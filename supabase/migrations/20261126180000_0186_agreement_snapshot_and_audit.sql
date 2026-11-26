-- -----------------------------------------------------------------------------
-- 0186: job agreements become a complete, tamper-evident record (trust Stage 1).
--
-- Builds on 0157 (versioned agreement), 0162/0163 (deposit set by the driver) and 0179 (payment terms).
--
--   * Each new version records what the job WAS when it was proposed, copied by the database from the job,
--     the accepted offer and its truck (never typed by the user): customer, driver, truck (registration and
--     capacity), material and quantity, collection and delivery places, preferred date, plus who loads and
--     who offloads, collection instructions and the agreed date. A content hash is stored with it.
--   * A version can never be edited or deleted. Only its status moves forward (proposed -> accepted /
--     declined / superseded; accepted -> superseded) and each side's acceptance time is set once.
--     That holds for admins and SECURITY DEFINER functions too.
--   * Accepting a version is refused if the job's material, quantity, places, date, fare, driver or truck
--     changed after it was proposed: a new version must be proposed, which the other side must accept.
--     When a newer version is accepted, the older accepted one is marked superseded (kept).
--   * job_agreement_events: append-only audit of every proposal, acceptance, decline and supersede, and of any
--     change to an assigned job's agreed details (field names only), with who did it and when.
--   * job_agreement_in_force(_job): the version in force and the fields of the job that differ from it now.
--   * propose_job_agreement_full(): 0179's proposal plus loading/offloading, collection instructions and agreed
--     date. propose_job_agreement_terms() keeps working (it carries those fields over from the version in force).
-- Existing versions are not touched (their snapshot columns stay empty: "recorded before 0186").
-- No DROP, no DELETE, no money. Undo: supabase/rollbacks/20261126180000_0186_rollback.sql.
-- -----------------------------------------------------------------------------

-- 1. Snapshot columns -----------------------------------------------------------------------------------------
alter table public.job_agreements
  add column if not exists customer_id uuid references auth.users(id),
  add column if not exists driver_id uuid references auth.users(id),
  add column if not exists truck_id uuid,
  add column if not exists truck_registration text,
  add column if not exists truck_capacity_m3 numeric(8,2),
  add column if not exists material text,
  add column if not exists quantity_m3 numeric(10,2),
  add column if not exists pickup_address text,
  add column if not exists pickup_lat double precision,
  add column if not exists pickup_lng double precision,
  add column if not exists delivery_address text,
  add column if not exists delivery_lat double precision,
  add column if not exists delivery_lng double precision,
  add column if not exists preferred_date date,
  add column if not exists agreed_date date,
  add column if not exists loading_by text
    check (loading_by is null or loading_by in ('driver', 'customer', 'collection_point', 'not_needed')),
  add column if not exists offloading_by text
    check (offloading_by is null or offloading_by in ('driver_tips', 'driver', 'customer', 'not_needed')),
  add column if not exists collection_instructions text
    check (collection_instructions is null or (char_length(collection_instructions) <= 500)),
  add column if not exists content_hash text;

-- What a version must match on the job to stay valid. One place, used by the snapshot, accept and the in-force view.
create or replace function public.job_agreement_job_facts(_job uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'customer_id', j.customer_id,
    'driver_id', j.driver_id,
    'truck_id', b.truck_id,
    'truck_registration', t.registration,
    'truck_capacity_m3', t.capacity_m3,
    'material', coalesce(nullif(btrim(j.custom_material), ''), j.material::text),
    'quantity_m3', j.quantity_m3,
    'pickup_address', j.pickup_address,
    'pickup_lat', j.pickup_lat,
    'pickup_lng', j.pickup_lng,
    'delivery_address', j.delivery_address,
    'delivery_lat', j.delivery_lat,
    'delivery_lng', j.delivery_lng,
    'preferred_date', j.preferred_date,
    'fare', coalesce(j.final_price, j.budget))
  from public.jobs j
  left join public.bids b on b.id = j.accepted_bid_id
  left join public.trucks t on t.id = b.truck_id
  where j.id = _job
