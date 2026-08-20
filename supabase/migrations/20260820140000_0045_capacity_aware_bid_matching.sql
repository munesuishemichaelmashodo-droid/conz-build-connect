-- 0045: capacity-aware driver matching (Phase 2 -- database/server only).
--
-- Adds a truck reference and server-derived capacity-match metadata to
-- bids, entirely separate from pricing. compute_material_offer, quote_id,
-- pricing_version/breakdown, and the existing budget-validation trigger
-- are NOT touched by this migration. This only affects: which truck a bid
-- is placed with, and informational ranking/display fields computed from
-- that truck's real registered capacity vs the job's quantity.
--
-- Eligibility: per explicit product decision, no maximum-trip ceiling is
-- imposed here. A truck remains eligible regardless of how many trips
-- ceil(quantity_m3 / capacity_m3) requires -- this is a real operational
-- number for the driver's actual truck, not the pricing engine's fixed
-- 10m3 reference-truck trip estimate (a different, unrelated calculation
-- used only for quoting). If Con Z later wants an operational cap, that's
-- a separate business decision requiring evidence, not something invented
-- here.
--
-- Backwards compatible: truck_id is mandatory for NEW bids (INSERT) but
-- never retroactively forced onto an existing bid -- a pre-migration bid
-- with truck_id still null can continue to be viewed/edited exactly as
-- before; only its capacity fields stay null (never computed).
--
-- Tiers (single formula covers both single- and multi-trip bids):
--   packing efficiency = quantity_m3 / (estimated_trips * capacity_m3)
--   trips = 1 and efficiency >= 0.833 (capacity within ~1.2x of order) -> excellent
--   trips = 1 and efficiency >= 0.5   (capacity within ~2x of order)   -> good
--   trips = 1 and efficiency <  0.5                                    -> oversized
--   trips >= 2                                                          -> multiple_trips
-- Tier and score are informational/ranking metadata only -- they never
-- determine the winning bid; the customer always makes the final choice
-- via the existing accept_bid/accept_counter flow, which is unchanged.

alter table public.bids
  add column if not exists truck_id uuid references public.trucks(id),
  add column if not exists capacity_m3_snapshot numeric,
  add column if not exists estimated_trips integer,
  add column if not exists capacity_match_tier text,
  add column if not exists capacity_match_score numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bids_capacity_match_tier_check'
  ) then
    alter table public.bids
      add constraint bids_capacity_match_tier_check
      check (capacity_match_tier is null or capacity_match_tier in ('excellent', 'good', 'oversized', 'multiple_trips'));
  end if;
end $$;

create index if not exists idx_bids_truck_id on public.bids(truck_id);

comment on column public.bids.truck_id is
  'The driver''s registered truck (trucks.id) this bid is placed with. Server-verified on every insert/update (tg_stamp_bid_capacity) to belong to bids.driver_id -- a client can never bid using another driver''s truck.';
comment on column public.bids.capacity_m3_snapshot is
  'trucks.capacity_m3 at the time this bid was placed/last updated. Always server-derived from the actual truck record, never client-supplied, so a later change to the truck''s registered capacity does not silently rewrite historical bids.';
comment on column public.bids.estimated_trips is
  'ceil(job.quantity_m3 / truck.capacity_m3) for the selected truck -- an operational estimate for THIS bid''s actual truck, distinct from compute_material_offer''s fixed 10m3 reference-truck trip count used for pricing. Always server-computed.';
comment on column public.bids.capacity_match_tier is
  'excellent | good | oversized | multiple_trips. Informational ranking/display metadata only -- never determines the winning bid. Always server-computed.';
comment on column public.bids.capacity_match_score is
  'Packing efficiency = quantity_m3 / (estimated_trips * capacity_m3), 0-1, higher is a closer match. Always server-computed.';

create or replace function public.tg_stamp_bid_capacity()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  _truck public.trucks;
  _qty numeric;
  _trips int;
  _score numeric;
  _tier text;
