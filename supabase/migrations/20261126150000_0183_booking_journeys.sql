-- -----------------------------------------------------------------------------
-- 0183: two customer booking journeys (Stage 2, 26/11/2026; revised 27/11/2026).
--
-- The customer first chooses A "Transport only" (already has the materials) or B "Materials and transport" (the
-- existing materials order, job_kind NULL, unchanged). A transport-only job has a job_kind:
--   transport_only       the load is at the customer's own yard, site or another place
--   collect_and_deliver  the driver collects materials the customer bought at a shop, yard or other location
--                        (the shop name is only a collection detail the customer types; Con Z has no supplier accounts)
--
-- A transport-only job is never a material order: material = 'custom', no material quote, no supply location, the
-- load description (custom_material) is required. Two ways to post it, both from the customer's collection point:
--   pricing_basis 'transport_only'     transport pricing is ON: the existing 0158/0159 path (server-measured road
--                                      distance, single-use transport quote, budget inside the guide band).
--   pricing_basis 'transport_request'  transport pricing is OFF (or no price could be worked out): no Con Z price,
--                                      no guide range, no quote; the budget is the customer's own offer and drivers
--                                      accept it or send their own price. Allowed whatever the switch says, so the
--                                      switch never takes the transport-only choice away from the customer.
-- No second pricing engine; the commission is unchanged (7% of the accepted price, which for these jobs is the
-- transport fare). Con Z arranges transport only; the customer arranges and pays for materials.
--
-- New nullable job columns (existing jobs keep NULL = the legacy journey; nothing is backfilled):
--   job_kind, load_details, truck_requirement, preferred_time,
--   collection_name, collection_contact, collection_reference.
-- Rules enforced here (not only in the app):
--   * job_kind needs pricing_basis 'transport_only' or 'transport_request', material 'custom', no material quote,
--     a load description, and a collection point in Zimbabwe; 'transport_request' also needs no transport quote, a
--     customer offer of $1-$100,000, and stores no guide range. Clients cannot post a transport-priced job without
--     a job_kind (no contradictory "material order priced as transport"). pricing_basis is widened to allow
--     'transport_request' (constraint replaced; the only DROP is that constraint, re-added in the same statement).
--   * collect_and_deliver needs a collection_name; transport_only must not carry collection fields (switching
--     journeys cannot leave hidden data behind).
--   * Length and control-character limits on every free-text field.
--   * After posting: job_kind can never change; the customer may correct the collection contact / reference /
--     details while the job is open or accepted; drivers can change none of these fields.
-- Privacy for drivers who have not been selected (mask_job_for_driver, find_next_loads_for_driver):
--   * a customer-chosen collection point (both transport bases) is shown as an area with ~1 km coordinates,
--     like the delivery point; collection contact and reference are removed; load details, the load description
--     (custom_material) and the shop / collection place name are contact-redacted (phone numbers and e-mails removed).
--   * Before 0183 the collection point of a transport-priced job was returned exactly; no such job exists live
--     (the transport switch has always been off).
-- No DELETE; the only DROP is the pricing_basis check constraint, replaced by a wider one in the same statement.
-- Undo: supabase/rollbacks/20261126150000_0183_rollback.sql.
-- -----------------------------------------------------------------------------

-- 1. Columns ------------------------------------------------------------------------------------------------
alter table public.jobs
  add column if not exists job_kind text
    check (job_kind is null or job_kind in ('transport_only', 'collect_and_deliver')),
  add column if not exists load_details text
    check (load_details is null or (char_length(load_details) <= 300 and load_details !~ '[[:cntrl:]]')),
  add column if not exists truck_requirement text
    check (truck_requirement is null or truck_requirement in ('any', 'tipper', 'dropside', 'flatbed')),
  add column if not exists preferred_time text
    check (preferred_time is null or preferred_time in ('any', 'morning', 'afternoon')),
  add column if not exists collection_name text
    check (collection_name is null or (char_length(collection_name) between 2 and 120 and collection_name !~ '[[:cntrl:]]')),
  add column if not exists collection_contact text
    check (collection_contact is null or (char_length(collection_contact) <= 120 and collection_contact !~ '[[:cntrl:]]')),
  add column if not exists collection_reference text
    check (collection_reference is null or (char_length(collection_reference) <= 80 and collection_reference !~ '[[:cntrl:]]'));

