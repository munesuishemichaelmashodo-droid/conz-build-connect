-- =============================================================================
-- 0083 — Defence-in-depth grants found by the invariant tests (Phase 16)
-- =============================================================================
--
-- supabase/tests/database/120_security_invariants.test.sql flagged:
--   * anon held table-level INSERT/UPDATE/DELETE on payments and UPDATE on
--     wallet_withdrawal_requests / wallet_topup_requests; authenticated held
--     INSERT/UPDATE/DELETE on payments. RLS blocked all of it (no matching
--     policies), but a single permissive policy added later would have
--     opened it. Payments are written only by server code (service role).
--   * ledger_post_referral_reward (trigger function) kept the default PUBLIC
--     EXECUTE (not callable as an RPC, but tidy it).
--   * notify_kyc_reverification(uuid) could be called by any signed-in user
--     for any id -> admin notification spam. Now: only for yourself.
--   * account_deletion_blockers(uuid) told any signed-in user whether ANOTHER
--     user had money or active jobs. Now: only for yourself (or the server).
-- =============================================================================

revoke insert, update, delete, truncate on public.payments from anon, authenticated;
revoke insert, update, delete, truncate on public.wallet_withdrawal_requests from anon;
revoke insert, update, delete, truncate on public.wallet_topup_requests from anon;
revoke insert, update, delete, truncate on public.payment_events, public.platform_ledger, public.escrow_refunds,
  public.admin_money_actions, public.admin_credit_requests, public.reconciliation_runs from anon, authenticated;

revoke all on function public.ledger_post_referral_reward() from public, anon, authenticated;

create or replace function public.notify_kyc_reverification(_driver uuid)
returns void
language sql
security definer
set search_path to 'public'
as $$
  insert into public.notifications (user_id, type, title, body)
  select distinct ur.user_id, 'driver_verification', 'Driver documents changed — re-review needed',
         format('A verified driver (%s) changed identity or compliance documents and is back to pending.', _driver)
    from public.user_roles ur
   where ur.role in ('admin', 'super_admin')
     -- only the driver's own profile change (via the guard trigger) or the server
     and (auth.uid() is null or auth.uid() = _driver);
$$;

create or replace function public.account_deletion_blockers(_uid uuid)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when auth.uid() is not null and auth.uid() is distinct from _uid then null else
  array_remove(array[
    case when exists (select 1 from public.wallets where user_id = _uid and balance > 0) then 'wallet_balance_positive' end,
    case when exists (select 1 from public.wallets where user_id = _uid and balance < 0) then 'wallet_balance_owed' end,
    case when exists (select 1 from public.wallets where user_id = _uid and held > 0) then 'commission_held' end,
    case when exists (select 1 from public.wallet_withdrawal_requests where user_id = _uid and status = 'pending') then 'withdrawal_pending' end,
    case when exists (select 1 from public.wallet_topup_requests where user_id = _uid and status = 'pending') then 'topup_pending' end,
    case when exists (select 1 from public.jobs where (customer_id = _uid or driver_id = _uid)
                        and status in ('open', 'accepted', 'in_progress')) then 'active_jobs' end,
    case when exists (select 1 from public.payments where user_id = _uid
                        and (status in ('paid', 'refund_due')
                             or (status = 'initiated' and created_at > now() - interval '72 hours'))) then 'payment_in_progress' end,
    case when exists (select 1 from public.disputes where (raised_by = _uid or against = _uid)
                        and status in ('open', 'investigating')) then 'open_disputes' end
  ], null) end
$$;
