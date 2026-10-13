-- 0088_sourcing_workflow_integrity  (PREPARED, NOT APPLIED)
--
-- Completes the nationwide sourcing workflow on top of 0087:
--   * idempotent, rate-limited request creation (retry safe)
--   * explicit state machine enforced by a trigger (no invalid transitions)
--   * append-only status history written by a trigger (no path can skip it)
--   * writes only through SECURITY DEFINER RPCs; direct UPDATE closed
--   * admin quote issuance validated against a real, verified, in-stock,
--     exact-coordinate supply location and priced by the EXISTING engine
--     (compute_material_offer) -- admins never type a price
--   * conversion to a job happens only when the customer posts a job with the
--     sourcing quote; no automatic order creation
--   * supplier identity / admin notes no longer readable by the customer
--
-- Dependencies (must be live BEFORE this migration):
--   0087 (table + create_material_sourcing_request), 0072 (is_valid_money),
--   0080 (create_price_quote_for, strict supply-location checks),
--   public.has_role, public.notifications, public.suppliers, price_quotes,
--   compute_material_offer, tg_touch_updated_at.
--
-- DESTRUCTIVE NOTE: drops the 8-argument create_material_sourcing_request
-- (replaced by a 9-argument version with an optional idempotency key; the
-- app does not call the old signature). Table has 0 rows live (checked
-- 11/10/2026).

-- ---------------------------------------------------------------- columns
alter table public.material_sourcing_requests
  add column if not exists idempotency_key   text,
  add column if not exists quote_id          uuid references public.price_quotes(id) on delete restrict,
  add column if not exists supply_location_id uuid references public.material_supply_locations(id) on delete restrict,
  add column if not exists quote_valid_until timestamptz,
  add column if not exists terms             text,
  add column if not exists decline_reason    text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sourcing_idempotency_key_len') then
    alter table public.material_sourcing_requests
      add constraint sourcing_idempotency_key_len
      check (idempotency_key is null or length(idempotency_key) between 8 and 128);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sourcing_quote_ready_complete') then
    alter table public.material_sourcing_requests
      add constraint sourcing_quote_ready_complete
      check (status <> 'quote_ready'
             or (quote_id is not null and supply_location_id is not null
                 and quote_valid_until is not null and quoted_total is not null
                 and terms is not null));
  end if;
end $$;

