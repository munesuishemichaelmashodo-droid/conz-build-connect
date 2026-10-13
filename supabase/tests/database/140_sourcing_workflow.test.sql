-- 0088 — nationwide sourcing workflow: idempotent creation, state machine,
-- append-only history, server-only quoting priced by the existing engine,
-- authorization boundaries, conversion only through a customer's own booking.

begin;
select plan(51);
select tests.enable_launch_features();

select set_config('t.c1',    tests.create_user('src_c1')::text, true);
select set_config('t.c2',    tests.create_user('src_c2')::text, true);
select set_config('t.admin', tests.create_user('src_admin', array['admin'])::text, true);
select set_config('t.drv',   tests.create_driver('src_drv', 100)::text, true);

-- Fixtures: one verified in-stock exact site, plus deliberately bad sites.
select tests.as_owner();
do $$
declare _good uuid; _unver uuid; _loc uuid; _bad_loc uuid; _low uuid; _pend uuid;
begin
  insert into public.suppliers (name, verification_status) values ('Sourcing Test Good', 'verified') returning id into _good;
  insert into public.suppliers (name, verification_status) values ('Sourcing Test Unverified', 'unverified') returning id into _unver;
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status,
     available_quantity_m3, priority, service_radius_km, location_precision)
  values (_good, 'river_sand', 'supplier', 'Good site', 'Good addr', -20.15, 28.58, 'active', 'verified', 100, 1, 50, 'exact')
  returning id into _loc;
  perform set_config('t.loc', _loc::text, true);
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status,
     available_quantity_m3, priority, service_radius_km, location_precision)
  values (_unver, 'river_sand', 'supplier', 'Unverified supplier site', 'x', -20.15, 28.58, 'active', 'verified', 100, 1, 50, 'exact')
  returning id into _bad_loc;
  perform set_config('t.loc_unver_supplier', _bad_loc::text, true);
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status,
     available_quantity_m3, priority, service_radius_km, location_precision)
  values (_good, 'river_sand', 'supplier', 'Low stock site', 'x', -20.15, 28.58, 'active', 'verified', 1, 1, 50, 'exact')
  returning id into _low;
  perform set_config('t.loc_low', _low::text, true);
  insert into public.material_supply_locations
    (supplier_id, material, source_type, label, address, lat, lng, status, verification_status,
     available_quantity_m3, priority, service_radius_km, location_precision)
  values (_good, 'river_sand', 'supplier', 'Unverified site', 'x', -20.15, 28.58, 'active', 'unverified', 100, 1, 50, 'exact')
  returning id into _pend;
  perform set_config('t.loc_pending', _pend::text, true);
end $$;

create or replace function pg_temp.req(_who text, _qty numeric default 12, _key text default null,
                                       _lat double precision default -18.18, _lng double precision default 31.55)
returns uuid language plpgsql as $$
declare _id uuid;
begin
  perform tests.login_as(current_setting(_who)::uuid);
  _id := public.create_material_sourcing_request('river_sand', null, _qty, 'Marondera CBD', _lat, _lng, null, null, _key);
  perform tests.as_owner();
  return _id;
end $$;

-- ---------------------------------------------------------------------------
-- Creation, idempotency, validation, abuse limits
-- ---------------------------------------------------------------------------
select set_config('t.r1', pg_temp.req('t.c1', 12, 'key-abcdef-001')::text, true);
select is((select status from public.material_sourcing_requests where id = current_setting('t.r1')::uuid), 'requested',
  'A request starts as requested and awaiting sourcing');
select is(pg_temp.req('t.c1', 12, 'key-abcdef-001'), current_setting('t.r1')::uuid,
  'Retrying with the same idempotency key returns the same request');
select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok($$select public.create_material_sourcing_request('river_sand', null, 13, 'Marondera CBD', -18.18, 31.55, null, null, 'key-abcdef-001')$$,
  '23505', null, 'Reusing a key for a different request is rejected');
select tests.as_owner();
select is(pg_temp.req('t.c1', 14), pg_temp.req('t.c1', 14),
  'A keyless double-submit of an identical open request is the same request');
select is((select count(*)::int from public.material_sourcing_requests where customer_id = current_setting('t.c1')::uuid and quantity_m3 = 14), 1,
  'No duplicate row was created by the double-submit');
select isnt(pg_temp.req('t.c2', 12, 'key-abcdef-001'), current_setting('t.r1')::uuid,
  'Another customer using the same key gets their own request');

select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok($$select public.create_material_sourcing_request('river_sand', null, 0, 'x', null, null, null, null, null)$$, null, null, 'Zero quantity rejected');
select throws_ok($$select public.create_material_sourcing_request('river_sand', null, 1001, 'x', null, null, null, null, null)$$, null, null, 'Quantity above the cap rejected');
select throws_ok($$select public.create_material_sourcing_request('custom', null, 5, 'x', null, null, null, null, null)$$, null, null, 'Custom material needs a description');
select throws_ok($$select public.create_material_sourcing_request('river_sand', null, 5, 'x', -18.1, null, null, null, null)$$, null, null, 'Half a coordinate pair rejected');
select throws_ok($$select public.create_material_sourcing_request('river_sand', null, 5, 'x', 91, 31, null, null, null)$$, null, null, 'Out-of-range coordinates rejected');
select tests.as_anon();
select throws_ok($$select public.create_material_sourcing_request('river_sand', null, 5, 'x', null, null, null, null, null)$$, '42501', null, 'Anonymous users cannot create requests');
select tests.as_owner();

