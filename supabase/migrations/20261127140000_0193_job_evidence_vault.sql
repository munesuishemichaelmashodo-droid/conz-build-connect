-- -----------------------------------------------------------------------------
-- 0193: one access-controlled evidence view per job, for admins (trust Stage 7).
--
-- The view brings together what other parts already record, each through its own access-checked function:
-- agreement versions (job_agreements / 0186), collection and delivery evidence (job_evidence_record / 0187),
-- payments (job_payment_reconciliation / 0188), disputes, cases (0192). This file adds the part that was missing:
--   * admin_job_history(_job): admin-only. Status timeline, the disputes and reports on the job, and every admin
--     action recorded against the job or any of its disputes, reports and payment records (admin_audit_log).
--   * Every call is itself logged (action 'job_evidence_viewed'), so the history shows who looked at the evidence
--     and when. Viewing never changes the evidence.
-- Parties keep their own views on the job page; this adds nothing for them. Signed-out visitors get nothing.
-- No DROP, no DELETE, no money. Recovery: supabase/rollbacks/20261127140000_0193_rollback.sql.
-- -----------------------------------------------------------------------------

create or replace function public.admin_job_history(_job uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare _j public.jobs; _jj jsonb; _targets uuid[];
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into _j from public.jobs where id = _job;
  if not found then raise exception 'Job not found'; end if;
  _jj := to_jsonb(_j);
  perform public.log_admin_action('job_evidence_viewed', jsonb_build_object('job_id', _job), null, _job, null);

  _targets := array[_job]
    || coalesce((select array_agg(id) from public.disputes where job_id = _job), '{}')
    || coalesce((select array_agg(id) from public.reports where job_id = _job), '{}');
  -- payment records exist only once 0179 is applied (it is live); read them when the table is there
  if to_regclass('public.direct_payment_stages') is not null then
    _targets := _targets || coalesce((select array_agg(id) from public.direct_payment_stages where job_id = _job), '{}');
  end if;

  return jsonb_build_object(
    'job_id', _job,
    'status', _j.status,
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('step', k, 'at', _jj->>k) order by (_jj->>k)::timestamptz)
        from unnest(array['created_at', 'accepted_at', 'driver_arrived_pickup_at', 'pickup_photo_taken_at', 'started_at',
                          'driver_arrived_dropoff_at', 'delivery_photo_taken_at', 'completed_at', 'cancelled_at']) k
       where _jj ? k and _jj->>k is not null), '[]'::jsonb),
    'disputes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'status', d.status, 'category', d.category, 'outcome', d.outcome,
                                                              'resolution', d.resolution, 'opened_at', d.created_at, 'resolved_at', d.resolved_at)
                                           order by d.created_at)
                            from public.disputes d where d.job_id = _job), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'category', r.category, 'status', r.status,
                                                             'created_at', r.created_at, 'description', r.description)
                                          order by r.created_at)
                           from public.reports r where r.job_id = _job), '[]'::jsonb),
    'admin_actions', coalesce((select jsonb_agg(jsonb_build_object('action', a.action, 'actor_id', a.actor_id, 'reason', a.reason,
                                                                   'target_id', a.target_id, 'at', a.created_at)
                                                order by a.created_at)
                                 from public.admin_audit_log a
                                where a.target_id = any(_targets) and a.action <> 'job_evidence_viewed'), '[]'::jsonb),
    'viewed_by', coalesce((select jsonb_agg(jsonb_build_object('actor_id', a.actor_id, 'at', a.created_at) order by a.created_at desc)
                             from (select * from public.admin_audit_log a
                                    where a.target_id = _job and a.action = 'job_evidence_viewed'
                                    order by a.created_at desc limit 50) a), '[]'::jsonb)
  );
end $$;
revoke all on function public.admin_job_history(uuid) from public, anon;
grant execute on function public.admin_job_history(uuid) to authenticated;
