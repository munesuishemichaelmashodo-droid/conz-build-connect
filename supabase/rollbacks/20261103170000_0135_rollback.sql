-- Undo 0135 (optional offer deposits). Needs the SQL editor (drops columns). Export bids.deposit_* first if any offer used them.
begin;
drop trigger if exists trg_bids_deposit_rules on public.bids;
drop function if exists public.acknowledge_deposit_terms(uuid);
drop function if exists public.tg_bids_deposit_rules();
alter table public.bids drop column if exists deposit_terms_accepted_at;
alter table public.bids drop column if exists deposit_terms;
alter table public.bids drop column if exists deposit_reason;
alter table public.bids drop column if exists deposit_amount;
alter table public.bids drop column if exists deposit_required;
commit;
