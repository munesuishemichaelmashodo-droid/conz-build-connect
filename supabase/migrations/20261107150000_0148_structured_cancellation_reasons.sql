-- 0148 — structured cancellation reasons (learning loop: why do requests fail?).
-- Today a cancellation has only free text (jobs.cancellation_reason / cancellation_events.reason), so "why do
-- requests fail" cannot be counted. This adds ONE optional category per cancellation, chosen by the person who
-- cancelled, plus a server-side classification of the 24 h driver no-show sweep.
--
--   * jobs.cancellation_reason_code and cancellation_events.reason_code: nullable, CHECK-constrained categories.
--     NULL means unknown / not provided. Historical rows stay NULL; nothing is back-filled or guessed.
--   * record_cancellation_reason(job, code): the caller must be the person who cancelled the job (cancelled_by =
--     caller; role derived by the server from the job), OR the driver describing their own recent release of a
--     job (their own cancellation_events row, last 24 h). Role-appropriate categories only; once per cancellation.
--   * Clients cannot write the columns: a guard trigger refuses changes made as authenticated/anon, and the actor
--     is never taken from the client.
--   * The sweep (cancelled_by null, its exact reason) is classified 'driver_did_not_arrive' by a trigger. A
--     customer cancelling by hand with the same wording has cancelled_by set, so it is NOT classified.
--   * Reopening a cancelled job (0147) clears the category.
--   * The free-text reason is untouched. cancel_job, the sweep and all commission/wallet functions are NOT modified.
-- Undo: supabase/rollbacks/20261107150000_0148_rollback.sql. NOT APPLIED to any hosted project.

create or replace function public.cancellation_reason_known(_code text)
returns boolean language sql immutable as $$
  select _code = any (array[
    'no_suitable_driver', 'no_driver_responded', 'price_too_high', 'driver_did_not_arrive',
    'driver_cancelled_after_accepting', 'customer_changed_plans', 'material_unavailable',
    'delivery_details_changed', 'other'
  ])
$$;

-- Role-appropriate choices. A driver cannot pick customer-side reasons such as price or "no driver responded".
create or replace function public.cancellation_reason_allowed(_role text, _code text)
returns boolean language sql immutable as $$
  select public.cancellation_reason_known(_code) and case _role
    when 'customer' then true
    when 'admin' then true
    when 'driver' then _code in ('material_unavailable', 'delivery_details_changed', 'other')
    else false
  end
$$;

alter table public.jobs
  add column if not exists cancellation_reason_code text
  constraint jobs_cancellation_reason_code_check
    check (cancellation_reason_code is null or public.cancellation_reason_known(cancellation_reason_code));

alter table public.cancellation_events
  add column if not exists reason_code text
  constraint cancellation_events_reason_code_check
    check (reason_code is null or public.cancellation_reason_known(reason_code));

create index if not exists jobs_cancellation_reason_code_idx
  on public.jobs (cancellation_reason_code) where cancellation_reason_code is not null;
create index if not exists cancellation_events_reason_code_idx
  on public.cancellation_events (reason_code) where reason_code is not null;

create or replace function public.tg_jobs_cancellation_code()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  -- Only the server may set or change the category. (Security INVOKER on purpose: current_user must be the caller.)
  if current_user in ('authenticated', 'anon')
     and new.cancellation_reason_code is distinct from old.cancellation_reason_code then
    raise exception 'cancellation_reason_code is set by the server' using errcode = '42501';
  end if;
  -- The 24 h no-show sweep: system cancellation (cancelled_by stays null) with its exact reason.
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and new.cancelled_by is null
     and new.cancellation_reason = 'Driver did not start pickup within 24 hours of accepting'
     and new.cancellation_reason_code is null then
    new.cancellation_reason_code := 'driver_did_not_arrive';
  end if;
  -- A reopened job is no longer cancelled.
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    new.cancellation_reason_code := null;
  end if;
  return new;
end $$;
revoke all on function public.tg_jobs_cancellation_code() from public, anon, authenticated;
grant execute on function public.tg_jobs_cancellation_code() to service_role;

create or replace trigger trg_jobs_cancellation_code
  before update on public.jobs
  for each row execute function public.tg_jobs_cancellation_code();

create or replace function public.tg_cancellation_events_code_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user in ('authenticated', 'anon') and new.reason_code is not null
     and (tg_op = 'INSERT' or new.reason_code is distinct from old.reason_code) then
    raise exception 'reason_code is set by the server' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tg_cancellation_events_code_guard() from public, anon, authenticated;
grant execute on function public.tg_cancellation_events_code_guard() to service_role;

create or replace trigger trg_cancellation_events_code_guard
  before insert or update on public.cancellation_events
  for each row execute function public.tg_cancellation_events_code_guard();

create or replace function public.record_cancellation_reason(_job_id uuid, _code text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  _uid uuid := auth.uid();
  _job public.jobs;
  _role text;
  _event uuid;
begin
  if _uid is null then raise exception 'Sign in required'; end if;
  if _code is null or not public.cancellation_reason_known(_code) then
    raise exception 'Unknown cancellation reason' using errcode = '22023';
  end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  -- The person who cancelled this job describes it. Their role comes from the job, never from the client.
  if _job.status = 'cancelled' and _job.cancelled_by = _uid then
    _role := case when _uid = _job.customer_id then 'customer'
                  when _uid = _job.driver_id then 'driver'
                  else 'admin' end;
    if not public.cancellation_reason_allowed(_role, _code) then
      raise exception 'That reason is not available for your role' using errcode = '22023';
    end if;
    if _job.cancellation_reason_code is not null then
      raise exception 'A reason was already recorded for this cancellation' using errcode = '22023';
    end if;
    update public.jobs set cancellation_reason_code = _code where id = _job_id;
    update public.cancellation_events set reason_code = _code
     where id = (select id from public.cancellation_events
                  where job_id = _job_id and user_id = _uid and reason_code is null
                  order by created_at desc limit 1);
    return;
  end if;

  -- A driver describing their own recent release of a job (the job reopened, so it is not cancelled).
  select id into _event from public.cancellation_events
   where job_id = _job_id and user_id = _uid and role = 'driver' and reason_code is null
     and created_at > now() - interval '24 hours'
   order by created_at desc limit 1;
  if _event is not null then
    if not public.cancellation_reason_allowed('driver', _code) then
      raise exception 'That reason is not available for your role' using errcode = '22023';
    end if;
    update public.cancellation_events set reason_code = _code where id = _event;
    return;
  end if;

  raise exception 'There is no cancellation of yours to describe' using errcode = '42501';
end $$;
revoke all on function public.record_cancellation_reason(uuid, text) from public, anon;
grant execute on function public.record_cancellation_reason(uuid, text) to authenticated, service_role;
