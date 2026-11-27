-- Recovery for 0184 — forward-safe. Run in the SQL editor only if 0184 causes a problem in production.
--
-- This script deliberately does NOT give back the grants 0184 closed: signed-out read access to disputes and
-- chat flags, and direct UPDATE/DELETE on disputes by signed-in users. Restoring them would let anyone rewrite or
-- delete dispute records without a reason or an audit entry.
-- It also keeps admin_mark_dispute_investigating and admin_reject_dispute callable: with the direct grants
-- closed they are the only way admins can act on disputes.
-- What it can switch off without weakening anything is the read-only trust-signals list. Re-run the GRANT line in
-- 0184 to turn it back on. If a dispute function is wrong, fix it forward with a new migration.

revoke execute on function public.admin_trust_signals() from authenticated;
