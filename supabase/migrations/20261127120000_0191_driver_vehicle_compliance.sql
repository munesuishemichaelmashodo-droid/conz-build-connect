-- -----------------------------------------------------------------------------
-- 0191: individual driver and vehicle document checks (trust Stage 6).
--
-- Reuses: the private driver-docs bucket and its upload rules, the overall driver verification (driver_profiles,
-- admin_set_driver_verification, 90-day re-check) and truck change review (0114). Nothing there changes.
--
-- Adds one record per document a driver submits, so each fact is checked on its own:
--   identity, driving_licence (with class), vehicle_registration (ZINARA), certificate_of_fitness, operator_licence,
--   insurance (with type: goods in transit, third party, comprehensive, other).
-- Each record: the file (driver's own folder in driver-docs, must exist), expiry date, only the last 4 characters of
-- the document number, status submitted -> checked | rejected, superseded when a newer one is submitted; who
-- reviewed it, when, and why. A document is "checked" only when an admin who is not the driver reviewed it.
-- Uploading never checks anything. Append-only history of every step.
--
-- What others see (driver_compliance_badges): only documents an admin checked that have not expired, as facts
-- ("Licence checked, class C, valid to ..."). Never a combined "fully verified" badge, never the document itself or
-- its number, and never a promise of insurance cover or legal compliance.
--
-- Expiry: a daily sweep reminds the driver 30 and 7 days before a checked document expires and tells the driver and
-- admins when it has expired. One restriction only, because driving without a valid licence is unlawful: a driver
-- whose checked driving licence on record has expired cannot send new offers until a renewed licence is submitted.
-- Nothing else is suspended automatically.
-- No DROP, no DELETE, no money. Recovery (forward-safe): supabase/rollbacks/20261127120000_0191_rollback.sql.
-- -----------------------------------------------------------------------------

create table if not exists public.driver_compliance_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users(id),
  truck_id uuid references public.trucks(id),
  doc_type text not null check (doc_type in ('identity', 'driving_licence', 'vehicle_registration',
                                              'certificate_of_fitness', 'operator_licence', 'insurance')),
  storage_path text not null check (char_length(storage_path) <= 300),
  number_last4 text check (number_last4 is null or number_last4 ~ '^[A-Za-z0-9]{1,4}$'),
  licence_class text check (licence_class is null or licence_class ~ '^[A-Za-z0-9 ,/]{1,20}$'),
  insurance_type text check (insurance_type is null or insurance_type in ('goods_in_transit', 'third_party', 'comprehensive', 'other')),
  expires_on date,
  status text not null default 'submitted' check (status in ('submitted', 'checked', 'rejected', 'superseded')),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_reason text check (review_reason is null or char_length(review_reason) <= 1000),
  check ((doc_type in ('vehicle_registration', 'certificate_of_fitness', 'operator_licence', 'insurance')) or truck_id is null),
  check (doc_type <> 'insurance' or insurance_type is not null)
);
create index if not exists driver_compliance_documents_driver_idx on public.driver_compliance_documents (driver_id, doc_type, submitted_at desc);
create unique index if not exists driver_compliance_one_current
  on public.driver_compliance_documents (driver_id, doc_type, coalesce(truck_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('submitted', 'checked');

create table if not exists public.driver_compliance_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.driver_compliance_documents(id),
  driver_id uuid not null,
  action text not null check (action in ('submitted', 'checked', 'rejected', 'superseded', 'reminder_30', 'reminder_7', 'expired')),
  actor uuid,
  reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists driver_compliance_one_notice
  on public.driver_compliance_events (document_id, action) where action in ('reminder_30', 'reminder_7', 'expired');

alter table public.driver_compliance_documents enable row level security;
alter table public.driver_compliance_events enable row level security;
revoke all on public.driver_compliance_documents, public.driver_compliance_events from public, anon, authenticated;
grant select on public.driver_compliance_documents, public.driver_compliance_events to authenticated;
grant select, insert, update on public.driver_compliance_documents to service_role;
grant select, insert on public.driver_compliance_events to service_role;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'driver_compliance_documents' and policyname = 'Own and admin read compliance documents') then
    create policy "Own and admin read compliance documents" on public.driver_compliance_documents for select to authenticated
      using (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'driver_compliance_events' and policyname = 'Own and admin read compliance events') then
    create policy "Own and admin read compliance events" on public.driver_compliance_events for select to authenticated
      using (driver_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
  end if;
end $$;

-- A record's facts never change; only its review fields move forward, once.
create or replace function public.tg_compliance_document_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Compliance records are kept.' using errcode = '42501'; end if;
  if (to_jsonb(new) - 'status' - 'reviewed_by' - 'reviewed_at' - 'review_reason' - 'expires_on' - 'licence_class')
     is distinct from (to_jsonb(old) - 'status' - 'reviewed_by' - 'reviewed_at' - 'review_reason' - 'expires_on' - 'licence_class') then
    raise exception 'A compliance record cannot be changed. Submit a new document instead.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'submitted' and new.status in ('checked', 'rejected', 'superseded'))
    or (old.status = 'checked' and new.status = 'superseded')) then
    raise exception 'Compliance status cannot go from % to %.', old.status, new.status using errcode = '42501';
  end if;
  if old.status <> 'submitted' and ((new.expires_on, new.licence_class, new.reviewed_by, new.reviewed_at, new.review_reason)
       is distinct from (old.expires_on, old.licence_class, old.reviewed_by, old.reviewed_at, old.review_reason)) then
    raise exception 'A reviewed compliance record cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tg_compliance_document_guard() from public, anon, authenticated;
create or replace trigger trg_compliance_document_guard
  before update or delete on public.driver_compliance_documents
  for each row execute function public.tg_compliance_document_guard();

create or replace function public.tg_compliance_events_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Compliance history cannot be changed.' using errcode = '42501';
end $$;
revoke all on function public.tg_compliance_events_append_only() from public, anon, authenticated;
create or replace trigger trg_compliance_events_append_only
  before update or delete on public.driver_compliance_events
  for each row execute function public.tg_compliance_events_append_only();

-- Driver submits a document (their own file). The previous current one of the same kind is superseded.
create or replace function public.submit_compliance_document(
  _doc_type text, _storage_path text, _expires_on date default null, _licence_class text default null,
  _insurance_type text default null, _truck uuid default null, _number_last4 text default null)
returns public.driver_compliance_documents
language plpgsql security definer set search_path to 'public' as $$
declare _uid uuid := auth.uid(); _row public.driver_compliance_documents; _old public.driver_compliance_documents;
begin
  if _uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if not exists (select 1 from public.driver_profiles where user_id = _uid) then
    raise exception 'Only drivers can submit compliance documents.' using errcode = '42501';
  end if;
  if split_part(coalesce(_storage_path, ''), '/', 1) <> _uid::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'driver-docs' and o.name = _storage_path) then
    raise exception 'The file must be one you uploaded to your own documents.' using errcode = '42501';
  end if;
  if _truck is not null and not exists (select 1 from public.trucks t where t.id = _truck and t.driver_id = _uid) then
    raise exception 'That truck is not yours.' using errcode = '42501';
  end if;
  if _expires_on is not null and _expires_on < current_date then
    raise exception 'This document has already expired. Submit the current one.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('compliance:' || _uid::text || ':' || coalesce(_doc_type, '')));
  for _old in select * from public.driver_compliance_documents
               where driver_id = _uid and doc_type = _doc_type and truck_id is not distinct from _truck
                 and status in ('submitted', 'checked') for update loop
    update public.driver_compliance_documents set status = 'superseded' where id = _old.id;
    insert into public.driver_compliance_events (document_id, driver_id, action, actor) values (_old.id, _uid, 'superseded', _uid);
  end loop;
  insert into public.driver_compliance_documents (driver_id, truck_id, doc_type, storage_path, number_last4, licence_class,
                                                  insurance_type, expires_on)
  values (_uid, _truck, _doc_type, _storage_path, nullif(btrim(coalesce(_number_last4, '')), ''),
          nullif(btrim(coalesce(_licence_class, '')), ''), _insurance_type, _expires_on)
  returning * into _row;
  insert into public.driver_compliance_events (document_id, driver_id, action, actor) values (_row.id, _uid, 'submitted', _uid);
  return _row;
