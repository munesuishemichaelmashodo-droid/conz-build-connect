-- Recovery for 0188 — forward-safe, run in the SQL editor only if 0188 causes a problem in production.
--
-- It does NOT remove the reference-reuse guard, the append-only guards or any record: no payment statement, proof,
-- review or history row is changed or removed, and nothing touches wallets or commission.
-- It can switch off the new actions (attaching proof, disputing or reporting a reversal, admin reviews) if one
-- misbehaves. The read-only reconciliation stays available. Re-run the GRANT lines at the end of each function in 0188
-- to turn them back on.
--
-- If the reference guard refuses a genuine payment (two real payments sharing one reference), fix it forward with a
-- new migration that narrows the rule; do not drop the guard.
revoke execute on function public.attach_stage_payment_evidence(uuid, text, text, text, text) from authenticated;
revoke execute on function public.flag_stage_payment(uuid, text, text, text) from authenticated;
revoke execute on function public.admin_review_stage_payment(uuid, text, text, text) from authenticated;
