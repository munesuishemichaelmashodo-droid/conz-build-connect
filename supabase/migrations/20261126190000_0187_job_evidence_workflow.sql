-- -----------------------------------------------------------------------------
-- 0187: collection and delivery evidence workflow (trust Stage 2).
--
-- Reuses what exists: driver arrival (driver_mark_arrived, 0060), pickup/delivery photos recorded only by the assigned
-- driver into the private bucket in stage order (record_job_evidence, 0110), the pickup location check and route
-- trail (0112), and completion only with a delivery photo plus the customer's one-time code with lockout (0096/0078).
--
-- Adds:
--   * job_stage_reports: structured statements tied to a job, a person, their role and a time:
--       driver  - collection_confirmed (quantity loaded, visible condition, optional photo),
--                 collection_problem (short load, wrong material, poor quality, site closed, not ready, other),
--                 delay (reason, new ETA);
--       customer or driver - delivery_problem (shortage, damage, partial delivery, wrong material, wrong place, other,
--                 with the quantity received).
--     Append-only. A correction is a new report pointing at the one it corrects (same person, same job), never an edit.
--     A photo attached to a report must be evidence of the same job filed by the same person.
--     Problems notify the other party and admins; delays notify the customer.
--   * Photo corrections: supersede_job_evidence() marks a photo as replaced by a newer one of the same job and kind
--     from the same person, with a reason; not after the job ends or while a dispute is open. The original is kept and
--     stays the job's photo of record. The row-level guard now protects every field of a photo record and lets
--     the supersede fields be set only once.
--   * Stored photos: admins can still read every job photo, but can no longer overwrite or delete one that is
--     recorded as evidence (the "admin all" storage policy now applies only to files that are not evidence).
--   * job_evidence_record(): one read-only record for the parties and admins: timeline, photos (marked "submitted by
--     the driver, not independently verified", with location status, and whether added after a dispute opened),
--     reports (statements), the delivery-code result (checked by the system) and disputes. Route-point counts are
--     shown to admins only and are called recorded GPS points, not live tracking.
-- No DROP, no DELETE, no money, no settings. Recovery (forward-safe, keeps every protection and record):
-- supabase/rollbacks/20261126190000_0187_rollback.sql.
-- -----------------------------------------------------------------------------

-- 1. Photo records: every field protected; supersede set once ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.job_evidence_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Evidence records cannot be deleted. Supersede instead.'
      using errcode = '42501';
  end if;

  -- (0187) every field except the supersede fields and notes is fixed
  if (to_jsonb(new) - 'superseded_by' - 'superseded_at' - 'notes')
     is distinct from (to_jsonb(old) - 'superseded_by' - 'superseded_at' - 'notes') then
    raise exception 'Evidence records are immutable.' using errcode = '42501';
  end if;
  -- (0187) a photo is superseded once, and its notes are written once
  if (old.superseded_by is not null and new.superseded_by is distinct from old.superseded_by)
     or (old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at)
     or (old.notes is not null and new.notes is distinct from old.notes) then
    raise exception 'Evidence records are immutable.' using errcode = '42501';
  end if;
  return new;
end $function$;

create or replace function public.job_has_open_dispute(_job uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.disputes d where d.job_id = _job and d.status in ('open', 'investigating'))
$$;
revoke all on function public.job_has_open_dispute(uuid) from public, anon, authenticated;

create or replace function public.supersede_job_evidence(_evidence uuid, _replacement uuid, _reason text)
returns public.job_evidence language plpgsql security definer set search_path to 'public' as $$
declare
  _old public.job_evidence;
  _new public.job_evidence;
  _j public.jobs;
  _why text := nullif(btrim(coalesce(_reason, '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if _why is null or length(_why) < 5 then raise exception 'Say why the photo is being replaced (at least 5 characters).' using errcode = '22023'; end if;
  select * into _old from public.job_evidence where id = _evidence for update;
  select * into _new from public.job_evidence where id = _replacement;
  if _old.id is null or _new.id is null then raise exception 'Photo not found'; end if;
  if _old.uploaded_by is distinct from auth.uid() or _new.uploaded_by is distinct from auth.uid() then
    raise exception 'Only the person who took both photos can replace one with the other.' using errcode = '42501';
  end if;
  if _old.job_id <> _new.job_id or _old.kind <> _new.kind or _old.id = _new.id then
    raise exception 'The replacement must be a different photo of the same kind on the same job.' using errcode = '22023';
  end if;
  if _new.uploaded_at < _old.uploaded_at then raise exception 'The replacement must be the newer photo.' using errcode = '22023'; end if;
  if _old.superseded_by is not null then raise exception 'This photo was already replaced.'; end if;
  if _new.superseded_by is not null then raise exception 'The replacement was itself replaced.'; end if;
  select * into _j from public.jobs where id = _old.job_id;
  if _j.status not in ('accepted', 'in_progress') then raise exception 'Photos cannot be replaced after the job has ended.'; end if;
  if public.job_has_open_dispute(_j.id) then
    raise exception 'Photos cannot be replaced while a dispute about this job is open.' using errcode = '42501';
  end if;
  update public.job_evidence set superseded_by = _replacement, superseded_at = now(), notes = 'Replaced: ' || _why
   where id = _evidence returning * into _old;
  return _old;
end $$;
revoke all on function public.supersede_job_evidence(uuid, uuid, text) from public, anon;
grant execute on function public.supersede_job_evidence(uuid, uuid, text) to authenticated;

-- 2. Stored photos: no admin overwrite or delete of a file that is evidence ----------------------------------------
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'job proof: admin all') then
    alter policy "job proof: admin all" on storage.objects
      using ((bucket_id = 'job-proof-photos')
             and (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'super_admin'::app_role))
             and not exists (select 1 from public.job_evidence e where e.storage_path = objects.name));
  end if;
end $$;

-- 3. Structured reports ------------------------------------------------------------------------------------------------
create table if not exists public.job_stage_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id),
  reported_by uuid not null references auth.users(id),
  reporter_role text not null check (reporter_role in ('customer', 'driver')),
  event text not null check (event in ('collection_confirmed', 'collection_problem', 'delay', 'delivery_problem')),
  issue text check (issue is null or issue in (
    'quantity_short', 'wrong_material', 'poor_quality', 'site_closed', 'not_ready',
    'traffic', 'breakdown', 'fuel', 'weather', 'road_block',
    'shortage', 'damage', 'partial_delivery', 'wrong_place', 'other')),
  condition text check (condition is null or condition in ('as_agreed', 'wet', 'mixed', 'contaminated', 'other')),
  quantity_m3 numeric(10,2) check (quantity_m3 is null or (quantity_m3 >= 0 and quantity_m3 <= 200)),
  eta_minutes integer check (eta_minutes is null or (eta_minutes between 1 and 1440)),
  note text check (note is null or char_length(note) <= 1000),
  evidence_id uuid references public.job_evidence(id),
  corrects_report uuid references public.job_stage_reports(id),
  job_status text not null,
  -- set by report_job_stage when the job already had a dispute: a party's statement made during the dispute
  filed_during_dispute boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists job_stage_reports_job_idx on public.job_stage_reports (job_id, created_at);
alter table public.job_stage_reports enable row level security;
revoke all on public.job_stage_reports from public, anon, authenticated;
grant select on public.job_stage_reports to authenticated;
grant select, insert on public.job_stage_reports to service_role;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_stage_reports'
                  and policyname = 'Parties and admins read stage reports') then
    create policy "Parties and admins read stage reports" on public.job_stage_reports for select to authenticated
      using (exists (select 1 from public.jobs j where j.id = job_stage_reports.job_id
                       and coalesce(auth.uid() in (j.customer_id, j.driver_id), false))
             or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
  end if;
end $$;

create or replace function public.tg_job_stage_reports_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Reports cannot be changed or removed. File a correction instead.' using errcode = '42501';
end $$;
revoke all on function public.tg_job_stage_reports_append_only() from public, anon, authenticated;
create or replace trigger trg_job_stage_reports_append_only
  before update or delete on public.job_stage_reports
  for each row execute function public.tg_job_stage_reports_append_only();

create or replace function public.report_job_stage(
  _job uuid,
  _event text,
  _issue text default null,
  _condition text default null,
  _quantity_m3 numeric default null,
  _eta_minutes integer default null,
  _note text default null,
  _evidence uuid default null,
  _corrects uuid default null
) returns public.job_stage_reports
language plpgsql security definer set search_path to 'public' as $$
declare
  _j public.jobs;
  _role text;
  _ev public.job_evidence;
  _prev public.job_stage_reports;
  _row public.job_stage_reports;
  _n text := nullif(btrim(coalesce(_note, '')), '');
  _other uuid;
  _title text;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  select * into _j from public.jobs where id = _job for update;
  if not found then raise exception 'Job not found'; end if;
  _role := case when auth.uid() = _j.driver_id then 'driver' when auth.uid() = _j.customer_id then 'customer' end;
  if _role is null then raise exception 'Only the customer or the assigned driver can report on this job.' using errcode = '42501'; end if;
  if _corrects is not null then
    select * into _prev from public.job_stage_reports where id = _corrects;
    if _prev.id is null or _prev.job_id <> _job or _prev.reported_by <> auth.uid() or _prev.event <> _event then
      raise exception 'You can only correct your own report of the same kind on this job.' using errcode = '42501';
    end if;
  end if;

  if _event in ('collection_confirmed', 'collection_problem', 'delay') then
    if _role <> 'driver' then raise exception 'Only the assigned driver can report this.' using errcode = '42501'; end if;
    if _j.status not in ('accepted', 'in_progress') then raise exception 'This job is not active.'; end if;
  elsif _event = 'delivery_problem' then
    if not (_j.status = 'in_progress' or (_j.status = 'completed' and coalesce(_j.completed_at, now()) > now() - interval '7 days')) then
      raise exception 'Delivery problems can be reported during the delivery or within 7 days after it.';
    end if;
  else
    raise exception 'Unknown report type' using errcode = '22023';
  end if;

  if _event = 'collection_confirmed' then
    if _j.pickup_photo_url is null then raise exception 'Take the collection photo first.'; end if;
    if _quantity_m3 is null or _quantity_m3 <= 0 then raise exception 'Enter the quantity loaded.' using errcode = '22023'; end if;
    if _condition is null then raise exception 'Say what the load looks like.' using errcode = '22023'; end if;
    _issue := null;
  elsif _event = 'collection_problem' then
    if _issue is null or _issue not in ('quantity_short', 'wrong_material', 'poor_quality', 'site_closed', 'not_ready', 'other') then
      raise exception 'Choose what the problem at collection is.' using errcode = '22023';
    end if;
  elsif _event = 'delay' then
    if _issue is null or _issue not in ('traffic', 'breakdown', 'fuel', 'weather', 'road_block', 'other') then
      raise exception 'Choose the reason for the delay.' using errcode = '22023';
    end if;
    if _eta_minutes is null then raise exception 'Give a new arrival time.' using errcode = '22023'; end if;
  elsif _event = 'delivery_problem' then
    if _issue is null or _issue not in ('shortage', 'damage', 'partial_delivery', 'wrong_material', 'wrong_place', 'other') then
      raise exception 'Choose what went wrong with the delivery.' using errcode = '22023';
    end if;
    if _issue in ('shortage', 'partial_delivery') and _quantity_m3 is null then
      raise exception 'Enter the quantity that arrived.' using errcode = '22023';
    end if;
  end if;
  if _issue = 'other' and (_n is null or length(_n) < 5) then
    raise exception 'Describe the problem (at least 5 characters).' using errcode = '22023';
  end if;

  if _evidence is not null then
    select * into _ev from public.job_evidence where id = _evidence;
    if _ev.id is null or _ev.job_id <> _job or _ev.uploaded_by <> auth.uid() then
      raise exception 'Only your own photo of this job can be attached.' using errcode = '42501';
    end if;
  end if;

  insert into public.job_stage_reports (job_id, reported_by, reporter_role, event, issue, condition, quantity_m3, eta_minutes,
                                        note, evidence_id, corrects_report, job_status, filed_during_dispute)
  values (_job, auth.uid(), _role, _event, _issue, _condition, _quantity_m3, _eta_minutes, _n, _evidence, _corrects, _j.status::text,
          exists (select 1 from public.disputes d where d.job_id = _job))
  returning * into _row;

  _other := case when _role = 'driver' then _j.customer_id else _j.driver_id end;
  _title := case _event
    when 'collection_confirmed' then 'Load collected'
    when 'collection_problem' then 'Problem at collection'
    when 'delay' then 'Delivery delayed'
    else 'Problem reported with the delivery' end;
  begin
    if _other is not null then
      insert into public.notifications (user_id, type, title, body, job_id)
      values (_other, 'job_stage_report', _title,
              case _event
                when 'collection_confirmed' then format('The driver reports %s m³ loaded. Open the job to see the photo.', _quantity_m3)
                when 'delay' then format('The driver reports a delay. New arrival in about %s minutes.', _eta_minutes)
                else 'Open the job to see what was reported. You can add your side or open a dispute if needed.' end,
              _job);
    end if;
    if _event in ('collection_problem', 'delivery_problem') then
      insert into public.notifications (user_id, type, title, body, job_id)
      select distinct ur.user_id, 'job_stage_report', _title, 'A problem was reported on a job. Review it in the job''s evidence record.', _job
        from public.user_roles ur where ur.role in ('admin', 'super_admin');
    end if;
  exception when others then
    raise warning 'stage report notice failed: %', sqlerrm;
  end;
  return _row;
end $$;
revoke all on function public.report_job_stage(uuid, text, text, text, numeric, integer, text, uuid, uuid) from public, anon;
grant execute on function public.report_job_stage(uuid, text, text, text, numeric, integer, text, uuid, uuid) to authenticated;

-- 4. The final evidence record ------------------------------------------------------------------------------------------
create or replace function public.job_evidence_record(_job uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  _j public.jobs;
  _jj jsonb;
  _is_admin boolean := public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin');
  _dispute_at timestamptz;
  _pin public.job_delivery_pins;
begin
  select * into _j from public.jobs where id = _job;
  if not found then raise exception 'Job not found'; end if;
  if not (coalesce(auth.uid() in (_j.customer_id, _j.driver_id), false) or _is_admin) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  _jj := to_jsonb(_j);
  select min(created_at) into _dispute_at from public.disputes where job_id = _job;
  select * into _pin from public.job_delivery_pins where job_id = _job;

  return jsonb_build_object(
    'job_id', _job,
    'status', _j.status,
    'basis', 'Photos and reports are submitted by the customer or driver; Con Z has not independently verified them. The delivery code check is done by the system.',
    'timeline', coalesce((
      select jsonb_agg(jsonb_build_object('step', k, 'at', _jj->>k) order by (_jj->>k)::timestamptz)
        from unnest(array['created_at', 'accepted_at', 'driver_arrived_pickup_at', 'pickup_photo_taken_at', 'loaded_at',
                          'started_at', 'driver_arrived_dropoff_at', 'delivery_photo_taken_at', 'completed_at', 'cancelled_at']) k
       where _jj ? k and _jj->>k is not null), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'kind', e.kind, 'uploaded_at', e.uploaded_at,
               'by_role', case when e.uploaded_by = _j.driver_id then 'driver' when e.uploaded_by = _j.customer_id then 'customer' else 'admin' end,
               'location_status', e.location_status, 'has_location', e.device_lat is not null,
               'is_photo_of_record', e.storage_path in (coalesce(_j.pickup_photo_url, ''), coalesce(_j.delivery_photo_url, '')),
               'replaced_by', e.superseded_by, 'replaced_note', e.notes,
               'added_after_dispute', _dispute_at is not null and e.uploaded_at > _dispute_at,
               'verification', 'submitted',
               'reviewer_note', case when _dispute_at is not null and e.uploaded_at > _dispute_at
                 then 'Uploaded after the dispute opened by one of the parties. Not independently verified.'
                 else 'Uploaded by one of the parties. Not independently verified.' end) order by e.uploaded_at)
        from public.job_evidence e where e.job_id = _job), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'event', r.event, 'by_role', r.reporter_role, 'issue', r.issue, 'condition', r.condition,
               'quantity_m3', r.quantity_m3, 'eta_minutes', r.eta_minutes, 'note', r.note, 'evidence_id', r.evidence_id,
               'corrects', r.corrects_report, 'at', r.created_at,
               'added_after_dispute', r.filed_during_dispute or (_dispute_at is not null and r.created_at > _dispute_at),
               'verification', 'statement',
               'reviewer_note', case when r.filed_during_dispute or (_dispute_at is not null and r.created_at > _dispute_at)
                 then 'Filed after the dispute opened by one of the parties. A statement, not independent verification.'
                 else 'A statement by one of the parties, not independent verification.' end) order by r.created_at)
        from public.job_stage_reports r where r.job_id = _job), '[]'::jsonb),
    'delivery_code', jsonb_build_object(
      'issued', _pin.job_id is not null,
      'confirmed_at', _pin.consumed_at,
      'wrong_attempts', case when _is_admin then coalesce(_pin.attempts, 0) end,
      'verification', case when _pin.consumed_at is not null then 'system_checked' else 'not_confirmed' end),
    'quantity', jsonb_build_object('ordered_m3', _j.quantity_m3, 'delivered_m3', _jj->'delivered_quantity_m3', 'receiver_name', _jj->'receiver_name'),
    'disputes', coalesce((
      select jsonb_agg(jsonb_build_object('status', d.status, 'category', d.category, 'opened_at', d.created_at, 'resolved_at', d.resolved_at)
                       order by d.created_at)
        from public.disputes d where d.job_id = _job), '[]'::jsonb),
    'recorded_gps_points', case when _is_admin then (select count(*) from public.job_route_points p where p.job_id = _job) end
  );
end $$;
revoke all on function public.job_evidence_record(uuid) from public, anon;
grant execute on function public.job_evidence_record(uuid) to authenticated;
