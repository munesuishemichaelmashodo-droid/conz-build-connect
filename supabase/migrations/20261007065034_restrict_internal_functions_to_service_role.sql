-- Internal money/automation functions: callable only by service_role (server code, webhook) and postgres (cron / other SECURITY DEFINER functions).
-- Logged-in users must NOT be able to call these directly via /rest/v1/rpc.
DO $$
DECLARE
  r record;
  internal_names text[] := array[
    'release_escrow_and_complete','hold_job_commission','release_job_commission',
    'mark_escrow_payment_paid','credit_wallet_from_payment','claim_super_admin',
    'enforce_customer_strikes','create_dispatch_wave','expire_stale_dispatch_offers',
    'sweep_stalled_dispatch_offers','auto_release_escrow_payments','expire_stale_accepted_jobs',
    'expire_stale_open_jobs','escalate_overdue_disputes','process_referral_lifecycle',
    'prune_driver_locations','rls_auto_enable'
  ];
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(internal_names)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
  END LOOP;
END $$;
