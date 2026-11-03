-- 0124 — material and bucket price setters: super admin + fresh step-up, like 0103 (owner rule 12/10/2026:
-- "pricing setters require super_admin AND a fresh step-up").
--
-- Found 27/10 (read-only check of production): admin_set_material_price and admin_set_material_bucket_price
-- accept ANY admin with no step-up. admin_set_material_price can also set demand_multiplier (up to 3x on every
-- future quote) and switch price enforcement off, which goes around 0103's lock on admin_set_demand_multiplier.
-- Both write an audit row (owners are alerted), but nothing stopped the change.
--
-- After: super admin (role check first), then public.require_aal2() (a recent Google sign-in satisfies it since
-- 0111), then the bodies exactly as live on 27/10/2026. Accepted jobs keep their agreed price.
-- App: admin.settings.tsx offers the step-up on these errors (same as diesel/multiplier).
-- No DROP. Undo: supabase/rollbacks/20261027150000_0124_rollback.sql (the live bodies of 27/10).

create or replace function public.admin_set_material_price(_material material_category, _min_price numeric, _max_price numeric, _demand_multiplier numeric default null::numeric, _enforced boolean default null::boolean, _label text default null::text, _reason text default null::text)
 returns material_prices
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  _old public.material_prices;
  _new public.material_prices;
begin
  if not public.has_role(auth.uid(), 'super_admin'::public.app_role) then
    raise exception 'Only super admins can change material prices' using errcode = '42501';
  end if;
  perform public.require_aal2();

  select * into _old from public.material_prices where material = _material;
  if not found then
    raise exception 'No price row for material %', _material;
  end if;

  if _min_price is null or _max_price is null then
    raise exception 'Both min and max price are required';
  end if;
  if _max_price < _min_price then
    raise exception 'Max price ($%) cannot be below min price ($%)',
      _max_price, _min_price;
  end if;
  if _demand_multiplier is not null
     and (_demand_multiplier <= 0 or _demand_multiplier > 3.0) then
    raise exception 'Demand multiplier must be between 0 and 3.0';
  end if;

  -- a >25% move in one step is nearly always a typo
  if _old.min_price > 0
     and abs(_min_price - _old.min_price) / _old.min_price > 0.25
     and _reason is null then
    raise exception
      'Min price moves %.0f%% (from $% to $%). Supply a reason to confirm.',
      abs(_min_price - _old.min_price) / _old.min_price * 100,
      _old.min_price, _min_price;
  end if;

  update public.material_prices
     set min_price         = _min_price,
         max_price         = _max_price,
         demand_multiplier = coalesce(_demand_multiplier, demand_multiplier),
         enforced          = coalesce(_enforced, enforced),
         label             = coalesce(_label, label),
         updated_at        = now(),
         updated_by        = auth.uid()
   where material = _material
  returning * into _new;

  perform public.log_admin_action(
    'material_price_updated',
    jsonb_build_object(
      'material', _material::text,
      'before', jsonb_build_object(
        'min', _old.min_price, 'max', _old.max_price,
        'multiplier', _old.demand_multiplier, 'enforced', _old.enforced),
      'after', jsonb_build_object(
        'min', _new.min_price, 'max', _new.max_price,
        'multiplier', _new.demand_multiplier, 'enforced', _new.enforced)),
    _reason, null, null);

  return _new;
end $function$;

create or replace function public.admin_set_material_bucket_price(_material material_category, _bucket_m3 integer, _min_price numeric, _max_price numeric, _reason text)
 returns material_price_buckets
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  _old public.material_price_buckets;
  _new public.material_price_buckets;
begin
  if not public.has_role(auth.uid(), 'super_admin'::public.app_role) then
    raise exception 'Only super admins can change material prices' using errcode = '42501';
  end if;
  perform public.require_aal2();

  if _min_price is null or _max_price is null or _min_price < 0 or _max_price < _min_price then
    raise exception 'Give a valid min/max price (min <= max, both >= 0).';
  end if;

  if _reason is null or length(trim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters) — it is recorded in the admin audit log.';
  end if;

  select * into _old from public.material_price_buckets where material = _material and bucket_m3 = _bucket_m3;

  insert into public.material_price_buckets (material, bucket_m3, min_price, max_price, updated_at, updated_by)
  values (_material, _bucket_m3, _min_price, _max_price, now(), auth.uid())
  on conflict (material, bucket_m3)
  do update set min_price = _min_price, max_price = _max_price, updated_at = now(), updated_by = auth.uid()
  returning * into _new;

  perform public.log_admin_action(
    'material_bucket_price_updated',
    jsonb_build_object(
      'material', _material::text, 'bucket_m3', _bucket_m3,
      'before', case when _old.material is not null then jsonb_build_object('min', _old.min_price, 'max', _old.max_price) else null end,
      'after', jsonb_build_object('min', _new.min_price, 'max', _new.max_price)
    ),
    _reason, null, null
  );

  return _new;
end;
$function$;
