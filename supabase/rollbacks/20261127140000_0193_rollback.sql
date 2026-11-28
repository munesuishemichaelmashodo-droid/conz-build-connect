-- Recovery for 0193 — forward-safe. Only switches off the admin evidence view. Nothing is stored by 0193 except
-- audit entries ('job_evidence_viewed'), which are kept. Re-run the GRANT line in 0193 to turn it back on.
revoke execute on function public.admin_job_history(uuid) from authenticated;
