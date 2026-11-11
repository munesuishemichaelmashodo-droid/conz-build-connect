-- 0158: transport-only engine golden values (design doc sample corridors), refusal of bad input, switch default off,
-- legacy jobs unchanged, no writes.
begin;
select plan(14);
select tests.as_owner();
insert into public.system_settings (key, value) values ('diesel_price_per_liter', '1.87'::jsonb), ('fuel_l_per_100km', '32'::jsonb), ('long_haul_markup', '1.87'::jsonb)
on conflict (key) do update set value = excluded.value;

create or replace function pg_temp.fare(_km numeric, _qty numeric default 12) returns numeric language sql as $$
  select ((public.compute_transport_offer(_km, _qty)) #>> '{perTrip,recommended}')::numeric $$;

select is(pg_temp.fare(9.9), 20.00, '9.9 km (Harare CBD to Borrowdale) = flat $20');
select is(pg_temp.fare(24.0), 40.00, '24 km = flat $40');
select is(pg_temp.fare(50), 60.00, '50 km = flat $60');
select is(pg_temp.fare(117.0), 134.97, '117 km (Harare to Chinhoyi) = $134.97');
select is(pg_temp.fare(262.0), 297.23, '262 km (Harare to Mutare) = $297.23');
select is(pg_temp.fare(435.7), 491.60, '435.7 km (Harare to Bulawayo) = $491.60');
select is(((public.compute_transport_offer(262.0, 40)) #>> '{total,recommended}')::numeric, 594.46, '40 m3 = 2 trips = $594.46');
select is(((public.compute_transport_offer(117.0, 12)) #>> '{perTrip,low}')::numeric, 114.73, 'low is 15% below');
select is((public.compute_transport_offer(117.0, 12)) ->> 'calibration', 'uncalibrated', 'marked uncalibrated');
select throws_ok($$select public.compute_transport_offer(null, 12)$$, '22023', null, 'no distance, no price (no default distance)');
select throws_ok($$select public.compute_transport_offer(0, 12)$$, '22023', null, 'zero distance refused');
select throws_ok($$select public.compute_transport_offer(100, 0)$$, '22023', null, 'zero load refused');
select is((select value #>> '{}' from public.system_settings where key = 'transport_pricing_enabled'), 'false', 'the switch is off by default');
select is((select count(*)::int from public.jobs where pricing_basis <> 'legacy_material_plus_transport'), 0, 'every existing job keeps the legacy basis');

select * from finish();
rollback;
