-- Recovery for 0189 — forward-safe. Run in the SQL editor only if 0189 causes a problem in production.
-- It does not delete or reverse any 'expire' ledger line and does not change any balance: an allowance that expired
-- stays expired (restoring it would need the owner's decision and an audited grant). It can stop further expiries by
-- switching the trigger function into a no-op; the 'expire' kind and its constraints stay so the ledger stays valid.
create or replace function public.tg_expire_promo_after_first_completion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  return null;
end $$;
