-- -----------------------------------------------------------------------------
-- 0178: safety/fraud report categories, and payments.paid_at.
--
-- 1. (Moved to 0179 on 26/11: the customer's side of a direct payment is now recorded per payment stage.)
--
-- 2. reports.category + reports.urgent: safety, fraud/scam, harassment, payment problem, request to deal outside
--    ConZ, suspicious job, other. Safety, fraud and harassment reports notify admins at once. ConZ does not run an
--    emergency response; the app tells people to call the emergency services.
--
-- 3. payments.paid_at is set when a payment becomes paid (audit finding P-4: it was never set).
--
-- No DROP, no DELETE. Undo: supabase/rollbacks/20261126100000_0178_rollback.sql.
-- Tests: supabase/tests/database/1120_safety_reports_paid_at.test.sql
-- -----------------------------------------------------------------------------

-- 2. Report categories ----------------------------------------------------------------------------------------
alter table public.reports add column if not exists category text not null default 'general';
alter table public.reports add column if not exists urgent boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reports_category_check') then
    alter table public.reports add constraint reports_category_check check (category in
      ('general', 'safety', 'fraud_scam', 'harassment', 'payment', 'off_platform_request', 'suspicious_job', 'other'));
  end if;
end $$;

-- 0142 grants column by column: reporters may also choose a category and read it back; admins read both columns
-- through the same select grant plus their row policy. `urgent` is set only by the trigger below.
grant select (category, urgent) on public.reports to authenticated;
grant insert (category) on public.reports to authenticated;

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