end $$;
revoke all on function public.submit_compliance_document(text, text, date, text, text, uuid, text) from public, anon;
grant execute on function public.submit_compliance_document(text, text, date, text, text, uuid, text) to authenticated;

-- Admin review: checked or rejected, with the facts confirmed from the document and a reason when rejecting.
create or replace function public.admin_review_compliance_document(_doc uuid, _decision text, _reason text default null,
                                                                   _expires_on date default null, _licence_class text default null)
returns public.driver_compliance_documents
language plpgsql security definer set search_path to 'public' as $$
declare _row public.driver_compliance_documents; _why text := nullif(btrim(coalesce(_reason, '')), '');
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into _row from public.driver_compliance_documents where id = _doc for update;
  if _row.id is null then raise exception 'Document not found'; end if;
  if _row.driver_id = auth.uid() then raise exception 'You cannot review your own documents.' using errcode = '42501'; end if;
  if _row.status <> 'submitted' then raise exception 'This document was already reviewed (%).', _row.status; end if;
  if _decision = 'rejected' then
    if _why is null or length(_why) < 5 then raise exception 'Give the reason for rejecting (at least 5 characters).' using errcode = '22023'; end if;
    update public.driver_compliance_documents set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = _why
     where id = _doc returning * into _row;
  elsif _decision = 'checked' then
    _expires_on := coalesce(_expires_on, _row.expires_on);
    if _row.doc_type <> 'identity' and _expires_on is null then
      raise exception 'Enter the expiry date shown on the document.' using errcode = '22023';
    end if;
    if _expires_on is not null and _expires_on < current_date then
      raise exception 'The document has expired; reject it instead.' using errcode = '22023';
    end if;
    if _row.doc_type = 'driving_licence' and coalesce(nullif(btrim(coalesce(_licence_class, '')), ''), _row.licence_class) is null then
      raise exception 'Enter the licence class shown on the document.' using errcode = '22023';
    end if;
    update public.driver_compliance_documents
       set status = 'checked', reviewed_by = auth.uid(), reviewed_at = now(), review_reason = _why, expires_on = _expires_on,
           licence_class = coalesce(nullif(btrim(coalesce(_licence_class, '')), ''), licence_class)
     where id = _doc returning * into _row;
  else
    raise exception 'Decision must be checked or rejected.' using errcode = '22023';
  end if;
  insert into public.driver_compliance_events (document_id, driver_id, action, actor, reason) values (_row.id, _row.driver_id, _decision, auth.uid(), _why);
  insert into public.notifications (user_id, type, title, body)
  values (_row.driver_id, 'compliance_review',
          case _decision when 'checked' then 'Document checked' else 'Document not accepted' end,
          case _decision when 'checked' then format('Con Z checked your %s.', replace(_row.doc_type, '_', ' '))
               else format('Your %s was not accepted: %s', replace(_row.doc_type, '_', ' '), _why) end);
  perform public.log_admin_action('compliance_document_' || _decision,
    jsonb_build_object('document_id', _row.id, 'doc_type', _row.doc_type), _why, _row.id, _row.driver_id);
  return _row;
