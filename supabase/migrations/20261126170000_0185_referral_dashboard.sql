-- -----------------------------------------------------------------------------
-- 0185: referral dashboard, recognition that can be withdrawn, share tracking and admin metrics.
-- Builds on 0181 (referrals carry no money). Apply 0181 first.
--
--   * Milestones (1/5/10/25/50 recognised referrals), kept SEPARATELY for the customer programme (people who invite
--     customers) and the driver programme (people who invite drivers), follow the referrals they rest on. When a recognised
--     referral is later rejected (fraud established), any milestone the person no longer reaches is marked
--     revoked (revoked_at, revoked_reason); it is never deleted. If they reach it again, it is reinstated.
--     A trigger keeps this in step for every path (scheduled run, admin early recognition, admin correction).
--   * record_referral: a code can only be claimed by a new account (created in the last 14 days, no
--     completed job as customer or driver), so an existing user cannot be "attributed" after the fact.
--     Two claims at the same moment end in one row (referred_id is UNIQUE) and a clear message.
--   * my_referral_progress(): the caller's own invitations, with progress only: role, month joined, stage,
--     steps done/needed. No names, phone numbers, e-mail addresses, ids or fraud details of the invited person.
--   * referral_share_events + record_referral_share(): counts shares (WhatsApp, share sheet, copy). Written only
--     by the function, at most 30 per person per day; readable by the person and admins.
--   * admin_referral_metrics(): admins only. Shares, attributed sign-ups, customer first deliveries, driver
--     verification and five-job qualification, repeat bookings, 30/60/90-day activity (with sample sizes),
--     rejected/frozen/flagged referrals, partner-benefit cost (none approved), and demand by area. Areas with
--     fewer than 5 jobs are grouped as "Other areas".
-- Existing milestone rows are not touched by this file (production has none); the trigger acts on the next change.
-- No DROP, no DELETE, no money, no settings written. Recovery (forward-safe): supabase/rollbacks/20261126170000_0185_rollback.sql.
-- -----------------------------------------------------------------------------

-- 1. Milestones per programme, revocable, never deleted --------------------------------------------------
-- Owner rule 28/11/2026: customer referrals (inviting customers) and driver referrals (inviting drivers) keep
-- separate progress and milestones. The old referral_milestones_achieved table (key: person + milestone, so one
-- shared count) stays as locked history (production: 0 rows); milestones are now kept here.
create table if not exists public.referral_programme_milestones (
  user_id uuid not null references auth.users(id) on delete cascade,
  programme text not null check (programme in ('customer', 'driver')),
  milestone integer not null check (milestone > 0),
  achieved_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  primary key (user_id, programme, milestone)
);
alter table public.referral_programme_milestones enable row level security;
revoke all on public.referral_programme_milestones from public, anon, authenticated;
grant select on public.referral_programme_milestones to authenticated;
grant all on public.referral_programme_milestones to service_role;
create policy "Own or admin read programme milestones" on public.referral_programme_milestones
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
revoke insert, update, delete, truncate on public.referral_milestones_achieved from anon, authenticated;
revoke select on public.referral_milestones_achieved from anon;

