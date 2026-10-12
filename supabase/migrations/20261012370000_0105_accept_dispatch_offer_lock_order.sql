-- 0105 — accept_dispatch_offer: consistent lock order (job row first, then the offer row).
--
-- Defect (found by scripts/db-concurrency-check.sh S10, true parallel run): two eligible drivers accepting offers on the
-- SAME open job at the same instant deadlock. Each transaction locked its own offer row first and then the job row; the
-- winner then updates every other pending offer of the job (including the loser's locked row) while the loser waits for
-- the job lock => "deadlock detected". Postgres aborts one side, so there was never a double claim, but the loser got
-- an opaque 40P01 error instead of "Offer no longer available", and under load it could abort the winner instead.
--
-- Fix: take the job lock first, then the offer lock, in every path that touches both (same order as the winner's
-- bulk update). Behaviour and messages are otherwise unchanged (body copied from 0089 with only the two locks reordered).
--
-- Deploy order: AFTER 0089 (this replaces 0089's function). Standalone otherwise. No data change.
-- Rollback: re-apply 0089's function body.

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

  update public.jobs
     set driver_id = auth.uid(), status = 'accepted',
         final_price = coalesce(final_price, budget)
   where id = job_row.id;

  perform public.hold_job_commission(job_row.id);

  update public.bids
     set status = 'rejected'
   where job_id = job_row.id and status = 'pending';

  update public.job_dispatch_offers
     set status = 'accepted', responded_at = now() where id = _offer_id;
  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = job_row.id and id <> _offer_id and status = 'pending';

  return job_row.id;
end $$;

revoke all on function public.accept_dispatch_offer(uuid) from public, anon;
grant execute on function public.accept_dispatch_offer(uuid) to authenticated, service_role;
