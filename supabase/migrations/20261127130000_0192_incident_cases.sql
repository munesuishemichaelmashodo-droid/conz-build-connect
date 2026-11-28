-- -----------------------------------------------------------------------------
-- 0192: incident and appeal workflow on the existing reports (trust Stages 4-5).
--
-- Reuses reports (0142 column grants, 0178 categories + urgent admin alert, admin_respond_to_report replies) and
-- disputes (resolve_dispute, 0184's audited admin actions). No second case system.
--
-- Adds to each report: a case reference (INC-000001), severity, the affected party, an optional linked dispute, an
-- assigned reviewer, and a lifecycle reported -> investigating -> decided -> (appealed -> appeal decided) -> closed.
--   * Categories widened: accident or injury, theft or missing cargo, damage or shortage, no-show, false delivery
--     claim, threats, account compromise, data exposure, unsafe or prohibited cargo, platform outage, dispute appeal
--     (plus the 0178 ones). Physical-safety categories are urgent and alert admins at once (0178 behaviour).
--     Con Z does not run an emergency response: the app sends people to the police (995) / emergency services (999).
--   * case_events (append-only): every statement, evidence file, assignment, severity change, protective action,
--     decision, appeal and closure, with who did it. The reporter and the affected party both add statements and
--     evidence and see the non-internal history; internal admin notes stay with admins.
--   * Decisions need a reason (10+ characters) and the policy applied; the decider and the assigned reviewer can
--     never be the reporter, the affected party or a party to the job. One appeal per case, within 14 days, decided
--     by a different admin. A closed case cannot be changed by anyone through the app.
--   * appeal_dispute(): a party to a decided dispute opens a dispute-appeal case linked to it (one per party).
--   * Risk signals never decide anything here: a person's account is only restricted by an admin's reasoned action.
-- One DROP CONSTRAINT widens reports_category_check in the same ALTER (reviewed exception). No data dropped.
-- Recovery (forward-safe): supabase/rollbacks/20261127130000_0192_rollback.sql.
-- -----------------------------------------------------------------------------

-- 1. Categories and case fields -------------------------------------------------------------------------------------
alter table public.reports
  drop constraint if exists reports_category_check,
  add constraint reports_category_check check (category in (
    'general', 'safety', 'fraud_scam', 'harassment', 'payment', 'off_platform_request', 'suspicious_job', 'other',
    'accident_injury', 'theft_missing', 'damage_shortage', 'no_show', 'false_delivery', 'threats',
    'account_compromise', 'data_exposure', 'unsafe_cargo', 'platform_outage', 'dispute_appeal'));

create sequence if not exists public.incident_case_seq;
alter table public.reports
  add column if not exists case_ref text,
  add column if not exists severity text check (severity is null or severity in ('critical', 'high', 'medium', 'low')),
  add column if not exists affected_user_id uuid references auth.users(id),
  add column if not exists dispute_id uuid references public.disputes(id),
  add column if not exists assigned_to uuid references auth.users(id),
  add column if not exists case_status text not null default 'reported'
    check (case_status in ('reported', 'investigating', 'decided', 'appealed', 'closed')),
  add column if not exists decision text,
  add column if not exists decision_reason text,
  add column if not exists decision_policy text,
  add column if not exists decided_by uuid references auth.users(id),
  add column if not exists decided_at timestamptz,
  add column if not exists appeal_grounds text,
  add column if not exists appealed_by uuid references auth.users(id),
  add column if not exists appealed_at timestamptz,
  add column if not exists appeal_decision text check (appeal_decision is null or appeal_decision in ('upheld', 'changed')),
  add column if not exists appeal_reason text,
  add column if not exists appeal_decided_by uuid references auth.users(id),
  add column if not exists appeal_decided_at timestamptz,
  add column if not exists closed_at timestamptz;
create unique index if not exists reports_case_ref_key on public.reports (case_ref);
create unique index if not exists reports_one_dispute_appeal_per_party on public.reports (dispute_id, user_id) where category = 'dispute_appeal';

grant select (case_ref, severity, affected_user_id, dispute_id, case_status, decision, decision_reason, decision_policy,
              decided_at, appeal_grounds, appealed_at, appeal_decision, appeal_reason, appeal_decided_at, closed_at)
  on public.reports to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reports' and policyname = 'Affected party reads the case') then
    create policy "Affected party reads the case" on public.reports for select to authenticated
      using (affected_user_id = auth.uid());
  end if;
end $$;

-- Existing reports get a reference so admins can cite them; nothing else about them changes.
update public.reports set case_ref = 'INC-' || lpad(nextval('public.incident_case_seq')::text, 6, '0') where case_ref is null;

-- 2. New reports: reference, severity, affected party, urgent alert ------------------------------------------------
create or replace function public.tg_reports_urgent_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _j public.jobs;
begin
  new.case_ref := coalesce(new.case_ref, 'INC-' || lpad(nextval('public.incident_case_seq')::text, 6, '0'));
  new.severity := coalesce(new.severity, case
    when new.category in ('accident_injury', 'safety', 'threats', 'unsafe_cargo') then 'critical'
    when new.category in ('theft_missing', 'fraud_scam', 'account_compromise', 'data_exposure', 'harassment') then 'high'
    when new.category in ('damage_shortage', 'no_show', 'false_delivery', 'payment', 'dispute_appeal', 'platform_outage') then 'medium'
    else 'low' end);
  if new.job_id is not null and new.affected_user_id is null then
    select * into _j from public.jobs where id = new.job_id;
    new.affected_user_id := case when new.user_id = _j.customer_id then _j.driver_id
                                 when new.user_id = _j.driver_id then _j.customer_id end;
  end if;
  new.urgent := new.category in ('safety', 'fraud_scam', 'harassment', 'accident_injury', 'theft_missing', 'threats',
                                 'account_compromise', 'data_exposure', 'unsafe_cargo');
  if new.urgent then
    insert into public.notifications (user_id, type, title, body, job_id)
    select distinct ur.user_id, 'urgent_report', 'Urgent report ' || new.case_ref,
           format('A %s report (%s severity) needs attention now.', replace(new.category, '_', ' '), new.severity), new.job_id
      from public.user_roles ur where ur.role in ('admin', 'super_admin');
  end if;
  return new;
end $$;

-- 3. Case history ---------------------------------------------------------------------------------------------------
create table if not exists public.case_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.reports(id),
  actor uuid,
  actor_role text not null check (actor_role in ('reporter', 'affected', 'admin', 'system')),
  action text not null check (action in ('reported', 'statement', 'evidence', 'assigned', 'severity_changed',
                                          'protective_action', 'note', 'decided', 'appealed', 'appeal_decided', 'closed')),
  body text check (body is null or char_length(body) <= 4000),
  storage_path text,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists case_events_report_idx on public.case_events (report_id, id);
alter table public.case_events enable row level security;
revoke all on public.case_events from public, anon, authenticated;
grant select on public.case_events to authenticated;
grant select, insert on public.case_events to service_role;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'case_events' and policyname = 'Parties read the case history') then
    create policy "Parties read the case history" on public.case_events for select to authenticated
      using ((not internal and exists (select 1 from public.reports r where r.id = case_events.report_id
                                          and coalesce(auth.uid() in (r.user_id, r.affected_user_id), false)))
             or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
  end if;
end $$;
create or replace function public.tg_case_events_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Case history cannot be changed.' using errcode = '42501';
end $$;
revoke all on function public.tg_case_events_append_only() from public, anon, authenticated;
create or replace trigger trg_case_events_append_only before update or delete on public.case_events
  for each row execute function public.tg_case_events_append_only();

create or replace function public.tg_reports_log_created()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.case_events (report_id, actor, actor_role, action, body) values (new.id, new.user_id, 'reporter', 'reported', null);
  return null;
end $$;
revoke all on function public.tg_reports_log_created() from public, anon, authenticated;
create or replace trigger trg_reports_log_created after insert on public.reports
  for each row execute function public.tg_reports_log_created();

-- A decided case keeps its decision; a closed case does not change at all.
create or replace function public.tg_reports_case_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Reports are kept.' using errcode = '42501'; end if;
  if old.case_status = 'closed' and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'A closed case cannot be changed.' using errcode = '42501';
  end if;
  if old.decided_at is not null and (new.decision, new.decision_reason, new.decision_policy, new.decided_by, new.decided_at)
     is distinct from (old.decision, old.decision_reason, old.decision_policy, old.decided_by, old.decided_at) then
    raise exception 'A decision cannot be rewritten. An appeal is decided separately.' using errcode = '42501';
  end if;
  if old.appealed_at is not null and (new.appeal_grounds, new.appealed_by, new.appealed_at)
     is distinct from (old.appeal_grounds, old.appealed_by, old.appealed_at) then
    raise exception 'An appeal cannot be rewritten.' using errcode = '42501';
  end if;
  if old.appeal_decided_at is not null and (new.appeal_decision, new.appeal_reason, new.appeal_decided_by, new.appeal_decided_at)
     is distinct from (old.appeal_decision, old.appeal_reason, old.appeal_decided_by, old.appeal_decided_at) then
    raise exception 'An appeal decision cannot be rewritten.' using errcode = '42501';
  end if;
  if (new.case_ref, new.user_id, new.description, new.created_at) is distinct from (old.case_ref, old.user_id, old.description, old.created_at) then
    raise exception 'What was reported cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tg_reports_case_guard() from public, anon, authenticated;
create or replace trigger trg_reports_case_guard before update or delete on public.reports
  for each row execute function public.tg_reports_case_guard();

-- 4. Helpers --------------------------------------------------------------------------------------------------------
create or replace function public.case_party_role(_r public.reports, _uid uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select case when _uid = _r.user_id then 'reporter' when _uid = _r.affected_user_id then 'affected' end
$$;
revoke all on function public.case_party_role(public.reports, uuid) from public, anon, authenticated;

-- someone who must not review or decide this case
create or replace function public.case_conflicted(_r public.reports, _uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select _uid in (_r.user_id, coalesce(_r.affected_user_id, '00000000-0000-0000-0000-000000000000'::uuid))
      or exists (select 1 from public.jobs j where j.id = _r.job_id and _uid in (j.customer_id, coalesce(j.driver_id, '00000000-0000-0000-0000-000000000000'::uuid)))
      or exists (select 1 from public.disputes d where d.id = _r.dispute_id and _uid in (d.raised_by, coalesce(d.against, '00000000-0000-0000-0000-000000000000'::uuid)))
$$;
revoke all on function public.case_conflicted(public.reports, uuid) from public, anon, authenticated;

create or replace function public.case_notify_parties(_r public.reports, _title text, _body text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.notifications (user_id, type, title, body, job_id)
  select u, 'case_update', _title || ' (' || _r.case_ref || ')', _body, _r.job_id
    from unnest(array[_r.user_id, _r.affected_user_id]) u where u is not null;
exception when others then raise warning 'case notice failed: %', sqlerrm;
end $$;
revoke all on function public.case_notify_parties(public.reports, text, text) from public, anon, authenticated;

-- 5. Parties: statements and evidence; appeals ------------------------------------------------------------------------
create or replace function public.case_add_statement(_report uuid, _body text, _storage_path text default null)
returns public.case_events language plpgsql security definer set search_path to 'public' as $$
declare _r public.reports; _role text; _ev public.case_events; _b text := nullif(btrim(coalesce(_body, '')), '');
begin
  select * into _r from public.reports where id = _report for update;
  if _r.id is null then raise exception 'Case not found'; end if;
  _role := public.case_party_role(_r, auth.uid());
  if _role is null then raise exception 'Only the people involved can add to this case.' using errcode = '42501'; end if;
  if _r.case_status = 'closed' then raise exception 'This case is closed.'; end if;
  if _b is null and _storage_path is null then raise exception 'Write a statement or attach a file.' using errcode = '22023'; end if;
  if _storage_path is not null and (split_part(_storage_path, '/', 2) <> auth.uid()::text
       or not exists (select 1 from storage.objects o where o.bucket_id = 'chat-media' and o.name = _storage_path)) then
    raise exception 'Attach a file you uploaded yourself.' using errcode = '42501';
  end if;
  insert into public.case_events (report_id, actor, actor_role, action, body, storage_path)
  values (_r.id, auth.uid(), _role, case when _storage_path is null then 'statement' else 'evidence' end, _b, _storage_path)
  returning * into _ev;
  return _ev;
end $$;
revoke all on function public.case_add_statement(uuid, text, text) from public, anon;
grant execute on function public.case_add_statement(uuid, text, text) to authenticated;

create or replace function public.case_appeal(_report uuid, _grounds text)
returns public.reports language plpgsql security definer set search_path to 'public' as $$
declare _r public.reports; _role text; _g text := nullif(btrim(coalesce(_grounds, '')), '');
begin
  select * into _r from public.reports where id = _report for update;
  if _r.id is null then raise exception 'Case not found'; end if;
  _role := public.case_party_role(_r, auth.uid());
  if _role is null then raise exception 'Only the people involved can appeal.' using errcode = '42501'; end if;
  if _r.case_status <> 'decided' then raise exception 'Only a decided case can be appealed, once.'; end if;
  if _r.decided_at < now() - interval '14 days' then raise exception 'The 14-day appeal period has ended.'; end if;
  if _g is null or length(_g) < 10 then raise exception 'Explain why the decision is wrong (at least 10 characters).' using errcode = '22023'; end if;
  update public.reports set case_status = 'appealed', appeal_grounds = _g, appealed_by = auth.uid(), appealed_at = now()
   where id = _r.id returning * into _r;
  insert into public.case_events (report_id, actor, actor_role, action, body) values (_r.id, auth.uid(), _role, 'appealed', _g);
  perform public.case_notify_parties(_r, 'Decision appealed', 'The decision was appealed. A different Con Z reviewer will look at it.');
  return _r;
end $$;
revoke all on function public.case_appeal(uuid, text) from public, anon;
grant execute on function public.case_appeal(uuid, text) to authenticated;

create or replace function public.appeal_dispute(_dispute uuid, _grounds text)
returns public.reports language plpgsql security definer set search_path to 'public' as $$
declare _d public.disputes; _r public.reports; _g text := nullif(btrim(coalesce(_grounds, '')), '');
begin
  select * into _d from public.disputes where id = _dispute;
  if _d.id is null then raise exception 'Dispute not found'; end if;
  if not coalesce(auth.uid() in (_d.raised_by, _d.against), false) then
    raise exception 'Only the people in the dispute can appeal it.' using errcode = '42501';
  end if;
  if _d.status not in ('resolved', 'rejected') then raise exception 'Only a decided dispute can be appealed.'; end if;
  if coalesce(_d.resolved_at, now()) < now() - interval '14 days' then raise exception 'The 14-day appeal period has ended.'; end if;
  if _g is null or length(_g) < 10 then raise exception 'Explain why the decision is wrong (at least 10 characters).' using errcode = '22023'; end if;
  begin
    insert into public.reports (user_id, job_id, description, category, dispute_id, affected_user_id)
    values (auth.uid(), _d.job_id, _g, 'dispute_appeal', _d.id,
            case when auth.uid() = _d.raised_by then _d.against else _d.raised_by end)
    returning * into _r;
  exception when unique_violation then
    raise exception 'You have already appealed this dispute.';
  end;
  return _r;
end $$;
revoke all on function public.appeal_dispute(uuid, text) from public, anon;
grant execute on function public.appeal_dispute(uuid, text) to authenticated;

-- 6. Admin workflow ----------------------------------------------------------------------------------------------------
create or replace function public.admin_case_action(_report uuid, _action text, _text text default null,
                                                    _assignee uuid default null, _severity text default null)
returns public.reports language plpgsql security definer set search_path to 'public' as $$
declare _r public.reports; _t text := nullif(btrim(coalesce(_text, '')), '');
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into _r from public.reports where id = _report for update;
  if _r.id is null then raise exception 'Case not found'; end if;
  if _r.case_status = 'closed' then raise exception 'A closed case cannot be changed.' using errcode = '42501'; end if;
  if public.case_conflicted(_r, auth.uid()) then raise exception 'You are involved in this case and cannot act on it.' using errcode = '42501'; end if;
  if _action = 'assign' then
    if _assignee is null or not (public.has_role(_assignee, 'admin') or public.has_role(_assignee, 'super_admin')) then
      raise exception 'Assign the case to an admin.' using errcode = '22023';
    end if;
    if public.case_conflicted(_r, _assignee) then raise exception 'That admin is involved in this case.' using errcode = '42501'; end if;
    update public.reports set assigned_to = _assignee,
           case_status = case when case_status = 'reported' then 'investigating' else case_status end
     where id = _r.id returning * into _r;
    insert into public.case_events (report_id, actor, actor_role, action, body, internal) values (_r.id, auth.uid(), 'admin', 'assigned', null, true);
  elsif _action in ('severity', 'protective_action', 'note') then
    if _t is null or length(_t) < 5 then raise exception 'Give the reason or details (at least 5 characters).' using errcode = '22023'; end if;
    if _action = 'severity' then
      if _severity is null or _severity not in ('critical', 'high', 'medium', 'low') then raise exception 'Choose a severity.' using errcode = '22023'; end if;
      update public.reports set severity = _severity where id = _r.id returning * into _r;
    end if;
    insert into public.case_events (report_id, actor, actor_role, action, body, internal)
    values (_r.id, auth.uid(), 'admin', case _action when 'severity' then 'severity_changed' else _action end,
            case when _action = 'severity' then _severity || ': ' || _t else _t end, _action = 'note');
    if _action = 'protective_action' then
      perform public.case_notify_parties(_r, 'Action taken on your case', _t);
    end if;
    if _r.case_status = 'reported' then update public.reports set case_status = 'investigating' where id = _r.id returning * into _r; end if;
  else
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  perform public.log_admin_action('case_' || _action, jsonb_build_object('report_id', _r.id, 'case_ref', _r.case_ref), _t, _r.id, _r.user_id);
  return _r;
end $$;
revoke all on function public.admin_case_action(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.admin_case_action(uuid, text, text, uuid, text) to authenticated;

create or replace function public.admin_decide_case(_report uuid, _decision text, _reason text, _policy text)
returns public.reports language plpgsql security definer set search_path to 'public' as $$
declare _r public.reports;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into _r from public.reports where id = _report for update;
  if _r.id is null then raise exception 'Case not found'; end if;
  if public.case_conflicted(_r, auth.uid()) then raise exception 'You are involved in this case and cannot decide it.' using errcode = '42501'; end if;
  if _r.case_status in ('decided', 'appealed', 'closed') then raise exception 'This case already has a decision.'; end if;
  if nullif(btrim(coalesce(_decision, '')), '') is null or length(btrim(_reason)) < 10 or nullif(btrim(coalesce(_policy, '')), '') is null then
    raise exception 'Give the decision, the reason (at least 10 characters) and the policy applied.' using errcode = '22023';
  end if;
  update public.reports
     set case_status = 'decided', decision = btrim(_decision), decision_reason = btrim(_reason), decision_policy = btrim(_policy),
         decided_by = auth.uid(), decided_at = now(), status = 'resolved'
   where id = _r.id returning * into _r;
  insert into public.case_events (report_id, actor, actor_role, action, body)
  values (_r.id, auth.uid(), 'admin', 'decided', _r.decision || ' — ' || _r.decision_reason || ' (policy: ' || _r.decision_policy || ')');
  perform public.case_notify_parties(_r, 'Decision on your case',
    format('%s. Reason: %s. You can appeal within 14 days.', _r.decision, _r.decision_reason));
  perform public.log_admin_action('case_decided', jsonb_build_object('report_id', _r.id, 'case_ref', _r.case_ref, 'policy', _r.decision_policy),
                                  _r.decision_reason, _r.id, _r.user_id);
  return _r;
end $$;
revoke all on function public.admin_decide_case(uuid, text, text, text) from public, anon;
grant execute on function public.admin_decide_case(uuid, text, text, text) to authenticated;

create or replace function public.admin_decide_appeal(_report uuid, _outcome text, _reason text)
returns public.reports language plpgsql security definer set search_path to 'public' as $$
declare _r public.reports;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into _r from public.reports where id = _report for update;
  if _r.id is null then raise exception 'Case not found'; end if;
  if _r.case_status <> 'appealed' then raise exception 'There is no open appeal on this case.'; end if;
  if auth.uid() = _r.decided_by then raise exception 'A different admin must decide the appeal.' using errcode = '42501'; end if;
  if public.case_conflicted(_r, auth.uid()) then raise exception 'You are involved in this case and cannot decide it.' using errcode = '42501'; end if;
  if _outcome not in ('upheld', 'changed') then raise exception 'The appeal outcome is upheld or changed.' using errcode = '22023'; end if;
  if length(btrim(coalesce(_reason, ''))) < 10 then raise exception 'Give the reason (at least 10 characters).' using errcode = '22023'; end if;
  update public.reports
     set appeal_decision = _outcome, appeal_reason = btrim(_reason), appeal_decided_by = auth.uid(), appeal_decided_at = now(),
         case_status = 'closed', closed_at = now()
   where id = _r.id returning * into _r;
  insert into public.case_events (report_id, actor, actor_role, action, body) values (_r.id, auth.uid(), 'admin', 'appeal_decided', _outcome || ' — ' || _r.appeal_reason);
  insert into public.case_events (report_id, actor, actor_role, action) values (_r.id, auth.uid(), 'admin', 'closed');
  perform public.case_notify_parties(_r, 'Appeal decided', format('The appeal was %s. Reason: %s. The case is now closed.', _outcome, _r.appeal_reason));
  perform public.log_admin_action('case_appeal_decided', jsonb_build_object('report_id', _r.id, 'outcome', _outcome), _r.appeal_reason, _r.id, _r.user_id);
  return _r;
end $$;
revoke all on function public.admin_decide_appeal(uuid, text, text) from public, anon;
grant execute on function public.admin_decide_appeal(uuid, text, text) to authenticated;

create or replace function public.admin_close_case(_report uuid, _reason text)
returns public.reports language plpgsql security definer set search_path to 'public' as $$
declare _r public.reports;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into _r from public.reports where id = _report for update;
  if _r.id is null then raise exception 'Case not found'; end if;
  if public.case_conflicted(_r, auth.uid()) then raise exception 'You are involved in this case.' using errcode = '42501'; end if;
  if _r.case_status <> 'decided' then raise exception 'Only a decided case without an open appeal can be closed.'; end if;
  if _r.decided_at > now() - interval '14 days' then raise exception 'The 14-day appeal period is still open.'; end if;
  if length(btrim(coalesce(_reason, ''))) < 5 then raise exception 'Give the reason.' using errcode = '22023'; end if;
  update public.reports set case_status = 'closed', closed_at = now() where id = _r.id returning * into _r;
  insert into public.case_events (report_id, actor, actor_role, action, body) values (_r.id, auth.uid(), 'admin', 'closed', btrim(_reason));
  return _r;
end $$;
revoke all on function public.admin_close_case(uuid, text) from public, anon;
grant execute on function public.admin_close_case(uuid, text) to authenticated;
