-- 0101 — supplier stock is ADVISORY, never a gate for quoting, booking or driver acceptance.
--
-- Owner direction (2026-10-12): ConZ is not an inventory marketplace. Customers say what they need; ConZ and the
-- drivers find a practical way to supply and deliver it. Blank or unknown stock must not block a request.
--
-- Defect/limitation: five functions treated stock as a gate:
--   resolve_material_source_candidates, create_price_quote_for, verified_quote_supply_for_job
--       (`available_quantity_m3 >= qty` is false for NULL, so every blank-stock site was ineligible), and
--   accept_bid (raised when tracked stock < job quantity, otherwise auto-decremented stock) and
--   cancel_job (added the quantity back).
-- Production has ALL supply locations with NULL stock, so 0080 would have made every material unbookable.
--
-- Change (smallest coherent):
--   * stock condition removed from the three eligibility functions. Kept: verified supplier, active + verified +
--     exact-coordinate location, material match, positive service radius, quote ownership/expiry/consumption.
--   * accept_bid / cancel_job: inventory reservation block removed (stock is not decremented/restored because drivers may
--     source elsewhere; decrementing would invent precision). Rest of both functions is unchanged (byte-identical
--     sources in production and local before this patch: accept_bid b52e314b..., cancel_job 16360921...).
--   * new supply_stock_status(location, qty) -> 'unknown' | 'confirmed' | 'below_requested' (never exposes quantities;
--     unknown is never reported as confirmed). authenticated + service_role only.
--
-- Deploy order: AFTER 0080 (0080 re-creates the strict versions of the three eligibility functions and would undo this).
--   Stage B: apply 0101 as the last statement of the 0080 step. Standalone otherwise (tables only).
-- Rollback: re-apply the previous function bodies (0080 for the three eligibility functions; 0049 era bodies for
--   accept_bid/cancel_job as captured in this repo's baseline). No data is changed by this migration.

CREATE OR REPLACE FUNCTION public.resolve_material_source_candidates(_material material_category, _quantity_m3 numeric, _delivery_lat numeric, _delivery_lng numeric)
 RETURNS TABLE(supply_location_id uuid, supplier_id uuid, supplier_name text, source_type text, label text, address text, lat numeric, lng numeric, priority integer, haversine_km numeric, location_precision text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    msl.id,
    msl.supplier_id,
    s.name,
    msl.source_type,
    msl.label,
    msl.address,
    msl.lat,
    msl.lng,
    msl.priority,
    round((2 * 6371 * asin(sqrt(
      power(sin(radians(_delivery_lat - msl.lat) / 2), 2) +
      cos(radians(msl.lat)) * cos(radians(_delivery_lat)) *
      power(sin(radians(_delivery_lng - msl.lng) / 2), 2)
    )))::numeric, 2) as haversine_km,
    msl.location_precision
  from public.material_supply_locations msl
  join public.suppliers s on s.id = msl.supplier_id
  where msl.material = _material
    and msl.status = 'active'
    and msl.verification_status = 'verified'
    and s.verification_status = 'verified'
    and msl.location_precision = 'exact'
    and msl.lat is not null
    and msl.lng is not null
    and msl.service_radius_km > 0
    and (2 * 6371 * asin(sqrt(
          power(sin(radians(_delivery_lat - msl.lat) / 2), 2) +
          cos(radians(msl.lat)) * cos(radians(_delivery_lat)) *
          power(sin(radians(_delivery_lng - msl.lng) / 2), 2)
        ))) <= msl.service_radius_km
  order by haversine_km asc
  limit 5;
$function$;

CREATE OR REPLACE FUNCTION public.create_price_quote_for(_customer_id uuid, _material text, _quantity_m3 numeric, _distance_km numeric, _distance_source text, _supply_location_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _id uuid;
begin
  if _distance_km is null or not (_distance_km >= 0 and _distance_km <= 5000) then
    raise exception 'invalid_distance';
  end if;
  if not public.is_valid_money(_quantity_m3, 1000) then
    raise exception 'invalid_quantity';
  end if;
  if _distance_source not in ('osrm', 'haversine') then
    raise exception 'invalid_distance_source';
  end if;
  if not exists (select 1 from public.material_prices where material::text = _material) then
    raise exception 'invalid_material';
  end if;
  if _supply_location_id is null or not exists (
       select 1 from public.material_supply_locations
        where id = _supply_location_id
          and material::text = _material
          and status = 'active'
          and verification_status = 'verified'
          and lat is not null and lng is not null
          and service_radius_km > 0
          and location_precision = 'exact'
          and exists (select 1 from public.suppliers s
                       where s.id = material_supply_locations.supplier_id
                         and s.verification_status = 'verified')) then
    raise exception 'invalid_supply_location';
  end if;

  insert into public.price_quotes (customer_id, material, quantity_m3, distance_km, distance_source, supply_location_id)
  values (_customer_id, _material, _quantity_m3, round(_distance_km, 2), _distance_source, _supply_location_id)
  returning id into _id;
  return _id;
end $function$;

CREATE OR REPLACE FUNCTION public.verified_quote_supply_for_job(_quote_id uuid, _customer_id uuid, _material text, _quantity numeric)
 RETURNS TABLE(lat numeric, lng numeric, service_radius_km numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select msl.lat, msl.lng, msl.service_radius_km
    from public.price_quotes q
    join public.material_supply_locations msl on msl.id = q.supply_location_id
    join public.suppliers s on s.id = msl.supplier_id
   where q.id = _quote_id
     and (q.customer_id is null or q.customer_id = _customer_id)
     and q.material::text = _material
     and q.quantity_m3 = _quantity
     and q.consumed_at is null
     and q.expires_at > now()
     and (auth.uid() is null or auth.uid() = _customer_id)
     and msl.material::text = _material
     and msl.status = 'active'
     and msl.verification_status = 'verified'
     and s.verification_status = 'verified'
     and msl.lat is not null and msl.lng is not null
     and msl.service_radius_km > 0
     and msl.location_precision = 'exact';
$function$;

CREATE OR REPLACE FUNCTION public.accept_bid(_bid_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _bid   public.bids;
  _job   public.jobs;
  _guard jsonb;
  _loc   public.material_supply_locations;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _bid from public.bids where id = _bid_id for update;
  if not found then raise exception 'Bid not found'; end if;

  select * into _job from public.jobs where id = _bid.job_id for update;
  if not found then raise exception 'Job not found'; end if;

  if _job.customer_id <> auth.uid() then raise exception 'Not your job'; end if;
  if _job.status <> 'open' then raise exception 'Job not open'; end if;
  if _bid.status <> 'pending' then raise exception 'Bid no longer available'; end if;

  -- F1: never let an invalid price become the job's final price.
  if not public.is_valid_money(_bid.price) then
    raise exception 'This offer has an invalid price and cannot be accepted.';
  end if;

  -- (0101) No inventory reservation: supplier stock is advisory and is neither checked nor changed here.

  update public.bids set status = 'accepted' where id = _bid_id;
  update public.bids set status = 'rejected'
   where job_id = _job.id and id <> _bid_id and status = 'pending';

  update public.jobs
     set status = 'accepted', driver_id = _bid.driver_id,
         accepted_bid_id = _bid_id, final_price = _bid.price
   where id = _job.id
  returning * into _job;

  _guard := public.driver_can_accept_for(_job.id, _bid.driver_id);
  if (_guard->>'ok')::boolean is not true then
    raise exception 'Driver has insufficient wallet balance: needs $%, has $% available',
      _guard->>'required', _guard->>'available';
  end if;

  perform public.hold_job_commission(_job.id);

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job.id and status = 'pending';

  return _job;
end $function$;

CREATE OR REPLACE FUNCTION public.cancel_job(_job_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  _job public.jobs; _stage text; _is_admin boolean; _loc public.material_supply_locations;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role)
            or public.has_role(auth.uid(), 'super_admin'::public.app_role);

  if not (_is_admin or auth.uid() = _job.customer_id or auth.uid() = _job.driver_id) then
    raise exception 'Not authorised to cancel this job';
  end if;
  if _job.status in ('completed','cancelled') then
    raise exception 'Job already % and cannot be cancelled', _job.status;
  end if;
  if _job.status = 'in_progress' and not _is_admin then
    raise exception 'Job is in progress — raise a dispute instead of cancelling';
  end if;

  _stage := case _job.status
              when 'open' then 'pre_acceptance'
              when 'accepted' then 'post_acceptance'
              when 'in_progress' then 'in_transit'
              else _job.status::text end;

  -- (0101) No inventory restore: stock is advisory and was never decremented on acceptance.

  perform public.release_job_commission(_job_id);

  -- F2: any escrow the customer already paid is owed back in full.
  perform public.escrow_refund_due_for_job(_job_id, 'job_cancelled');

  update public.jobs
     set status = 'cancelled', cancellation_reason = _reason,
         cancellation_stage = _stage, cancelled_at = now(),
         cancelled_by = auth.uid()
   where id = _job_id
  returning * into _job;

  update public.job_dispatch_offers
     set status = 'superseded', responded_at = now()
   where job_id = _job_id and status = 'pending';

  if _stage <> 'pre_acceptance' and auth.uid() = _job.customer_id then
    perform public.enforce_customer_strikes(_job.customer_id, _job_id, _stage, _reason);
  end if;

  if _stage <> 'pre_acceptance' and auth.uid() = _job.driver_id then
    insert into public.cancellation_events(user_id, job_id, role, stage, reason)
    values (_job.driver_id, _job_id, 'driver', _stage, _reason);
  end if;

  if _job.driver_id is not null and auth.uid() <> _job.driver_id then
    insert into public.notifications (user_id, type, title, body)
    values (_job.driver_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'The customer cancelled this job.'));
  end if;
  if auth.uid() <> _job.customer_id then
    insert into public.notifications (user_id, type, title, body)
    values (_job.customer_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'This job was cancelled.'));
  end if;

  return _job;
end $function$;

create or replace function public.supply_stock_status(_location_id uuid, _quantity numeric)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
           when msl.id is null then 'unknown'
           when msl.available_quantity_m3 is null then 'unknown'
           when msl.available_quantity_m3 >= _quantity then 'confirmed'
           else 'below_requested'
         end
    from (select 1) one
    left join public.material_supply_locations msl on msl.id = _location_id;
$$;
comment on function public.supply_stock_status(uuid, numeric) is
  '0101: advisory label only. unknown = no stock recorded (never shown as available); confirmed = recorded stock covers the quantity; below_requested = recorded stock is lower (still bookable; confirm at pickup).';
revoke all on function public.supply_stock_status(uuid, numeric) from public, anon;
grant execute on function public.supply_stock_status(uuid, numeric) to authenticated, service_role;

revoke all on function public.resolve_material_source_candidates(material_category, numeric, numeric, numeric) from public, anon;
grant execute on function public.resolve_material_source_candidates(material_category, numeric, numeric, numeric) to authenticated, service_role;
revoke all on function public.create_price_quote_for(uuid, text, numeric, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.create_price_quote_for(uuid, text, numeric, numeric, text, uuid) to service_role;
revoke all on function public.verified_quote_supply_for_job(uuid, uuid, text, numeric) from public, anon;
grant execute on function public.verified_quote_supply_for_job(uuid, uuid, text, numeric) to authenticated, service_role;
revoke all on function public.accept_bid(uuid) from public, anon;
grant execute on function public.accept_bid(uuid) to authenticated, service_role;
revoke all on function public.cancel_job(uuid, text) from public, anon;
grant execute on function public.cancel_job(uuid, text) to authenticated, service_role;
