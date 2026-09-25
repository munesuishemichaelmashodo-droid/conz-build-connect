-- 0061: remove authenticator-app (MFA) security from admin — password only.
--
-- Owner's decision (25/09/2026): admins sign in with email + password and
-- are authorised by role (has_role admin / super_admin) alone.
--
-- Already done before this migration:
--   * 20260917091657 drop_admin_mfa_requirement made require_admin_mfa() a
--     no-op, so the 8 admin actions that call it (approve top-up /
--     withdrawal, grant / revoke role, set user status, wallet adjust /
--     reverse, referral action) no longer need a second factor.
--   * The admin panel's aal2 entry gate was removed from admin.tsx.
--
-- This migration finishes the job:
--   1. Removes every enrolled authenticator (TOTP) factor, so Supabase no
--      longer treats any account as MFA-enrolled (no aal2 "next level").
--      Challenges cascade with their factor.
--   2. Revokes client access to the MFA management RPCs that only the
--      removed /mfa page and admin Security tab used. They are kept (not
--      dropped) so this is reversible with a GRANT; require_admin_mfa()
--      stays as the no-op its 8 callers expect.
--   3. Keeps the mfa_recovery_* tables and their rows untouched — the
--      recovery log is audit history.
--
-- Safe to replay: DELETE is idempotent, REVOKE of an absent grant is a no-op.

-- 1. Enrolled authenticators -------------------------------------------------
delete from auth.mfa_factors where factor_type = 'totp';

-- 2. MFA management RPCs: no longer callable from the app --------------------
revoke execute on function public.admin_list_admins_mfa_status() from public, anon, authenticated;
revoke execute on function public.admin_reset_mfa(uuid, text) from public, anon, authenticated;
revoke execute on function public.admin_reset_mfa_factor(uuid, text) from public, anon, authenticated;
revoke execute on function public.generate_mfa_recovery_codes() from public, anon, authenticated;
revoke execute on function public.redeem_mfa_recovery_code(text) from public, anon, authenticated;