begin
  if new.truck_id is null then
    if TG_OP = 'INSERT' then
      raise exception 'Select a registered truck to bid with.' using errcode = '23514';
    end if;
    -- Existing (pre-feature) bid being edited without ever attaching a
    -- truck: leave it exactly as it was rather than forcing the new
    -- requirement onto historical data. Capacity fields stay whatever
    -- they already are (null, for a legacy bid).
    new.capacity_m3_snapshot := old.capacity_m3_snapshot;
    new.estimated_trips := old.estimated_trips;
    new.capacity_match_tier := old.capacity_match_tier;
    new.capacity_match_score := old.capacity_match_score;
    return new;
  end if;

  select * into _truck from public.trucks where id = new.truck_id;
  if not found then
    raise exception 'Truck not found.' using errcode = '23503';
  end if;
  if _truck.driver_id <> new.driver_id then
    raise exception 'You can only bid using your own registered truck.' using errcode = '42501';
  end if;
  if _truck.capacity_m3 is null or _truck.capacity_m3 <= 0 then
    raise exception 'This truck has no valid registered capacity.' using errcode = '23514';
  end if;

  select quantity_m3 into _qty from public.jobs where id = new.job_id;
  if not found or _qty is null or _qty <= 0 then
    raise exception 'Job not found or has no valid quantity.' using errcode = '23503';
  end if;

  _trips := ceil(_qty / _truck.capacity_m3)::int;
  _score := round(_qty / (_trips * _truck.capacity_m3), 4);

  if _trips <= 1 and _score >= 0.833 then
    _tier := 'excellent';
  elsif _trips <= 1 and _score >= 0.5 then
    _tier := 'good';
  elsif _trips <= 1 then
    _tier := 'oversized';
  else
    _tier := 'multiple_trips';
  end if;

  -- Always server-derived -- overwrites anything the client sent for these
  -- four fields, on every insert AND every update where a truck_id is set.
  new.capacity_m3_snapshot := _truck.capacity_m3;
  new.estimated_trips := _trips;
  new.capacity_match_score := _score;
  new.capacity_match_tier := _tier;

  return new;
end;
$function$;

drop trigger if exists trg_stamp_bid_capacity on public.bids;
create trigger trg_stamp_bid_capacity
  before insert or update on public.bids
  for each row execute function public.tg_stamp_bid_capacity();

-- Close a real gap in the existing bid-integrity guard: a driver could
-- previously still silently rewrite price/delivery_date/message (and now
-- truck_id) via a direct upsert WHILE a customer's counter-offer was
-- awaiting their response (counter_status = 'countered'), bypassing the
-- intended accept_counter/reject_counter workflow. The existing immutable-
-- once-decided rule (status <> 'pending') is preserved unchanged; this
-- only adds the missing mid-negotiation case. Everything else in this
-- function (which already fully protects status/counter fields from any
-- direct client write) is unchanged.
create or replace function public.bids_guard_direct_write()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  _is_admin boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Not authorised to update this bid.' using errcode = '42501';
  end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);
  if _is_admin then return new; end if;

  if new.status     is distinct from old.status
     or new.job_id    is distinct from old.job_id
     or new.driver_id is distinct from old.driver_id
     or new.created_at is distinct from old.created_at
     or new.customer_counter_price is distinct from old.customer_counter_price
     or new.counter_status is distinct from old.counter_status
  then
    raise exception 'A bid''s status and counter-offer fields can only be changed through the app.'
      using errcode = '42501';
  end if;

  if old.driver_id = auth.uid() then
    if old.status <> 'pending' then
      raise exception 'This bid has already been decided and can no longer be edited.'
        using errcode = '42501';
    end if;
    if old.counter_status = 'countered'
       and (new.price is distinct from old.price
            or new.delivery_date is distinct from old.delivery_date
            or new.message is distinct from old.message
            or new.truck_id is distinct from old.truck_id) then
      raise exception 'Respond to the customer''s counter-offer before changing your bid.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'Not authorised to update this bid.' using errcode = '42501';
end $function$;