-- the 1-hour limit (10 per customer)
do $$ begin
  for i in 1..9 loop perform pg_temp.req('t.c2', 20 + i); end loop;
end $$;
select tests.login_as(current_setting('t.c2')::uuid);
select throws_ok($$select public.create_material_sourcing_request('river_sand', null, 99, 'Rate limited', null, null, null, null, null)$$,
  '54000', null, 'More than 10 requests in an hour is rate limited');
select tests.as_owner();

select cmp_ok((select count(*)::int from public.notifications where user_id = current_setting('t.admin')::uuid and type = 'sourcing_request'), '>=', 1,
  'Admins are notified of a new sourcing request');

-- ---------------------------------------------------------------------------
-- Direct writes and data exposure are closed
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok($$update public.material_sourcing_requests set status = 'sourcing'$$, '42501', null, 'A customer cannot change status directly');
select throws_ok($$select supplier_name from public.material_sourcing_requests$$, '42501', null, 'Supplier identity is not readable by the customer');
select throws_ok($$select admin_notes from public.material_sourcing_requests$$, '42501', null, 'Internal admin notes are not readable by the customer');
select is((select count(*)::int from public.material_sourcing_requests where id = current_setting('t.r1')::uuid), 1, 'A customer reads their own request');
select tests.login_as(current_setting('t.c2')::uuid);
select is((select count(*)::int from public.material_sourcing_requests where id = current_setting('t.r1')::uuid), 0, 'A customer cannot read another customer''s request');
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok($$update public.material_sourcing_requests set quoted_total = 1, status = 'quote_ready'$$, '42501', null, 'Admins cannot write prices/status directly either');
select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok($$select * from public.admin_list_sourcing_requests()$$, '42501', null, 'Customers cannot list the admin queue');
select throws_ok(format($$select public.admin_start_sourcing(%L)$$, current_setting('t.r1')), '42501', null, 'Customers cannot start sourcing');
select tests.login_as(current_setting('t.admin')::uuid);
select cmp_ok((select count(*)::int from public.admin_list_sourcing_requests('requested')), '>=', 1, 'Admins can list the queue');

-- ---------------------------------------------------------------------------
-- State machine + history
-- ---------------------------------------------------------------------------
select public.admin_start_sourcing(current_setting('t.r1')::uuid, 'calling Bulawayo yards');
select tests.as_owner();
select is((select status from public.material_sourcing_requests where id = current_setting('t.r1')::uuid), 'sourcing', 'Admin moves the request to sourcing');
select throws_ok(format($$update public.material_sourcing_requests set status = 'converted', converted_job_id = gen_random_uuid() where id = %L$$, current_setting('t.r1')),
  null, null, 'sourcing -> converted is not a valid transition');
select throws_ok(format($$update public.material_sourcing_requests set quantity_m3 = 1 where id = %L$$, current_setting('t.r1')),
  '23514', null, 'The requested quantity is immutable');

-- ---------------------------------------------------------------------------
-- Quote issuance: service-only, validated, engine-priced
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.issue_sourcing_quote(%L, %L, %L, 20, 'osrm')$$, current_setting('t.r1'), current_setting('t.admin'), current_setting('t.loc')),
  '42501', null, 'An admin session cannot mint a quote directly (service-only RPC)');
select tests.as_service();
select throws_ok(format($$select public.issue_sourcing_quote(%L, %L, %L, 20, 'osrm', 48, 'Pay on booking')$$, current_setting('t.r1'), current_setting('t.c1'), current_setting('t.loc')),
  '42501', null, 'A non-admin id cannot be passed as the approving admin');
select throws_ok(format($$select public.issue_sourcing_quote(%L, %L, %L, 20, 'osrm', 48, 'Pay on booking')$$, current_setting('t.r1'), current_setting('t.admin'), current_setting('t.loc_unver_supplier')),
  null, 'invalid_supply_location', 'A site of an unverified supplier is rejected');
select throws_ok(format($$select public.issue_sourcing_quote(%L, %L, %L, 20, 'osrm', 48, 'Pay on booking')$$, current_setting('t.r1'), current_setting('t.admin'), current_setting('t.loc_pending')),
  null, 'invalid_supply_location', 'An unverified site is rejected');
select is(public.supply_stock_status(current_setting('t.loc_low')::uuid, 12), 'below_requested',
  'A site with lower recorded stock is no longer rejected for stock (0101; issuing is covered in 310) and is labelled below_requested');
