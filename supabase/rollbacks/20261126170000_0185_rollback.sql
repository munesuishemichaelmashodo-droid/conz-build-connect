-- Recovery for 0185 — forward-safe. Run in the SQL editor only if 0185 causes a problem in production.
--
-- This script deliberately keeps:
--   * the milestone sync trigger (a referral rejected after fraud must keep withdrawing the milestones it earned);
--   * the "new accounts only, one claim per account" rule in record_referral;
--   * every referral, milestone, share event and audit row.
-- It can switch off the new read and share functions if one misbehaves; the Invite page then shows
-- "could not be loaded" and the admin results card "not available yet". Re-run the GRANT lines in 0185 to resume.
-- If a 0185 rule is wrong, fix it forward with a new migration.

revoke execute on function public.my_referral_progress() from authenticated;
revoke execute on function public.record_referral_share(text) from authenticated;
revoke execute on function public.admin_referral_metrics(int) from authenticated;
