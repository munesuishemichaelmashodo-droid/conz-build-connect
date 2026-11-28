-- Recovery for 0187 — forward-safe, run in the SQL editor only if 0187 causes a problem in production.
--
-- This script deliberately does NOT restore the earlier, weaker state:
--   * the narrowed "job proof: admin all" storage policy stays (admins must never again be able to overwrite or delete a
--     stored evidence photo);
--   * the stronger job_evidence_immutable() guard stays (every field of a photo record fixed, supersede set once);
--   * job_stage_reports and its append-only guard stay, with every report already filed.
-- No photo, report, evidence row or history is changed or removed.
--
-- What it can switch off, without losing anything, is the new ability for people to file reports or replace photos,
-- in case one of those functions misbehaves. The read-only evidence record stays available to parties and admins.
-- To turn them back on, re-run the two GRANT lines at the end of 0187 for these functions.
--
-- If a protection itself is wrong, fix it forward with a new migration; do not drop it.

revoke execute on function public.report_job_stage(uuid, text, text, text, numeric, integer, text, uuid, uuid) from authenticated;
revoke execute on function public.supersede_job_evidence(uuid, uuid, text) from authenticated;
