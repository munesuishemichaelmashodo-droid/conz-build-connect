-- 0092: driver levels carry no financial discount.
--
-- Owner decision 11/10/2026: commission is a flat commission_rate (7%) for
-- every driver level. 0091 stopped every money path from calling
-- driver_level_commission_multiplier(), but left the old function returning
-- 0.80 / 0.90 / 0.95 -- a latent discount that any future caller would pick
-- up by accident. It now returns 1.00 for every level (and for NULL), so even
-- a stray caller cannot reintroduce a level discount. Signature, owner and
-- grants are unchanged (CREATE OR REPLACE keeps them).
--
-- Forward-only, idempotent, no data change. Not applied to any hosted project.

create or replace function public.driver_level_commission_multiplier(_level driver_level)
returns numeric
language sql
immutable
set search_path to 'public'
as $$
  -- Levels are recognition only. The fee is commission_rate for everyone.
  select 1.00::numeric;
$$;

comment on function public.driver_level_commission_multiplier(driver_level) is
  'Deprecated no-op: always 1.00. Driver levels do not change commission (flat commission_rate for all). Kept so old callers do not break.';