create or replace function public.sync_referral_milestones(_user uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  _prog text;
  _label text;
  _count int;
  _m int;
  _row public.referral_programme_milestones;
  _milestones jsonb;
begin
  if _user is null then return; end if;
  -- one run per person at a time, so two referrals recognised together cannot both insert a milestone
  perform pg_advisory_xact_lock(hashtext('referral_milestones:' || _user::text));
  select coalesce(value->'milestones', '[1,5,10,25,50]'::jsonb) into _milestones
    from public.system_settings where key = 'referral_rewards';
  _milestones := coalesce(_milestones, '[1,5,10,25,50]'::jsonb);
  foreach _prog in array array['customer', 'driver'] loop
    _label := case _prog when 'customer' then 'customer' else 'driver' end;
    select count(*) into _count from public.referrals
     where referrer_id = _user and referred_role = _prog and reward_status = 'released';
    for _m in select jsonb_array_elements_text(_milestones)::int loop
      select * into _row from public.referral_programme_milestones
       where user_id = _user and programme = _prog and milestone = _m for update;
      if _count >= _m then
        if _row.user_id is null then
          insert into public.referral_programme_milestones (user_id, programme, milestone) values (_user, _prog, _m);
          insert into public.notifications(user_id, type, title, body)
          values (_user, 'referral_milestone', format('%s recognised %s referrals', _m, _label),
                  format('You have %s recognised %s referrals on Con Z. Thank you for helping more people use Con Z.', _m, _label));
        elsif _row.revoked_at is not null then
          update public.referral_programme_milestones set revoked_at = null, revoked_reason = null
           where user_id = _user and programme = _prog and milestone = _m;
        end if;
      elsif _row.user_id is not null and _row.revoked_at is null then
        update public.referral_programme_milestones
           set revoked_at = now(), revoked_reason = 'A referral it counted was not recognised after review.'
         where user_id = _user and programme = _prog and milestone = _m;
        insert into public.notifications(user_id, type, title, body)
        values (_user, 'referral_milestone_revoked', format('%s recognised %s referrals: withdrawn', _m, _label),
                'A referral was not recognised after review, so this milestone no longer applies.');
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.sync_referral_milestones(uuid) from public, anon, authenticated;
create or replace function public.tg_referral_status_sync_milestones()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if (old.reward_status = 'released') is distinct from (new.reward_status = 'released')
     or old.referrer_id is distinct from new.referrer_id then
    perform public.sync_referral_milestones(new.referrer_id);
    if old.referrer_id is distinct from new.referrer_id then
      perform public.sync_referral_milestones(old.referrer_id);
    end if;
  end if;
  return null;
end $$;
revoke all on function public.tg_referral_status_sync_milestones() from public, anon, authenticated;
create or replace trigger trg_referral_status_sync_milestones
  after update of reward_status, referrer_id on public.referrals
  for each row execute function public.tg_referral_status_sync_milestones();
-- Anyone already recognised (none in production) gets their per-programme milestones now.
do $$ declare _u uuid; begin
  for _u in select distinct referrer_id from public.referrals where reward_status = 'released' loop
    perform public.sync_referral_milestones(_u);
  end loop;
end $$;
-- 2. Claiming a code: new accounts only, one claim per account ---------------------------------------------
CREATE OR REPLACE FUNCTION public.record_referral(_code text, _referred_role text DEFAULT 'customer'::text, _device_fingerprint text DEFAULT NULL::text)
 RETURNS referrals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _referrer_id uuid;
  _referred_id uuid := auth.uid();
  _hold_days int;
  _fraud boolean := false;
  _fraud_reasons text[] := '{}';
  _referred_phone text;
  _dupe_phone_count int;
  _dupe_device_count int;
  _created timestamptz;
  _row public.referrals;
BEGIN
  IF _referred_id IS NULL THEN RAISE EXCEPTION 'Must be authenticated'; END IF;
  IF _referred_role NOT IN ('customer','driver') THEN RAISE EXCEPTION 'Invalid role'; END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referred_id = _referred_id) THEN
    RAISE EXCEPTION 'This account has already redeemed a referral code';
  END IF;

  SELECT id INTO _referrer_id FROM public.profiles WHERE referral_code = upper(trim(_code));
  IF _referrer_id IS NULL THEN RAISE EXCEPTION 'Referral code not found'; END IF;
  IF _referrer_id = _referred_id THEN RAISE EXCEPTION 'You cannot refer yourself'; END IF;

  -- 0185: only a new account can be invited.
  SELECT created_at INTO _created FROM auth.users WHERE id = _referred_id;
  IF _created IS NULL OR _created < now() - interval '14 days'
     OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.status = 'completed' AND (j.customer_id = _referred_id OR j.driver_id = _referred_id)) THEN
    RAISE EXCEPTION 'A referral code can only be used when a new account is created.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE((value->>'hold_days')::int, 7) INTO _hold_days
    FROM public.system_settings WHERE key = 'referral_rewards';
  IF _hold_days IS NULL THEN _hold_days := 7; END IF;

  -- Signals for human review only (never an automatic block).
  SELECT phone INTO _referred_phone FROM public.profiles WHERE id = _referred_id;
  IF _referred_phone IS NOT NULL THEN
    SELECT count(*) INTO _dupe_phone_count
      FROM public.referrals rf JOIN public.profiles p ON p.id = rf.referred_id
      WHERE p.phone = _referred_phone AND rf.referred_id <> _referred_id;
    IF _dupe_phone_count > 0 THEN
      _fraud := true;
      _fraud_reasons := array_append(_fraud_reasons, 'phone number reused across referred accounts');
    END IF;
    IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _referrer_id AND p.phone = _referred_phone) THEN
      _fraud := true;
      _fraud_reasons := array_append(_fraud_reasons, 'same phone number as the referrer');
    END IF;
  END IF;

  IF _device_fingerprint IS NOT NULL THEN
    SELECT count(*) INTO _dupe_device_count
      FROM public.referrals WHERE device_fingerprint = _device_fingerprint AND referred_id <> _referred_id;
    IF _dupe_device_count > 0 THEN
      _fraud := true;
      _fraud_reasons := array_append(_fraud_reasons, 'device fingerprint reused across referred accounts');
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.referrals
      (referrer_id, referred_id, referral_code, referred_role, hold_period_days, fraud_flag, fraud_reason, device_fingerprint)
    VALUES
      (_referrer_id, _referred_id, upper(trim(_code)), _referred_role, _hold_days, _fraud,
       NULLIF(array_to_string(_fraud_reasons, '; '), ''), _device_fingerprint)
    RETURNING * INTO _row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This account has already redeemed a referral code';
  END;

  INSERT INTO public.notifications(user_id, type, title, body)
  VALUES (_referrer_id, 'referral_joined', 'Someone joined with your invitation',
    format('A new %s joined Con Z with your link. You can follow their progress on your Invite page.', _referred_role));

  RETURN _row;
