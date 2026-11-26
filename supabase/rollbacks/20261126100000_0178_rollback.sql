-- Undo 0178. Functions and triggers go; the customer payment records table and the report columns are KEPT
-- (records are never deleted; remove them by hand only if empty).
drop trigger if exists trg_payments_set_paid_at on public.payments;
drop function if exists public.tg_payments_set_paid_at();
drop trigger if exists trg_reports_urgent_notify on public.reports;
drop function if exists public.tg_reports_urgent_notify();
drop function if exists public.customer_acknowledge_direct_payment(uuid);
drop function if exists public.customer_report_direct_payment(uuid, text, numeric, text);
drop function if exists public.direct_payment_customer_job(uuid);
