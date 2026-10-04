-- 0065 — fix NULL handling in driver_can_accept_for()'s access check.
--
-- 0063/0064's check was `IF NOT (a OR b OR ...)`. With no signed-in user
-- (auth.uid() NULL) the comparisons are NULL, NOT NULL is NULL, and a NULL
-- IF condition does not raise — so the check let uid-less callers through.
-- Anonymous callers were still blocked by the EXECUTE revoke from 0063;
-- this makes the check itself fail closed.

CREATE OR REPLACE FUNCTION public.driver_can_accept_for(_job_id uuid, _driver_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _rate numeric; _req numeric;
  _bal numeric; _held numeric; _avail numeric;
  _free boolean; _has_profile boolean;
  _uid uuid := auth.uid();
begin
  select * into _job from public.jobs where id = _job_id;
  if not found then raise exception 'Job not found'; end if;

  -- The driver checking themself, an admin, or the job's customer accepting
  -- a bid from this driver (accept_bid / accept_counter). A NULL uid is
  -- only allowed for the server's own service_role key.
  -- coalesce: with a NULL uid every comparison is NULL, and IF NOT NULL
  -- does not raise — the check must treat "unknown" as "not allowed".
  if not coalesce((
       _uid = _driver_id
    or public.has_role(_uid, 'admin'::public.app_role)
    or public.has_role(_uid, 'super_admin'::public.app_role)
    or (_uid = _job.customer_id
        and exists (select 1 from public.bids b where b.job_id = _job_id and b.driver_id = _driver_id))
    or (_uid is null and auth.role() = 'service_role')
  ), false) then
    raise exception 'Not authorised to check this driver''s balance.' using errcode = '42501';
  end if;

  select first_job_free_used, true into _free, _has_profile
    from public.driver_profiles where user_id = _driver_id;
  if not coalesce(_has_profile, false) then
    return jsonb_build_object('ok', false, 'required', 0, 'available', 0,
      'reason', 'no_driver_profile');
  end if;

  select coalesce(balance,0), coalesce(held,0) into _bal, _held
    from public.wallets where user_id = _driver_id;
  _avail := coalesce(_bal,0) - coalesce(_held,0);

  if _free is not true then
    return jsonb_build_object('ok', true, 'required', 0,
      'available', _avail, 'free', true);
  end if;

  select (value::text)::numeric into _rate
    from public.system_settings where key = 'commission_rate';
  if _rate is null then raise exception 'commission_rate not configured'; end if;

  _req := round(coalesce(_job.final_price, _job.budget, 0) * _rate / 100.0, 2);

  return jsonb_build_object('ok', _avail >= _req, 'required', _req,
    'available', _avail, 'shortfall', greatest(0, _req - _avail), 'free', false);
end $function$;

REVOKE EXECUTE ON FUNCTION public.driver_can_accept_for(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.driver_can_accept_for(uuid, uuid) TO authenticated;
