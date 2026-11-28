-- Recovery for 0181 — forward-safe. Run in the SQL editor only if 0181 causes a problem in production.
--
-- This script deliberately does NOT restore the pre-0181 referral functions. Those paid referral rewards into
-- wallets (real commission credit), which the owner has ruled out: referrals give non-cash recognition only.
-- It also keeps the guard that refuses any 'referral_bonus' wallet entry, and keeps clients unable to write the
-- referrals table directly. No referral row, history or audit entry is changed or removed.
--
-- What it can do safely, if the scheduled processing or the admin actions misbehave, is pause them:
--   * stop the scheduled run (no referral moves forward until it is switched back on);
--   * stop admins calling admin_referral_action.
-- To resume: re-run the GRANT line at the end of 0181 section 3 and set the cron job active again.
-- If a 0181 rule is wrong, fix it forward with a new migration that keeps the no-money guard.

select cron.alter_job(jobid, active := false) from cron.job where jobname = 'process-referral-rewards';
revoke execute on function public.admin_referral_action(uuid, text, text) from authenticated;