END $function$;
revoke all on function public.record_referral(text, text, text) from public, anon;
grant execute on function public.record_referral(text, text, text) to authenticated, service_role;

-- 3. The caller's own invitations, progress only ---------------------------------------------------------
create or replace function public.my_referral_progress()
returns table (
  ref_key text,
  invited_as text,
  joined_month date,
  stage text,
  verified boolean,
  jobs_done int,
  jobs_needed int,
  recognised_on date
)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  _uid uuid := auth.uid();
  _min int;
begin
  if _uid is null then raise exception 'Must be authenticated' using errcode = '42501'; end if;
  select greatest(coalesce((value->>'driver_min_deliveries')::int, 5), 1) into _min
    from public.system_settings where key = 'referral_rewards';
  _min := coalesce(_min, 5);

  return query
  select
    -- an opaque key for list rendering, not the referral or user id
    left(md5(rf.id::text || _uid::text), 12),
    rf.referred_role,
    date_trunc('month', rf.created_at)::date,
    case
      when rf.reward_status = 'released' then 'recognised'
      when rf.reward_status = 'rejected' then 'not_recognised'
      when rf.reward_status = 'frozen' or coalesce(rf.fraud_flag, false) then 'being_checked'
      when rf.verification_status = 'verified' then 'qualified'
      else 'in_progress'
    end,
    case when rf.referred_role = 'driver' then coalesce(dp.verification_status = 'verified', false) end,
    least(g.done, case when rf.referred_role = 'driver' then _min else 1 end)::int,
    (case when rf.referred_role = 'driver' then _min else 1 end)::int,
    case when rf.reward_status = 'released' then coalesce(rf.decided_at, rf.reward_release_at)::date end
  from public.referrals rf
  left join public.driver_profiles dp on dp.user_id = rf.referred_id
  cross join lateral (
    select count(*)::int as done from public.jobs j
     where j.status = 'completed'
       and ((rf.referred_role = 'customer' and j.customer_id = rf.referred_id and j.driver_id is distinct from rf.referrer_id)
         or (rf.referred_role = 'driver' and j.driver_id = rf.referred_id and j.customer_id is distinct from rf.referrer_id))
       and not exists (select 1 from public.disputes d where d.job_id = j.id and d.status in ('open', 'investigating'))
  ) g
  where rf.referrer_id = _uid
  order by rf.created_at desc;
end $$;
revoke all on function public.my_referral_progress() from public, anon;
grant execute on function public.my_referral_progress() to authenticated;

-- 4. Share events -----------------------------------------------------------------------------------------
create table if not exists public.referral_share_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('whatsapp', 'share_sheet', 'copy_link', 'copy_code')),
  created_at timestamptz not null default now()
);
create index if not exists referral_share_events_user_time_idx on public.referral_share_events (user_id, created_at);
create index if not exists referral_share_events_time_idx on public.referral_share_events (created_at);
alter table public.referral_share_events enable row level security;
revoke all on public.referral_share_events from anon, authenticated;
grant select on public.referral_share_events to authenticated;
grant select, insert, update, delete on public.referral_share_events to service_role;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'referral_share_events' and policyname = 'Own share events') then
    create policy "Own share events" on public.referral_share_events for select to authenticated using (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'referral_share_events' and policyname = 'Admins read share events') then
    create policy "Admins read share events" on public.referral_share_events for select to authenticated
      using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));
  end if;
end $$;