-- 2. Validation (SECURITY INVOKER on purpose: current_user must be the caller) -----------------------------
alter table public.jobs
  drop constraint if exists jobs_pricing_basis_check,
  add constraint jobs_pricing_basis_check
    check (pricing_basis in ('legacy_material_plus_transport', 'transport_only', 'transport_request'));

create or replace function public.tg_validate_job_kind()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  _client boolean := current_user in ('authenticated', 'anon');
  _is_customer boolean;
begin
  -- Empty strings are stored as NULL.
  new.load_details := nullif(btrim(new.load_details), '');
  new.collection_name := nullif(btrim(new.collection_name), '');
  new.collection_contact := nullif(btrim(new.collection_contact), '');
  new.collection_reference := nullif(btrim(new.collection_reference), '');

  if tg_op = 'UPDATE' and _client then
    if new.job_kind is distinct from old.job_kind then
      raise exception 'The type of booking cannot be changed after posting.' using errcode = '42501';
    end if;
    if (new.collection_name, new.collection_contact, new.collection_reference, new.load_details,
        new.truck_requirement, new.preferred_time)
       is distinct from
       (old.collection_name, old.collection_contact, old.collection_reference, old.load_details,
        old.truck_requirement, old.preferred_time) then
      _is_customer := auth.uid() is not null and auth.uid() = old.customer_id;
      if not _is_customer then
        raise exception 'Only the customer can change the collection details.' using errcode = '42501';
      end if;
      if old.status not in ('open', 'accepted') then
        raise exception 'Collection details can only be changed before the load is collected.' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.job_kind is null then
    if new.collection_name is not null or new.collection_contact is not null or new.collection_reference is not null then
      raise exception 'Collection details need a booking type.' using errcode = '22023';
    end if;
    if new.pricing_basis = 'transport_request' then
      raise exception 'A transport request needs a booking type.' using errcode = '22023';
    end if;
    if tg_op = 'INSERT' and _client and new.pricing_basis = 'transport_only' then
      raise exception 'Choose transport only to book a transport-priced trip.' using errcode = '22023';
    end if;
    return new;
  end if;

  if new.pricing_basis not in ('transport_only', 'transport_request') then
    raise exception 'This booking type must be priced for transport only.' using errcode = '22023';
  end if;
  if new.pickup_lat is null or new.pickup_lng is null or nullif(btrim(coalesce(new.pickup_address, '')), '') is null then
    raise exception 'Choose where the load is collected.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    -- A transport-only job is never a material order (no catalogue material, material quote or supply location).
    if new.material is distinct from 'custom' or new.quote_id is not null or new.supply_location_id is not null then
      raise exception 'A transport-only booking cannot include a material order.' using errcode = '22023';
    end if;
    if char_length(btrim(coalesce(new.custom_material, ''))) not between 2 and 120
       or new.custom_material ~ '[[:cntrl:]]' then
      raise exception 'Say what the driver is moving (2 to 120 characters).' using errcode = '22023';
    end if;
    if not (new.pickup_lat between -23.0 and -15.0 and new.pickup_lng between 25.0 and 33.5) then
      raise exception 'The collection point must be in Zimbabwe.' using errcode = '22023';
    end if;
  end if;
  if new.pricing_basis = 'transport_request' then
    if new.transport_quote_id is not null then
      raise exception 'A transport request has no Con Z price quote.' using errcode = '22023';
    end if;
    if tg_op = 'INSERT' then
      if new.budget is null or new.budget < 1 or new.budget > 100000 then
        raise exception 'Enter an offer between $1 and $100,000.' using errcode = '22023';
      end if;
      new.pricing_breakdown := null;  -- no guide range: nothing stored that could look like a Con Z price
      new.pricing_version := null;
    end if;
  end if;
  if new.job_kind = 'collect_and_deliver' then
    if new.collection_name is null then
      raise exception 'Give the name of the shop or place where the materials are collected.' using errcode = '22023';
    end if;
  else
    if new.collection_name is not null or new.collection_contact is not null or new.collection_reference is not null then
      raise exception 'Shop collection details only apply to a customer-arranged collection booking.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tg_validate_job_kind() from public, anon, authenticated;
