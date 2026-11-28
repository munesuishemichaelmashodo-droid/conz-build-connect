-- Recovery for 0192 — forward-safe. Run in the SQL editor only if 0192 causes a problem in production.
-- Keeps every case field, reference, history row and guard (decisions and closed cases cannot be rewritten) and the
-- widened categories (existing reports may use them). It can pause the parties' and admins' case actions if one of
-- them misbehaves; plain reporting and admin replies (0142) keep working. Re-run the GRANT lines in 0192 to resume.
revoke execute on function public.case_add_statement(uuid, text, text) from authenticated;
revoke execute on function public.case_appeal(uuid, text) from authenticated;
revoke execute on function public.appeal_dispute(uuid, text) from authenticated;
revoke execute on function public.admin_case_action(uuid, text, text, uuid, text) from authenticated;
revoke execute on function public.admin_decide_case(uuid, text, text, text) from authenticated;
revoke execute on function public.admin_decide_appeal(uuid, text, text) from authenticated;
revoke execute on function public.admin_close_case(uuid, text) from authenticated;
