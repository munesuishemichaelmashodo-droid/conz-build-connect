-- Undo 0129: remove the setter. Settings values it wrote stay (restore them from admin_audit_log 'previous').
begin;
do $$ begin
  if to_regprocedure('public.admin_set_launch_switch(text, jsonb, text)') is not null then
    revoke execute on function public.admin_set_launch_switch(text, jsonb, text) from authenticated;
  end if;
end $$;
commit;
