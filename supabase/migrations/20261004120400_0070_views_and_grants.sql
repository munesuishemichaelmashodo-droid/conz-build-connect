-- 0070 — View exposure + least-privilege grants (audit M2, L3).
--
-- M2: driver_public_profiles and market_rate_history are SECURITY DEFINER
--     views (they do not enforce the querying user's RLS). Anon could read
--     every driver's id + verification status, and completed-job pricing
--     aggregates. Remove anon from driver_public_profiles (authenticated
--     bidder-card display is unaffected) and remove all client access to
--     market_rate_history (only server/admin code uses it).
-- L3: anon never writes the money tables; RLS blocked it already, but the
--     direct grants should not exist. Remove them.
--
-- Non-destructive, idempotent. (A follow-up P2 item is to rebuild these views
-- WITH (security_invoker=true) where the RLS semantics allow it; that is a
-- larger change deferred so staging testing is not blocked.)

revoke all on public.driver_public_profiles from anon;
revoke all on public.market_rate_history   from anon, authenticated;

revoke insert, update, delete on public.wallets             from anon;
revoke insert, update, delete on public.wallet_transactions from anon;