create unique index if not exists uq_sourcing_customer_idem
  on public.material_sourcing_requests (customer_id, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists uq_sourcing_quote_id
  on public.material_sourcing_requests (quote_id) where quote_id is not null;

-- ---------------------------------------------------------- state machine
create or replace function public.sourcing_transition_allowed(_from text, _to text)
returns boolean language sql immutable as $$
  select case _from
    when 'requested'   then _to in ('sourcing', 'declined', 'expired')
    when 'sourcing'    then _to in ('quote_ready', 'declined', 'expired')
    when 'quote_ready' then _to in ('sourcing', 'converted', 'declined', 'expired')
    else false            -- declined / expired / converted are terminal
  end;
$$;

create or replace function public.tg_sourcing_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status
       and not public.sourcing_transition_allowed(old.status, new.status) then
      raise exception 'invalid_sourcing_transition: % -> %', old.status, new.status
        using errcode = '23514';
    end if;
    -- immutable once created
    if new.customer_id is distinct from old.customer_id
       or new.material is distinct from old.material
       or new.quantity_m3 is distinct from old.quantity_m3
       or new.delivery_lat is distinct from old.delivery_lat
       or new.delivery_lng is distinct from old.delivery_lng
       or new.delivery_address is distinct from old.delivery_address
       or new.idempotency_key is distinct from old.idempotency_key
       or new.created_at is distinct from old.created_at then
      raise exception 'sourcing_request_fields_immutable' using errcode = '23514';
    end if;
    -- leaving quote_ready by any route other than conversion voids the quote
    if old.status = 'quote_ready' and new.status in ('sourcing', 'declined', 'expired') then
      new.quote_id := null; new.supply_location_id := null;
      new.quote_valid_until := null; new.quoted_total := null; new.terms := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists t_sourcing_guard on public.material_sourcing_requests;
create trigger t_sourcing_guard before update on public.material_sourcing_requests
  for each row execute function public.tg_sourcing_guard();

-- --------------------------------------------------------- history (audit)
create table if not exists public.material_sourcing_status_history (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.material_sourcing_requests(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor_id    uuid,
  actor_role  text not null default 'system',
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_sourcing_history_request
  on public.material_sourcing_status_history (request_id, id);

alter table public.material_sourcing_status_history enable row level security;
revoke all on public.material_sourcing_status_history from public, anon, authenticated;
-- No policies on purpose: customers and admins read through the RPCs below.

create or replace function public.tg_sourcing_history_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'sourcing_history_is_append_only' using errcode = '42501';
end $$;
drop trigger if exists t_sourcing_history_immutable on public.material_sourcing_status_history;
create trigger t_sourcing_history_immutable
  before update or delete on public.material_sourcing_status_history
  for each row execute function public.tg_sourcing_history_immutable();
-- (ON DELETE CASCADE from a deleted account bypasses row triggers' intent by
--  design: account deletion removes the request and its history together.)

create or replace function public.tg_sourcing_history_write()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _uid uuid := auth.uid(); _role text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  _role := case
    when _uid is null then 'system'
    when public.has_role(_uid, 'super_admin') then 'super_admin'
    when public.has_role(_uid, 'admin') then 'admin'
    when _uid = new.customer_id then 'customer'
    else 'user' end;
  -- issue_sourcing_quote runs as service_role (no auth.uid); it passes the
  -- real admin through conz.sourcing_actor so the trail names a person.
  if _uid is null and nullif(current_setting('conz.sourcing_actor', true), '') is not null then
    _uid := current_setting('conz.sourcing_actor', true)::uuid;
    _role := 'admin';
  end if;
  insert into public.material_sourcing_status_history
    (request_id, from_status, to_status, actor_id, actor_role, note)
  values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status, _uid, _role,
          nullif(current_setting('conz.sourcing_note', true), ''));
  return new;
end $$;

drop trigger if exists t_sourcing_history_write on public.material_sourcing_requests;
create trigger t_sourcing_history_write
  after insert or update on public.material_sourcing_requests
  for each row execute function public.tg_sourcing_history_write();

-- ------------------------------------------ close direct writes / leakage
drop policy if exists "Admins update sourcing requests" on public.material_sourcing_requests;
revoke all on public.material_sourcing_requests from public, anon, authenticated;
-- Customer-safe columns only: no supplier identity, no supplier contact, no
-- internal admin notes. Admins use admin_list_sourcing_requests().
grant select (id, customer_id, material, custom_material, quantity_m3, delivery_address,
              delivery_lat, delivery_lng, preferred_date, notes, status, quoted_total,
              quote_id, quote_valid_until, terms, decline_reason, expires_at,
              converted_job_id, created_at, updated_at)
  on public.material_sourcing_requests to authenticated;

-- ----------------------------------------------------------- notification
create or replace function public.sourcing_notify(_user uuid, _type text, _title text, _body text)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.notifications (user_id, type, title, body)
  select _user, _type, _title, _body where _user is not null;
$$;
revoke all on function public.sourcing_notify(uuid, text, text, text) from public, anon, authenticated;

-- ------------------------------------------------------ create (customer)
drop function if exists public.create_material_sourcing_request(
  public.material_category, text, numeric, text, double precision, double precision, date, text);

create or replace function public.create_material_sourcing_request(
  p_material         public.material_category,
  p_custom_material  text,
  p_quantity_m3      numeric,
  p_delivery_address text,
  p_delivery_lat     double precision default null,
  p_delivery_lng     double precision default null,
  p_preferred_date   date default null,
  p_notes            text default null,
  p_idempotency_key  text default null
) returns uuid
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  v_customer uuid := auth.uid();
  v_id uuid; v_existing public.material_sourcing_requests%rowtype;
  v_addr text := trim(p_delivery_address);
  v_custom text := nullif(trim(p_custom_material), '');
  v_notes text := nullif(trim(p_notes), '');
begin
  if v_customer is null then raise exception 'Authentication required'; end if;
  if not public.has_role(v_customer, 'customer') then
    raise exception 'Only customer accounts can submit sourcing requests';
  end if;
  if p_quantity_m3 is null or not (p_quantity_m3 > 0 and p_quantity_m3 <= 1000) then
    raise exception 'Quantity must be greater than zero and at most 1000 m3';
  end if;
  if v_addr is null or length(v_addr) = 0 or length(v_addr) > 500 then
    raise exception 'Enter a valid delivery address';
  end if;
  if (p_delivery_lat is null) <> (p_delivery_lng is null) then
    raise exception 'Provide both delivery coordinates or neither';
  end if;
  if p_delivery_lat is not null and (p_delivery_lat not between -90 and 90
                                     or p_delivery_lng not between -180 and 180) then
    raise exception 'Invalid delivery coordinates';
  end if;
  if p_material::text = 'custom' then
    if v_custom is null or length(v_custom) > 120 then raise exception 'Describe the custom material'; end if;
  elsif p_custom_material is not null then
    raise exception 'Custom material description is only allowed for custom requests';
  end if;
  if v_notes is not null and length(v_notes) > 2000 then raise exception 'Notes are too long'; end if;
  if p_idempotency_key is not null and length(p_idempotency_key) not between 8 and 128 then
    raise exception 'Invalid idempotency key';
  end if;

  -- serialise concurrent retries of the same logical request per customer
  perform pg_advisory_xact_lock(hashtext('sourcing:' || v_customer::text));

  -- 1. explicit idempotency key: same key + same payload => same request
  if p_idempotency_key is not null then
    select * into v_existing from public.material_sourcing_requests
     where customer_id = v_customer and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.material <> p_material or v_existing.quantity_m3 <> p_quantity_m3
         or v_existing.delivery_address <> v_addr then
        raise exception 'idempotency_key_reused_with_different_request' using errcode = '23505';
      end if;
      return v_existing.id;
    end if;
  end if;

  -- 2. no key (e.g. double-tap): an identical OPEN request in the last 24h is
  --    the same request, not a new one
  select * into v_existing from public.material_sourcing_requests
   where customer_id = v_customer and material = p_material
     and quantity_m3 = p_quantity_m3 and delivery_address = v_addr
     and delivery_lat is not distinct from p_delivery_lat
     and delivery_lng is not distinct from p_delivery_lng
     and status in ('requested', 'sourcing', 'quote_ready')
     and created_at > now() - interval '24 hours'
   order by created_at desc limit 1;
  if found then return v_existing.id; end if;

  -- 3. abuse limits
  if (select count(*) from public.material_sourcing_requests
       where customer_id = v_customer and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many sourcing requests. Please try again later.' using errcode = '54000';
  end if;
  if (select count(*) from public.material_sourcing_requests
       where customer_id = v_customer and status in ('requested', 'sourcing', 'quote_ready')) >= 20 then
    raise exception 'You have too many open sourcing requests.' using errcode = '54000';
  end if;

  insert into public.material_sourcing_requests (
    customer_id, material, custom_material, quantity_m3, delivery_address,
    delivery_lat, delivery_lng, preferred_date, notes, idempotency_key)
  values (v_customer, p_material, case when p_material::text = 'custom' then v_custom end,
          p_quantity_m3, v_addr, p_delivery_lat, p_delivery_lng, p_preferred_date,
          v_notes, p_idempotency_key)
  returning id into v_id;

  -- tell the sourcing team (existing notifications integration)
  perform public.sourcing_notify(ur.user_id, 'sourcing_request', 'New material sourcing request',
          p_quantity_m3::text || ' m3 ' || p_material::text || ' needs a supplier')
     from (select distinct user_id from public.user_roles
            where role in ('admin', 'super_admin')) ur;

  return v_id;
end $function$;

revoke all on function public.create_material_sourcing_request(
  public.material_category, text, numeric, text, double precision, double precision, date, text, text)
  from public, anon;
grant execute on function public.create_material_sourcing_request(
  public.material_category, text, numeric, text, double precision, double precision, date, text, text)
  to authenticated, service_role;

-- --------------------------------------------------------- admin helpers
create or replace function public.sourcing_require_admin(_uid uuid)
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if _uid is null or not (public.has_role(_uid, 'admin') or public.has_role(_uid, 'super_admin')) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
end $$;
revoke all on function public.sourcing_require_admin(uuid) from public, anon, authenticated;

create or replace function public.admin_list_sourcing_requests(p_status text default null, p_limit integer default 50)
returns setof public.material_sourcing_requests
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.sourcing_require_admin(auth.uid());
  return query
    select * from public.material_sourcing_requests
     where (p_status is null or status = p_status)
     order by created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

create or replace function public.admin_start_sourcing(p_request_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r public.material_sourcing_requests%rowtype;
begin
  perform public.sourcing_require_admin(auth.uid());
  select * into r from public.material_sourcing_requests where id = p_request_id for update;
  if not found then raise exception 'sourcing_request_not_found'; end if;
  perform set_config('conz.sourcing_note', coalesce(left(p_note, 500), ''), true);
  update public.material_sourcing_requests
     set status = 'sourcing', admin_notes = coalesce(left(p_note, 2000), admin_notes)
   where id = p_request_id;
  perform public.sourcing_notify(r.customer_id, 'sourcing_update', 'We are sourcing your material',
          'Our team is finding a verified supplier for your ' || r.material::text || ' request.');
end $$;

-- Service-role only: the server computes the OSRM road distance from the
-- supply location to the delivery pin, then calls this with the verified
-- admin's id. The price is produced by compute_material_offer; nothing the
-- admin or the client types is ever used as a price.
create or replace function public.issue_sourcing_quote(
  p_request_id uuid, p_admin_id uuid, p_supply_location_id uuid,
  p_distance_km numeric, p_distance_source text,
  p_valid_hours integer default 48, p_terms text default null, p_note text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  r public.material_sourcing_requests%rowtype; _guide jsonb; _quote uuid;
  _valid_until timestamptz; _supplier text; _loc text;
begin
  perform public.sourcing_require_admin(p_admin_id);
  select * into r from public.material_sourcing_requests where id = p_request_id for update;
  if not found then raise exception 'sourcing_request_not_found'; end if;
  if r.status not in ('requested', 'sourcing') then
    raise exception 'invalid_sourcing_transition: % -> quote_ready', r.status using errcode = '23514';
  end if;
  if r.material::text = 'custom' then
    raise exception 'custom_material_requires_manual_quote';
  end if;
  if r.delivery_lat is null or r.delivery_lng is null then
    raise exception 'delivery_coordinates_required';
  end if;
  if p_valid_hours is null or p_valid_hours not between 1 and 168 then
    raise exception 'invalid_quote_validity';
  end if;
  if p_terms is null or length(trim(p_terms)) = 0 or length(p_terms) > 1000 then
    raise exception 'terms_required';
  end if;

  -- strict supply-location + distance + quantity validation lives here
  _quote := public.create_price_quote_for(
    r.customer_id, r.material::text, r.quantity_m3, p_distance_km, p_distance_source, p_supply_location_id);

  _guide := public.compute_material_offer(r.material, r.quantity_m3, p_distance_km);
  if _guide is null or coalesce((_guide->>'requiresCustomQuote')::boolean, false)
     or (_guide->>'offer') is null or not public.is_valid_money((_guide->>'offer')::numeric, 1000000) then
    raise exception 'no_engine_price_available';
  end if;

  _valid_until := now() + make_interval(hours => p_valid_hours);
  update public.price_quotes set expires_at = _valid_until where id = _quote;

  select s.name, coalesce(msl.label, msl.address) into _supplier, _loc
    from public.material_supply_locations msl join public.suppliers s on s.id = msl.supplier_id
   where msl.id = p_supply_location_id;

  perform set_config('conz.sourcing_actor', p_admin_id::text, true);
  perform set_config('conz.sourcing_note', coalesce(left(p_note, 500), ''), true);
  if r.status = 'requested' then
    update public.material_sourcing_requests set status = 'sourcing' where id = p_request_id;
  end if;
  update public.material_sourcing_requests
     set status = 'quote_ready', quote_id = _quote, supply_location_id = p_supply_location_id,
         quote_valid_until = _valid_until, quoted_total = (_guide->>'offer')::numeric,
         terms = trim(p_terms), supplier_name = _supplier, supplier_location = _loc,
         admin_notes = coalesce(left(p_note, 2000), admin_notes)
   where id = p_request_id;

  perform public.sourcing_notify(r.customer_id, 'sourcing_quote_ready', 'Your quote is ready',
          'We found a verified supplier. Review and book before ' || to_char(_valid_until, 'YYYY-MM-DD HH24:MI') || ' UTC.');
  return _quote;
end $$;

create or replace function public.decline_sourcing_request(p_request_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare r public.material_sourcing_requests%rowtype; _uid uuid := auth.uid(); _admin boolean;
begin
  if _uid is null then raise exception 'Authentication required'; end if;
  select * into r from public.material_sourcing_requests where id = p_request_id for update;
  if not found then raise exception 'sourcing_request_not_found'; end if;
  _admin := public.has_role(_uid, 'admin') or public.has_role(_uid, 'super_admin');
  if not _admin and r.customer_id <> _uid then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  perform set_config('conz.sourcing_note', coalesce(left(p_reason, 500), ''), true);
  update public.material_sourcing_requests
     set status = 'declined', decline_reason = coalesce(left(p_reason, 500), case when _admin then 'declined_by_team' else 'cancelled_by_customer' end)
   where id = p_request_id;
  if _admin and r.customer_id <> _uid then
    perform public.sourcing_notify(r.customer_id, 'sourcing_update', 'Sourcing request closed',
            'We could not source this material right now. You are welcome to try again later.');
  end if;
end $$;

create or replace function public.my_sourcing_history(p_request_id uuid)
returns table (from_status text, to_status text, created_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select h.from_status, h.to_status, h.created_at
    from public.material_sourcing_status_history h
    join public.material_sourcing_requests r on r.id = h.request_id
   where h.request_id = p_request_id and r.customer_id = auth.uid()
   order by h.id;
$$;

create or replace function public.admin_sourcing_history(p_request_id uuid)
returns setof public.material_sourcing_status_history
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.sourcing_require_admin(auth.uid());
  return query select * from public.material_sourcing_status_history
                where request_id = p_request_id order by id;
end $$;

-- Marks requests/quotes that have lapsed. Service-role / cron only.
create or replace function public.expire_sourcing_requests()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  perform set_config('conz.sourcing_note', 'auto-expired', true);
  update public.material_sourcing_requests
     set status = 'expired'
   where (status = 'quote_ready' and quote_valid_until < now())
      or (status in ('requested', 'sourcing') and created_at < now() - interval '30 days');
  get diagnostics n = row_count;
  return n;
end $$;

-- ------------------------------------- conversion happens only via a job
create or replace function public.tg_sourcing_mark_converted()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.quote_id is null then return new; end if;
  perform set_config('conz.sourcing_note', 'customer booked with sourcing quote', true);
  update public.material_sourcing_requests
     set status = 'converted', converted_job_id = new.id
   where quote_id = new.quote_id and customer_id = new.customer_id
     and status = 'quote_ready' and quote_valid_until > now();
  return new;
end $$;
drop trigger if exists t_sourcing_mark_converted on public.jobs;
create trigger t_sourcing_mark_converted after insert on public.jobs
  for each row execute function public.tg_sourcing_mark_converted();

-- ------------------------------------------------------------------ grants
revoke all on function public.sourcing_transition_allowed(text, text) from public, anon, authenticated;
revoke all on function public.admin_list_sourcing_requests(text, integer) from public, anon;
revoke all on function public.admin_start_sourcing(uuid, text) from public, anon;
revoke all on function public.issue_sourcing_quote(uuid, uuid, uuid, numeric, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.decline_sourcing_request(uuid, text) from public, anon;
revoke all on function public.my_sourcing_history(uuid) from public, anon;
revoke all on function public.admin_sourcing_history(uuid) from public, anon;
revoke all on function public.expire_sourcing_requests() from public, anon, authenticated;
revoke all on function public.tg_sourcing_mark_converted() from public, anon, authenticated;
revoke all on function public.tg_sourcing_history_write() from public, anon, authenticated;
grant execute on function public.admin_list_sourcing_requests(text, integer) to authenticated;
grant execute on function public.admin_start_sourcing(uuid, text) to authenticated;
grant execute on function public.decline_sourcing_request(uuid, text) to authenticated;
grant execute on function public.my_sourcing_history(uuid) to authenticated;
grant execute on function public.admin_sourcing_history(uuid) to authenticated;
grant execute on function public.issue_sourcing_quote(uuid, uuid, uuid, numeric, text, integer, text, text) to service_role;
grant execute on function public.expire_sourcing_requests() to service_role;

-- Hourly expiry. Dynamic SQL so this still parses on databases without pg_cron.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$
      select cron.schedule('expire-sourcing-requests', '17 * * * *',
                           'select public.expire_sourcing_requests();')
       where not exists (select 1 from cron.job where jobname = 'expire-sourcing-requests')
    $q$;
  end if;
end $$;
