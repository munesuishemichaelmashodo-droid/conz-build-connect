-- Undo 0175 (payment-link identifiers). Contains DROP: run in the Supabase SQL editor.
-- Refuses if any payment-link record exists: those rows are evidence of real provider payments and must be kept.
begin;
lock table public.provider_payment_refs in access exclusive mode;
do $$ begin
  if exists (select 1 from public.provider_payment_refs) then
    raise exception 'STOP: provider_payment_refs has rows; keep them (export first) before removing 0175';
  end if;
end $$;
drop function if exists public.apply_provider_link_payment(text, text, uuid, text, numeric, text, text, text, text, text, text, text);
drop function if exists public.provider_record_payment_link(uuid, text, text, text);
drop function if exists public.provider_claim_payment_link(uuid, text);
drop table if exists public.provider_payment_refs;
drop function if exists public.provider_payment_refs_guard();
commit;
