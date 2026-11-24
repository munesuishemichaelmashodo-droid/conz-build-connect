-- Transport-only pricing (0158) price matrix, pinned so any change to the formula is deliberate.
-- Settings fixed for the test: diesel $2.04/L, fuel 32 L/100 km, allowance 1.87 -> $1.2207/km beyond 50 km
-- (the same values production read on 24/11/2026). Fares are per 20 m3 trip; -15% / +15% guide.
begin;
select plan(16);

select tests.as_owner();
update public.system_settings set value = '2.04'::jsonb where key = 'diesel_price_per_liter';
delete from public.system_settings where key in ('fuel_l_per_100km', 'long_haul_markup');

create temporary table m(km numeric, m3 numeric, rec numeric, low numeric, high numeric, trips int);
insert into m values
  (  5, 10,  20.00,  17.00,  23.00, 1),   -- urban band <= 10 km
  ( 15, 12,  30.00,  25.50,  34.50, 1),   -- <= 20 km
  ( 25, 12,  40.00,  34.00,  46.00, 1),   -- <= 30 km
  ( 50, 20,  60.00,  51.00,  69.00, 1),   -- <= 50 km (band edge)
  ( 51, 20,  61.22,  52.04,  70.40, 1),   -- continuous just past 50 km
  ( 80, 20,  96.62,  82.13, 111.12, 1),
  (200, 20, 243.11, 206.64, 279.58, 1),
  (440, 20, 536.09, 455.67, 616.50, 1),   -- above the old $500 ceiling
  ( 15, 30,  60.00,  51.00,  69.00, 2),   -- 30 m3 = 2 trips
  (200, 40, 486.22, 413.29, 559.15, 2);

select results_eq(
  $$select (public.compute_transport_offer(km, m3) #>> '{total,recommended}')::numeric from m order by km, m3$$,
  $$select rec from m order by km, m3$$, 'recommended fares match the matrix');
select results_eq(
  $$select (public.compute_transport_offer(km, m3) #>> '{total,low}')::numeric from m order by km, m3$$,
  $$select low from m order by km, m3$$, 'low guide = -15%');
select results_eq(
  $$select (public.compute_transport_offer(km, m3) #>> '{total,high}')::numeric from m order by km, m3$$,
  $$select high from m order by km, m3$$, 'high guide = +15%');
select results_eq(
  $$select (public.compute_transport_offer(km, m3) ->> 'trips')::int from m order by km, m3$$,
  $$select trips from m order by km, m3$$, 'trips = ceil(m3 / 20)');

select is((public.compute_transport_offer(100, 20) #>> '{assumptions,ratePerKmBeyond50}')::numeric, 1.2207, 'rate beyond 50 km = 0.32 x 2.04 x 1.87');
select is(public.compute_transport_offer(100, 20) ->> 'basis', 'transport_only', 'basis is transport only (no material line)');
select is(public.compute_transport_offer(100, 20) ->> 'calibration', 'uncalibrated', 'still marked uncalibrated');

-- Monotonic in distance (a longer trip never costs less).
select ok(not exists (
  select 1 from generate_series(1, 600) d
   where (public.compute_transport_offer(d + 1, 20) #>> '{total,recommended}')::numeric
       < (public.compute_transport_offer(d, 20) #>> '{total,recommended}')::numeric), 'fare never falls as distance grows (1-600 km)');

-- Where one 20 m3 trip passes $500 (the old launch ceiling, removed by 0172).
select is((select min(d) from generate_series(1, 600) d
            where (public.compute_transport_offer(d, 20) #>> '{total,recommended}')::numeric > 500), 411,
          'recommended fare first exceeds $500 at 411 km');
select is((select min(d) from generate_series(1, 600) d
            where (public.compute_transport_offer(d, 20) #>> '{total,high}')::numeric > 500), 358,
          'high guide first exceeds $500 at 358 km');

-- Commission on a transport-only fare: 7% of the fare, rounded to cents.
select is(public.commission_amount(243.11, 7), 17.02::numeric, '7% of $243.11 = $17.02');
select is(public.commission_amount(536.09, 7), 37.53::numeric, '7% of $536.09 = $37.53');

-- Inputs outside the engine's range are refused, never priced.
select throws_ok($$select public.compute_transport_offer(0, 20)$$, '22023', null, 'zero km refused');
select throws_ok($$select public.compute_transport_offer(2001, 20)$$, '22023', null, 'over 2000 km refused');
select throws_ok($$select public.compute_transport_offer(10, 0)$$, '22023', null, 'zero load refused');
select throws_ok($$select public.compute_transport_offer(10, 1001)$$, '22023', null, 'over 1000 m3 refused');

select * from finish();
rollback;