create or replace trigger trg_jobs_validate_kind
  before insert or update on public.jobs
  for each row execute function public.tg_validate_job_kind();

-- 3. What drivers who have not been selected see -------------------------------------------------------------
create or replace function public.mask_job_for_driver(j public.jobs)
returns public.jobs language plpgsql immutable set search_path to 'public' as $$
begin
  j.delivery_address := public.coarse_place(j.delivery_address);
  j.delivery_lat := public.coarse_coord(j.delivery_lat);
  j.delivery_lng := public.coarse_coord(j.delivery_lng);
  j.dropoff_address := null; j.dropoff_lat := null; j.dropoff_lng := null;
  j.notes := public.redact_contacts(j.notes);
  j.receiver_name := null;
  j.tracking_token := null;
  j.delivery_pin := null;
  j.delivery_photo_url := null; j.pickup_photo_url := null;
  -- (0183) A collection point the customer chose is private like the delivery point; the listed pickup
  -- locations of legacy material pricing stay as they were.
  if j.pricing_basis in ('transport_only', 'transport_request') then
    j.pickup_address := public.coarse_place(j.pickup_address);
    j.pickup_lat := public.coarse_coord(j.pickup_lat);
    j.pickup_lng := public.coarse_coord(j.pickup_lng);
  end if;
  j.collection_contact := null;
  j.collection_reference := null;
  -- Free text the customer typed: phone numbers and e-mail addresses removed, like the notes.
  j.load_details := public.redact_contacts(j.load_details);
  j.custom_material := public.redact_contacts(j.custom_material);
  j.collection_name := public.redact_contacts(j.collection_name);
  return j;
end $$;
revoke all on function public.mask_job_for_driver(public.jobs) from public, anon, authenticated;

create or replace function public.find_next_loads_for_driver(_driver_id uuid, _current_job_id uuid)
returns table(job_id uuid, material public.material_category, quantity_m3 numeric, pickup_address text,
              pickup_lat double precision, pickup_lng double precision, delivery_address text,
              delivery_lat double precision, delivery_lng double precision, budget numeric, preferred_date date,
              repositioning_km numeric, next_load_km numeric, empty_km_saved numeric, capacity_tier text,
              capacity_trips integer, recommendation_tier text)
language sql stable security definer set search_path to 'public'
as $$
  select e.job_id, e.material, e.quantity_m3,
         case when j.pricing_basis in ('transport_only', 'transport_request') then public.coarse_place(e.pickup_address) else e.pickup_address end,
         case when j.pricing_basis in ('transport_only', 'transport_request') then public.coarse_coord(e.pickup_lat) else e.pickup_lat end,
         case when j.pricing_basis in ('transport_only', 'transport_request') then public.coarse_coord(e.pickup_lng) else e.pickup_lng end,
         public.coarse_place(e.delivery_address), public.coarse_coord(e.delivery_lat), public.coarse_coord(e.delivery_lng),
         e.budget, e.preferred_date, e.repositioning_km, e.next_load_km, e.empty_km_saved, e.capacity_tier,
         e.capacity_trips, e.recommendation_tier
    from public._find_next_loads_exact(_driver_id, _current_job_id) e
    left join public.jobs j on j.id = e.job_id
$$;
revoke all on function public.find_next_loads_for_driver(uuid, uuid) from public, anon;
grant execute on function public.find_next_loads_for_driver(uuid, uuid) to authenticated;
