-- -----------------------------------------------------------------------------
-- 0178: the customer's side of a direct payment, safety/fraud report categories, and payments.paid_at.
--
-- 1. Direct payment, customer's side (owner's brief 26/11: distinguish "method agreed", "customer says paid",
--    "driver confirms receipt", "customer acknowledges", "disputed"). ConZ never handles the fare, so nothing here
--    is proof of settlement: these are the two parties' own statements.
--    * direct_payment_customer_records: one row per job, written only by the job's customer through
--      customer_report_direct_payment() ("I paid the driver": method, amount, optional reference) and
--      customer_acknowledge_direct_payment() ("I agree with the driver's confirmation"). Each part is write-once;
--      nothing is ever deleted. Readable by the job's customer, its driver and admins.
--    * Amounts that differ from the agreed price, or from the driver's confirmation (0176), alert admins.
--      Commission never changes (7% of jobs.final_price, reserved at acceptance, charged once at completion).
--
-- 2. reports.category + reports.urgent: safety, fraud/scam, harassment, payment problem, request to deal outside
--    ConZ, suspicious job, other. Safety, fraud and harassment reports notify admins at once. ConZ does not run an
--    emergency response; the app tells people to call the emergency services.
--
-- 3. payments.paid_at is set when a payment becomes paid (audit finding P-4: it was never set).
--
-- No DROP, no DELETE. Undo: supabase/rollbacks/20261126100000_0178_rollback.sql.
-- Tests: supabase/tests/database/1120_direct_payment_customer_side.test.sql
-- -----------------------------------------------------------------------------

-- 1. Customer's side of a direct payment ----------------------------------------------------------------------
create table if not exists public.direct_payment_customer_records (
  job_id           uuid primary key references public.jobs(id),
  customer_id      uuid not null,
  method           text check (method is null or method in ('cash', 'ecocash', 'onemoney', 'innbucks', 'bank_transfer', 'other')),
  amount           numeric(12, 2) check (amount is null or (amount > 0 and amount <= 100000)),
  agreed_amount    numeric(12, 2) not null,
  reference        text check (reference is null or (length(reference) between 1 and 100 and reference !~ '[[:cntrl:]]')),
  reported_at      timestamptz,
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now(),
  check ((method is null) = (amount is null) and (amount is null) = (reported_at is null))
);

-- Write-once parts: a report, once made, never changes; an acknowledgement, once made, never changes.
create or replace function public.direct_payment_customer_records_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A payment record cannot be deleted. Raise a dispute instead.' using errcode = '42501';
  end if;
  if new.job_id <> old.job_id or new.customer_id <> old.customer_id or new.agreed_amount <> old.agreed_amount
     or (old.reported_at is not null and (new.method is distinct from old.method or new.amount is distinct from old.amount
         or new.reference is distinct from old.reference or new.reported_at is distinct from old.reported_at))
     or (old.acknowledged_at is not null and new.acknowledged_at is distinct from old.acknowledged_at) then
    raise exception 'A payment record cannot be changed. Raise a dispute instead.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.direct_payment_customer_records_guard() from public, anon, authenticated;
create or replace trigger trg_direct_payment_customer_records_guard
  before update or delete on public.direct_payment_customer_records
  for each row execute function public.direct_payment_customer_records_guard();

alter table public.direct_payment_customer_records enable row level security;
revoke all on public.direct_payment_customer_records from public, anon, authenticated;
grant select on public.direct_payment_customer_records to authenticated;
grant all on public.direct_payment_customer_records to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'direct_payment_customer_records'
                   and policyname = 'direct_payment_customer_records_parties_read') then
    create policy direct_payment_customer_records_parties_read on public.direct_payment_customer_records
      for select to authenticated
      using (
        customer_id = auth.uid()
        or exists (select 1 from public.jobs j where j.id = job_id and j.driver_id = auth.uid())
        or public.has_role(auth.uid(), 'admin'::public.app_role)
        or public.has_role(auth.uid(), 'super_admin'::public.app_role)
      );
  end if;
end $$;

-- Shared checks: the caller is the job's customer, the job is direct-pay and has a driver.
create or replace function public.direct_payment_customer_job(_job_id uuid)
returns public.jobs language plpgsql security definer set search_path to 'public' as $$
declare _job public.jobs;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _job from public.jobs where id = _job_id for update;
  if not found or _job.customer_id is distinct from auth.uid() then
    raise exception 'Only the customer of this job can record its payment.' using errcode = '42501';
  end if;
  if _job.payment_method is distinct from 'direct' then
    raise exception 'This job was not paid directly to the driver.';
  end if;
  if _job.driver_id is null or _job.status not in ('accepted', 'in_progress', 'completed') then
    raise exception 'A payment can only be recorded on an active or completed job.';
  end if;
  return _job;
end $$;
revoke all on function public.direct_payment_customer_job(uuid) from public, anon, authenticated;

-- "I paid the driver." Once per job; the same report again returns it unchanged, a different one is refused.
create or replace function public.customer_report_direct_payment(_job_id uuid, _method text, _amount numeric,
                                                                  _reference text default null)
returns public.direct_payment_customer_records
language plpgsql security definer set search_path to 'public' as $$
declare _job public.jobs; _row public.direct_payment_customer_records; _conf public.direct_payment_confirmations;
        _ref text := nullif(btrim(coalesce(_reference, '')), ''); _amt numeric := round(_amount, 2); _agreed numeric;
