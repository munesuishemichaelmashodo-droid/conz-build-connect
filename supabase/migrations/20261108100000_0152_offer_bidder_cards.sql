-- 0152: safe bidder cards for the offers screen + declared truck facts (additive; no DROP).
--
-- Why: a customer who received an offer could read the bidding driver's whole profile row
-- (phone, email) and the whole truck row (full registration) through two table policies
-- ("Customers view bidders on own jobs", "Customers read trucks offered on their jobs").
-- The app only needs name, photo, last active and a few truck facts. This migration adds
-- a purpose-built function that returns exactly that, with the plate masked until the
-- customer has chosen the driver. The policies themselves are tightened in 0153, AFTER
-- the app that uses this function is deployed (otherwise the offers screen loses names).
--
-- Also adds nullable, self-declared truck facts (body type, make, model, colour). Changing
-- a fact that was already declared sends a verified driver back to review (same rule as a
-- registration or capacity change); filling one in for the first time does not.

alter table public.trucks add column if not exists body_type text
  check (body_type is null or body_type in ('tipper', 'dropside', 'flatbed', 'other'));
alter table public.trucks add column if not exists make text
  check (make is null or char_length(make) between 1 and 40);
alter table public.trucks add column if not exists model text
  check (model is null or char_length(model) between 1 and 40);
alter table public.trucks add column if not exists colour text
  check (colour is null or char_length(colour) between 1 and 30);

-- Re-review after a material truck change (0114 body + declared facts changed from a value).
create or replace function public.tg_truck_change_needs_review()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _uid uuid := auth.uid();
  _what text;
begin
  -- Service role, migrations and admins: no automatic re-review.
  if _uid is null then return new; end if;
  if public.has_role(_uid, 'admin'::public.app_role) or public.has_role(_uid, 'super_admin'::public.app_role) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.registration is not distinct from old.registration
       and new.capacity_m3 is not distinct from old.capacity_m3
       and new.photo_url is not distinct from old.photo_url
       and new.driver_id is not distinct from old.driver_id
       and not (old.body_type is not null and new.body_type is distinct from old.body_type)
       and not (old.make is not null and new.make is distinct from old.make)
       and not (old.model is not null and new.model is distinct from old.model)
       and not (old.colour is not null and new.colour is distinct from old.colour) then
      return new;
    end if;
    _what := 'Truck details changed';
  else
    _what := 'New truck added';
  end if;

  update public.driver_profiles
     set verification_status = 'pending',
         verification_notes = _what || ' (' || coalesce(new.registration, 'no registration')
                              || '). Con Z needs to check it before you can take more jobs.'
   where user_id = new.driver_id
     and verification_status = 'verified';

  if found then
    update public.bids set status = 'withdrawn'
     where driver_id = new.driver_id and status = 'pending';
    begin
      insert into public.notifications (user_id, type, title, body)
      select distinct ur.user_id, 'truck_review', 'Truck needs review',
             _what || ' (' || coalesce(new.registration, 'no registration') || '). The driver is back in review.'
        from public.user_roles ur where ur.role in ('admin', 'super_admin');
    exception when others then
      raise warning 'truck review alert failed: %', sqlerrm;  -- never block the save
    end;
  end if;
  return new;
end $$;
revoke all on function public.tg_truck_change_needs_review() from public, anon, authenticated;

-- The safe card. Caller must be the job's customer or an admin; anyone else gets no rows.
create or replace function public.offer_bidder_cards(_job uuid)
returns table (
  bid_id uuid,
  driver_id uuid,
  full_name text,
  avatar_url text,
  last_active_at timestamptz,
  body_type text,
  make text,
  model text,
  colour text,
  capacity_m3 numeric,
  plate_display text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id,
         b.driver_id,
         p.full_name,
         p.avatar_url,
         p.last_active_at,
         t.body_type,
         t.make,
         t.model,
         t.colour,
         t.capacity_m3,
         case
           when t.registration is null or btrim(t.registration) = '' then null
           when j.driver_id = b.driver_id and j.status in ('accepted', 'in_progress', 'completed') then t.registration
           when char_length(regexp_replace(t.registration, '\s', '', 'g')) <= 3 then '••••'
           else left(regexp_replace(t.registration, '\s', '', 'g'), 3) || ' ••••'
         end
    from public.bids b
    join public.jobs j on j.id = b.job_id
    join public.profiles p on p.id = b.driver_id
    left join public.trucks t on t.id = b.truck_id
   where b.job_id = _job
     and auth.uid() is not null
     and (j.customer_id = auth.uid()
          or public.has_role(auth.uid(), 'admin'::public.app_role)
          or public.has_role(auth.uid(), 'super_admin'::public.app_role))
$$;
revoke all on function public.offer_bidder_cards(uuid) from public, anon;
grant execute on function public.offer_bidder_cards(uuid) to authenticated;
