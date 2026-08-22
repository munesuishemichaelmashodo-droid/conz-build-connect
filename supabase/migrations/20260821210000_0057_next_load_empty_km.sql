-- 0057: next-load "empty km" intelligence upgrade.
--
-- Same function, same signature semantics, no new table. Extends the
-- return columns to add:
--   next_load_km          -- Phase 3.C: candidate pickup -> candidate delivery
--   delivery_lat/lng       -- candidate's own delivery point (route display + calc)
--   empty_km_saved          -- see formula below
--   recommendation_tier     -- excellent / good / possible, explainable rules
--
-- empty_km_saved formula, and why it's this specific formula:
--
-- We do NOT know the driver's true home base or intended next direction
-- (explicitly not allowed to invent one). The only concrete, already-known
-- prior point is the CURRENT job's own pickup location -- where the
-- driver physically started this trip from. We use that as a conservative
-- comparison anchor, not a claim about where they're "really" headed.
--
--   hypothetical_empty_return_km = distance(current_delivery, current_pickup)
--     -- what the driver would travel, unpaid, if they simply returned
--     -- the way they came with no next load.
--
--   cost_with_candidate = repositioning_km + distance(candidate_delivery, current_pickup)
--     -- repositioning_km: still-empty travel to reach the candidate's
--     --   pickup (unavoidable, same meaning as before this migration).
--     -- distance(candidate_delivery, current_pickup): how much travel,
--     --   if any, would still remain to get back toward the origin
--     --   AFTER completing the candidate load. A candidate whose own
--     --   delivery lands back near the origin contributes ~0 here; one
--     --   that goes further away contributes more, correctly penalising
--     --   "wrong direction" candidates even when their pickup is close.
--
--   empty_km_saved = greatest(0, hypothetical_empty_return_km - cost_with_candidate)
--
-- This is why a farther-pickup, homeward-bound candidate can score above
-- a nearer-pickup, outward-bound one -- it's not proximity alone, it's
-- proximity minus "how much of the empty trip does this load replace".
-- Floored at zero: never presented as a negative saving, and a load whose
-- own direction is worse than just returning empty shows 0, not a
-- penalty -- it can still appear (POSSIBLE tier), just without a claimed
-- benefit that isn't real.
--
-- Tier thresholds reuse existing, already-established scale conventions
-- from this codebase rather than inventing new numbers: 30km mirrors the
-- regional-source service radius already used (migration 0055), and the
-- 150km detour ceiling is the same cutoff this function has always used.
-- Capacity tiers are the exact existing excellent/good/oversized/
-- multiple_trips vocabulary (migration 0045 / capacityMatch.ts) --
-- unchanged, not reinvented.
--
--   EXCELLENT: capacity in (excellent, good) AND repositioning_km <= 30
--              AND empty_km_saved >= 20
--   GOOD:      capacity in (excellent, good, oversized) AND empty_km_saved > 0
--   POSSIBLE:  everything else that already passed the existing filters
--              (valid date/status/detour-cutoff eligibility, unchanged)
--
-- No job is ever hidden for having a weaker tier -- POSSIBLE is still a
-- real, biddable result, exactly as before this migration.

drop function if exists public.find_next_loads_for_driver(uuid, uuid);

