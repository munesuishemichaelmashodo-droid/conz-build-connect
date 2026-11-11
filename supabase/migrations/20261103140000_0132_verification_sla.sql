-- -----------------------------------------------------------------------------
-- 0132: driver verification service level (24 business hours, Africa/Harare).
--
--   * verification_events: append-only timeline (submitted, resubmitted, approved, rejected,
--     overdue_alerted). Original timestamps are never changed.
--   * business_holidays: configurable Zimbabwe public holidays (starts EMPTY on purpose; a super
--     admin adds the dates; no incomplete list is hard-coded).
--   * business_hours_elapsed(from, to): elapsed hours excluding Saturdays, Sundays and holidays.
--   * Clock rule: it starts at 'submitted' / 'resubmitted' and stops at the decision. A driver whose
--     documents were sent back ('rejected') is not in the queue, so the clock is paused until they resubmit.
--   * admin_verification_queue(): pending drivers with business hours waiting and an overdue flag.
--   * Overdue = ADMIN ALERT ONLY (one notification per submission). Nothing is approved, rejected or
--     suspended automatically.
--   * Admins are notified when a driver submits or resubmits. Decision notices to the driver already
--     exist (admin_set_driver_verification).
-- Target (hours) is system_settings 'verification_sla_hours', default 24. No DROP.
-- Undo: supabase/rollbacks/20261103140000_0132_rollback.sql
-- -----------------------------------------------------------------------------

begin;

create table if not exists public.business_holidays (
  holiday date primary key,
  name text not null check (length(btrim(name)) >= 2),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.verification_events (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users (id),
  event text not null check (event in ('submitted', 'resubmitted', 'approved', 'rejected', 'overdue_alerted')),
  at timestamptz not null default now()
);
create index if not exists verification_events_driver_idx on public.verification_events (driver_id, at desc);

drop trigger if exists trg_verification_events_immutable on public.verification_events;
create trigger trg_verification_events_immutable
  before update or delete on public.verification_events
  for each row execute function public.append_only_guard();

alter table public.business_holidays enable row level security;
alter table public.verification_events enable row level security;
revoke all on public.business_holidays from public, anon, authenticated;
revoke all on public.verification_events from public, anon, authenticated;
grant select on public.business_holidays to authenticated;
grant select on public.verification_events to authenticated;

drop policy if exists "Everyone signed in reads holidays" on public.business_holidays;
create policy "Everyone signed in reads holidays" on public.business_holidays for select to authenticated using (true);
drop policy if exists "Admins read verification events" on public.verification_events;
create policy "Admins read verification events" on public.verification_events for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));
drop policy if exists "Drivers read own verification events" on public.verification_events;
create policy "Drivers read own verification events" on public.verification_events for select to authenticated
  using (driver_id = auth.uid());

insert into public.system_settings (key, value) values ('verification_sla_hours', '24'::jsonb)
on conflict (key) do nothing;

-- Elapsed hours between two instants, leaving out Saturdays, Sundays and configured holidays (Harare days).
create or replace function public.business_hours_elapsed(_from timestamptz, _to timestamptz)
returns numeric
language sql
stable
set search_path to 'public'
as $$
  select coalesce(sum(extract(epoch from (
           least(_to, ((d + 1)::timestamp at time zone 'Africa/Harare'))
         - greatest(_from, (d::timestamp at time zone 'Africa/Harare'))
         )) / 3600.0), 0)::numeric
    from generate_series((_from at time zone 'Africa/Harare')::date, (_to at time zone 'Africa/Harare')::date, interval '1 day') g(dt)
   cross join lateral (select g.dt::date as d) x
   where _to > _from
     and extract(isodow from d) < 6
     and not exists (select 1 from public.business_holidays h where h.holiday = d);
$$;

-- Timeline from status changes (server side, idempotent: one row per real transition).
create or replace function public.tg_driver_verification_events()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare _ev text;
begin
  if tg_op = 'INSERT' then
    if new.verification_status = 'pending' then _ev := 'submitted'; end if;
  elsif new.verification_status is distinct from old.verification_status then
    _ev := case new.verification_status::text
             when 'pending' then case when exists (select 1 from public.verification_events e where e.driver_id = new.user_id)
                                      then 'resubmitted' else 'submitted' end
             when 'verified' then 'approved'
             when 'rejected' then 'rejected'
           end;
  end if;
  if _ev is not null then
    insert into public.verification_events (driver_id, event) values (new.user_id, _ev);
    if _ev in ('submitted', 'resubmitted') then
      begin
        insert into public.notifications (user_id, type, title, body)
        select distinct ur.user_id, 'verification_submitted',
               case when _ev = 'submitted' then 'Driver awaiting verification' else 'Driver resubmitted documents' end,
               'Decision target: 24 business hours. Open Admin > Verify.'
          from public.user_roles ur where ur.role in ('admin', 'super_admin');
      exception when others then
        raise warning 'verification notice failed: %', sqlerrm;  -- never block the driver's save
      end;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.tg_driver_verification_events() from public, anon, authenticated;

