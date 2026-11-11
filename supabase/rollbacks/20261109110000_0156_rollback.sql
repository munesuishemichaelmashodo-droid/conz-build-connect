-- Undo 0156: back to the 0154 function and the 0153 trucks policy; remove the digits check (has DROP: SQL editor).
alter table public.trucks drop constraint if exists trucks_declared_facts_no_digits;
alter policy "Customers read trucks offered on their jobs" on public.trucks
  using (exists (select 1 from public.jobs j where j.customer_id = auth.uid() and j.driver_id = trucks.driver_id
                   and j.status in ('accepted', 'in_progress', 'completed')));

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
         status = 'pending'
   where public.bids.status in ('pending', 'withdrawn');

  update public.job_dispatch_offers
     set status = 'accepted', responded_at = now() where id = _offer_id;

  return job_row.id;
end $$;

revoke all on function public.accept_dispatch_offer(uuid) from public, anon;
grant execute on function public.accept_dispatch_offer(uuid) to authenticated, service_role;