create or replace function public.find_next_loads_for_driver(
  _driver_id uuid,
  _current_job_id uuid
) returns table (
  job_id uuid,
  material public.material_category,
  quantity_m3 numeric,
  pickup_address text,
  pickup_lat double precision,
  pickup_lng double precision,
  delivery_address text,
  delivery_lat double precision,
  delivery_lng double precision,
  budget numeric,
  preferred_date date,
  repositioning_km numeric,
  next_load_km numeric,
  empty_km_saved numeric,
  capacity_tier text,
  capacity_trips int,
  recommendation_tier text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _is_authorized boolean;
  _anchor_lat double precision;
  _anchor_lng double precision;
  _anchor_date date;
  _origin_lat double precision;
  _origin_lng double precision;
begin
  _is_authorized := auth.uid() = _driver_id
    or public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role);
  if not _is_authorized then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  -- Anchor: current job's delivery point (where the driver is / will be).
  -- Origin: current job's OWN pickup point -- the one real, already-known
  -- prior location, used only as the empty_km_saved comparison baseline,
  -- never presented as the driver's actual home base.
  select j.delivery_lat, j.delivery_lng, j.preferred_date, j.pickup_lat, j.pickup_lng
    into _anchor_lat, _anchor_lng, _anchor_date, _origin_lat, _origin_lng
  from public.jobs j
  where j.id = _current_job_id
    and j.driver_id = _driver_id
    and j.status in ('in_progress', 'completed');

  if _anchor_lat is null or _anchor_lng is null then
    return;
  end if;

  return query
  with candidates as (
    select
      j.id,
      j.material,
      j.quantity_m3,
      j.pickup_address,
      j.pickup_lat,
      j.pickup_lng,
      j.delivery_address,
      j.delivery_lat,
      j.delivery_lng,
      j.budget,
      j.preferred_date,
      round((2 * 6371 * asin(sqrt(
        power(sin(radians(j.pickup_lat - _anchor_lat) / 2), 2) +
        cos(radians(_anchor_lat)) * cos(radians(j.pickup_lat)) *
        power(sin(radians(j.pickup_lng - _anchor_lng) / 2), 2)
      )))::numeric, 1) as repositioning_km,
      case when j.delivery_lat is not null and j.delivery_lng is not null then
        round((2 * 6371 * asin(sqrt(
          power(sin(radians(j.delivery_lat - j.pickup_lat) / 2), 2) +
          cos(radians(j.pickup_lat)) * cos(radians(j.delivery_lat)) *
          power(sin(radians(j.delivery_lng - j.pickup_lng) / 2), 2)
        )))::numeric, 1)
      end as next_load_km,
      cap.tier as capacity_tier,
      cap.trips as capacity_trips,
      -- distance(candidate_delivery, origin) -- only computable when both
      -- the origin and the candidate's own delivery coordinates exist.
      case when _origin_lat is not null and _origin_lng is not null
                and j.delivery_lat is not null and j.delivery_lng is not null then
        (2 * 6371 * asin(sqrt(
          power(sin(radians(j.delivery_lat - _origin_lat) / 2), 2) +
          cos(radians(_origin_lat)) * cos(radians(j.delivery_lat)) *
          power(sin(radians(j.delivery_lng - _origin_lng) / 2), 2)
        )))
      end as _dist_candidate_delivery_to_origin
    from public.jobs j
    left join lateral (
      select
        case
          when trips_calc.trips > 1 then 'multiple_trips'
          when trips_calc.score >= 0.833 then 'excellent'
          when trips_calc.score >= 0.5 then 'good'
          else 'oversized'
        end as tier,
        trips_calc.trips
      from (
        select
          ceil(j.quantity_m3 / t.capacity_m3)::int as trips,
          j.quantity_m3 / (ceil(j.quantity_m3 / t.capacity_m3) * t.capacity_m3) as score
        from public.trucks t
        where t.driver_id = _driver_id and t.capacity_m3 > 0
        order by
          (case when ceil(j.quantity_m3 / t.capacity_m3) > 1 then 3
                when j.quantity_m3 / (ceil(j.quantity_m3 / t.capacity_m3) * t.capacity_m3) >= 0.833 then 0
                when j.quantity_m3 / (ceil(j.quantity_m3 / t.capacity_m3) * t.capacity_m3) >= 0.5 then 1
                else 2 end),
          ceil(j.quantity_m3 / t.capacity_m3)
        limit 1
      ) trips_calc
    ) cap on true
    where j.status = 'open'
      and j.id <> _current_job_id
      and j.pickup_lat is not null and j.pickup_lng is not null
      and (2 * 6371 * asin(sqrt(
            power(sin(radians(j.pickup_lat - _anchor_lat) / 2), 2) +
            cos(radians(_anchor_lat)) * cos(radians(j.pickup_lat)) *
            power(sin(radians(j.pickup_lng - _anchor_lng) / 2), 2)
          ))) <= 150
      and (_anchor_date is null or j.preferred_date is null or j.preferred_date >= _anchor_date)
  )
  select
    c.id,
    c.material,
    c.quantity_m3,
    c.pickup_address,
    c.pickup_lat,
    c.pickup_lng,
    c.delivery_address,
    c.delivery_lat,
    c.delivery_lng,
    c.budget,
    c.preferred_date,
    c.repositioning_km,
    c.next_load_km,
    case when _origin_lat is not null and _origin_lng is not null and c._dist_candidate_delivery_to_origin is not null then
      round(greatest(0,
        (2 * 6371 * asin(sqrt(
          power(sin(radians(_anchor_lat - _origin_lat) / 2), 2) +
          cos(radians(_origin_lat)) * cos(radians(_anchor_lat)) *
          power(sin(radians(_anchor_lng - _origin_lng) / 2), 2)
        )))
        - (c.repositioning_km + c._dist_candidate_delivery_to_origin)
      )::numeric, 1)
    end as empty_km_saved,
    c.capacity_tier,
    c.capacity_trips,
    case
      when c.capacity_tier in ('excellent','good') and c.repositioning_km <= 30
        and coalesce(
          case when _origin_lat is not null and _origin_lng is not null and c._dist_candidate_delivery_to_origin is not null then
            greatest(0,
              (2 * 6371 * asin(sqrt(
                power(sin(radians(_anchor_lat - _origin_lat) / 2), 2) +
                cos(radians(_origin_lat)) * cos(radians(_anchor_lat)) *
                power(sin(radians(_anchor_lng - _origin_lng) / 2), 2)
              )))
              - (c.repositioning_km + c._dist_candidate_delivery_to_origin)
            )
          end, 0) >= 20
      then 'excellent'
      when c.capacity_tier in ('excellent','good','oversized')
        and coalesce(
          case when _origin_lat is not null and _origin_lng is not null and c._dist_candidate_delivery_to_origin is not null then
            greatest(0,
              (2 * 6371 * asin(sqrt(
                power(sin(radians(_anchor_lat - _origin_lat) / 2), 2) +
                cos(radians(_origin_lat)) * cos(radians(_anchor_lat)) *
                power(sin(radians(_anchor_lng - _origin_lng) / 2), 2)
              )))
              - (c.repositioning_km + c._dist_candidate_delivery_to_origin)
            )
          end, 0) > 0
      then 'good'
      else 'possible'
    end as recommendation_tier
  from candidates c
  order by
    case
      when c.capacity_tier in ('excellent','good') and c.repositioning_km <= 30 then 0
      else 1
    end,
    -- Primary ranking signal is empty_km_saved descending (the actual
    -- "productive journey" insight), not raw repositioning distance --
    -- this is the behavioural change from the previous version.
    coalesce(
      case when _origin_lat is not null and _origin_lng is not null and c._dist_candidate_delivery_to_origin is not null then
        greatest(0,
          (2 * 6371 * asin(sqrt(
            power(sin(radians(_anchor_lat - _origin_lat) / 2), 2) +
            cos(radians(_origin_lat)) * cos(radians(_anchor_lat)) *
            power(sin(radians(_anchor_lng - _origin_lng) / 2), 2)
          )))
          - (c.repositioning_km + c._dist_candidate_delivery_to_origin)
        )
      end, 0) desc,
    c.repositioning_km asc
  limit 10;
end;
$function$;

comment on function public.find_next_loads_for_driver is
  'Read-only next-load/backhaul recommendation layer with empty-km-saved intelligence. Ranks candidates by estimated reduction in empty/repositioning travel (using the current job''s own pickup point as a conservative origin proxy -- never an invented home base), not raw pickup proximity alone. Returns an explainable recommendation_tier (excellent/good/possible) built from existing capacity-tier and distance conventions already used elsewhere in this codebase. No automatic assignment -- the driver still bids/accepts through the existing, completely unchanged flow. Never reads or writes anything in the pricing path (compute_material_offer, resolveMaterialSource, price_quotes).';

grant execute on function public.find_next_loads_for_driver(uuid, uuid) to authenticated;
