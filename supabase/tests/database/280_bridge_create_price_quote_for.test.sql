-- 0098 — bridge for create_price_quote_for (the one RPC the deployed app calls that production lacked).
-- Part A: contract tests that hold for BOTH the strict 0080 function and the 0098 bridge.
-- Part B: simulates a production-like database (function missing), runs the 0098 body, and checks the bridge
--         (service-only, same validation, stock is advisory: untracked and below-order stock accepted, idempotent re-run).
-- Keep the inlined migration body in Part B identical to supabase/migrations/*_0098_bridge_create_price_quote_for.sql.

begin;
select plan(33);

select set_config('t.cust',  tests.create_user('bq_cust')::text, true);
select set_config('t.other', tests.create_user('bq_other')::text, true);

select tests.as_owner();
do $$
declare _s uuid; _su uuid; _l uuid; _lnull uuid; _lpaused uuid; _lun uuid; _lother uuid;
begin
  insert into public.suppliers (name, verification_status) values ('Bridge Test Supplier', 'verified') returning id into _s;
  insert into public.suppliers (name, verification_status) values ('Bridge Unverified Supplier', 'unverified') returning id into _su;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values (_s, 'stones', 'supplier', 'Tracked site', 'a', -17.80, 31.05, 'active', 'verified', 100, 1, 200, 'exact') returning id into _l;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values (_s, 'stones', 'supplier', 'Untracked site', 'b', -17.81, 31.06, 'active', 'verified', null, 2, 200, 'exact') returning id into _lnull;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values (_s, 'stones', 'supplier', 'Paused site', 'c', -17.82, 31.07, 'paused', 'verified', 100, 3, 200, 'exact') returning id into _lpaused;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values (_su, 'stones', 'supplier', 'Unverified-supplier site', 'd', -17.83, 31.08, 'active', 'verified', 100, 4, 200, 'exact') returning id into _lun;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status, available_quantity_m3, priority, service_radius_km, location_precision)
  values (_s, 'crusher_run', 'supplier', 'Other material site', 'e', -17.84, 31.09, 'active', 'verified', 100, 5, 200, 'exact') returning id into _lother;
  perform set_config('t.loc', _l::text, true);
  perform set_config('t.loc_null', _lnull::text, true);
  perform set_config('t.loc_paused', _lpaused::text, true);
  perform set_config('t.loc_unv', _lun::text, true);
  perform set_config('t.loc_other', _lother::text, true);
end $$;

create or replace function pg_temp.q(_cust text, _mat text, _qty numeric, _km numeric, _src text, _loc text)
returns text language sql as $$
  select format('select public.create_price_quote_for(%L, %L, %s, %s, %L, %L)', nullif(_cust,''), _mat, _qty, _km, _src, nullif(_loc,''))
$$;

-- ===========================================================================
-- Part A: contract (both versions)
-- ===========================================================================
select ok(exists (select 1 from pg_proc where oid = to_regprocedure('public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)')), 'A1: function exists with the signature the app calls');
select ok(has_function_privilege('service_role', 'public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)', 'execute'), 'A2: service_role can execute');
select ok(not has_function_privilege('authenticated', 'public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)', 'execute'), 'A3: authenticated cannot execute');
select ok(not has_function_privilege('anon', 'public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)', 'execute'), 'A4: anon cannot execute');

select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(pg_temp.q(current_setting('t.cust'), 'stones', 12, 20, 'osrm', current_setting('t.loc')), '42501', null, 'A5: a signed-in customer cannot call it directly');
select tests.as_service();

select set_config('t.q1', public.create_price_quote_for(current_setting('t.cust')::uuid, 'stones', 12, 20.456, 'osrm', current_setting('t.loc')::uuid)::text, true);
select tests.as_owner();
select is((select customer_id from public.price_quotes where id = current_setting('t.q1')::uuid), current_setting('t.cust')::uuid, 'A6: quote is bound to the customer');
select is((select distance_km from public.price_quotes where id = current_setting('t.q1')::uuid), 20.46::numeric, 'A7: distance stored rounded to 2 dp');
select is((select supply_location_id from public.price_quotes where id = current_setting('t.q1')::uuid), current_setting('t.loc')::uuid, 'A8: quote is bound to the supply location');
select ok((select expires_at > now() and consumed_at is null from public.price_quotes where id = current_setting('t.q1')::uuid), 'A9: quote is live and unconsumed');

select tests.as_service();
select set_config('t.q2', public.create_price_quote_for(current_setting('t.cust')::uuid, 'stones', 12, 20.456, 'osrm', current_setting('t.loc')::uuid)::text, true);
select tests.as_owner();
select isnt(current_setting('t.q2'), current_setting('t.q1'), 'A10: a retried identical request gets its own quote id (no silent reuse)');
select is((select count(*)::int from public.price_quotes where customer_id = current_setting('t.cust')::uuid), 2, 'A11: exactly two quote rows exist for the two requests');
select is((select count(*)::int from public.price_quotes where customer_id = current_setting('t.other')::uuid), 0, 'A12: nobody else got a quote');

select tests.as_service();
select throws_like(pg_temp.q('', 'stones', 12, -1, 'osrm', current_setting('t.loc')), '%invalid_distance%', 'A13: negative distance rejected');
select throws_like(format($$select public.create_price_quote_for(null, 'stones', 12, 'NaN'::numeric, 'osrm', %L)$$, current_setting('t.loc')), '%invalid_distance%', 'A14: NaN distance rejected');
select throws_like(pg_temp.q('', 'stones', 12, 5001, 'osrm', current_setting('t.loc')), '%invalid_distance%', 'A15: absurd distance rejected');
select throws_like(pg_temp.q('', 'stones', 0, 20, 'osrm', current_setting('t.loc')), '%invalid_quantity%', 'A16: zero quantity rejected');
select throws_like(pg_temp.q('', 'stones', 1001, 20, 'osrm', current_setting('t.loc')), '%invalid_quantity%', 'A17: quantity over the cap rejected');
select throws_like(pg_temp.q('', 'stones', 12, 20, 'client_provided', current_setting('t.loc')), '%invalid_distance_source%', 'A18: client-provided distance source rejected');
select throws_like(pg_temp.q('', 'unobtainium', 12, 20, 'osrm', current_setting('t.loc')), '%invalid_material%', 'A19: unknown material rejected');
select throws_like(pg_temp.q('', 'stones', 12, 20, 'osrm', ''), '%invalid_supply_location%', 'A20: a quote without a supply location is rejected');
select throws_like(pg_temp.q('', 'stones', 12, 20, 'osrm', current_setting('t.loc_other')), '%invalid_supply_location%', 'A21: supply location for a different material rejected');
select throws_like(pg_temp.q('', 'stones', 12, 20, 'osrm', current_setting('t.loc_paused')), '%invalid_supply_location%', 'A22: paused site rejected');
select throws_like(pg_temp.q('', 'stones', 12, 20, 'osrm', current_setting('t.loc_unv')), '%invalid_supply_location%', 'A23: site of an unverified supplier rejected');
select lives_ok(pg_temp.q('', 'stones', 101, 20, 'osrm', current_setting('t.loc')), 'A24: tracked stock below the order is NOT rejected (0101: stock is advisory)');
select throws_like(format($$select public.create_price_quote_for(null, 'stones', 12, 20, 'osrm', %L)$$, gen_random_uuid()), '%invalid_supply_location%', 'A25: unknown location id rejected');

-- ===========================================================================
-- Part B: production-like state (0080 function missing) -> run the 0098 body
-- ===========================================================================
select tests.as_owner();
drop function public.create_price_quote_for(uuid, text, numeric, numeric, text, uuid);
select ok(not exists (select 1 from pg_proc where oid = to_regprocedure('public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)')), 'B1: simulated production state - the function is missing');

-- ---- inlined body of migration 0098 ----
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
-- ---- end of 0098 body ----

select ok(exists (select 1 from pg_proc where oid = to_regprocedure('public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)')), 'B2: the bridge creates it');
select ok(has_function_privilege('service_role', 'public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)', 'execute')
      and not has_function_privilege('anon', 'public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)', 'execute'),
  'B3: bridge is service-role only');
select tests.as_service();
select lives_ok(pg_temp.q(current_setting('t.cust'), 'stones', 12, 20, 'osrm', current_setting('t.loc_null')), 'B4: bridge accepts a site whose stock is untracked (matches the live resolver)');
select lives_ok(pg_temp.q('', 'stones', 101, 20, 'osrm', current_setting('t.loc')), 'B5: bridge does not reject tracked stock below the order (0101: stock is advisory)');
select throws_like(pg_temp.q('', 'stones', 12, 20, 'osrm', current_setting('t.loc_unv')), '%invalid_supply_location%', 'B6: bridge still rejects an unverified supplier');
select tests.as_owner();
select set_config('t.def1', md5(pg_get_functiondef('public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)'::regprocedure)), true);

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
select is(md5(pg_get_functiondef('public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)'::regprocedure)), current_setting('t.def1'),
  'B7: re-running the migration is a no-op (definition unchanged)');
select ok(obj_description('public.create_price_quote_for(uuid,text,numeric,numeric,text,uuid)'::regprocedure, 'pg_proc') like '0098 bridge%', 'B8: bridge is labelled as such');

select * from finish();
rollback;