create or replace function public.record_referral_share(_channel text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare _uid uuid := auth.uid();
begin
  if _uid is null then raise exception 'Must be authenticated' using errcode = '42501'; end if;
  if _channel not in ('whatsapp', 'share_sheet', 'copy_link', 'copy_code') then
    raise exception 'Unknown share channel' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('referral_share:' || _uid::text));
  if (select count(*) from public.referral_share_events where user_id = _uid and created_at > now() - interval '1 day') >= 30 then
    return false;   -- counted enough for today; sharing itself is never blocked
  end if;
  insert into public.referral_share_events (user_id, channel) values (_uid, _channel);
  return true;
end $$;
revoke all on function public.record_referral_share(text) from public, anon;
grant execute on function public.record_referral_share(text) to authenticated;

-- 5. Admin metrics ----------------------------------------------------------------------------------------
create or replace function public.admin_referral_metrics(_days int default 90)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  _since timestamptz;
  _out jsonb;
  _retention jsonb := '[]'::jsonb;
  _n int;
  _role text;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  _since := now() - (greatest(least(coalesce(_days, 90), 3650), 1) || ' days')::interval;

  -- Activity N days after joining: a customer posted a job, or a driver completed one, between day N-30 and day N.
  foreach _role in array array['customer', 'driver'] loop
    foreach _n in array array[30, 60, 90] loop
      _retention := _retention || (
        select jsonb_build_object(
          'role', _role, 'day', _n,
          'eligible', count(*),
          'active', count(*) filter (where exists (
            select 1 from public.jobs j
             where (case when _role = 'customer' then j.customer_id = rf.referred_id
                         else j.driver_id = rf.referred_id and j.status = 'completed' end)
               and coalesce(case when _role = 'customer' then j.created_at else j.completed_at end, j.created_at)
                   between rf.created_at + ((_n - 30) || ' days')::interval and rf.created_at + (_n || ' days')::interval)))
        from public.referrals rf
        where rf.referred_role = _role and rf.reward_status <> 'rejected'
          and rf.created_at <= now() - (_n || ' days')::interval);
    end loop;
  end loop;

  select jsonb_build_object(
    'window_days', greatest(least(coalesce(_days, 90), 3650), 1),
    'shares', jsonb_build_object(
      'total', (select count(*) from public.referral_share_events where created_at >= _since),
      'people_sharing', (select count(distinct user_id) from public.referral_share_events where created_at >= _since),
      'by_channel', coalesce((select jsonb_object_agg(channel, n) from (
         select channel, count(*) n from public.referral_share_events where created_at >= _since group by channel) s), '{}'::jsonb)),
    'signups', jsonb_build_object(
      'customers', (select count(*) from public.referrals where referred_role = 'customer' and created_at >= _since),
      'drivers', (select count(*) from public.referrals where referred_role = 'driver' and created_at >= _since)),
    'customers_first_delivery', (select count(*) from public.referrals
       where referred_role = 'customer' and verification_status = 'verified' and created_at >= _since),
    'drivers_verified', (select count(*) from public.referrals rf join public.driver_profiles dp on dp.user_id = rf.referred_id
       where rf.referred_role = 'driver' and dp.verification_status = 'verified' and rf.created_at >= _since),
    'drivers_five_jobs', (select count(*) from public.referrals
       where referred_role = 'driver' and verification_status = 'verified' and created_at >= _since),
    'recognised', (select count(*) from public.referrals where reward_status = 'released' and created_at >= _since),
    'repeat_customers', (select count(*) from public.referrals rf
       where rf.referred_role = 'customer' and rf.created_at >= _since
         and (select count(*) from public.jobs j where j.customer_id = rf.referred_id and j.status = 'completed') >= 2),
    'repeat_bookings', (select coalesce(sum(greatest(c - 1, 0)), 0) from (
       select (select count(*) from public.jobs j where j.customer_id = rf.referred_id and j.status = 'completed') c
         from public.referrals rf where rf.referred_role = 'customer' and rf.created_at >= _since) x),
    'retention', _retention,
    'review', jsonb_build_object(
      'flagged', (select count(*) from public.referrals where fraud_flag and created_at >= _since),
      'frozen', (select count(*) from public.referrals where reward_status = 'frozen' and created_at >= _since),
      'rejected', (select count(*) from public.referrals where reward_status = 'rejected' and created_at >= _since),
      'milestones_revoked', (select count(*) from public.referral_programme_milestones where revoked_at >= _since)),
    'partner_benefits', jsonb_build_object('approved', 0, 'cost', 0,
      'note', 'No partner benefits are approved. Referrals give recognition only.'),
    'areas', coalesce((
      select jsonb_agg(a order by (a->>'posted')::int desc) from (
        select jsonb_build_object(
          'area', area, 'posted', sum(posted), 'with_offer', sum(with_offer), 'completed', sum(completed),
          'no_offer', sum(posted) - sum(with_offer), 'from_referred_customers', sum(referred)) a
        from (
          select case when count(*) over (partition by p.area) >= 5 then p.area else 'Other areas' end as area,
                 1 as posted,
                 (exists (select 1 from public.bids b where b.job_id = p.id))::int as with_offer,
                 (p.status = 'completed')::int as completed,
                 (exists (select 1 from public.referrals rf where rf.referred_id = p.customer_id and rf.referred_role = 'customer'))::int as referred
          from (select j.id, j.status, j.customer_id, coalesce(public.coarse_place(j.delivery_address), 'Unknown area') as area
                  from public.jobs j where j.created_at >= _since) p
        ) per_job
        group by area) g), '[]'::jsonb)
  ) into _out;
  return _out;
