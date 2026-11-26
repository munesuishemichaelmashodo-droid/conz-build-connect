-- Undo 0179. Functions and triggers go; the payment-stage tables, their history and the new agreement columns are
-- KEPT (records are never deleted).
drop function if exists public.customer_acknowledge_stage_payment(uuid, text);
drop function if exists public.driver_confirm_stage_payment(uuid, text, text, numeric, text);
drop function if exists public.customer_claim_stage_payment(uuid, text, text, numeric, text);
drop function if exists public.direct_payment_flag_mismatch(public.direct_payment_stages);
drop function if exists public.direct_payment_check_statement(text, numeric, text);
drop function if exists public.direct_payment_stage_row(uuid, text);
drop function if exists public.job_payment_plan(uuid);
drop function if exists public.propose_job_agreement_terms(uuid, text, text, numeric, text, text, text, text, text, text, text, text, text, text);
drop trigger if exists trg_direct_payment_stages_guard on public.direct_payment_stages;
drop trigger if exists trg_direct_payment_stage_events_append_only on public.direct_payment_stage_events;
