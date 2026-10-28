-- Undo 0103 (applied 28/10/2026): the two pricing setters exactly as live before (diesel: super admin, no step-up;
-- multiplier: any admin, no step-up). No DROP.

CREATE OR REPLACE FUNCTION public.admin_set_diesel_price(_price numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.admin_set_demand_multiplier(_multiplier numeric, _reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare _n integer;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role)
       or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Forbidden';
  end if;

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
end $function$;
