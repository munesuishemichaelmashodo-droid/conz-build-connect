-- Undo 0178. Triggers and functions go; the report columns are KEPT (drop them by hand only if unused).
drop trigger if exists trg_payments_set_paid_at on public.payments;
drop function if exists public.tg_payments_set_paid_at();
drop trigger if exists trg_reports_urgent_notify on public.reports;
drop function if exists public.tg_reports_urgent_notify();
