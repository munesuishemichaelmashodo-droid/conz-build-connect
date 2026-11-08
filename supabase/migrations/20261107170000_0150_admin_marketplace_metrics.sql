-- 0150 — practical, aggregate marketplace metrics for admins + no-show reopening tracking.
-- Question answered: is ConZ improving SUCCESSFUL deliveries, and why do requests fail? Reuses existing data only.
--   * jobs.no_show_reopened_at: set by customer_reopen_no_show_job (the only change to that 0147 function: one extra
--     assignment). A reopened request is therefore counted as a reopening, never as a new request. Clients cannot
--     write the column (invoker-security guard trigger).
--   * admin_marketplace_metrics(days): admin / super_admin only; returns counts as {n, d} pairs so every rate has an
--     explicit numerator and denominator; jobs and offers are separate sections; no identifiers are returned.
--     Jobs are the cohort created in the window; offers are dispatch offers sent in the window (system exclusion
--     rows, wave 0, are not offers).
--   Definitions (also shown beside the numbers in the admin screen):
--     with_offer          jobs with >= 1 driver offer (bid)            / requests created
--     offer_accepted      jobs with an accepted offer                  / jobs with >= 1 offer
--     verified_completed  jobs completed through the normal flow       / requests created
--     cancelled(_by_reason) jobs now cancelled, by structured category ('unknown' = not provided / historic)
--     no_shows            jobs cancelled by the 24 h sweep and still cancelled (reopened ones count under reopenings)
--     no_show_reopened    reopenings in the window, and those later completed
--     repeat_requests     requests from customers with an EARLIER completed delivery   / requests created
--     repeat_verified_completed  completed deliveries by such customers                / verified completed
--     invited / invited_chosen   jobs inviting a previous driver / invited driver ended up assigned
--     feedback            answers and dismissals among completed jobs in the window
--     offers              sent / viewed / accepted / declined / expired, median seconds to a response
--   "Repeat" never means loyalty on its own: retried requests after a failure are included in repeat_requests,
--   which is why repeat verified deliveries are reported separately.
-- Undo: supabase/rollbacks/20261107170000_0150_rollback.sql. NOT APPLIED to any hosted project.

alter table public.jobs add column if not exists no_show_reopened_at timestamptz;

create or replace function public.tg_jobs_recovery_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  -- Security INVOKER on purpose: current_user must be the caller, not the function owner.
  if current_user in ('authenticated', 'anon') and new.no_show_reopened_at is distinct from old.no_show_reopened_at then
    raise exception 'no_show_reopened_at is set by the server' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tg_jobs_recovery_guard() from public, anon, authenticated;
grant execute on function public.tg_jobs_recovery_guard() to service_role;

create or replace trigger trg_jobs_recovery_guard
  before update on public.jobs
  for each row execute function public.tg_jobs_recovery_guard();