$$;
revoke all on function public.job_agreement_job_facts(uuid) from public, anon, authenticated;

create or replace function public.job_agreement_row_facts(_a public.job_agreements)
returns jsonb language sql immutable set search_path to 'public' as $$
  select jsonb_build_object(
    'customer_id', _a.customer_id, 'driver_id', _a.driver_id, 'truck_id', _a.truck_id,
    'truck_registration', _a.truck_registration, 'truck_capacity_m3', _a.truck_capacity_m3,
    'material', _a.material, 'quantity_m3', _a.quantity_m3,
    'pickup_address', _a.pickup_address, 'pickup_lat', _a.pickup_lat, 'pickup_lng', _a.pickup_lng,
    'delivery_address', _a.delivery_address, 'delivery_lat', _a.delivery_lat, 'delivery_lng', _a.delivery_lng,
    'preferred_date', _a.preferred_date, 'fare', _a.fare)
$$;
revoke all on function public.job_agreement_row_facts(public.job_agreements) from public, anon, authenticated;

-- Field names whose values differ (numbers compared as numbers).
create or replace function public.job_agreement_changed_fields(_then jsonb, _now jsonb)
returns text[] language sql immutable set search_path to 'public' as $$
  select coalesce(array_agg(k order by k), '{}')
    from jsonb_object_keys(_now) k
   where case when jsonb_typeof(_now->k) = 'number' and jsonb_typeof(_then->k) = 'number'
              then (_now->>k)::numeric is distinct from (_then->>k)::numeric
              else (_now->k) is distinct from (_then->k) end
$$;
revoke all on function public.job_agreement_changed_fields(jsonb, jsonb) from public, anon, authenticated;

-- 2. Fill the snapshot on insert (the database, not the user) ------------------------------------------------
create or replace function public.tg_job_agreement_snapshot()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _f jsonb := public.job_agreement_job_facts(new.job_id);
begin
  new.customer_id := (_f->>'customer_id')::uuid;
  new.driver_id := (_f->>'driver_id')::uuid;
  new.truck_id := (_f->>'truck_id')::uuid;
  new.truck_registration := _f->>'truck_registration';
  new.truck_capacity_m3 := (_f->>'truck_capacity_m3')::numeric;
  new.material := _f->>'material';
  new.quantity_m3 := (_f->>'quantity_m3')::numeric;
  new.pickup_address := _f->>'pickup_address';
  new.pickup_lat := (_f->>'pickup_lat')::double precision;
  new.pickup_lng := (_f->>'pickup_lng')::double precision;
  new.delivery_address := _f->>'delivery_address';
  new.delivery_lat := (_f->>'delivery_lat')::double precision;
  new.delivery_lng := (_f->>'delivery_lng')::double precision;
  new.preferred_date := (_f->>'preferred_date')::date;
  new.created_at := now();
  new.content_hash := md5((to_jsonb(new) - 'status' - 'customer_accepted_at' - 'driver_accepted_at' - 'content_hash')::text);
  return new;
end $$;
revoke all on function public.tg_job_agreement_snapshot() from public, anon, authenticated;
create or replace trigger trg_job_agreement_snapshot
  before insert on public.job_agreements
  for each row execute function public.tg_job_agreement_snapshot();

