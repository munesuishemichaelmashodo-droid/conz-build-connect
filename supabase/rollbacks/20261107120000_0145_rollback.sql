-- Undo for 0145_driver_cancel_reopens_job.
-- Restores cancel_job to the exact production definition read on 07/11/2026
-- (whitespace-stripped body md5 403695f5049358f1a29bd8c74f9fa6cb) and removes the reopen function.
-- Jobs already reopened stay open (their state is ordinary); nothing is rewritten.
-- The DROP statement must run in the Supabase SQL editor (the MCP tool hangs on DROP).

create or replace function public.cancel_job(_job_id uuid, _reason text default null)
returns public.jobs
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  _job public.jobs; _stage text; _is_admin boolean; _loc public.material_supply_locations;
  _prev_status text; _admin_acting boolean;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);

  if not (_is_admin or auth.uid() = _job.customer_id or auth.uid() = _job.driver_id) then
    raise exception 'Not authorised to cancel this job';
  end if;
  if _job.status in ('completed','cancelled') then
    raise exception 'Job already % and cannot be cancelled', _job.status;
  end if;
  if _job.status = 'in_progress' and not _is_admin then
    raise exception 'Job is in progress — raise a dispute instead of cancelling';
  end if;

  _admin_acting := _is_admin and auth.uid() is distinct from _job.customer_id
                             and auth.uid() is distinct from _job.driver_id;
  if _admin_acting and length(btrim(coalesce(_reason, ''))) < 5 then
    raise exception 'A reason of at least 5 characters is required to cancel as an admin';
  end if;
  _prev_status := _job.status::text;

  _stage := case _job.status
              when 'open' then 'pre_acceptance'
              when 'accepted' then 'post_acceptance'
              when 'in_progress' then 'in_transit'
              else _job.status::text end;

  perform public.release_job_commission(_job_id);

  perform public.escrow_refund_due_for_job(_job_id, 'job_cancelled');

  update public.jobs
     set status = 'cancelled', cancellation_reason = _reason,
         cancellation_stage = _stage, cancelled_at = now(),
         cancelled_by = auth.uid()
   where id = _job_id
  returning * into _job;

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job_id and status = 'pending';

  if _stage <> 'pre_acceptance' and auth.uid() = _job.customer_id then
    perform public.enforce_customer_strikes(_job.customer_id, _job_id, _stage, _reason);
  end if;

  if _stage <> 'pre_acceptance' and auth.uid() = _job.driver_id then
    insert into public.cancellation_events(user_id, job_id, role, stage, reason)
    values (_job.driver_id, _job_id, 'driver', _stage, _reason);
  end if;

  if _admin_acting then
    perform public.log_admin_action(
      _action      => 'job_cancelled_by_admin',
      _meta        => jsonb_build_object('job_id', _job_id, 'stage', _stage, 'previous_status', _prev_status),
      _reason      => btrim(_reason),
      _target_id   => _job_id,
      _target_user => _job.customer_id);
  end if;

  if _job.driver_id is not null and auth.uid() <> _job.driver_id then
    insert into public.notifications (user_id, type, title, body, job_id)
    values (_job.driver_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'The customer cancelled this job.'), _job_id);
  end if;
  if auth.uid() <> _job.customer_id then
    insert into public.notifications (user_id, type, title, body, job_id)
    values (_job.customer_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'This job was cancelled.'), _job_id);
  end if;

  return _job;
end
$$;

revoke all on function public.cancel_job(uuid, text) from public, anon;
grant execute on function public.cancel_job(uuid, text) to authenticated, service_role;

drop function if exists public.reopen_job_after_driver_cancel(uuid, text);
