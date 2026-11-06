-- Undo for 0142 (admin ops batch 1). Contains DROP FUNCTION: run it in the Supabase SQL editor, not through
-- the MCP tool (which hangs on DROP). The new reports columns (admin_reply, admin_reply_at, admin_reply_by) are
-- KEPT so no reply is lost; remove them by hand only if you are sure.
begin;

-- Reports: back to the previous table privileges (this re-opens customer read access to admin_notes).
grant select, insert, update on public.reports to authenticated;

drop function if exists public.admin_search(text, text, integer, integer);
drop function if exists public.admin_respond_to_report(uuid, text, text, text);
drop function if exists public.admin_list_reports(text, integer, integer);

-- cancel_job: the 0101 definition (production's body before 0142).
create or replace function public.cancel_job(_job_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _stage text; _is_admin boolean; _loc public.material_supply_locations;
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

  _stage := case _job.status
              when 'open' then 'pre_acceptance'
              when 'accepted' then 'post_acceptance'
              when 'in_progress' then 'in_transit'
              else _job.status::text end;

  -- (0101) No inventory restore: stock is advisory and was never decremented on acceptance.

  perform public.release_job_commission(_job_id);

  -- F2: any escrow the customer already paid is owed back in full.
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

  if _job.driver_id is not null and auth.uid() <> _job.driver_id then
    insert into public.notifications (user_id, type, title, body)
    values (_job.driver_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'The customer cancelled this job.'));
  end if;
  if auth.uid() <> _job.customer_id then
    insert into public.notifications (user_id, type, title, body)
    values (_job.customer_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'This job was cancelled.'));
  end if;

  return _job;
end $function$;

commit;
