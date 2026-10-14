-- =============================================================================
-- 0108 — Correct the duplicated opening-balance ledger entry (found 14/10/2026)
-- =============================================================================
--
-- Defect (verified live, read-only, 14/10/2026):
--   0082's opening-balance block is not idempotent. A first partial run on
--   08/10/2026 posted opening_balance 100.00 for the funded wallet; the full run on
--   14/10/2026 posted a second opening_balance of 85.30 (the balance at that moment,
--   which already included the 08/10 amount less the 14.70 direct commission).
--   Result: -Σ(user_wallets ledger) = 170.60 while Σ(wallets.balance) = 85.30, so
--   financial_reconciliation() check "user_wallets_match_balances" is red and the
--   daily reconcile job alerts super admins. Wallet balances themselves are correct
--   (wallets_match_transactions is ok); only the platform ledger overstates by 85.30.
--
-- Fix: the ledger is append-only (trg_platform_ledger_immutable), so post ONE balanced
--   compensating entry that reverses the later duplicate for each wallet that has more
--   than one opening_balance group. Nothing is updated or deleted.
--
-- Idempotent: runs only for a wallet that has >1 positive opening groups and no
--   correction yet; a second run does nothing.
-- Deploy order: after 0082. No app change. Rollback: none needed (a further
--   compensating entry would be required to undo it).
-- =============================================================================

do $$
declare
  _r record;
begin
  for _r in
    select o.user_id, o.amount
      from (
        select l.user_id, l.entry_group, l.amount, l.created_at,
               row_number() over (partition by l.user_id order by l.created_at, l.entry_group) as rn
          from public.platform_ledger l
         where l.kind = 'opening_balance'
           and l.account = 'opening_balance'
           and l.amount > 0
           and l.user_id is not null
      ) o
     where o.rn > 1
       and not exists (
         select 1 from public.platform_ledger c
          where c.kind = 'opening_balance_correction'
            and c.user_id = o.user_id
       )
  loop
    perform public.post_ledger('opening_balance_correction',
      jsonb_build_array(
        jsonb_build_object('account', 'opening_balance', 'amount', -_r.amount),
        jsonb_build_object('account', 'user_wallets',    'amount',  _r.amount)),
      null, null, _r.user_id,
      'Correction: duplicate opening balance posted twice when 0082 was re-run (14/10/2026)');
  end loop;
end $$;
