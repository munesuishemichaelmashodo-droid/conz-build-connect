-- Reference (configuration) data for the LOCAL test database only.
--
-- scripts/db-test.mjs appends this file to the copied baseline migration in
-- .dbtest/, because the 13/08 baseline is schema-only and later migrations
-- assume these configuration rows already exist. Values mirror production
-- configuration as of 07/10/2026 (non-personal: pricing and platform
-- settings). No user data, no secrets. Never applied to a hosted project.

insert into public.material_prices (material, label, min_price, max_price, unit, enforced, demand_multiplier) values
  ('custom',       'Other / custom', 0,    0,    '10-15 m³ load', false, 1),
  ('gravel',       'Gravel',         9,    13,   'per m³', true, 1),
  ('pit_sand',     'Pit sand',       8,    11,   'per m³', true, 1),
  ('river_sand',   'River sand',     12,   16,   'per m³', true, 1),
  ('quarry_dust',  'Quarry dust',    10,   18,   'per m³', true, 1),
  ('crusher_run',  'Crusher run',    18,   25,   'per m³', true, 1),
  ('stones',       '3/4 stones',     15,   30,   'per m³', true, 1),
  ('top_soil',     'Top soil',       8,    16,   'per m³', true, 1),
  ('filling_soil', 'Filling soil',   11.2, 16.8, 'per m³', true, 1)
on conflict (material) do nothing;

insert into public.system_settings (key, value) values
  ('commission_rate', '7'::jsonb),
  ('diesel_price_per_liter', '1.87'::jsonb),
  ('admin_wallet_threshold', '{"threshold":500}'::jsonb),
  ('referral_rewards', '{"hold_days":7,"milestones":[1,5,10,25,50],"driver_min_deliveries":5,"driver_referrer_amount":15,"customer_referred_credit":5,"customer_referrer_amount":10}'::jsonb)
on conflict (key) do nothing;
