-- Re-close functions that earlier migrations (20260829161624, 0061, 0063) had revoked from authenticated,
-- which the blanket grant in lockdown_function_execute_grants re-opened by mistake.
REVOKE EXECUTE ON FUNCTION public.wallet_available(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.wallet_available(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.recent_cancellation_strikes(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recent_cancellation_strikes(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_list_admins_mfa_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_reset_mfa(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_reset_mfa_factor(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_mfa_recovery_codes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.redeem_mfa_recovery_code(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_list_admins_mfa_status() TO service_role;
GRANT  EXECUTE ON FUNCTION public.admin_reset_mfa(uuid, text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.admin_reset_mfa_factor(uuid, text) TO service_role;
GRANT  EXECUTE ON FUNCTION public.generate_mfa_recovery_codes() TO service_role;
GRANT  EXECUTE ON FUNCTION public.redeem_mfa_recovery_code(text) TO service_role;
