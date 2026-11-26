-- Undo 0184. Gives back the grants exactly as they were live on 26/11/2026 and stops clients calling the three new
-- functions (removing them would need DROP). The app falls back to its previous direct dispute updates when the
-- functions are not callable. No data is changed by 0184, so nothing else needs undoing.

grant select on public.disputes to anon;
grant update, delete on public.disputes to authenticated;
grant select on public.chat_flags to anon;
grant insert, update, delete on public.chat_flags to authenticated;

revoke execute on function public.admin_mark_dispute_investigating(uuid) from authenticated;
revoke execute on function public.admin_reject_dispute(uuid, text) from authenticated;
revoke execute on function public.admin_trust_signals() from authenticated;