select throws_ok(format($$select public.issue_sourcing_quote(%L, %L, %L, 20, 'osrm', 48, '   ')$$, current_setting('t.r1'), current_setting('t.admin'), current_setting('t.loc')),
  null, 'terms_required', 'Terms are mandatory');
select throws_ok(format($$select public.issue_sourcing_quote(%L, %L, %L, 'NaN', 'osrm', 48, 'Pay on booking')$$, current_setting('t.r1'), current_setting('t.admin'), current_setting('t.loc')),
  null, null, 'A non-finite distance is rejected');
select throws_ok(format($$select public.issue_sourcing_quote(%L, %L, %L, 20, 'client_provided', 48, 'Pay on booking')$$, current_setting('t.r1'), current_setting('t.admin'), current_setting('t.loc')),
  null, null, 'A client-provided distance can never become a quote');
select set_config('t.q1', public.issue_sourcing_quote(current_setting('t.r1')::uuid, current_setting('t.admin')::uuid, current_setting('t.loc')::uuid, 400, 'osrm', 48, 'Pay on booking; pickup Bulawayo', 'verified by phone')::text, true);
select tests.as_owner();
select is((select status from public.material_sourcing_requests where id = current_setting('t.r1')::uuid), 'quote_ready', 'A valid, verified supply location produces a quote');
select is((select quoted_total from public.material_sourcing_requests where id = current_setting('t.r1')::uuid),
  (public.compute_material_offer('river_sand', 12, 400)->>'offer')::numeric,
  'The quoted total is exactly what the pricing engine produces (admins never type a price)');
select is((select customer_id from public.price_quotes where id = current_setting('t.q1')::uuid), current_setting('t.c1')::uuid, 'The quote is bound to the requesting customer');
select cmp_ok((select expires_at from public.price_quotes where id = current_setting('t.q1')::uuid), '>', now() + interval '47 hours', 'The quote lives for the validity window');
select is((select actor_id from public.material_sourcing_status_history where request_id = current_setting('t.r1')::uuid and to_status = 'quote_ready'),
  current_setting('t.admin')::uuid, 'History names the approving admin, even though the RPC ran as service_role');

-- ---------------------------------------------------------------------------
-- History is append-only and only readable through the RPCs
-- ---------------------------------------------------------------------------
select throws_ok($$update public.material_sourcing_status_history set note = 'edited'$$, '42501', null, 'History cannot be edited');
select throws_ok($$delete from public.material_sourcing_status_history$$, '42501', null, 'History cannot be deleted');
select tests.login_as(current_setting('t.c1')::uuid);
select cmp_ok((select count(*)::int from public.my_sourcing_history(current_setting('t.r1')::uuid)), '>=', 3, 'The customer can follow their request progress');
select throws_ok($$select * from public.material_sourcing_status_history$$, '42501', null, 'The raw history table is not directly readable');
select tests.login_as(current_setting('t.c2')::uuid);
select is((select count(*)::int from public.my_sourcing_history(current_setting('t.r1')::uuid)), 0, 'Another customer sees no history');

-- ---------------------------------------------------------------------------
-- Conversion happens only when the owner books with the sourcing quote
-- ---------------------------------------------------------------------------
select tests.login_as(current_setting('t.c2')::uuid);
select throws_ok(format($$select public.decline_sourcing_request(%L)$$, current_setting('t.r1')), '42501', null, 'Another customer cannot cancel the request');
select tests.login_as(current_setting('t.c1')::uuid);
select lives_ok(format($$insert into public.jobs (customer_id, material, quantity_m3, delivery_address, budget, quote_id, delivery_lat, delivery_lng, pickup_lat, pickup_lng)
  values (auth.uid(), 'river_sand', 12, 'Marondera CBD', %s, %L, -18.18, 31.55, -20.15, 28.58)$$,
  (select quoted_total from public.material_sourcing_requests where id = current_setting('t.r1')::uuid), current_setting('t.q1')),
  'The customer books using the sourcing quote');
select tests.as_owner();
select is((select status from public.material_sourcing_requests where id = current_setting('t.r1')::uuid), 'converted', 'The request converts only after that booking');
select isnt((select converted_job_id from public.material_sourcing_requests where id = current_setting('t.r1')::uuid), null, 'The converted request points at the real job');

-- ---------------------------------------------------------------------------
-- Cancel / expiry / terminal states
-- ---------------------------------------------------------------------------
select set_config('t.r2', pg_temp.req('t.c1', 33)::text, true);
select tests.login_as(current_setting('t.c1')::uuid);
select public.decline_sourcing_request(current_setting('t.r2')::uuid, 'changed my mind');
select tests.as_owner();
select is((select status from public.material_sourcing_requests where id = current_setting('t.r2')::uuid), 'declined', 'The customer can cancel their own request');
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.admin_start_sourcing(%L)$$, current_setting('t.r2')), '23514', null, 'A declined request is terminal');
select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok($$select public.expire_sourcing_requests()$$, '42501', null, 'Customers cannot run the expiry job');
select tests.as_owner();

select * from finish();
rollback;
