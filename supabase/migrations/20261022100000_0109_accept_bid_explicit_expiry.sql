-- 0109: accept_bid refuses an expired offer by itself (defence in depth).
--
-- APPLIED to production 23/10/2026 with the owner's approval (recorded as version
-- 20261022100000; live body hash equals the tested local build). Undo:
-- supabase/rollbacks/20261022100000_0109_rollback.sql.
--
-- Why: expiry is already enforced today, but only indirectly. The BEFORE UPDATE
-- trigger tg_bids_offer_expiry (0062, live and enabled — read-only check
-- 22/10/2026) raises when a pending bid whose expires_at has passed is set to
-- 'accepted'. accept_bid relies on that trigger firing. If the trigger were ever
-- dropped, disabled or rewritten, an expired offer could be accepted silently.
-- This migration adds the same rule to accept_bid itself, so the function is
-- correct on its own.
--
-- What changes: one added check, directly after the existing status checks and
-- while the bid and job rows are already locked FOR UPDATE:
--   * clock_timestamp() (statement-time database clock, not the transaction
--     start) is compared with bids.expires_at. A bid that expires while this call
--     waits on a row lock is therefore still refused.
--   * same message and errcode (42501) as the trigger, so the app's existing
--     handling of "This offer has expired" keeps working.
--   * a pending bid with no expiry (NULL) is not treated as expired, matching the
--     trigger (0062 backfilled old rows and stamps every new one).
--
-- Not changed (body otherwise equals the live definition read 22/10/2026,
-- including the 0101 stock-is-advisory form): row locking order, ownership and
-- status checks, price validation, wallet affordability check, commission hold,
-- dispatch-offer supersede, grants. No data is touched; the live bids that are
-- pending past their expiry stay as they are.
--
-- Rollback: re-create accept_bid from 20261012330000_0101_stock_is_advisory.sql.
-- Depends on: 0062 (bids.expires_at), 0101 (the body this extends).

create or replace function public.accept_bid(_bid_id uuid)
 returns jobs
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  _bid   public.bids;
  _job   public.jobs;
  _guard jsonb;
  _loc   public.material_supply_locations;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _bid from public.bids where id = _bid_id for update;
  if not found then raise exception 'Bid not found'; end if;

  select * into _job from public.jobs where id = _bid.job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.customer_id <> auth.uid() then raise exception 'Not your job'; end if;
  if _job.status <> 'open' then raise exception 'Job not open'; end if;
  if _bid.status <> 'pending' then raise exception 'Bid no longer available'; end if;

  -- (0109) An offer past its expiry can no longer be accepted, whatever the
  -- trigger does. Checked after the row locks, against the live database clock.
  if _bid.expires_at is not null and _bid.expires_at < clock_timestamp() then
    raise exception 'This offer has expired. Ask the driver to send it again.'
      using errcode = '42501';
  end if;

  -- F1: never let an invalid price become the job's final price.
  if not public.is_valid_money(_bid.price) then
    raise exception 'This offer has an invalid price and cannot be accepted.';
  end if;

  -- (0101) No inventory reservation: supplier stock is advisory and is neither checked nor changed here.

  update public.bids set status = 'accepted' where id = _bid_id;
  update public.bids set status = 'rejected'
   where job_id = _job.id and id <> _bid_id and status = 'pending';

  update public.jobs
     set status = 'accepted', driver_id = _bid.driver_id,
         accepted_bid_id = _bid_id, final_price = _bid.price
   where id = _job.id
  returning * into _job;

  _guard := public.driver_can_accept_for(_job.id, _bid.driver_id);
  if (_guard->>'ok')::boolean is not true then
    raise exception 'Driver has insufficient wallet balance: needs $%, has $% available',
      _guard->>'required', _guard->>'available';
  end if;

  perform public.hold_job_commission(_job.id);

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job.id and status = 'pending';

  return _job;
end $function$;

revoke all on function public.accept_bid(uuid) from public, anon;
grant execute on function public.accept_bid(uuid) to authenticated, service_role;
