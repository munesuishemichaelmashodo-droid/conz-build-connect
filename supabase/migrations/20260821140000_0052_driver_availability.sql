-- 0052: driver_availability foundation (Stage 1 of geographic driver
-- matching). Current-state table only -- one row per driver, no history.
--
-- Deliberately separate from driver_locations, which remains exclusively
-- active-job tracking (live delivery map, stationary-driver detection).
-- driver_availability represents a different lifecycle: a driver
-- signalling "I'm open to receiving job opportunities right now", not
-- "I'm en route on an assigned job".
--
-- is_available = true means the driver has explicitly opted in to
-- receiving job opportunities -- NOT merely that the app is open. This is
-- a stricter signal than the existing profiles.last_active_at heartbeat
-- (app-open presence, used for chat online/last-seen), which remains
-- unchanged and is not conflated with this.
--
-- Existing precedent inspected before choosing any numbers: the current
-- presence heartbeat (src/lib/auth.tsx) updates profiles.last_active_at
-- every ~45s while the tab is visible, and treats a profile as "Online"
-- when last_active_at is under 2 minutes old (src/routes/_authenticated/
-- chat.$jobId.tsx). Stage 1 does not yet consume any freshness threshold
-- (no ranking logic exists yet), but documenting this precedent now so a
-- later stage doesn't invent an unrelated number: ~45s heartbeat cadence,
-- ~2min freshness window are the existing, already-shipped reference
-- points to align with, not hard facts this migration enforces.
--
-- Does not touch compute_material_offer, resolveMaterialSource,
-- resolve_material_source_candidates, Pomona's configuration,
-- driver_locations, accept_bid, cancel_job, or capacity matching.

create table if not exists public.driver_availability (
  driver_id uuid primary key references auth.users(id) on delete cascade,
  lat numeric,
  lng numeric,
  is_available boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint driver_availability_coords_paired check (
    (lat is null and lng is null) or (lat is not null and lng is not null)
  ),
  constraint driver_availability_lat_range check (lat is null or lat between -90 and 90),
  constraint driver_availability_lng_range check (lng is null or lng between -180 and 180)
);

comment on table public.driver_availability is
  'Current-state (one row per driver, no history) idle-driver availability and approximate position. Separate lifecycle from driver_locations (active-job tracking only). is_available=true means the driver has explicitly opted in to receiving job opportunities, not merely that the app is open (see profiles.last_active_at for that). Stage 1 of geographic driver matching -- this table is not yet consumed by any matching/ranking logic.';

create index if not exists idx_driver_availability_available
  on public.driver_availability (driver_id)
  where is_available = true;

alter table public.driver_availability enable row level security;

drop policy if exists "Driver reads own availability" on public.driver_availability;
create policy "Driver reads own availability" on public.driver_availability
  for select using (auth.uid() = driver_id);

drop policy if exists "Driver inserts own availability" on public.driver_availability;
create policy "Driver inserts own availability" on public.driver_availability
  for insert with check (auth.uid() = driver_id);

drop policy if exists "Driver updates own availability" on public.driver_availability;
create policy "Driver updates own availability" on public.driver_availability
  for update using (auth.uid() = driver_id);

-- Deliberately no policy allows reading another driver's row -- RLS
-- defaults to deny by omission. A future matching stage reads this
-- table only through a SECURITY DEFINER function (same pattern as
-- resolve_material_source_candidates), never via direct client queries,
-- so raw coordinates are never broadly queryable.

-- Lightweight anti-spoof sanity check, not cryptographic GPS
-- authenticity: reject an update that implies an obviously impossible
-- sustained speed since the driver's last recorded position. Uses the
-- same haversine formula already established elsewhere in this codebase
-- (tg_validate_job_budget, resolve_material_source_candidates) rather
-- than introducing a new distance calculation.
create or replace function public.tg_validate_driver_availability_move()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  _distance_km numeric;
  _hours numeric;
  _implied_kmh numeric;
begin
  if old.lat is null or old.lng is null or new.lat is null or new.lng is null then
    return new;
  end if;
  if new.lat = old.lat and new.lng = old.lng then
    return new;
  end if;

  -- Floor of ~36s (0.01h) -- comfortably below the existing ~45s heartbeat
  -- cadence this table is designed to be updated on, so two updates that
  -- land close together in wall-clock time (e.g. a client retry, or GPS
  -- jitter within a single heartbeat cycle) don't get an artificially
  -- inflated implied speed from a near-zero time delta.
  _hours := greatest(extract(epoch from (new.updated_at - old.updated_at)) / 3600.0, 0.01);
  _distance_km := 2 * 6371 * asin(sqrt(
    power(sin(radians(new.lat - old.lat) / 2), 2) +
    cos(radians(old.lat)) * cos(radians(new.lat)) *
    power(sin(radians(new.lng - old.lng) / 2), 2)
  ));
  _implied_kmh := _distance_km / _hours;

  -- Generous bound: no legitimate ground-vehicle position update should
  -- imply sustained travel faster than this. Flags obviously bad data;
  -- does not assert certainty about GPS authenticity.
  if _implied_kmh > 200 then
    raise exception 'Location update implies an implausible speed (~% km/h) -- rejected.', round(_implied_kmh);
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_validate_driver_availability_move on public.driver_availability;
create trigger trg_validate_driver_availability_move
  before update on public.driver_availability
  for each row execute function public.tg_validate_driver_availability_move();
