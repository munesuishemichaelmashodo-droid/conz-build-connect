-- 0102 — drivers can decline a dispatch offer (server-side).
--
-- Gap: the app's "Decline"/dismiss button only closed the dialog on the driver's own screen. The server never
-- learned of the decision, so the offer stayed pending until it timed out and the next progressive wave waited.
--
-- Change: decline_dispatch_offer(_offer_id) — only the offered driver; pending offers only; marks the offer
-- 'rejected' with responded_at, then (when the job is still open and nothing else is pending) asks the existing
-- expiry/expansion logic for the next wave. Idempotent: returns false for an offer that is not pending or a job
-- that is no longer open. Never creates offers for the decliner again (create_dispatch_wave already excludes
-- drivers who have ever been offered the job). No change to accept_dispatch_offer, eligibility or radius stages.
--
-- Deploy order: after 0089 (dispatch). Standalone otherwise. App: the decline button calls it (best effort).
-- Rollback: drop function public.decline_dispatch_offer(uuid).

create or replace function public.decline_dispatch_offer(_offer_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _o public.job_dispatch_offers%rowtype;
  _job_status text;
  _jid uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  -- lock order: job first, then offer (same order as accept_dispatch_offer, see 0105)
  select job_id into _jid from public.job_dispatch_offers where id = _offer_id;
  if not found then
    raise exception 'Not your offer' using errcode = '42501';
  end if;
  perform 1 from public.jobs where id = _jid for update;
  select * into _o from public.job_dispatch_offers where id = _offer_id for update;
  if not found or _o.driver_id <> auth.uid() then
    raise exception 'Not your offer' using errcode = '42501';
  end if;

  if _o.status <> 'pending' then
    return false;
  end if;

  select status::text into _job_status from public.jobs where id = _o.job_id;
  if _job_status is distinct from 'open' then
    return false;
  end if;

  update public.job_dispatch_offers
     set status = 'rejected', responded_at = now()
   where id = _offer_id;

  -- widen right away if this was the last pending offer (reuses the existing staged logic)
  perform public.expire_stale_dispatch_offers(_o.job_id);
  return true;
end $$;

comment on function public.decline_dispatch_offer(uuid) is
  '0102: the offered driver declines; records rejected + responded_at and triggers the next progressive wave when nothing else is pending. Idempotent.';

revoke all on function public.decline_dispatch_offer(uuid) from public, anon;
grant execute on function public.decline_dispatch_offer(uuid) to authenticated, service_role;