-- 3. Nothing is ever rewritten or removed ---------------------------------------------------------------------
create or replace function public.tg_job_agreement_immutable()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('conz.allow_agreement_purge', true), '') = 'on' then return old; end if;
    raise exception 'Agreement versions are kept as a record and cannot be deleted.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - 'status' - 'customer_accepted_at' - 'driver_accepted_at')
     is distinct from (to_jsonb(old) - 'status' - 'customer_accepted_at' - 'driver_accepted_at') then
    raise exception 'An agreement version cannot be changed. Propose a new version instead.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'proposed' and new.status in ('accepted', 'declined', 'superseded'))
    or (old.status = 'accepted' and new.status = 'superseded')) then
    raise exception 'Agreement status cannot go from % to %.', old.status, new.status using errcode = '42501';
  end if;
  if (old.customer_accepted_at is not null and new.customer_accepted_at is distinct from old.customer_accepted_at)
     or (old.driver_accepted_at is not null and new.driver_accepted_at is distinct from old.driver_accepted_at) then
    raise exception 'An acceptance cannot be changed or withdrawn.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.tg_job_agreement_immutable() from public, anon, authenticated;
create or replace trigger trg_job_agreement_immutable
  before update or delete on public.job_agreements
  for each row execute function public.tg_job_agreement_immutable();

-- 4. Audit trail ----------------------------------------------------------------------------------------------
create table if not exists public.job_agreement_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id),
  agreement_id uuid references public.job_agreements(id),
  version integer,
  actor uuid,
  actor_role text not null check (actor_role in ('customer', 'driver', 'admin', 'system')),
  action text not null check (action in ('proposed', 'accepted', 'declined', 'superseded', 'job_details_changed')),
  changed_fields text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists job_agreement_events_job_idx on public.job_agreement_events (job_id, created_at);
