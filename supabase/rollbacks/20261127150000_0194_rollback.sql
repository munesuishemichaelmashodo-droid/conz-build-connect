-- Undo for 0194 account_closure_credit_refund. Forward-safe: it never pays anything and never removes records.
-- It stops new closure requests and recorded refunds by revoking client access to those functions (super admins can still decline open requests); the table and its
-- rows (refund records are financial records) and the "no offers while a request is open" trigger stay.
-- To also let drivers with an open request send offers again, a super admin declines those requests first.
revoke execute on function public.request_account_closure(text, text) from authenticated;
revoke execute on function public.cancel_account_closure(uuid) from authenticated;
revoke execute on function public.admin_record_closure_refund(uuid, text, text) from authenticated;
