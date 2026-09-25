-- Recovered verbatim from live supabase_migrations.schema_migrations on
-- 2026-09-25 (was applied live without a committed file).
-- enforce_customer_strikes(_user_id, _job_id, _stage, _reason): HIGH
-- finding from the closing security sweep. Only legitimate caller
-- (confirmed live) is cancel_job, always with _user_id = auth.uid().
-- No admin path, no driver path, no cron/NULL-session path calls this.
-- No frontend caller. Revoking client EXECUTE and adding the one
-- authorization rule the call graph actually supports: caller must be
-- acting on their own account. Strike calculation, thresholds,
-- cancellation_events semantics, and notification behavior unchanged.

REVOKE EXECUTE ON FUNCTION public.enforce_customer_strikes(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_customer_strikes(uuid, uuid, text, text) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_customer_strikes(_user_id uuid, _job_id uuid, _stage text, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _strikes   int;
  _until     timestamptz;
  _restrict  text;
  _title     text;
  _body      text;
begin
  if auth.uid() is null or auth.uid() <> _user_id then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  insert into public.cancellation_events(user_id, job_id, role, stage, reason)
  values (_user_id, _job_id, 'customer', _stage, _reason);

  _strikes := public.recent_cancellation_strikes(_user_id);

  update public.profiles
     set cancellation_strikes = _strikes
   where id = _user_id;

  if _strikes >= 7 then
    _until    := now() + interval '30 days';
    _restrict := 'Repeated cancellations after drivers accepted. Contact support.';
    _title    := 'Account restricted';
    _body     := 'Your account is restricted for 30 days after repeated cancellations. Contact support to appeal.';
  elsif _strikes >= 5 then
    _until    := now() + interval '7 days';
    _restrict := 'Five cancellations after acceptance in 90 days.';
    _title    := 'Booking paused for 7 days';
    _body     := 'You have cancelled 5 accepted jobs in 90 days. You can book again in 7 days.';
  elsif _strikes >= 3 then
    _until    := now() + interval '24 hours';
    _restrict := 'Three cancellations after acceptance in 90 days.';
    _title    := 'Booking paused for 24 hours';
    _body     := 'You have cancelled 3 accepted jobs. You can book again in 24 hours. Cancelling after a driver has accepted costs them a trip.';
  else
    _until    := null;
    _title    := 'Cancellation recorded';
    _body     := format('You cancelled a job a driver had already accepted (%s of 3 before booking is paused). Cancelling before acceptance is always free.', _strikes);
  end if;

  if _until is not null then
    update public.profiles
       set restricted_until  = greatest(coalesce(restricted_until, now()), _until),
           restriction_reason = _restrict
     where id = _user_id;
  end if;

  insert into public.notifications(user_id, type, title, body)
  values (_user_id, 'cancellation_strike', _title, _body);

  return jsonb_build_object('strikes', _strikes, 'restricted_until', _until);
end $function$;

REVOKE EXECUTE ON FUNCTION public.enforce_customer_strikes(uuid, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_customer_strikes(uuid, uuid, text, text) FROM anon, authenticated;
