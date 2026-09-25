-- Recovered verbatim from live supabase_migrations.schema_migrations on
-- 2026-09-25 (was applied live without a committed file).
-- Additional findings from the same audit pass, same category of bug:
-- hold_job_commission and release_job_commission both had EXECUTE granted
-- to anon/authenticated/PUBLIC with no auth.uid() check, and are callable
-- directly on any job id. Neither can be used to steal funds outright
-- (both are idempotent -- hold_job_commission short-circuits if
-- held_commission is already set, release_job_commission's greatest(...,0)
-- can't push held negative), but both let a client manipulate another
-- user's wallet.held figure and another job's held_commission accounting
-- on jobs they have nothing to do with, which is a real integrity/griefing
-- issue worth closing with the same pattern.
--
-- Callers confirmed live, all owned by `postgres`, all SECURITY DEFINER:
--   hold_job_commission    <- accept_bid, accept_counter, accept_dispatch_offer
--                              (each already checks the caller is the job's
--                              customer or the accepting driver before
--                              calling this)
--   release_job_commission <- complete_job, release_escrow_and_complete,
--                              cancel_job (each already checks customer/
--                              driver/admin before calling this),
--                              resolve_dispute (admin-gated at its own top),
--                              expire_stale_accepted_jobs (a cron sweep with
--                              no user session -- auth.uid() is NULL there,
--                              same as auto_release_escrow_payments)
-- No caller of either function is itself reachable by an unauthorized
-- party, so revoking client EXECUTE is sufficient and safe by the same
-- owner-privilege mechanism used above. An internal check is added too,
-- as defense-in-depth, shaped to match each function's actual legitimate
-- callers rather than copying release_escrow_and_complete's check
-- verbatim -- release_job_commission's callers include admin-initiated
-- paths (resolve_dispute, admin cancelling any job via cancel_job) that
-- hold_job_commission's callers do not have.

REVOKE EXECUTE ON FUNCTION public.hold_job_commission(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hold_job_commission(uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.hold_job_commission(_job_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job  public.jobs;
  _rate numeric;
  _amt  numeric;
begin
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  -- Defense-in-depth (see migration header): legitimate callers are
  -- accept_bid/accept_counter/accept_dispatch_offer, which by this point
  -- have already set _job.driver_id to the accepting driver and already
  -- verified the caller is that driver or the job's customer.
  if auth.uid() is not null
     and auth.uid() <> _job.customer_id
     and auth.uid() <> _job.driver_id
  then
    raise exception 'Not authorised to hold commission on this job.' using errcode = '42501';
  end if;

  if _job.held_commission is not null then
    return _job.held_commission;             -- already reserved
  end if;

  -- first job free: nothing to reserve
  if not coalesce(
       (select first_job_free_used from public.driver_profiles
         where user_id = _job.driver_id), false) then
    update public.jobs set held_commission = 0 where id = _job_id;
    return 0;
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _amt := round(coalesce(_job.final_price, _job.budget, 0) * _rate / 100.0, 2);

  update public.wallets
     set held = coalesce(held, 0) + _amt, updated_at = now()
   where user_id = _job.driver_id;

  if not found then
    raise exception 'Driver % has no wallet', _job.driver_id;
  end if;

  update public.jobs set held_commission = _amt where id = _job_id;
  return _amt;
end $function$;

REVOKE EXECUTE ON FUNCTION public.hold_job_commission(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hold_job_commission(uuid) FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.release_job_commission(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_job_commission(uuid) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.release_job_commission(_job_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _job public.jobs;
  _amt numeric;
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then return 0; end if;

  -- Defense-in-depth (see migration header): unlike hold_job_commission,
  -- this function's legitimate callers include admin-initiated paths
  -- (resolve_dispute is admin-gated at its own top; cancel_job allows an
  -- admin to cancel any job, not just their own), plus
  -- expire_stale_accepted_jobs, a cron sweep with no user session (NULL
  -- auth.uid()). The customer/driver/NULL/admin check below matches
  -- exactly those callers -- nothing wider, nothing narrower.
  if auth.uid() is not null
     and auth.uid() <> _job.customer_id
     and auth.uid() <> _job.driver_id
     and not (public.has_role(auth.uid(), 'admin'::public.app_role)
              or public.has_role(auth.uid(), 'super_admin'::public.app_role))
  then
    raise exception 'Not authorised to release commission on this job.' using errcode = '42501';
  end if;

  _amt := coalesce(_job.held_commission, 0);
  if _amt = 0 or _job.driver_id is null then
    update public.jobs set held_commission = null where id = _job_id;
    return 0;
  end if;

  -- greatest(...,0) so a double release can never push held negative
  update public.wallets
     set held = greatest(coalesce(held, 0) - _amt, 0), updated_at = now()
   where user_id = _job.driver_id;

  update public.jobs set held_commission = null where id = _job_id;
  return _amt;
end $function$;

REVOKE EXECUTE ON FUNCTION public.release_job_commission(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_job_commission(uuid) FROM anon, authenticated;
