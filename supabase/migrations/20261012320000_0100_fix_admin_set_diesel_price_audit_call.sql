-- =============================================================================
-- 0100 — admin_set_diesel_price always failed (wrong argument order to log_admin_action)
-- (12/10/2026)
--
-- VERIFIED DEFECT (stand-in reproduction + read-only production catalog check, same definition):
--   admin_set_diesel_price(numeric) ends with
--       PERFORM public.log_admin_action('diesel_price_changed', NULL, NULL, jsonb_build_object('price', _price), NULL);
--   but log_admin_action's signature is (_action text, _meta jsonb, _reason text, _target_id uuid,
--   _target_user uuid). The jsonb lands in the uuid parameter, so the call does not resolve and EVERY
--   call, including a super admin's, raises "function public.log_admin_action(unknown, unknown, unknown,
--   jsonb, unknown) does not exist". The diesel price (a pricing input) cannot be changed at all.
--   Production's function text contains the same wrong call (checked read-only 12/10/2026).
--
-- FIX: recreate the function with the audit call using named arguments. Authorisation (super_admin
-- only), bounds, the upsert and the return value are unchanged. Idempotent (create or replace).
-- Grants are re-stated to match the current ones (authenticated + service_role; the function checks the
-- role itself). Rollback: re-create the previous body (identical except the log call).
-- =============================================================================

create or replace function public.admin_set_diesel_price(_price numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can change diesel price';
  end if;
  if _price is null or _price <= 0 or _price > 100 then
    raise exception 'Price must be between 0 and 100';
  end if;
  insert into public.system_settings(key, value, updated_by, updated_at)
  values ('diesel_price_per_liter', to_jsonb(_price), auth.uid(), now())
  on conflict (key) do update
     set value = excluded.value, updated_by = auth.uid(), updated_at = now();
  perform public.log_admin_action(
    _action => 'diesel_price_changed',
    _meta   => jsonb_build_object('price', _price));
  return to_jsonb(_price);
end $function$;

revoke all on function public.admin_set_diesel_price(numeric) from public, anon;
grant execute on function public.admin_set_diesel_price(numeric) to authenticated, service_role;