drop trigger if exists trg_driver_verification_events on public.driver_profiles;
create trigger trg_driver_verification_events
  after insert or update of verification_status on public.driver_profiles
  for each row execute function public.tg_driver_verification_events();

-- Admin queue with business hours waiting.
create or replace function public.admin_verification_queue()
returns table (driver_id uuid, full_name text, waiting_since timestamptz, business_hours numeric, overdue boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare _sla numeric;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  select coalesce((value #>> '{}')::numeric, 24) into _sla from public.system_settings where key = 'verification_sla_hours';
  _sla := coalesce(_sla, 24);
  return query
    select dp.user_id, p.full_name,
           s.since,
           round(public.business_hours_elapsed(s.since, now()), 1),
           public.business_hours_elapsed(s.since, now()) >= _sla
      from public.driver_profiles dp
      join public.profiles p on p.id = dp.user_id
      cross join lateral (
        select coalesce((select max(e.at) from public.verification_events e
                          where e.driver_id = dp.user_id and e.event in ('submitted', 'resubmitted')), dp.created_at) as since) s
     where dp.verification_status = 'pending'
     order by s.since;
end $$;
revoke all on function public.admin_verification_queue() from public, anon;
grant execute on function public.admin_verification_queue() to authenticated;

-- Server job: one admin alert per overdue submission. Never changes a driver's status.
create or replace function public.flag_overdue_verifications()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare _sla numeric; r record; _n integer := 0;
begin
  select coalesce((value #>> '{}')::numeric, 24) into _sla from public.system_settings where key = 'verification_sla_hours';
  _sla := coalesce(_sla, 24);
  for r in
    select dp.user_id,
           coalesce((select max(e.at) from public.verification_events e
                      where e.driver_id = dp.user_id and e.event in ('submitted', 'resubmitted')), dp.created_at) as since
      from public.driver_profiles dp where dp.verification_status = 'pending'
  loop
    continue when public.business_hours_elapsed(r.since, now()) < _sla;
    continue when exists (select 1 from public.verification_events e
                           where e.driver_id = r.user_id and e.event = 'overdue_alerted' and e.at >= r.since);
    insert into public.verification_events (driver_id, event) values (r.user_id, 'overdue_alerted');
    insert into public.notifications (user_id, type, title, body)
    select distinct ur.user_id, 'verification_overdue', 'Driver verification is overdue',
           'A driver has waited over ' || _sla::text || ' business hours. Open Admin > Verify.'
      from public.user_roles ur where ur.role in ('admin', 'super_admin');
    _n := _n + 1;
  end loop;
  return _n;
end $$;
revoke all on function public.flag_overdue_verifications() from public, anon, authenticated;
grant execute on function public.flag_overdue_verifications() to service_role;

-- Holidays: super admin + step-up + reason + audit.
create or replace function public.admin_set_business_holiday(_date date, _name text, _remove boolean, _reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can change holidays.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _date is null then raise exception 'Choose a date.' using errcode = '22023'; end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = '22023';
  end if;
  if coalesce(_remove, false) then
    delete from public.business_holidays where holiday = _date;
  else
    insert into public.business_holidays (holiday, name, created_by) values (_date, btrim(coalesce(_name, '')), auth.uid())
    on conflict (holiday) do update set name = excluded.name;
  end if;
  perform public.log_admin_action(_action => 'business_holiday_changed',
    _meta => jsonb_build_object('date', _date, 'name', _name, 'removed', coalesce(_remove, false)), _reason => btrim(_reason));
end $$;
revoke all on function public.admin_set_business_holiday(date, text, boolean, text) from public, anon;
grant execute on function public.admin_set_business_holiday(date, text, boolean, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$
      select cron.schedule('flag-overdue-verifications', '*/30 * * * *', 'select public.flag_overdue_verifications();')
       where not exists (select 1 from cron.job where jobname = 'flag-overdue-verifications')
    $q$;
  end if;
end $$;

commit;