begin
  _job := public.direct_payment_customer_job(_job_id);
  _agreed := coalesce(_job.final_price, _job.budget);
  if _method is null or _method not in ('cash', 'ecocash', 'onemoney', 'innbucks', 'bank_transfer', 'other') then
    raise exception 'Choose how you paid.';
  end if;
  if _amt is null or not public.is_valid_money(_amt) or _amt <= 0 then
    raise exception 'Enter the amount you paid.';
  end if;
  if _ref is not null and (length(_ref) > 100 or _ref ~ '[[:cntrl:]]') then
    raise exception 'The payment reference is too long or has invalid characters.';
  end if;

  select * into _row from public.direct_payment_customer_records where job_id = _job_id for update;
  if found and _row.reported_at is not null then
    if _row.method = _method and _row.amount = _amt and _row.reference is not distinct from _ref then
      return _row;                                      -- idempotent repeat
    end if;
    raise exception 'You already reported this payment. If something is wrong, raise a dispute.';
  end if;

  if found then
    update public.direct_payment_customer_records
       set method = _method, amount = _amt, reference = _ref, reported_at = now()
     where job_id = _job_id returning * into _row;
  else
    insert into public.direct_payment_customer_records (job_id, customer_id, method, amount, agreed_amount, reference, reported_at)
    values (_job_id, auth.uid(), _method, _amt, _agreed, _ref, now())
    returning * into _row;
  end if;

  insert into public.notifications (user_id, type, title, body, job_id)
  values (_job.driver_id, 'payment_reported', 'Customer says they paid you',
          format('The customer says they paid you $%s (%s). Check that you received it, then confirm it on the job. Con Z did not handle this payment.',
                 _amt, replace(_method, '_', ' ')),
          _job_id);

  select * into _conf from public.direct_payment_confirmations where job_id = _job_id;
  if _amt <> _agreed or (_conf.job_id is not null and _conf.amount <> _amt) then
    insert into public.notifications (user_id, type, title, body, job_id)
    select distinct ur.user_id, 'payment_anomaly', 'Direct payment amounts do not match',
           format('Job %s: the customer says they paid $%s; the agreed price is $%s%s. Commission stays 7%% of the agreed price.',
                  _job_id, _amt, _agreed,
                  case when _conf.job_id is not null then format('; the driver confirmed $%s', _conf.amount) else '' end),
           _job_id
      from public.user_roles ur where ur.role in ('admin', 'super_admin');
  end if;
  return _row;
end $$;
revoke all on function public.customer_report_direct_payment(uuid, text, numeric, text) from public, anon;
grant execute on function public.customer_report_direct_payment(uuid, text, numeric, text) to authenticated;

-- "I agree with the driver's confirmation." Only after the driver confirmed (0176). Once per job.
create or replace function public.customer_acknowledge_direct_payment(_job_id uuid)
returns public.direct_payment_customer_records
language plpgsql security definer set search_path to 'public' as $$
declare _job public.jobs; _row public.direct_payment_customer_records;
begin
  _job := public.direct_payment_customer_job(_job_id);
  if not exists (select 1 from public.direct_payment_confirmations where job_id = _job_id) then
    raise exception 'The driver has not confirmed this payment yet.';
  end if;
  select * into _row from public.direct_payment_customer_records where job_id = _job_id for update;
  if found and _row.acknowledged_at is not null then
    return _row;                                        -- idempotent repeat
  end if;
  if found then
    update public.direct_payment_customer_records set acknowledged_at = now() where job_id = _job_id returning * into _row;
  else
    insert into public.direct_payment_customer_records (job_id, customer_id, agreed_amount, acknowledged_at)
    values (_job_id, auth.uid(), coalesce(_job.final_price, _job.budget), now())
    returning * into _row;
  end if;
  return _row;
end $$;
revoke all on function public.customer_acknowledge_direct_payment(uuid) from public, anon;
grant execute on function public.customer_acknowledge_direct_payment(uuid) to authenticated;

-- 2. Report categories ----------------------------------------------------------------------------------------
alter table public.reports add column if not exists category text not null default 'general';
alter table public.reports add column if not exists urgent boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reports_category_check') then
    alter table public.reports add constraint reports_category_check check (category in
      ('general', 'safety', 'fraud_scam', 'harassment', 'payment', 'off_platform_request', 'suspicious_job', 'other'));
  end if;
end $$;

-- Safety, fraud and harassment reports are urgent and reach every admin at once.
create or replace function public.tg_reports_urgent_notify()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.urgent := new.category in ('safety', 'fraud_scam', 'harassment');
  if new.urgent then
    insert into public.notifications (user_id, type, title, body, job_id)
    select distinct ur.user_id, 'urgent_report',
           case new.category when 'safety' then 'Safety report' when 'fraud_scam' then 'Fraud or scam report'
                else 'Harassment report' end,
           left(new.description, 200), new.job_id
      from public.user_roles ur where ur.role in ('admin', 'super_admin');
  end if;
  return new;
end $$;
revoke all on function public.tg_reports_urgent_notify() from public, anon, authenticated;
create or replace trigger trg_reports_urgent_notify
  before insert on public.reports
  for each row execute function public.tg_reports_urgent_notify();

-- 3. payments.paid_at ------------------------------------------------------------------------------------------
create or replace function public.tg_payments_set_paid_at()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' and new.paid_at is null then
    new.paid_at := now();
  end if;
  return new;
end $$;
revoke all on function public.tg_payments_set_paid_at() from public, anon, authenticated;
create or replace trigger trg_payments_set_paid_at
  before update of status on public.payments
  for each row execute function public.tg_payments_set_paid_at();
