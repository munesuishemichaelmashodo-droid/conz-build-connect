-- -----------------------------------------------------------------------------
-- 0183: two customer booking journeys (Stage 2, 26/11/2026).
--
--   transport_only       the customer already has the load and needs a truck (from their yard, site, etc.)
--   collect_and_deliver  the driver collects a load the customer arranged at a supplier / shop / location
--
-- Both use the existing transport-only pricing path (0158/0159): the customer gives the collection point and the
-- delivery point, the SERVER measures the road distance into a single-use transport quote, and the budget must sit
-- in the guide band. No second pricing engine; the commission is unchanged (7% of the accepted price, which for
-- these jobs is the transport fare). Con Z arranges transport only; the customer arranges and pays for materials.
--
-- New nullable job columns (existing jobs keep NULL = the legacy journey; nothing is backfilled):
--   job_kind, load_details, truck_requirement, preferred_time,
--   collection_name, collection_contact, collection_reference.
-- Rules enforced here (not only in the app):
--   * job_kind needs pricing_basis = 'transport_only' (so the transport switch, quote and price band apply).
--   * collect_and_deliver needs a collection_name; transport_only must not carry collection fields (switching
--     journeys cannot leave hidden data behind).
--   * Length and control-character limits on every free-text field.
--   * After posting: job_kind can never change; the customer may correct the collection contact / reference /
--     details while the job is open or accepted; drivers can change none of these fields.
-- Privacy for drivers who have not been selected (mask_job_for_driver, find_next_loads_for_driver):
--   * a customer-chosen collection point (transport_only pricing) is shown as an area with ~1 km coordinates,
--     like the delivery point; collection contact and reference are removed; load details are contact-redacted.
--   * Before 0183 the collection point of a transport-priced job was returned exactly; no such job exists live
--     (the transport switch has always been off).
-- No DROP, no DELETE. Undo: supabase/rollbacks/20261126150000_0183_rollback.sql.
-- -----------------------------------------------------------------------------

-- 1. Columns ------------------------------------------------------------------------------------------------
alter table public.jobs
  add column if not exists job_kind text
    check (job_kind is null or job_kind in ('transport_only', 'collect_and_deliver')),
  add column if not exists load_details text
    check (load_details is null or (char_length(load_details) <= 300 and load_details !~ '[[:cntrl:]]')),
  add column if not exists truck_requirement text
    check (truck_requirement is null or truck_requirement in ('any', 'tipper', 'dropside', 'flatbed')),
  add column if not exists preferred_time text
    check (preferred_time is null or preferred_time in ('any', 'morning', 'afternoon')),
  add column if not exists collection_name text
    check (collection_name is null or (char_length(collection_name) between 2 and 120 and collection_name !~ '[[:cntrl:]]')),
  add column if not exists collection_contact text
    check (collection_contact is null or (char_length(collection_contact) <= 120 and collection_contact !~ '[[:cntrl:]]')),
  add column if not exists collection_reference text
    check (collection_reference is null or (char_length(collection_reference) <= 80 and collection_reference !~ '[[:cntrl:]]'));

-- 2. Validation (SECURITY INVOKER on purpose: current_user must be the caller) -----------------------------
create or replace function public.tg_validate_job_kind()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  _client boolean := current_user in ('authenticated', 'anon');
  _is_customer boolean;
