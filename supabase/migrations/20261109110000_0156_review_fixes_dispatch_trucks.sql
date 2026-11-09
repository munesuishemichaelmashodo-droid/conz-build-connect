-- 0156: review fixes on 0152-0155.
-- 1. accept_dispatch_offer (0154): an offer revived from 'withdrawn' kept its old expiry and counter-offer state, so the customer
--    could be left with an expired or stale offer while the driver saw success. The revived offer now gets a fresh 30-minute
--    expiry and a clean counter state, and the function refuses (instead of silently succeeding) when the driver's earlier
--    response is final (rejected or accepted).
-- 2. trucks policy (0153): a customer could read every truck of the assigned driver, even after completion. Now only the truck
--    named on the accepted offer of the customer's own job.
-- 3. Declared truck facts (0152) are free text; reject anything that looks like a phone number (5+ digits in a row), so a driver
--    cannot pass contact details to the customer through make/model/colour before the job is chosen.
-- No DROP. Undo: supabase/rollbacks/20261109110000_0156_rollback.sql.

create or replace function public.accept_dispatch_offer(_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  offer_row public.job_dispatch_offers%rowtype;
  job_row   public.jobs%rowtype;
  _jid      uuid;
  guard     jsonb;
  _outer    numeric;
  _truck    uuid;
  _n        integer;
begin
  -- lock order: job first, then offer (matches the winner's bulk update of sibling offers)
  select job_id into _jid from public.job_dispatch_offers where id = _offer_id;
  if not found then raise exception 'Offer not found'; end if;
  select * into job_row from public.jobs where id = _jid for update;

  select * into offer_row from public.job_dispatch_offers where id = _offer_id for update;
  if not found then raise exception 'Offer not found'; end if;
  if offer_row.driver_id <> auth.uid() then raise exception 'Not your offer'; end if;
  if offer_row.status <> 'pending' then raise exception 'Offer no longer available'; end if;

  if offer_row.expires_at < now() then
    update public.job_dispatch_offers
       set status = 'expired', responded_at = now() where id = _offer_id;
    raise exception 'Offer expired';
  end if;

  if job_row.status <> 'open' then raise exception 'Job no longer available'; end if;

  -- 0089: the driver must STILL be eligible for this job (location, truck,
  -- availability, verification, account, wallet, no active job), checked at the
  -- outer radius under the job row lock. The UI is not a security boundary.
  _outer := (select max(r) from unnest(public.dispatch_stage_radii()) r);
  if not exists (select 1 from public.eligible_dispatch_drivers(job_row.id, _outer) e where e.driver_id = auth.uid()) then
    raise exception 'You are not eligible for this job (too far from the pickup, unavailable, or no registered truck).'
      using errcode = '42501';
  end if;

  if not public.is_valid_money(coalesce(job_row.final_price, job_row.budget)) then
    raise exception 'This job has an invalid price and cannot be accepted.';
  end if;

  guard := public.driver_can_accept(job_row.id);
  if (guard->>'ok')::boolean is not true then
    raise exception 'Insufficient wallet balance: need $% commission, have $% available',
      guard->>'required', guard->>'available';
  end if;

  -- The customer chooses. Answering a dispatch request sends the customer an offer at their own
  -- price (the same row a driver's "Send offer" makes); it does NOT assign the job or reserve
  -- commission. Both happen only when the customer picks this driver (accept_bid).
  select t.id into _truck
    from public.trucks t
   where t.driver_id = auth.uid()
   order by ceil(job_row.quantity_m3 / nullif(t.capacity_m3, 0)), t.capacity_m3
   limit 1;

  insert into public.bids (job_id, driver_id, price, truck_id, message)
  values (job_row.id, auth.uid(), coalesce(job_row.final_price, job_row.budget), _truck, null)
  on conflict (job_id, driver_id) do update
     set price = excluded.price,
         truck_id = excluded.truck_id,
         status = 'pending',
         expires_at = now() + interval '30 minutes',
         counter_status = 'none',
         customer_counter_price = null
   where public.bids.status in ('pending', 'withdrawn');
  get diagnostics _n = row_count;
  if _n = 0 then
    raise exception 'You already have a response on this job.';
  end if;

  update public.job_dispatch_offers
     set status = 'accepted', responded_at = now() where id = _offer_id;

  return job_row.id;
end $$;

revoke all on function public.accept_dispatch_offer(uuid) from public, anon;
grant execute on function public.accept_dispatch_offer(uuid) to authenticated, service_role;

alter policy "Customers read trucks offered on their jobs" on public.trucks
  using (exists (
    select 1
      from public.jobs j
      join public.bids b on b.id = j.accepted_bid_id
     where j.customer_id = auth.uid()
       and b.truck_id = trucks.id
       and j.status in ('accepted', 'in_progress', 'completed')
  ));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trucks_declared_facts_no_digits' and conrelid = 'public.trucks'::regclass) then
    alter table public.trucks add constraint trucks_declared_facts_no_digits
      check (coalesce(make, '') !~ '\d{5,}' and coalesce(model, '') !~ '\d{5,}' and coalesce(colour, '') !~ '\d{5,}');
  end if;
end $$;