create or replace function public.customer_reopen_no_show_job(_job_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _job    public.jobs;
  _driver uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.customer_id <> auth.uid() then
    raise exception 'Only the customer can reopen this job.' using errcode = '42501';
  end if;
  if _job.status <> 'cancelled'
     or _job.payment_method <> 'direct'
     or _job.cancellation_reason is distinct from 'Driver did not start pickup within 24 hours of accepting'
     or _job.cancelled_by is not null
     or _job.cancelled_at is null or _job.cancelled_at < now() - interval '7 days'
     or _job.driver_arrived_pickup_at is not null
     or _job.pickup_photo_url is not null
     or _job.pickup_photo_taken_at is not null
     or exists (select 1 from public.disputes d where d.job_id = _job_id) then
    raise exception 'This job can no longer be reopened.' using errcode = '22023';
  end if;
  _driver := _job.driver_id;

  if _job.accepted_bid_id is not null then
    update public.bids set status = 'withdrawn' where id = _job.accepted_bid_id and status = 'accepted';
  end if;

  update public.jobs
     set status = 'open', driver_id = null, accepted_bid_id = null, final_price = null,
         held_commission = null, delivery_pin = null,
         driver_arrived_pickup_at = null, driver_arrived_dropoff_at = null,
         cancellation_reason = null, cancellation_stage = null, cancelled_at = null, cancelled_by = null,
         no_show_reopened_at = now(),
         expires_at = now() + interval '24 hours'
   where id = _job_id
  returning * into _job;

  delete from public.job_delivery_pins where job_id = _job_id;

  -- Fresh dispatch: clear old offers, but never offer the no-show driver again.
  delete from public.job_dispatch_offers where job_id = _job_id;
  if _driver is not null then
    insert into public.job_dispatch_offers (job_id, driver_id, wave, status, responded_at)
    values (_job_id, _driver, 0, 'rejected', now())
    on conflict (job_id, driver_id) do nothing;
  end if;

  insert into public.notifications (user_id, type, title, body, job_id)
  values (_job.customer_id, 'job_reopened', 'Your request is open again',
          'Nearby drivers have been alerted. You can cancel the request from the job page at any time.', _job_id);

  perform public.create_dispatch_wave(_job_id, 5);
  return _job;
end
$$;

revoke all on function public.customer_reopen_no_show_job(uuid) from public, anon;
grant execute on function public.customer_reopen_no_show_job(uuid) to authenticated, service_role;

create or replace function public.admin_marketplace_metrics(_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  _d integer := greatest(1, least(coalesce(_days, 7), 90));
  _from timestamptz := now() - make_interval(days => _d);
  r jsonb;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Admins only';
  end if;

  with j as (select * from public.jobs where created_at >= _from),
  tot as (select count(*) n from j),
  first_offer as (
    select b.job_id, min(b.created_at) at from public.bids b join j on j.id = b.job_id group by b.job_id),
  with_offer as (select count(*) n from first_offer),
  accepted as (select count(*) n from j where accepted_bid_id is not null and exists (select 1 from first_offer f where f.job_id = j.id)),
  completed as (select count(*) n from j where status = 'completed'),
  cancelled as (select count(*) n from j where status = 'cancelled'),
  noshow as (select count(*) n from j where status = 'cancelled' and cancellation_reason_code = 'driver_did_not_arrive'),
  reopened as (
    select count(*) n, count(*) filter (where status = 'completed') done
      from public.jobs where no_show_reopened_at >= _from),
  rep as (
    select j.id, j.status from j
     where exists (select 1 from public.jobs p
                    where p.customer_id = j.customer_id and p.id <> j.id
                      and p.status = 'completed' and p.created_at < j.created_at)),
  invited as (select count(*) n,
                     count(*) filter (where driver_id = preferred_driver_id) chosen,
                     count(*) filter (where exists (select 1 from public.bids b where b.job_id = j.id and b.driver_id = j.preferred_driver_id)) bid
                from j where preferred_driver_id is not null),
  fb as (select f.answer, f.dismissed from public.delivery_feedback f join j on j.id = f.job_id),
  off as (select * from public.job_dispatch_offers where offered_at >= _from and wave > 0)
  select jsonb_build_object(
    'window_days', _d,
    'generated_at', now(),
    'jobs', jsonb_build_object(
      'requests_created', (select n from tot),
      'with_offer', jsonb_build_object('n', (select n from with_offer), 'd', (select n from tot)),
      'median_minutes_to_first_offer', (
        select round((percentile_cont(0.5) within group (order by extract(epoch from fo.at - j.created_at) / 60))::numeric, 1)
          from j join first_offer fo on fo.job_id = j.id),
      'offer_accepted', jsonb_build_object('n', (select n from accepted), 'd', (select n from with_offer)),
      'verified_completed', jsonb_build_object('n', (select n from completed), 'd', (select n from tot)),
      'cancelled', jsonb_build_object('n', (select n from cancelled), 'd', (select n from tot)),
      'cancelled_by_reason', (
        select coalesce(jsonb_object_agg(k, c), '{}'::jsonb)
          from (select coalesce(cancellation_reason_code, 'unknown') k, count(*) c
                  from j where status = 'cancelled' group by 1) x),
      'no_shows', jsonb_build_object('n', (select n from noshow), 'd', (select n from tot)),
      'no_show_reopened', jsonb_build_object('reopened', (select n from reopened), 'reopened_then_completed', (select done from reopened)),
      'repeat_requests', jsonb_build_object('n', (select count(*) from rep), 'd', (select n from tot)),
      'repeat_verified_completed', jsonb_build_object('n', (select count(*) from rep where status = 'completed'), 'd', (select n from completed)),
      'invited', jsonb_build_object('n', (select n from invited), 'd', (select n from tot)),
      'invited_bid_received', jsonb_build_object('n', (select bid from invited), 'd', (select n from invited)),
      'invited_chosen', jsonb_build_object('n', (select chosen from invited), 'd', (select n from invited))),
    'feedback', jsonb_build_object(
      'eligible', (select n from completed),
      'answered', (select count(*) from fb where answer is not null),
      'dismissed', (select count(*) from fb where dismissed and answer is null),
      'by_answer', (select coalesce(jsonb_object_agg(answer, c), '{}'::jsonb)
                      from (select answer, count(*) c from fb where answer is not null group by answer) y)),
    'offers', jsonb_build_object(
      'sent', (select count(*) from off),
      'viewed', (select count(*) from off where viewed_at is not null),
      'accepted', (select count(*) from off where status = 'accepted'),
      'declined', (select count(*) from off where status = 'rejected'),
      'expired', (select count(*) from off where status = 'expired'),
      'median_response_seconds', (
        select (percentile_cont(0.5) within group (order by extract(epoch from responded_at - offered_at)))::int
          from off where status in ('accepted', 'rejected') and responded_at is not null)))
  into r;
  return r;
end $$;
revoke all on function public.admin_marketplace_metrics(integer) from public, anon;
grant execute on function public.admin_marketplace_metrics(integer) to authenticated, service_role;