alter table public.job_agreement_events enable row level security;
revoke all on public.job_agreement_events from public, anon, authenticated;
grant select on public.job_agreement_events to authenticated;
grant select, insert on public.job_agreement_events to service_role;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'job_agreement_events'
                  and policyname = 'Participants and admins read agreement events') then
    create policy "Participants and admins read agreement events" on public.job_agreement_events
      for select to authenticated
      using (exists (select 1 from public.jobs j where j.id = job_agreement_events.job_id
                       and coalesce(auth.uid() in (j.customer_id, j.driver_id), false))
             or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
  end if;
end $$;

create or replace function public.tg_job_agreement_events_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'The agreement history cannot be changed.' using errcode = '42501';
end $$;
revoke all on function public.tg_job_agreement_events_append_only() from public, anon, authenticated;
create or replace trigger trg_job_agreement_events_append_only
  before update or delete on public.job_agreement_events
  for each row execute function public.tg_job_agreement_events_append_only();

create or replace function public.job_agreement_actor_role(_job uuid, _uid uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select case
    when _uid is null then 'system'
    when exists (select 1 from public.jobs j where j.id = _job and j.customer_id = _uid) then 'customer'
    when exists (select 1 from public.jobs j where j.id = _job and j.driver_id = _uid) then 'driver'
    when public.has_role(_uid, 'admin') or public.has_role(_uid, 'super_admin') then 'admin'
    else 'system' end
$$;
revoke all on function public.job_agreement_actor_role(uuid, uuid) from public, anon, authenticated;

create or replace function public.tg_job_agreement_log()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _action text;
begin
  if tg_op = 'INSERT' then _action := 'proposed';
  elsif new.status is distinct from old.status then _action := new.status;
  else return null;
  end if;
  insert into public.job_agreement_events (job_id, agreement_id, version, actor, actor_role, action)
  values (new.job_id, new.id, new.version, auth.uid(), public.job_agreement_actor_role(new.job_id, auth.uid()), _action);
  return null;
end $$;
revoke all on function public.tg_job_agreement_log() from public, anon, authenticated;
create or replace trigger trg_job_agreement_log
  after insert or update of status on public.job_agreements
  for each row execute function public.tg_job_agreement_log();

-- A change to an assigned job's agreed details is recorded against the version in force.
create or replace function public.tg_job_agreed_details_changed()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  _a public.job_agreements;
  _changed text[];
begin
  if new.status not in ('accepted', 'in_progress') then return null; end if;
  select * into _a from public.job_agreements
   where job_id = new.id and status = 'accepted' and content_hash is not null
   order by version desc limit 1;
  if _a.id is null then return null; end if;
  _changed := public.job_agreement_changed_fields(public.job_agreement_row_facts(_a), public.job_agreement_job_facts(new.id));
  if cardinality(_changed) = 0 then return null; end if;
  -- one entry per distinct change
  if exists (select 1 from public.job_agreement_events e
              where e.agreement_id = _a.id and e.action = 'job_details_changed' and e.changed_fields = _changed) then
    return null;
  end if;
  insert into public.job_agreement_events (job_id, agreement_id, version, actor, actor_role, action, changed_fields)
  values (new.id, _a.id, _a.version, auth.uid(), public.job_agreement_actor_role(new.id, auth.uid()), 'job_details_changed', _changed);
  begin
    insert into public.notifications (user_id, type, title, body, job_id)
    select u, 'job_agreement', 'Job details changed after you agreed',
           'Some details of this delivery changed after you both agreed. Open the job and confirm the agreement again.', new.id
      from unnest(array[new.customer_id, new.driver_id]) u
     where u is not null and u is distinct from auth.uid();
  exception when others then
    raise warning 'agreement change notice failed: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.tg_job_agreed_details_changed() from public, anon, authenticated;
create or replace trigger trg_job_agreed_details_changed
  after update of material, custom_material, quantity_m3, pickup_address, pickup_lat, pickup_lng,
                  delivery_address, delivery_lat, delivery_lng, preferred_date, final_price, budget,
                  driver_id, accepted_bid_id on public.jobs
  for each row execute function public.tg_job_agreed_details_changed();

-- 5. Accept: only a version that still matches the job; older accepted versions are superseded -------------------
create or replace function public.accept_job_agreement(_agreement uuid)
returns public.job_agreements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _a public.job_agreements;
  _j public.jobs;
  _changed text[];
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _a from public.job_agreements where id = _agreement for update;
  if not found then raise exception 'Agreement not found'; end if;
  select * into _j from public.jobs where id = _a.job_id for update;
  if not coalesce(auth.uid() in (_j.customer_id, _j.driver_id), false) then
    raise exception 'Only the customer or the driver of this job can do that' using errcode = '42501';
  end if;
  if _a.status <> 'proposed' then raise exception 'This version is no longer open'; end if;
  if _j.status not in ('accepted', 'in_progress') then raise exception 'The job is no longer open for changes'; end if;
  if auth.uid() = _a.proposed_by then raise exception 'The other person has to confirm your proposal'; end if;
  if _a.content_hash is not null then
    _changed := public.job_agreement_changed_fields(public.job_agreement_row_facts(_a), public.job_agreement_job_facts(_j.id));
    if cardinality(_changed) > 0 then
      raise exception 'The job changed after this version was proposed (%). Propose a new version so you both confirm the same details.',
        array_to_string(_changed, ', ') using errcode = '22023';
    end if;
  end if;

  update public.job_agreements set status = 'superseded'
   where job_id = _a.job_id and status = 'accepted' and version < _a.version;
  update public.job_agreements
     set customer_accepted_at = case when auth.uid() = _j.customer_id then coalesce(customer_accepted_at, now()) else customer_accepted_at end,
         driver_accepted_at   = case when auth.uid() = _j.driver_id   then coalesce(driver_accepted_at, now())   else driver_accepted_at end,
         status = 'accepted'
   where id = _agreement
   returning * into _a;
  return _a;
end $$;
revoke all on function public.accept_job_agreement(uuid) from public, anon;
grant execute on function public.accept_job_agreement(uuid) to authenticated;

-- 6. Propose with handling details -------------------------------------------------------------------------------
create or replace function public.propose_job_agreement_full(
  _job uuid,
  _payment_method text,
  _payment_timing text,
  _deposit_amount numeric default 0,
  _deposit_due text default null,
  _deposit_reason text default null,
  _recipient_name text default null,
  _recipient_account text default null,
  _payment_instructions text default null,
  _cancellation_terms text default null,
  _pickup_window text default null,
  _delivery_window text default null,
  _inclusions text default null,
  _exclusions text default null,
  _loading_by text default null,
  _offloading_by text default null,
  _collection_instructions text default null,
  _agreed_date date default null
) returns public.job_agreements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _j public.jobs;
  _fare numeric;
  _next integer;
  _row public.job_agreements;
  _in_force public.job_agreements;
  _other uuid;
  _is_customer boolean;
  _dep numeric := round(coalesce(_deposit_amount, 0), 2);
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _j from public.jobs where id = _job for update;
  if not found then raise exception 'Job not found'; end if;
  if not coalesce(auth.uid() in (_j.customer_id, _j.driver_id), false) then
    raise exception 'Only the customer or the driver of this job can do that' using errcode = '42501';
  end if;
  if _j.status not in ('accepted', 'in_progress') then raise exception 'The agreement can only be set while the job is assigned and not yet finished'; end if;
  _fare := coalesce(_j.final_price, _j.budget);
  if not public.is_valid_money(_fare) then raise exception 'This job has no valid agreed price'; end if;
  if _payment_method is null or _payment_method not in ('cash', 'ecocash', 'onemoney', 'innbucks', 'zipit', 'bank_transfer', 'other') then
    raise exception 'Choose a payment method';
  end if;
  if _payment_timing is null or _payment_timing not in ('on_delivery', 'on_pickup', 'before_pickup', 'other') then
    raise exception 'Choose when the payment is due';
  end if;
  if _loading_by is not null and _loading_by not in ('driver', 'customer', 'collection_point', 'not_needed') then
    raise exception 'Choose who loads the truck';
  end if;
  if _offloading_by is not null and _offloading_by not in ('driver_tips', 'driver', 'customer', 'not_needed') then
    raise exception 'Choose who offloads';
  end if;
  if _agreed_date is not null and (_agreed_date < current_date - 1 or _agreed_date > current_date + 365) then
    raise exception 'Choose a delivery date within the next year';
  end if;
  _is_customer := auth.uid() = _j.customer_id;

  select * into _in_force from public.job_agreements
   where job_id = _job and status in ('proposed', 'accepted') order by version desc limit 1;

  if _is_customer then
    -- Deposit, its timing and reason, and where the driver is paid are the driver's to set (0162/0163/0179).
    if _dep <> coalesce(_in_force.deposit_amount, 0) then
      raise exception 'Only the driver can propose or change a deposit';
    end if;
    _deposit_due := _in_force.deposit_due;
    _deposit_reason := _in_force.deposit_reason;
    _recipient_name := _in_force.recipient_name;
    _recipient_account := _in_force.recipient_account;
    _payment_instructions := _in_force.payment_instructions;
  end if;

  if _dep < 0 or _dep > _fare then raise exception 'The deposit cannot be more than the fare'; end if;
  if _dep > 0 and (_deposit_due is null or _deposit_due not in ('on_agreement', 'before_pickup', 'on_pickup')) then
    raise exception 'Say when the deposit is due';
  end if;
  if _dep = 0 then _deposit_due := null; _deposit_reason := null; end if;

  select coalesce(max(version), 0) + 1 into _next from public.job_agreements where job_id = _job;
  update public.job_agreements set status = 'superseded' where job_id = _job and status = 'proposed';

  insert into public.job_agreements (job_id, version, proposed_by, fare, payment_method, payment_channel, payment_timing, deposit_amount,
                                     deposit_due, deposit_reason, recipient_name, recipient_account, payment_instructions,
                                     cancellation_terms, pickup_window, delivery_window, inclusions, exclusions,
                                     loading_by, offloading_by, collection_instructions, agreed_date,
                                     customer_accepted_at, driver_accepted_at)
  values (_job, _next, auth.uid(), _fare,
          case when _payment_method in ('cash', 'ecocash', 'bank_transfer') then _payment_method else 'other' end,
          _payment_method, _payment_timing, _dep,
          _deposit_due, nullif(btrim(_deposit_reason), ''), nullif(btrim(_recipient_name), ''),
          nullif(btrim(_recipient_account), ''), nullif(btrim(_payment_instructions), ''),
          nullif(btrim(_cancellation_terms), ''),
          nullif(btrim(_pickup_window), ''), nullif(btrim(_delivery_window), ''),
          nullif(btrim(_inclusions), ''), nullif(btrim(_exclusions), ''),
          _loading_by, _offloading_by, nullif(btrim(_collection_instructions), ''), _agreed_date,
          case when _is_customer then now() end,
          case when not _is_customer then now() end)
  returning * into _row;

  _other := case when _is_customer then _j.driver_id else _j.customer_id end;
  begin
    insert into public.notifications (user_id, type, title, body, job_id)
    values (_other, 'job_agreement', 'Agreement to confirm',
            'The other person set out the price, payment, handling and timing for this delivery. Open the job to confirm or change it.', _job);
  exception when others then
    raise warning 'agreement notice failed: %', sqlerrm;
  end;
  return _row;
end $$;
revoke all on function public.propose_job_agreement_full(uuid, text, text, numeric, text, text, text, text, text, text, text, text, text, text, text, text, text, date) from public, anon;
grant execute on function public.propose_job_agreement_full(uuid, text, text, numeric, text, text, text, text, text, text, text, text, text, text, text, text, text, date) to authenticated;

-- The 0179 entry point keeps working and carries the handling details over from the version in force.
create or replace function public.propose_job_agreement_terms(
  _job uuid,
  _payment_method text,
  _payment_timing text,
  _deposit_amount numeric default 0,
  _deposit_due text default null,
  _deposit_reason text default null,
  _recipient_name text default null,
  _recipient_account text default null,
  _payment_instructions text default null,
  _cancellation_terms text default null,
  _pickup_window text default null,
  _delivery_window text default null,
  _inclusions text default null,
  _exclusions text default null
) returns public.job_agreements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare _in_force public.job_agreements;
begin
  select * into _in_force from public.job_agreements
   where job_id = _job and status in ('proposed', 'accepted') order by version desc limit 1;
  return public.propose_job_agreement_full(_job, _payment_method, _payment_timing, _deposit_amount, _deposit_due, _deposit_reason,
    _recipient_name, _recipient_account, _payment_instructions, _cancellation_terms, _pickup_window, _delivery_window,
    _inclusions, _exclusions, _in_force.loading_by, _in_force.offloading_by, _in_force.collection_instructions, _in_force.agreed_date);
end $$;
revoke all on function public.propose_job_agreement_terms(uuid, text, text, numeric, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.propose_job_agreement_terms(uuid, text, text, numeric, text, text, text, text, text, text, text, text, text, text) to authenticated;

-- 7. The version in force and what changed since --------------------------------------------------------------
create or replace function public.job_agreement_in_force(_job uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  _j public.jobs;
  _a public.job_agreements;
begin
  select * into _j from public.jobs where id = _job;
  if not found then raise exception 'Job not found'; end if;
  if not (coalesce(auth.uid() in (_j.customer_id, _j.driver_id), false)
          or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  select * into _a from public.job_agreements
   where job_id = _job and status = 'accepted' order by version desc limit 1;
  if _a.id is null then return jsonb_build_object('agreement_id', null); end if;
  return jsonb_build_object(
    'agreement_id', _a.id,
    'version', _a.version,
    'recorded_details', _a.content_hash is not null,
    'changed_since_agreed', case when _a.content_hash is null then '[]'::jsonb else to_jsonb(
      public.job_agreement_changed_fields(public.job_agreement_row_facts(_a), public.job_agreement_job_facts(_job))) end);
end $$;
revoke all on function public.job_agreement_in_force(uuid) from public, anon;
grant execute on function public.job_agreement_in_force(uuid) to authenticated;
