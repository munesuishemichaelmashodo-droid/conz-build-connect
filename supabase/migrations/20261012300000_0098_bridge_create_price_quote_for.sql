-- =============================================================================
-- 0098 — BRIDGE: create_price_quote_for for databases that never received 0080
-- (12/10/2026)
--
-- WHY
--   The application on `main` (src/lib/booking.functions.ts, tryCreateQuote) creates every
--   price quote server-side by calling public.create_price_quote_for(...) with the service role.
--   That function is created by 0080_pricing_input_integrity. Production's migration history ends
--   at 0076 and a read-only catalog check (12/10/2026) found 0080 NOT applied: the function does
--   not exist, so every quote - and therefore every priced booking - fails closed with
--   "We couldn't secure this price quote".
--   A read-only audit of every RPC name called by the deployed app (44 names) found this to be the
--   ONLY one missing in production.
--
-- WHAT THIS DOES (and deliberately does not do)
--   * Creates ONLY create_price_quote_for, and ONLY if it does not already exist. Where 0080 has been
--     applied (fresh databases, CI, any environment that replays 0080) this migration is a no-op, so
--     0080's stricter version is never overwritten.
--   * Does NOT touch tg_validate_job_budget, resolve_material_source_candidates, jobs_guard_insert,
--     create_price_quote (the legacy client-callable overloads) or any grant. Production keeps its
--     current, working trigger and resolver; the quote this function writes is exactly what that
--     trigger already reads (price_quotes.customer_id / supply_location_id / distance_km).
--   * Service role only. Clients cannot call it (same grants as 0080).
--
-- ELIGIBILITY RULE (updated 2026-10-12, owner direction; see 0101)
--   Supplier stock is ADVISORY. Blank/unknown or lower-than-requested stock never blocks a quote
--   (ConZ is not an inventory marketplace; every production supply location has NULL stock today).
--   Everything else is strict: active + verified location, verified supplier, exact coordinates,
--   radius > 0, material match, quantity/distance/source validation, and a real supplier row.
--   0080 (Stage B) re-introduces a strict stock check; 0101 removes it again and must be applied
--   right after 0080.
-- =============================================================================

do $bridge$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'create_price_quote_for'
       and pg_get_function_identity_arguments(p.oid) =
           '_customer_id uuid, _material text, _quantity_m3 numeric, _distance_km numeric, _distance_source text, _supply_location_id uuid'
  ) then
    raise notice '0098: create_price_quote_for already exists (0080 applied); nothing to do';
    return;
  end if;

  execute $fn$
    create function public.create_price_quote_for(
      _customer_id uuid, _material text, _quantity_m3 numeric, _distance_km numeric,
      _distance_source text, _supply_location_id uuid
    )
    returns uuid
    language plpgsql
    security definer
    set search_path to 'public'
    as $body$
    declare _id uuid;
    begin
      if _distance_km is null or not (_distance_km >= 0 and _distance_km <= 5000) then
        raise exception 'invalid_distance';
      end if;
      if not public.is_valid_money(_quantity_m3, 1000) then
        raise exception 'invalid_quantity';
      end if;
      if _distance_source not in ('osrm', 'haversine') then
        raise exception 'invalid_distance_source';
      end if;
      if not exists (select 1 from public.material_prices where material::text = _material) then
        raise exception 'invalid_material';
      end if;
      if _supply_location_id is null or not exists (
           select 1 from public.material_supply_locations msl
            where msl.id = _supply_location_id
              and msl.material::text = _material
              and msl.status = 'active'
              and msl.verification_status = 'verified'
              and msl.lat is not null and msl.lng is not null
              and msl.service_radius_km > 0
              and msl.location_precision = 'exact'
              and exists (select 1 from public.suppliers s
                           where s.id = msl.supplier_id
                             and s.verification_status = 'verified')) then
        raise exception 'invalid_supply_location';
      end if;

      insert into public.price_quotes (customer_id, material, quantity_m3, distance_km, distance_source, supply_location_id)
      values (_customer_id, _material, _quantity_m3, round(_distance_km, 2), _distance_source, _supply_location_id)
      returning id into _id;
      return _id;
    end
    $body$
  $fn$;

  revoke all on function public.create_price_quote_for(uuid, text, numeric, numeric, text, uuid)
    from public, anon, authenticated;
  grant execute on function public.create_price_quote_for(uuid, text, numeric, numeric, text, uuid)
    to service_role;

  comment on function public.create_price_quote_for(uuid, text, numeric, numeric, text, uuid) is
    '0098 bridge: server-only quote creation for databases without 0080. Stock is advisory (never a gate); 0080 re-adds a stock check that 0101 removes.';
  raise notice '0098: created bridge create_price_quote_for';
end
$bridge$;