end $$;
revoke all on function public.admin_referral_metrics(int) from public, anon;
grant execute on function public.admin_referral_metrics(int) to authenticated;

-- 6. Attribution corrections (owner rule 28/11/2026: an audited way to settle "I joined with X's invitation") ----
-- Super admin with a fresh step-up, never one of the people involved, with a reason. Only while the referral has
-- not been recognised, only for an account that is still new (same 14-day / no completed job rule as a claim, so a
-- recognised history can never be moved), never self-referral. It cannot recognise, qualify or pay anything: the
-- referral starts again at "pending" and qualifies through the normal rules.
create or replace function public.admin_set_referral_attribution(_referred_id uuid, _referrer_code text, _reason text)
returns public.referrals language plpgsql security definer set search_path to 'public' as $$
declare
  _referrer uuid;
  _why text := nullif(btrim(coalesce(_reason, '')), '');
  _old public.referrals;
  _row public.referrals;
  _created timestamptz;
  _role text;
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only a super admin can correct a referral.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _why is null or length(_why) < 10 then
    raise exception 'Give the reason (at least 10 characters).' using errcode = '22023';
  end if;
  select id into _referrer from public.profiles where referral_code = upper(btrim(coalesce(_referrer_code, '')));
  if _referrer is null then raise exception 'Referral code not found.' using errcode = 'P0002'; end if;
  if _referrer = _referred_id then raise exception 'An account cannot refer itself.' using errcode = '22023'; end if;
  if auth.uid() in (_referrer, _referred_id) then
    raise exception 'You cannot correct a referral you are part of.' using errcode = '42501';
  end if;
  select created_at into _created from auth.users where id = _referred_id;
  if _created is null then raise exception 'Account not found.' using errcode = 'P0002'; end if;
  if _created < now() - interval '14 days'
     or exists (select 1 from public.jobs j where j.status = 'completed' and (j.customer_id = _referred_id or j.driver_id = _referred_id)) then
    raise exception 'Only a new account (14 days, no completed job) can have its referral corrected.' using errcode = '22023';
  end if;
  select * into _old from public.referrals where referred_id = _referred_id for update;
  if found and _old.reward_status in ('released', 'approved') then
    raise exception 'A recognised or approved referral cannot be moved.' using errcode = '22023';
  end if;
  _role := case when public.has_role(_referred_id, 'driver') then 'driver' else 'customer' end;
  if _old.id is null then
    insert into public.referrals (referrer_id, referred_id, referral_code, referred_role, hold_period_days)
    values (_referrer, _referred_id, upper(btrim(_referrer_code)), _role, 7)
    returning * into _row;
  else
    update public.referrals
       set referrer_id = _referrer, referral_code = upper(btrim(_referrer_code)),
           verification_status = 'pending', reward_status = 'pending', reward_release_at = null
     where id = _old.id returning * into _row;
  end if;
  perform public.log_admin_action('referral_attribution_set',
    jsonb_build_object('referred_id', _referred_id, 'new_referrer', _referrer, 'previous_referrer', _old.referrer_id),
    _why, _row.id, _referred_id);
  insert into public.notifications(user_id, type, title, body)
  values (_referrer, 'referral_joined', 'Someone joined with your invitation',
          'Con Z recorded that a new account joined with your invitation. You can follow their progress on your Invite page.');
  return _row;
end $$;
revoke all on function public.admin_set_referral_attribution(uuid, text, text) from public, anon;
grant execute on function public.admin_set_referral_attribution(uuid, text, text) to authenticated;
