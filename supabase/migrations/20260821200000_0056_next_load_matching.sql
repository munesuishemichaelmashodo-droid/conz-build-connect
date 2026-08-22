-- 0056: next-load / backhaul matching, Phase 1-6 (read-only recommendation
-- layer only). No new tables -- everything needed already exists in
-- jobs, trucks, and the capacity-tier formula already established in
-- migration 0045 / src/lib/capacityMatch.ts (reused verbatim here, not
-- reinvented).
--
-- find_next_loads_for_driver(driver_id, current_job_id): given a driver's
-- current job (in_progress or completed -- the anchor point is that job's
-- delivery location, i.e. where the driver's truck actually is or is
-- about to be), finds OPEN jobs that could logically follow it. Purely
-- read-only, no side effects, no automatic assignment -- the driver still
-- goes through the existing bidding/acceptance flow for anything shown
-- here, completely unchanged.
--
-- CRITICAL: this function does not touch, call, or influence
-- compute_material_offer, resolveMaterialSource, resolve_material_source_
-- candidates, price_quotes, or any customer-facing pricing path in any
-- way. Customer price remains exactly:
--   material source -> customer delivery distance -> compute_material_offer
-- Driver repositioning/backhaul distance is a completely separate concern
-- (driver-side discovery only), never fed into that calculation.

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
  budget numeric,
  preferred_date date,
  repositioning_km numeric,
  capacity_tier text,
  capacity_trips int
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
begin
  -- Only the driver themselves (or an admin) may query this for a given
  -- driver_id -- same authorization pattern as every other function this
  -- session (explicit check inside the SECURITY DEFINER body, independent
  -- of table RLS).
  _is_authorized := auth.uid() = _driver_id
    or public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role);
  if not _is_authorized then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;

  -- Anchor point: the current job's delivery location -- where the
  -- driver's truck is, or is about to be, once this delivery finishes.
  -- Must genuinely belong to this driver and be in_progress or completed
  -- (an open/accepted-but-not-started job has no real position yet; a
  -- cancelled job never happened) -- this is the lifecycle rule Phase 1/
  -- test J asks for.
  select j.delivery_lat, j.delivery_lng, j.preferred_date
    into _anchor_lat, _anchor_lng, _anchor_date
  from public.jobs j
  where j.id = _current_job_id
    and j.driver_id = _driver_id
    and j.status in ('in_progress', 'completed');

  if _anchor_lat is null or _anchor_lng is null then
    return; -- no rows: current job doesn't qualify, or has no delivery coordinates yet
  end if;

  return query
  select
    j.id,
    j.material,
    j.quantity_m3,
    j.pickup_address,
    j.pickup_lat,
    j.pickup_lng,
    j.delivery_address,
    j.budget,
    j.preferred_date,
    round((2 * 6371 * asin(sqrt(
      power(sin(radians(j.pickup_lat - _anchor_lat) / 2), 2) +
      cos(radians(_anchor_lat)) * cos(radians(j.pickup_lat)) *
      power(sin(radians(j.pickup_lng - _anchor_lng) / 2), 2)
    )))::numeric, 1) as repositioning_km,
    cap.tier,
    cap.trips
  from public.jobs j
  left join lateral (
    -- Best capacity tier across the driver's registered trucks for this
    -- job's quantity -- identical formula to previewCapacityMatch /
    -- tg_stamp_bid_capacity (migration 0045), not a new one. Display/
    -- ranking only, same as job-list sorting already does -- never an
    -- eligibility gate (a driver with no matching truck can still see
    -- and choose to bid, exactly like the existing job list).
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
    -- Simple, explainable "not an excessive detour" cutoff rather than
    -- real route optimization -- deliberately not overbuilding this.
    and (2 * 6371 * asin(sqrt(
          power(sin(radians(j.pickup_lat - _anchor_lat) / 2), 2) +
          cos(radians(_anchor_lat)) * cos(radians(j.pickup_lat)) *
          power(sin(radians(j.pickup_lng - _anchor_lng) / 2), 2)
        ))) <= 150
    -- Simple timing rule: a job needed before the current job's own
    -- preferred date can't logically be a "next" load. Only applied when
    -- both dates are actually set -- most jobs have flexible/no date.
    and (_anchor_date is null or j.preferred_date is null or j.preferred_date >= _anchor_date)
  order by repositioning_km asc
  limit 10;
end;
$function$;

comment on function public.find_next_loads_for_driver is
  'Read-only next-load/backhaul recommendation layer. Given a driver''s in_progress or completed job, finds open jobs whose pickup point is within a simple 150km detour cutoff of that job''s delivery location, ranked by repositioning distance. No automatic assignment -- the driver still bids/accepts through the existing, completely unchanged flow. Never reads or writes anything in the pricing path (compute_material_offer, resolveMaterialSource, price_quotes) -- driver repositioning distance cannot influence customer pricing, by construction (this function has no caller relationship to those at all).';

grant execute on function public.find_next_loads_for_driver(uuid, uuid) to authenticated;