begin
  -- Empty strings are stored as NULL.
  new.load_details := nullif(btrim(new.load_details), '');
  new.collection_name := nullif(btrim(new.collection_name), '');
  new.collection_contact := nullif(btrim(new.collection_contact), '');
  new.collection_reference := nullif(btrim(new.collection_reference), '');

  if tg_op = 'UPDATE' and _client then
    if new.job_kind is distinct from old.job_kind then
      raise exception 'The type of booking cannot be changed after posting.' using errcode = '42501';
    end if;
    if (new.collection_name, new.collection_contact, new.collection_reference, new.load_details,
        new.truck_requirement, new.preferred_time)
       is distinct from
       (old.collection_name, old.collection_contact, old.collection_reference, old.load_details,
        old.truck_requirement, old.preferred_time) then
      _is_customer := auth.uid() is not null and auth.uid() = old.customer_id;
      if not _is_customer then
        raise exception 'Only the customer can change the collection details.' using errcode = '42501';
      end if;
      if old.status not in ('open', 'accepted') then
        raise exception 'Collection details can only be changed before the load is collected.' using errcode = '42501';
      end if;
    end if;
  end if;

  if new.job_kind is null then
    if new.collection_name is not null or new.collection_contact is not null or new.collection_reference is not null then
      raise exception 'Collection details need a booking type.' using errcode = '22023';
    end if;
    return new;
  end if;

  if new.pricing_basis is distinct from 'transport_only' then
    raise exception 'This booking type must be priced for transport only.' using errcode = '22023';
  end if;
  if new.pickup_lat is null or new.pickup_lng is null or nullif(btrim(coalesce(new.pickup_address, '')), '') is null then
    raise exception 'Choose where the load is collected.' using errcode = '22023';
  end if;
  if new.job_kind = 'collect_and_deliver' then
    if new.collection_name is null then
      raise exception 'Give the supplier, shop or place name for the collection.' using errcode = '22023';
    end if;
  else
    if new.collection_name is not null or new.collection_contact is not null or new.collection_reference is not null then
      raise exception 'Supplier collection details only apply to a collect-and-deliver booking.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tg_validate_job_kind() from public, anon, authenticated;
create or replace trigger trg_jobs_validate_kind
  before insert or update on public.jobs
  for each row execute function public.tg_validate_job_kind();

-- 3. What drivers who have not been selected see -------------------------------------------------------------
create or replace function public.mask_job_for_driver(j public.jobs)
returns public.jobs language plpgsql immutable set search_path to 'public' as $$
begin
  j.delivery_address := public.coarse_place(j.delivery_address);
  j.delivery_lat := public.coarse_coord(j.delivery_lat);
  j.delivery_lng := public.coarse_coord(j.delivery_lng);
  j.dropoff_address := null; j.dropoff_lat := null; j.dropoff_lng := null;
  j.notes := public.redact_contacts(j.notes);
  j.receiver_name := null;
  j.tracking_token := null;
  j.delivery_pin := null;
  j.delivery_photo_url := null; j.pickup_photo_url := null;
  -- (0183) A collection point the customer chose is private like the delivery point; listed supplier
  -- locations (legacy pricing) stay as they were.
  if j.pricing_basis = 'transport_only' then
    j.pickup_address := public.coarse_place(j.pickup_address);
    j.pickup_lat := public.coarse_coord(j.pickup_lat);
    j.pickup_lng := public.coarse_coord(j.pickup_lng);
  end if;
  j.collection_contact := null;
  j.collection_reference := null;
  j.load_details := public.redact_contacts(j.load_details);
  return j;
end $$;
revoke all on function public.mask_job_for_driver(public.jobs) from public, anon, authenticated;

create or replace function public.find_next_loads_for_driver(_driver_id uuid, _current_job_id uuid)
returns table(job_id uuid, material public.material_category, quantity_m3 numeric, pickup_address text,
              pickup_lat double precision, pickup_lng double precision, delivery_address text,
              delivery_lat double precision, delivery_lng double precision, budget numeric, preferred_date date,
              repositioning_km numeric, next_load_km numeric, empty_km_saved numeric, capacity_tier text,
              capacity_trips integer, recommendation_tier text)
language sql stable security definer set search_path to 'public'
as $$
  select e.job_id, e.material, e.quantity_m3,
         case when j.pricing_basis = 'transport_only' then public.coarse_place(e.pickup_address) else e.pickup_address end,
         case when j.pricing_basis = 'transport_only' then public.coarse_coord(e.pickup_lat) else e.pickup_lat end,
         case when j.pricing_basis = 'transport_only' then public.coarse_coord(e.pickup_lng) else e.pickup_lng end,
         public.coarse_place(e.delivery_address), public.coarse_coord(e.delivery_lat), public.coarse_coord(e.delivery_lng),
         e.budget, e.preferred_date, e.repositioning_km, e.next_load_km, e.empty_km_saved, e.capacity_tier,
         e.capacity_trips, e.recommendation_tier
    from public._find_next_loads_exact(_driver_id, _current_job_id) e
    left join public.jobs j on j.id = e.job_id
$$;
revoke all on function public.find_next_loads_for_driver(uuid, uuid) from public, anon;
grant execute on function public.find_next_loads_for_driver(uuid, uuid) to authenticated;
