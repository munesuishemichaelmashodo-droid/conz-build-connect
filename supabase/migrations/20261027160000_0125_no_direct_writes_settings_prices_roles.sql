-- 0125 — no direct client writes to settings, prices or roles.
--
-- Found 27/10 (read-only check of production): system_settings and material_prices have an RLS policy
-- "ALL for super_admin", and user_roles has INSERT/UPDATE/DELETE policies for super_admin, with table grants
-- to authenticated. A signed-in super admin session could therefore write these tables straight through the
-- API: change the commission rate, the payment switch, escrow/withdrawal switches and limits, prices, or grant
-- admin roles, without the step-up (require_aal2) or the admin_audit_log row that the admin_* functions enforce.
-- The app never writes these tables directly (checked: only the service role writes user_roles, at sign-up).
--
-- After: anon and authenticated keep SELECT (as RLS allows) but lose INSERT/UPDATE/DELETE. Every change goes
-- through the SECURITY DEFINER admin_* functions (all checked to be definer, so they are unaffected).
-- Undo: supabase/rollbacks/20261027160000_0125_rollback.sql (re-grants exactly what was granted on 27/10).

revoke insert, update, delete on table public.system_settings       from anon, authenticated;
revoke insert, update, delete on table public.material_prices        from anon, authenticated;
revoke insert, update, delete on table public.material_price_buckets from anon, authenticated;
revoke insert, update, delete on table public.user_roles             from anon, authenticated;
