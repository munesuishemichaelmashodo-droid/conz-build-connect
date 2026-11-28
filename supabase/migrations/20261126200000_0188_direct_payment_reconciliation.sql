-- -----------------------------------------------------------------------------
-- 0188: direct-payment reconciliation (trust Stage 3).
--
-- Business model unchanged: the customer pays the driver directly. Con Z never collects, holds, escrows, distributes or
-- guarantees the fare. The 7% commission stays as it is (driver's commission credit, 0171/0176); nothing here reads or
-- writes wallets, wallet transactions, held commission, promo credit or the job price.
--
-- Reuses 0179/0180: the agreed plan (job_payment_plan), one write-once row per stage (direct_payment_stages: expected
-- amount, method, recipient, the customer's "I paid", the driver's "I received", the customer's acknowledgement) and
-- its append-only history (direct_payment_stage_events). Adds only:
--   * Reused references refused: a payment reference (normalised: letters and digits, upper case) already given for a
--     different payment, on any job, is refused, for the customer's and the driver's statement alike. The same reference
--     on both statements of ONE payment is expected. Serialised per reference, so two people cannot use one reference
--     at the same moment.
--   * direct_payment_evidence: proof a party attaches to a stage (screenshot, receipt photo, bank or provider
--     statement), a file the party uploaded to the job's private chat-media folder. Append-only, parties and admins
--     only, at most 10 per person per stage.
--   * direct_payment_stage_reviews (append-only): a party marks a stage payment disputed or reports a reversal (with a
--     reason); an admin who is not a party records an independent check (bank statement, provider statement or a
--     provider lookup, with a reason; never a screenshot) or closes a review. Every admin action is in the audit log.
--   * direct_payment_stage_state(): one status per stage, from strongest to weakest claim:
--       disputed / reversal_reported (open review) > independently_confirmed (admin checked an independent source)
--       > both_confirmed (driver received + customer agreed; NOT checked by Con Z) > receipt_claimed (driver says
--       received) > payment_reported (customer says paid) > not_reported. Attached proof is reported next to it
--       (evidence_submitted, screenshot_only) and never upgrades a status.
--   * job_payment_reconciliation(): the job's agreed fare, method, recipient, each stage with its statements,
--     references, proof, reviews and status, totals (agreed, reported, received, outstanding) and flags.
-- No DROP, no DELETE, no money, no settings. Recovery (forward-safe): supabase/rollbacks/20261126200000_0188_rollback.sql.
-- -----------------------------------------------------------------------------

-- 1. References ------------------------------------------------------------------------------------------------------
create or replace function public.normalise_payment_reference(_ref text)
returns text language sql immutable set search_path to 'public' as $$
  select nullif(upper(regexp_replace(coalesce(_ref, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;
revoke all on function public.normalise_payment_reference(text) from public, anon;
grant execute on function public.normalise_payment_reference(text) to authenticated, service_role;

create or replace function public.tg_direct_payment_reference_reuse()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _ref text;
begin
  foreach _ref in array array[
      case when new.customer_reference is distinct from old.customer_reference then public.normalise_payment_reference(new.customer_reference) end,
      case when new.driver_reference is distinct from old.driver_reference then public.normalise_payment_reference(new.driver_reference) end] loop
    continue when _ref is null;
    perform pg_advisory_xact_lock(hashtext('conz.payment_reference:' || _ref));
    if exists (select 1 from public.direct_payment_stages s
                where s.id <> new.id
                  and (public.normalise_payment_reference(s.customer_reference) = _ref
                       or public.normalise_payment_reference(s.driver_reference) = _ref)) then
      raise exception 'This payment reference was already used for another payment. Check the reference, or raise a dispute.'
        using errcode = '23505';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.tg_direct_payment_reference_reuse() from public, anon, authenticated;
create or replace trigger trg_direct_payment_reference_reuse
  before update of customer_reference, driver_reference on public.direct_payment_stages
  for each row execute function public.tg_direct_payment_reference_reuse();

-- 2. Attached proof ---------------------------------------------------------------------------------------------------
create table if not exists public.direct_payment_evidence (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.direct_payment_stages(id),
  job_id uuid not null references public.jobs(id),
  submitted_by uuid not null references auth.users(id),
  submitter_role text not null check (submitter_role in ('customer', 'driver')),
  kind text not null check (kind in ('screenshot', 'receipt_photo', 'bank_statement', 'provider_statement', 'other')),
  storage_path text not null check (char_length(storage_path) <= 300),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists direct_payment_evidence_stage_idx on public.direct_payment_evidence (stage_id, created_at);

create table if not exists public.direct_payment_stage_reviews (
  id bigint generated always as identity primary key,
  stage_id uuid not null references public.direct_payment_stages(id),
  job_id uuid not null references public.jobs(id),
  actor uuid not null references auth.users(id),
  actor_role text not null check (actor_role in ('customer', 'driver', 'admin')),
  action text not null check (action in ('disputed', 'reversal_reported', 'independently_verified', 'review_closed')),
  source text check (source is null or source in ('bank_statement', 'provider_statement', 'provider_lookup')),
  reason text not null check (char_length(reason) between 10 and 1000),
  created_at timestamptz not null default now(),
  check ((action = 'independently_verified') = (source is not null))
);
create index if not exists direct_payment_stage_reviews_stage_idx on public.direct_payment_stage_reviews (stage_id, id);

alter table public.direct_payment_evidence enable row level security;
alter table public.direct_payment_stage_reviews enable row level security;
revoke all on public.direct_payment_evidence, public.direct_payment_stage_reviews from public, anon, authenticated;
grant select on public.direct_payment_evidence, public.direct_payment_stage_reviews to authenticated;
grant select, insert on public.direct_payment_evidence, public.direct_payment_stage_reviews to service_role;
do $$
declare _t text;
begin
  foreach _t in array array['direct_payment_evidence', 'direct_payment_stage_reviews'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = _t and policyname = _t || '_parties_admins_read') then
      execute format($p$create policy %I on public.%I for select to authenticated
        using (exists (select 1 from public.jobs j where j.id = %I.job_id and coalesce(auth.uid() in (j.customer_id, j.driver_id), false))
               or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'))$p$,
        _t || '_parties_admins_read', _t, _t);
    end if;
  end loop;
end $$;

create or replace function public.tg_direct_payment_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Payment history is append-only.' using errcode = '42501';
end $$;
revoke all on function public.tg_direct_payment_append_only() from public, anon, authenticated;
create or replace trigger trg_direct_payment_evidence_append_only
  before update or delete on public.direct_payment_evidence
  for each row execute function public.tg_direct_payment_append_only();
create or replace trigger trg_direct_payment_stage_reviews_append_only
  before update or delete on public.direct_payment_stage_reviews
  for each row execute function public.tg_direct_payment_append_only();

create or replace function public.attach_stage_payment_evidence(_job uuid, _stage text, _kind text, _storage_path text,
                                                                 _note text default null)
returns public.direct_payment_evidence
language plpgsql security definer set search_path to 'public' as $$
declare
  _row public.direct_payment_stages;
  _j public.jobs;
  _ev public.direct_payment_evidence;
  _parts text[] := string_to_array(coalesce(_storage_path, ''), '/');
begin
  _row := public.direct_payment_stage_row(_job, _stage);   -- locks the job, checks the caller is a party
  select * into _j from public.jobs where id = _job;
  if _kind is null or _kind not in ('screenshot', 'receipt_photo', 'bank_statement', 'provider_statement', 'other') then
    raise exception 'Choose what kind of proof this is.' using errcode = '22023';
  end if;
  if coalesce(array_length(_parts, 1), 0) < 3 or _parts[1] <> _job::text or _parts[2] <> auth.uid()::text then
    raise exception 'The file must be one you uploaded to this job.' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'chat-media' and o.name = _storage_path) then
    raise exception 'The file was not uploaded. Choose it again.';
  end if;
  if (select count(*) from public.direct_payment_evidence e where e.stage_id = _row.id and e.submitted_by = auth.uid()) >= 10 then
    raise exception 'You have already attached 10 files to this payment.';
  end if;
  insert into public.direct_payment_evidence (stage_id, job_id, submitted_by, submitter_role, kind, storage_path, note)
  values (_row.id, _job, auth.uid(), case when auth.uid() = _j.driver_id then 'driver' else 'customer' end,
          _kind, _storage_path, nullif(btrim(coalesce(_note, '')), ''))
  returning * into _ev;
  return _ev;
end $$;
revoke all on function public.attach_stage_payment_evidence(uuid, text, text, text, text) from public, anon;
grant execute on function public.attach_stage_payment_evidence(uuid, text, text, text, text) to authenticated;

-- 3. Disputes, reversals, independent checks -------------------------------------------------------------------------
create or replace function public.flag_stage_payment(_job uuid, _stage text, _action text, _reason text)
returns public.direct_payment_stage_reviews
language plpgsql security definer set search_path to 'public' as $$
declare
  _row public.direct_payment_stages;
  _j public.jobs;
  _rv public.direct_payment_stage_reviews;
  _why text := nullif(btrim(coalesce(_reason, '')), '');
  _role text;
begin
  if _action not in ('disputed', 'reversal_reported') then raise exception 'Unknown action' using errcode = '22023'; end if;
  select * into _row from public.direct_payment_stages s where s.job_id = _job and s.stage = _stage;
  if _row.id is null then raise exception 'Nothing has been recorded for this payment yet.'; end if;
  _row := public.direct_payment_stage_row(_job, _stage);   -- locks the job, checks the caller is a party
  select * into _j from public.jobs where id = _job;
  _role := case when auth.uid() = _j.driver_id then 'driver' else 'customer' end;
  if _why is null or length(_why) < 10 then raise exception 'Explain what is wrong (at least 10 characters).' using errcode = '22023'; end if;
  if _row.customer_claimed_at is null and _row.driver_confirmed_at is null then
    raise exception 'Nothing has been recorded for this payment yet.';
  end if;
  if public.direct_payment_stage_state(_row) = _action then
    raise exception 'This payment is already marked %.', replace(_action, '_', ' ');
  end if;
  insert into public.direct_payment_stage_reviews (stage_id, job_id, actor, actor_role, action, reason)
  values (_row.id, _job, auth.uid(), _role, _action, _why) returning * into _rv;
  begin
    insert into public.notifications (user_id, type, title, body, job_id)
    select u, 'payment_review',
           case _action when 'disputed' then 'A payment on your job was disputed' else 'A payment reversal was reported' end,
           format('The %s reported a problem with the %s payment. Con Z did not handle this money and will review the records.',
                  _role, case _stage when 'full' then 'job' else _stage end), _job
      from (select case when _role = 'driver' then _j.customer_id else _j.driver_id end as u
            union select ur.user_id from public.user_roles ur where ur.role in ('admin', 'super_admin')) x
     where u is not null;
  exception when others then raise warning 'payment review notice failed: %', sqlerrm;
  end;
  return _rv;
end $$;
revoke all on function public.flag_stage_payment(uuid, text, text, text) from public, anon;
grant execute on function public.flag_stage_payment(uuid, text, text, text) to authenticated;

create or replace function public.admin_review_stage_payment(_stage_id uuid, _action text, _source text, _reason text)
returns public.direct_payment_stage_reviews
language plpgsql security definer set search_path to 'public' as $$
declare
  _row public.direct_payment_stages;
  _j public.jobs;
  _rv public.direct_payment_stage_reviews;
  _why text := nullif(btrim(coalesce(_reason, '')), '');
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into _row from public.direct_payment_stages where id = _stage_id for update;
  if _row.id is null then raise exception 'Payment record not found'; end if;
  select * into _j from public.jobs where id = _row.job_id;
  if auth.uid() in (_j.customer_id, _j.driver_id) then
    raise exception 'You cannot review a payment on a job you are part of.' using errcode = '42501';
  end if;
  if _why is null or length(_why) < 10 then raise exception 'Give the reason (at least 10 characters).' using errcode = '22023'; end if;
  if _action = 'independently_verified' then
    if _source = 'screenshot' then
      raise exception 'A screenshot alone is not proof of payment. Check a bank or provider statement or the provider''s records.'
        using errcode = '22023';
    end if;
    if _source is null or _source not in ('bank_statement', 'provider_statement', 'provider_lookup') then
      raise exception 'Say which independent source was checked.' using errcode = '22023';
    end if;
    if _row.customer_claimed_at is null and _row.driver_confirmed_at is null then
      raise exception 'Nothing has been recorded for this payment yet.';
    end if;
    if _source in ('bank_statement', 'provider_statement') and not exists (
         select 1 from public.direct_payment_evidence e where e.stage_id = _row.id and e.kind = _source) then
      raise exception 'No % is attached to this payment.', replace(_source, '_', ' ');
    end if;
  elsif _action = 'review_closed' then
    _source := null;
    if public.direct_payment_stage_state(_row) not in ('disputed', 'reversal_reported') then
      raise exception 'There is no open review on this payment.';
    end if;
  else
    raise exception 'Unknown action' using errcode = '22023';
  end if;
  insert into public.direct_payment_stage_reviews (stage_id, job_id, actor, actor_role, action, source, reason)
  values (_row.id, _row.job_id, auth.uid(), 'admin', _action, _source, _why) returning * into _rv;
  perform public.log_admin_action('direct_payment_' || _action,
    jsonb_build_object('stage_id', _row.id, 'job_id', _row.job_id, 'stage', _row.stage, 'source', _source), _why, _row.job_id, null);
  return _rv;
end $$;
revoke all on function public.admin_review_stage_payment(uuid, text, text, text) from public, anon;
grant execute on function public.admin_review_stage_payment(uuid, text, text, text) to authenticated;

-- 4. One status per stage ----------------------------------------------------------------------------------------------
create or replace function public.direct_payment_stage_state(_row public.direct_payment_stages)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare _last public.direct_payment_stage_reviews; _open public.direct_payment_stage_reviews;
begin
  if _row.id is null then return 'not_reported'; end if;
  -- the newest dispute or reversal that no later review_closed has closed
  select * into _open from public.direct_payment_stage_reviews r
   where r.stage_id = _row.id and r.action in ('disputed', 'reversal_reported')
     and not exists (select 1 from public.direct_payment_stage_reviews c
                      where c.stage_id = _row.id and c.action = 'review_closed' and c.id > r.id)
   order by r.id desc limit 1;
  if _open.id is not null then return _open.action; end if;
  select * into _last from public.direct_payment_stage_reviews r
   where r.stage_id = _row.id and r.action = 'independently_verified'
     and not exists (select 1 from public.direct_payment_stage_reviews d
                      where d.stage_id = _row.id and d.action in ('disputed', 'reversal_reported') and d.id > r.id)
   order by r.id desc limit 1;
  if _last.id is not null then return 'independently_confirmed'; end if;
  if _row.driver_confirmed_at is not null and _row.customer_acknowledged_at is not null then return 'both_confirmed'; end if;
  if _row.driver_confirmed_at is not null then return 'receipt_claimed'; end if;
  if _row.customer_claimed_at is not null then return 'payment_reported'; end if;
  return 'not_reported';
end $$;
revoke all on function public.direct_payment_stage_state(public.direct_payment_stages) from public, anon, authenticated;

-- 5. Reconciliation -----------------------------------------------------------------------------------------------------
create or replace function public.job_payment_reconciliation(_job uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  _j public.jobs;
  _a public.job_agreements;
  _stages jsonb;
  _fare numeric;
begin
  select * into _j from public.jobs where id = _job;
  if not found then raise exception 'Job not found'; end if;
  if not (coalesce(auth.uid() in (_j.customer_id, _j.driver_id), false)
          or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Only the customer or the driver of this job can see its payments.' using errcode = '42501';
  end if;
  select * into _a from public.job_agreements a where a.job_id = _job and a.status = 'accepted' order by a.version desc limit 1;
  _fare := coalesce(_a.fare, _j.final_price, _j.budget);

  select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) into _stages from (
    select case p.stage when 'deposit' then 1 when 'balance' then 2 else 3 end as ord,
      jsonb_build_object(
        'stage', p.stage,
        'expected_amount', p.expected_amount,
        'method_agreed', p.method_agreed,
        'recipient_name', p.recipient_name,
        'recipient_account', p.recipient_account,
        'state', public.direct_payment_stage_state(s),
        'customer_reported', case when s.customer_claimed_at is not null then jsonb_build_object(
            'at', s.customer_claimed_at, 'amount', s.customer_amount, 'method', s.customer_method, 'reference', s.customer_reference) end,
        'driver_received', case when s.driver_confirmed_at is not null then jsonb_build_object(
            'at', s.driver_confirmed_at, 'amount', s.driver_amount, 'method', s.driver_method, 'reference', s.driver_reference) end,
        'customer_acknowledged_at', s.customer_acknowledged_at,
        'evidence', coalesce((select jsonb_agg(jsonb_build_object('kind', e.kind, 'by_role', e.submitter_role, 'at', e.created_at,
                                                                  'storage_path', e.storage_path, 'note', e.note) order by e.created_at)
                                from public.direct_payment_evidence e where e.stage_id = s.id), '[]'::jsonb),
        'evidence_submitted', exists (select 1 from public.direct_payment_evidence e where e.stage_id = s.id),
        'screenshot_only', exists (select 1 from public.direct_payment_evidence e where e.stage_id = s.id)
                           and not exists (select 1 from public.direct_payment_evidence e where e.stage_id = s.id and e.kind <> 'screenshot'),
        'reviews', coalesce((select jsonb_agg(jsonb_build_object('action', r.action, 'by_role', r.actor_role, 'source', r.source,
                                                                 'reason', r.reason, 'at', r.created_at) order by r.id)
                               from public.direct_payment_stage_reviews r where r.stage_id = s.id), '[]'::jsonb),
        'flags', to_jsonb(array_remove(array[
            case when s.customer_amount is not null and s.customer_amount <> p.expected_amount then 'customer_amount_differs' end,
            case when s.driver_amount is not null and s.driver_amount <> p.expected_amount then 'driver_amount_differs' end,
            case when s.customer_amount is not null and s.driver_amount is not null and s.customer_amount <> s.driver_amount
                 then 'customer_and_driver_differ' end,
            case when s.customer_reference is not null and s.driver_reference is not null
                      and public.normalise_payment_reference(s.customer_reference) <> public.normalise_payment_reference(s.driver_reference)
                 then 'references_differ' end,
            case when s.agreement_id is distinct from _a.id and s.id is not null then 'recorded_under_earlier_agreement' end
          ], null))
      ) as x
    from public.job_payment_plan(_job) p
    left join public.direct_payment_stages s on s.job_id = _job and s.stage = p.stage
  ) t;

  return jsonb_build_object(
    'job_id', _job,
    'payment_route', _j.payment_method,
    'agreed_fare', _fare,
    'agreement_version', _a.version,
    'basis', 'The customer pays the driver directly. Con Z does not collect, hold or guarantee this money. Reported and received amounts are statements by the customer and the driver; "independently confirmed" means a Con Z admin checked a bank or provider record. A screenshot alone never confirms a payment.',
    'stages', _stages,
    'totals', jsonb_build_object(
      'agreed', _fare,
      'reported_by_customer', (select coalesce(sum(s.customer_amount), 0) from public.direct_payment_stages s where s.job_id = _job),
      'received_by_driver', (select coalesce(sum(s.driver_amount), 0) from public.direct_payment_stages s
                              where s.job_id = _job and public.direct_payment_stage_state(s) not in ('disputed', 'reversal_reported')),
      'outstanding', greatest(_fare - (select coalesce(sum(s.driver_amount), 0) from public.direct_payment_stages s
                                        where s.job_id = _job and public.direct_payment_stage_state(s) not in ('disputed', 'reversal_reported')), 0),
      'under_review', (select count(*) from public.direct_payment_stages s
                        where s.job_id = _job and public.direct_payment_stage_state(s) in ('disputed', 'reversal_reported')))
  );
end $$;
revoke all on function public.job_payment_reconciliation(uuid) from public, anon;
grant execute on function public.job_payment_reconciliation(uuid) to authenticated;
