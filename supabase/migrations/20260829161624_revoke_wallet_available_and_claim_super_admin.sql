-- Recovered verbatim from live supabase_migrations.schema_migrations on
-- 2026-09-25 (was applied live without a committed file).
-- wallet_available(uuid): read-only, but accepts an arbitrary _user_id
-- with no ownership check -- any anon/authenticated caller could look up
-- any other user's available wallet balance. Confirmed no database-level
-- callers and no frontend callers -- genuinely dead client surface.
-- Not dropped, per instruction -- grants only.
REVOKE EXECUTE ON FUNCTION public.wallet_available(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wallet_available(uuid) FROM anon, authenticated;

-- claim_super_admin(): confirmed 2 super_admin rows already exist, so
-- this function is permanently inert for any caller today; its frontend
-- button is only rendered when superCount === 0, so it is not visible to
-- any real user right now. Restricting to postgres/service_role is a
-- deliberate hardening choice against a dormant future-takeover risk.
-- Not dropped, per instruction -- grants only.
REVOKE EXECUTE ON FUNCTION public.claim_super_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_super_admin() FROM anon, authenticated;
