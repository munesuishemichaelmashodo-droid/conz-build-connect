-- 0103 — pricing setters require super_admin AND a fresh step-up (owner decision 2026-10-12).
--
-- Before: admin_set_diesel_price = super_admin only, no step-up; admin_set_demand_multiplier = ANY admin, no step-up
--         (it multiplies every future quote by up to 3x; the 13/08 incident showed the impact).
-- After:  both = super_admin (role check first), then public.require_aal2() (the existing step-up helper: aal2 plus,
--         from 0096, a TOTP verified within the configured window), then the unchanged validation, write and audit row.
--         Accepted jobs keep their agreed budget; only future quotes use the new value.
--
-- Deploy order: AFTER 0096 (freshness check) and 0100 (diesel audit-call fix). If applied before 0096 the step-up is
--   aal2-only (production's current require_aal2 has no freshness window), which is still stronger than today.
--   Standalone otherwise (uses require_aal2, has_role, log_admin_action, tables that exist in production).
-- Rollback: re-apply the previous bodies (0100 for diesel; production's current text for the multiplier).
-- App: the admin settings screen must run its step-up prompt before these calls (see admin.settings.tsx).

create or replace function public.admin_set_diesel_price(_price numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can change diesel price';
  end if;
  perform public.require_aal2();
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
end $$;

create or replace function public.admin_set_demand_multiplier(_multiplier numeric, _reason text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare _n integer;
begin
  if not public.has_role(auth.uid(), 'super_admin'::public.app_role) then
    raise exception 'Only super admins can change the price multiplier';
  end if;
  perform public.require_aal2();

  if _multiplier is null or _multiplier <= 0 or _multiplier > 3.0 then
    raise exception 'Multiplier must be between 0 and 3.0';
  end if;
  if _reason is null or length(trim(_reason)) < 5 then
    raise exception 'Give a reason (e.g. "diesel up 8%%")';
  end if;

  update public.material_prices
     set demand_multiplier = _multiplier,
         updated_at = now(),
         updated_by = auth.uid()
   where enforced = true;

  get diagnostics _n = row_count;

  perform public.log_admin_action(
    'demand_multiplier_updated',
    jsonb_build_object('multiplier', _multiplier, 'materials_affected', _n),
    _reason, null, null);

  return _n;
end $$;

revoke all on function public.admin_set_diesel_price(numeric) from public, anon;
grant execute on function public.admin_set_diesel_price(numeric) to authenticated, service_role;
revoke all on function public.admin_set_demand_multiplier(numeric, text) from public, anon;
grant execute on function public.admin_set_demand_multiplier(numeric, text) to authenticated, service_role;
