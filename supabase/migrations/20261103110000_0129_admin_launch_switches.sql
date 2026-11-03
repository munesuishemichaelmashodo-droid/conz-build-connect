-- -----------------------------------------------------------------------------
-- 0129: let a super admin change the launch switches and limits without SQL.
--
-- The five values behind launch_switches() (0107) could only be changed by editing
-- system_settings by hand. This adds one audited setter: super admin + step-up
-- (require_aal2) + written reason + admin_audit_log, for exactly these keys:
--   escrow_enabled, withdrawals_enabled  (true / false)
--   max_job_budget, max_wallet_balance   (1 to 10,000)
--   min_topup                            (0.01 to 1,000)
-- It does not change any current value, price or the commission. No DROP.
-- Undo: supabase/rollbacks/20261103110000_0129_rollback.sql
-- -----------------------------------------------------------------------------

begin;

create or replace function public.admin_set_launch_switch(_key text, _value jsonb, _reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _old jsonb;
  _num numeric;
  _clean jsonb;
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can change launch switches.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = '22023';
  end if;

  if _key in ('escrow_enabled', 'withdrawals_enabled') then
    if _value is null or jsonb_typeof(_value) <> 'boolean' then
      raise exception '% must be true or false.', _key using errcode = '22023';
    end if;
    _clean := _value;
  elsif _key in ('max_job_budget', 'max_wallet_balance', 'min_topup') then
    if _value is null or jsonb_typeof(_value) <> 'number' then
      raise exception '% must be a number.', _key using errcode = '22023';
    end if;
    _num := (_value #>> '{}')::numeric;
    if _key = 'min_topup' and (_num < 0.01 or _num > 1000) then
      raise exception 'The minimum top-up must be between 0.01 and 1,000.' using errcode = '22023';
    elsif _key <> 'min_topup' and (_num < 1 or _num > 10000) then
      raise exception '% must be between 1 and 10,000.', _key using errcode = '22023';
    end if;
    _clean := to_jsonb(round(_num, 2));
  else
    raise exception 'Unknown launch switch.' using errcode = '22023';
  end if;

  select value into _old from public.system_settings where key = _key;
  insert into public.system_settings (key, value, updated_by, updated_at)
  values (_key, _clean, auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = auth.uid(), updated_at = now();

  perform public.log_admin_action(
    _action => 'launch_switch_changed',
    _meta => jsonb_build_object('key', _key, 'value', _clean, 'previous', _old),
    _reason => btrim(_reason));
  return public.launch_switches();
end $$;

revoke all on function public.admin_set_launch_switch(text, jsonb, text) from public, anon;
grant execute on function public.admin_set_launch_switch(text, jsonb, text) to authenticated;

commit;
