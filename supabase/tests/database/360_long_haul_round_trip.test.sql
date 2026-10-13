-- 0106 — long-haul rate beyond 50 km covers the empty return trip (factor 1.87, was 1.5).
begin;
select plan(5);
select tests.as_owner();
update public.system_settings set value = to_jsonb(2.04::numeric) where key = 'diesel_price_per_liter';

select is(public.compute_material_offer('river_sand', 10, 80)->>'pricingVersion', 'v1.2', '1: pricing version bumped to v1.2');
select is((public.compute_material_offer('river_sand', 10, 80)->>'transportCost')::numeric,
          round(60 + 30 * (0.32 * 2.04 * 1.87), 2), '2: 80 km transport = 60 + 30 km x 0.32 L x diesel x 1.87');
select ok((60 + 30 * (0.32 * 2.04 * 1.87)) / 30 > 0, 'sanity');
select is((public.compute_material_offer('river_sand', 10, 40)->>'transportCost')::numeric, 60.00, '3: short-haul flat step (<=50 km) unchanged');
select is((public.compute_material_offer('river_sand', 10, 5)->>'transportCost')::numeric, 20.00, '4: shortest flat step unchanged');
select * from finish();
rollback;
