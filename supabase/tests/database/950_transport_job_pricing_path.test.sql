-- 0159: transport-only jobs. Refused while the switch is off; with it on, a job needs the customer's own unexpired, unused
-- server-made quote matching pickup, delivery and load, and a budget inside the engine's band; the client's pickup is kept;
-- commission is 7% of that transport fare; legacy jobs are untouched.
begin;
select plan(18);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;
update public.system_settings set value = '1.87'::jsonb where key = 'diesel_price_per_liter';

select set_config('t.cust',  tests.create_user('tq_cust')::text, true);
select set_config('t.other', tests.create_user('tq_other')::text, true);
select set_config('t.d',     tests.create_driver('tq_d', 200, true)::text, true);

create or replace function pg_temp.quote(_cust text, _km numeric default 24.0, _qty numeric default 12) returns uuid language sql as $$
  select public.create_transport_quote_for(current_setting(_cust)::uuid, _qty, -17.80, 31.05, -17.93, 31.10, _km) $$;
create or replace function pg_temp.mkjob(_q uuid, _budget numeric, _basis text default 'transport_only', _qty numeric default 12, _plat numeric default -17.80) returns uuid language plpgsql as $$
declare _id uuid;
begin
  insert into public.jobs (customer_id, material, quantity_m3, delivery_address, pickup_address, budget, delivery_lat, delivery_lng,
                           pickup_lat, pickup_lng, pricing_basis, transport_quote_id)
  values (current_setting('t.cust')::uuid, 'custom', _qty, 'Harare', 'Own pickup, Norton', _budget, -17.93, 31.10, _plat, 31.05, _basis, _q)
  returning id into _id;
  return _id;
end $$;

-- 1-2 service role makes quotes; clients cannot
select tests.as_service();
select set_config('t.q1', pg_temp.quote('t.cust')::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$select public.create_transport_quote_for(gen_random_uuid(), 12, -17.8, 31.05, -17.9, 31.1, 5)$$, null, null, 'a customer cannot make their own quote (distance would be client-controlled)');
select is((select count(*)::int from public.transport_quotes), 1, 'a customer reads their own quote');

-- 3 switch off
select throws_ok(format($$select pg_temp.mkjob(%L, 40)$$, current_setting('t.q1')), '22023', 'Transport pricing is not available yet.', 'refused while the switch is off');

-- switch on
select tests.as_owner();
update public.system_settings set value = 'true'::jsonb where key = 'transport_pricing_enabled';
select tests.login_as(current_setting('t.cust')::uuid);

-- 4-6 band, other customer, changed coordinates
select throws_ok(format($$select pg_temp.mkjob(%L, 90)$$, current_setting('t.q1')), '22023', null, 'a budget above the guide band is refused');
select throws_ok(format($$select pg_temp.mkjob(%L, 40, 'transport_only', 12, -17.50)$$, current_setting('t.q1')), '22023', null, 'a different pickup point than the quote is refused');
select throws_ok(format($$select pg_temp.mkjob(%L, 40, 'transport_only', 15)$$, current_setting('t.q1')), '22023', null, 'a different load than the quote is refused');
select tests.login_as(current_setting('t.other')::uuid);
select throws_ok(format($$select pg_temp.mkjob(%L, 40)$$, current_setting('t.q1')), null, null, 'another customer cannot use the quote');
select tests.login_as(current_setting('t.cust')::uuid);

-- 8-11 the valid booking
select lives_ok(format($$select pg_temp.mkjob(%L, 40)$$, current_setting('t.q1')), 'a budget inside the band books');
select is((select pickup_lat::numeric from public.jobs where customer_id = current_setting('t.cust')::uuid and pricing_basis = 'transport_only'), -17.80::numeric, 'the client''s own pickup point is kept');
select is((select pricing_breakdown ->> 'basis' from public.jobs where customer_id = current_setting('t.cust')::uuid and pricing_basis = 'transport_only'), 'transport_only', 'the breakdown says transport only');
select throws_ok(format($$select pg_temp.mkjob(%L, 40)$$, current_setting('t.q1')), '22023', null, 'a quote works once');

-- 12 expired
select tests.as_owner();
select set_config('t.q2', (select id::text from public.transport_quotes where false), true);
select tests.as_service();
select set_config('t.q2', pg_temp.quote('t.cust')::text, true);
select tests.as_owner();
update public.transport_quotes set expires_at = now() - interval '1 minute' where id = current_setting('t.q2')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select pg_temp.mkjob(%L, 40)$$, current_setting('t.q2')), '22023', null, 'an expired quote is refused');

-- 13-14 rules about the column itself
select tests.as_owner();
select throws_ok(format($$select pg_temp.mkjob(%L, 40, 'legacy_material_plus_transport')$$, current_setting('t.q2')), '22023', null, 'a transport quote cannot ride on a legacy-priced job');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok($$update public.jobs set pricing_basis = 'legacy_material_plus_transport' where pricing_basis = 'transport_only'$$, '42501', null, 'a customer cannot change how a job is priced');

-- 15-16 raising the budget stays inside the band
select tests.as_owner();
select set_config('t.job', (select id::text from public.jobs where customer_id = current_setting('t.cust')::uuid and pricing_basis = 'transport_only'), true);
select throws_ok(format($$update public.jobs set budget = 500 where id = %L$$, current_setting('t.job')), '22023', null, 'raising the budget above the band is refused');
select lives_ok(format($$update public.jobs set budget = 44 where id = %L$$, current_setting('t.job')), 'raising inside the band is fine');

-- 17-18 commission is 7% of the transport fare
select set_config('t.b', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.d')::uuid, 44)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.b')::uuid);
select tests.as_owner();
select is((select held_commission from public.jobs where id = current_setting('t.job')::uuid), 3.08::numeric, 'commission reserved is 7% of the transport fare ($44 -> $3.08)');

-- 19 the switch really is the only gate
update public.system_settings set value = 'false'::jsonb where key = 'transport_pricing_enabled';
select tests.as_service();
select set_config('t.q3', pg_temp.quote('t.cust')::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select pg_temp.mkjob(%L, 40)$$, current_setting('t.q3')), '22023', 'Transport pricing is not available yet.', 'switching off again refuses new transport jobs');

select * from finish();
rollback;
