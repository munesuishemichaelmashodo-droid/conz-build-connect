
You're right — the current Top Up dialog is just UI, it never writes anywhere. Here's the plan to make the whole wallet actually work, with proper account security.

## 1. Top-up flow (manual bank / mobile-money → admin approves → wallet credits)

New table:

```
wallet_topup_requests
  id, user_id, amount (>0, ≤100000),
  method (ecocash|onemoney|zipit|bank),
  reference, note,
  status (pending|approved|rejected|cancelled),
  created_at, decided_at, decided_by, reject_reason
```

Grants + RLS (auth-only, per Data-API rules):
- `GRANT SELECT, INSERT ON ... TO authenticated`, `GRANT ALL ... TO service_role`, no `anon`.
- Driver INSERT/SELECT/UPDATE own rows only; cancel allowed only while pending.
- Admin/super_admin SELECT/UPDATE all via `has_role`.

Security-definer RPCs:
- `request_topup(amount, method, reference)` — insert pending row for `auth.uid()`, cap 5 pending per driver.
- `admin_approve_topup(id)` — admin-only; in one transaction credits `wallets.balance` and writes `wallet_transactions('topup')`. Idempotent.
- `admin_reject_topup(id, reason)` — admin-only.

UI:
- Driver `wallet.tsx` Top Up sheet posts through `request_topup`; shows a "Pending top-ups" list with status pills and Cancel.
- New admin **Top-up requests** tab in `admin.revenue.tsx` with Approve / Reject.
- Realtime on `wallets` + `wallet_transactions` + `wallet_topup_requests` so the driver's balance and history update instantly after approval — solves the "I paid $50 and nothing happened" case.

## 2. Commission deduction

`complete_job` already deducts 7% and honours "first job free". Add:
- Block completion when `wallet.balance < commission` (non-free jobs) with a clear error.
- Notification "Commission $X deducted" for the driver.
- Post-completion "Commission Deducted" receipt screen matching the mockup, read from `wallet_transactions`.

## 3. Low-balance protection

- RPC `driver_can_accept(job_id) → {ok, required, balance, shortfall}`.
- `accept_dispatch_offer` calls the guard first; raises `Insufficient wallet balance`.
- `JobOfferListener` shows the "Low Wallet Balance" modal from the board (Top Up to Accept / Maybe Later).

## 4. Withdrawals

`wallet_withdrawal_requests` (mirrors top-ups). Driver requests → admin approves → RPC debits wallet + writes `wallet_transactions('withdrawal')`. Same RLS pattern.

## 5. Account security

- Enable **leaked-password protection** (HIBP) via `configure_auth`.
- **Withdrawal PIN**: `driver_profiles.withdrawal_pin_hash` (pgcrypto bcrypt). Set from Profile. Required to submit a withdrawal. Rate-limit table `pin_attempts` → 5 tries / 15 min, then locked.
- **Audit log**: `wallet_audit_log(user_id, actor_id, action, meta jsonb, created_at)` written by every wallet RPC; driver reads own rows, admins read all.
- **Lock down direct writes** on `wallets` and `wallet_transactions`: revoke `INSERT/UPDATE/DELETE` from `authenticated` — every change must go through SECURITY DEFINER RPCs. Keep SELECT-own.
- **Server validation**: every RPC clamps `amount` (`> 0`, `<= 100000`, no NaN) and re-checks role via `has_role`.
- All new server calls go through `createServerFn` + `requireSupabaseAuth`.
- Run `security--run_security_scan` after the migration and fix any findings.

## 6. Files

Backend — single migration `…_wallet_hardening.sql`:
tables, grants, RLS, RPCs, audit trigger, revoke direct writes on wallets/wallet_transactions, enable realtime replication.

Frontend:
- `src/lib/wallet.functions.ts` (new) — `requestTopup`, `cancelTopup`, `requestWithdrawal`, `setWithdrawalPin`, `verifyWithdrawalPin`, `adminApproveTopup`, `adminRejectTopup`, `adminApproveWithdrawal`.
- `src/routes/_authenticated/wallet.tsx` — wire Top Up to `requestTopup`; add Pending list; add Withdraw sheet with PIN.
- `src/routes/_authenticated/admin.revenue.tsx` — approvals tab.
- `src/components/LowBalanceModal.tsx` (new) + hook into `JobOfferListener.tsx` and manual accept.
- `src/routes/_authenticated/profile.tsx` — "Set withdrawal PIN" card.

Auth config: `configure_auth({ password_hibp_enabled: true })`.

## 7. Verification

- Playwright: driver requests $50 EcoCash top-up → shows Pending → admin approves → balance jumps to $50 and history shows a `topup` row, all via realtime with no refresh.
- Driver A cannot see or approve driver B's request (RLS denies).
- Withdrawal without PIN rejected; 6 wrong PINs locks the driver out.
- Accept a job with balance < commission → LowBalance modal; with enough balance → commission row lands after completion.
- `security--run_security_scan` clean.

Approve and I'll ship the migration first, then the wiring in the follow-up build turn.