end $$;
revoke all on function public.admin_review_compliance_document(uuid, text, text, date, text) from public, anon;
grant execute on function public.admin_review_compliance_document(uuid, text, text, date, text) to authenticated;

-- The driver's own status per document kind (driver and admins).
create or replace function public.driver_compliance_summary(_driver uuid default null)
returns table (doc_type text, truck_id uuid, state text, expires_on date, licence_class text, insurance_type text, review_reason text)
language plpgsql stable security definer set search_path to 'public' as $$
declare _d uuid := coalesce(_driver, auth.uid());
begin
  if not (_d = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query
  select t.k, d.truck_id,
         case when d.id is null then 'missing'
              when d.status = 'rejected' then 'rejected'
              when d.status = 'submitted' then 'pending'
              when d.expires_on is not null and d.expires_on < current_date then 'expired'
              else 'checked' end,
         d.expires_on, d.licence_class, d.insurance_type, case when d.status = 'rejected' then d.review_reason end
    from unnest(array['identity', 'driving_licence', 'vehicle_registration', 'certificate_of_fitness', 'operator_licence', 'insurance']) t(k)
    left join lateral (
      select * from public.driver_compliance_documents x
       where x.driver_id = _d and x.doc_type = t.k and x.status <> 'superseded'
       order by x.submitted_at desc limit 1) d on true;
end $$;
revoke all on function public.driver_compliance_summary(uuid) from public, anon;
grant execute on function public.driver_compliance_summary(uuid) to authenticated;

-- What customers may see: checked, unexpired facts only.
create or replace function public.driver_compliance_badges(_driver uuid)
returns table (doc_type text, licence_class text, insurance_type text, valid_to date)
language sql stable security definer set search_path to 'public' as $$
  select x.doc_type, x.licence_class, x.insurance_type, x.expires_on
    from public.driver_compliance_documents x
   where x.driver_id = _driver and x.status = 'checked' and (x.expires_on is null or x.expires_on >= current_date)
     and auth.uid() is not null
$$;
revoke all on function public.driver_compliance_badges(uuid) from public, anon;
grant execute on function public.driver_compliance_badges(uuid) to authenticated;

-- Daily: reminders at 30 and 7 days, an expiry notice once.
create or replace function public.compliance_expiry_sweep()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare _r record; _n integer := 0; _action text;
begin
  for _r in select * from public.driver_compliance_documents
             where status = 'checked' and expires_on is not null and expires_on <= current_date + 30 loop
    _action := case when _r.expires_on < current_date then 'expired'
                    when _r.expires_on <= current_date + 7 then 'reminder_7' else 'reminder_30' end;
    begin
      insert into public.driver_compliance_events (document_id, driver_id, action) values (_r.id, _r.driver_id, _action);
    exception when unique_violation then continue;
    end;
    _n := _n + 1;
    insert into public.notifications (user_id, type, title, body)
    values (_r.driver_id, 'compliance_expiry',
            case _action when 'expired' then 'A document has expired' else 'A document expires soon' end,
            case _action when 'expired'
                 then format('Your %s expired on %s. Upload the renewed one.%s', replace(_r.doc_type, '_', ' '), _r.expires_on,
                             case when _r.doc_type = 'driving_licence' then ' You cannot send new offers until it is checked.' else '' end)
                 else format('Your %s expires on %s. Upload the renewed one in time.', replace(_r.doc_type, '_', ' '), _r.expires_on) end);
    if _action = 'expired' then
      insert into public.notifications (user_id, type, title, body)
      select distinct ur.user_id, 'compliance_expiry', 'Driver document expired',
             format('A driver''s %s expired on %s.', replace(_r.doc_type, '_', ' '), _r.expires_on)
        from public.user_roles ur where ur.role in ('admin', 'super_admin');
    end if;
  end loop;
  return _n;
end $$;
revoke all on function public.compliance_expiry_sweep() from public, anon, authenticated;
grant execute on function public.compliance_expiry_sweep() to service_role;
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'compliance-expiry-sweep') then
    perform cron.schedule('compliance-expiry-sweep', '17 6 * * *', 'select public.compliance_expiry_sweep()');
  end if;
end $$;

-- The one restriction: no new offers with an expired checked driving licence on record.
create or replace function public.tg_bid_requires_unexpired_licence()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _lic public.driver_compliance_documents;
begin
  select * into _lic from public.driver_compliance_documents
   where driver_id = new.driver_id and doc_type = 'driving_licence' and status in ('checked', 'submitted')
   order by submitted_at desc limit 1;
  if _lic.id is not null and _lic.status = 'checked' and _lic.expires_on < current_date then
    raise exception 'Your driving licence on record expired on %. Upload the renewed licence to send offers.', _lic.expires_on
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tg_bid_requires_unexpired_licence() from public, anon, authenticated;
create or replace trigger trg_bid_requires_unexpired_licence
  before insert on public.bids
  for each row execute function public.tg_bid_requires_unexpired_licence();
