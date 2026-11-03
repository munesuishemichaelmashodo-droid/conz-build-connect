-- -----------------------------------------------------------------------------
-- 0131: ConZ points (customers and drivers). Not cash, not a wallet.
--
-- Product Setup in this codebase is the material list (enum material_category + the rows in
-- material_prices). A job carries ONE material, its quantities and its own price snapshot
-- (jobs.material, quantity_m3, delivered_quantity_m3, final_price), so points reuse those and
-- never read today's prices. Rules can be general or tied to one material.
--
-- Safe by default: points are OFF (system_settings.points_enabled = false) and the four starter
-- rules are inactive with zero points. Nothing is awarded until a super admin approves values.
--
-- Awards are made by a server job (process_points, every 15 minutes) from facts the database
-- already trusts: a job that is 'completed' (server-verified delivery, 0096) and a referral whose
-- reward was released. One award per job/person/event (unique idempotency key). Admin adjustments
-- and reversals add rows; history is never edited. Points never touch prices, wallets or the 7%
-- commission. No DROP. Undo: supabase/rollbacks/20261103130000_0131_rollback.sql
-- -----------------------------------------------------------------------------

begin;

insert into public.system_settings (key, value) values ('points_enabled', 'false'::jsonb)
on conflict (key) do nothing;

create table if not exists public.points_rules (
  id uuid primary key default gen_random_uuid(),
  event text not null check (event in ('delivery', 'referral')),
  audience text not null check (audience in ('customer', 'driver')),
  material public.material_category,
  points_flat integer not null default 0 check (points_flat between 0 and 100000),
  points_per_m3 numeric(10, 2) not null default 0 check (points_per_m3 between 0 and 10000),
  points_per_usd numeric(10, 2) not null default 0 check (points_per_usd between 0 and 1000),
  active boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (event = 'delivery' or material is null),
  check (event = 'delivery' or (points_per_m3 = 0 and points_per_usd = 0)),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index if not exists points_rules_one_active_general
  on public.points_rules (event, audience) where active and material is null;
create unique index if not exists points_rules_one_active_product
  on public.points_rules (event, audience, material) where active and material is not null;

insert into public.points_rules (event, audience, note)
select e, a, 'Starter rule: inactive, zero points. Set values and switch on once approved.'
  from (values ('delivery', 'customer'), ('delivery', 'driver'), ('referral', 'customer'), ('referral', 'driver')) v(e, a)
 where not exists (select 1 from public.points_rules);

create table if not exists public.points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  points integer not null check (points <> 0),
  kind text not null check (kind in ('award', 'adjustment', 'reversal')),
  event text check (event in ('delivery', 'referral')),
  job_id uuid references public.jobs (id),
  referral_id uuid references public.referrals (id),
  rule_id uuid references public.points_rules (id),
  basis jsonb not null default '{}'::jsonb,
  reverses_id uuid references public.points_ledger (id),
  reason text,
  idempotency_key text not null unique,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  unique (reverses_id),
  check (kind <> 'award' or (rule_id is not null and event is not null and points > 0)),
  check (kind <> 'adjustment' or (reason is not null and length(btrim(reason)) >= 5 and created_by is not null)),
  check (kind <> 'reversal' or (reverses_id is not null and reason is not null and length(btrim(reason)) >= 5 and created_by is not null))
);
create index if not exists points_ledger_user_idx on public.points_ledger (user_id, created_at desc);

drop trigger if exists trg_points_ledger_immutable on public.points_ledger;
create trigger trg_points_ledger_immutable
  before update or delete on public.points_ledger
  for each row execute function public.append_only_guard();

alter table public.points_rules enable row level security;
alter table public.points_ledger enable row level security;

revoke all on public.points_rules from public, anon, authenticated;
revoke all on public.points_ledger from public, anon, authenticated;
grant select on public.points_rules to authenticated;
grant select on public.points_ledger to authenticated;

drop policy if exists "Admins read points rules" on public.points_rules;
create policy "Admins read points rules" on public.points_rules for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));
drop policy if exists "Users read own points" on public.points_ledger;
create policy "Users read own points" on public.points_ledger for select to authenticated using (user_id = auth.uid());
drop policy if exists "Admins read all points" on public.points_ledger;
create policy "Admins read all points" on public.points_ledger for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- What a signed-in person sees: whether points are on, and their balance.
create or replace function public.points_overview()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'enabled', coalesce((select (value #>> '{}')::boolean from public.system_settings where key = 'points_enabled'), false),
    'balance', coalesce((select sum(points) from public.points_ledger where user_id = auth.uid()), 0));
$$;
revoke all on function public.points_overview() from public, anon;
grant execute on function public.points_overview() to authenticated;

-- The server job. Idempotent: the unique key makes a second run a no-op.
create or replace function public.process_points()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _on boolean;
  _n integer := 0;
  j record;
  rf record;
  _aud text;
  _uid uuid;
  _rule public.points_rules;
  _qty numeric;
  _pts integer;
  _got integer;
begin
  select coalesce((value #>> '{}')::boolean, false) into _on from public.system_settings where key = 'points_enabled';
  if not coalesce(_on, false) then return 0; end if;

  -- Delivered jobs (last 60 days is plenty for a 15-minute job; older jobs are never back-filled).
  for j in
    select * from public.jobs
     where status = 'completed' and completed_at is not null and completed_at >= now() - interval '60 days'
       and not exists (select 1 from public.disputes d where d.job_id = jobs.id
                        and (d.status in ('open', 'investigating') or d.outcome = 'refund'))
  loop
    foreach _aud in array array['customer', 'driver'] loop
      _uid := case _aud when 'customer' then j.customer_id else j.driver_id end;
      continue when _uid is null;
      select * into _rule from public.points_rules r
       where r.event = 'delivery' and r.audience = _aud and r.active
         and (r.material = j.material or r.material is null)
         and (r.starts_at is null or j.completed_at >= r.starts_at)
         and (r.ends_at is null or j.completed_at < r.ends_at)
       order by (r.material is not null) desc
       limit 1;
      continue when not found;
      _qty := coalesce(j.delivered_quantity_m3, j.quantity_m3, 0);
      _pts := floor(_rule.points_flat + _rule.points_per_m3 * _qty + _rule.points_per_usd * coalesce(j.final_price, 0));
      continue when _pts <= 0;
      insert into public.points_ledger (user_id, points, kind, event, job_id, rule_id, basis, idempotency_key)
      values (_uid, _pts, 'award', 'delivery', j.id, _rule.id,
              jsonb_build_object('material', j.material, 'quantity_m3', _qty, 'job_price_usd', j.final_price,
                                 'points_flat', _rule.points_flat, 'points_per_m3', _rule.points_per_m3,
                                 'points_per_usd', _rule.points_per_usd, 'payment_method', j.payment_method),
              'delivery:' || j.id || ':' || _aud || ':' || _uid)
      on conflict (idempotency_key) do nothing;
      get diagnostics _got = row_count;
      _n := _n + _got;
    end loop;
  end loop;

  -- Referrals whose reward was released (so only genuine, qualified referrals earn points).
  for rf in select * from public.referrals where reward_status = 'released' loop
    select * into _rule from public.points_rules r
     where r.event = 'referral' and r.audience = rf.referred_role and r.active
       and (r.starts_at is null or now() >= r.starts_at) and (r.ends_at is null or now() < r.ends_at)
     limit 1;
    continue when not found;
    _pts := _rule.points_flat;
    continue when _pts <= 0;
    insert into public.points_ledger (user_id, points, kind, event, referral_id, rule_id, basis, idempotency_key)
    values (rf.referrer_id, _pts, 'award', 'referral', rf.id, _rule.id,
            jsonb_build_object('referred_role', rf.referred_role, 'points_flat', _rule.points_flat),
            'referral:' || rf.id)
    on conflict (idempotency_key) do nothing;
    get diagnostics _got = row_count;
    _n := _n + _got;
  end loop;
  return _n;
end $$;
revoke all on function public.process_points() from public, anon, authenticated;
grant execute on function public.process_points() to service_role;

-- Admin controls ---------------------------------------------------------------------------
create or replace function public.admin_set_points_enabled(_on boolean, _reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can switch points on or off.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _on is null then raise exception 'Choose on or off.' using errcode = '22023'; end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = '22023';
  end if;
  insert into public.system_settings (key, value, updated_by, updated_at)
  values ('points_enabled', to_jsonb(_on), auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = auth.uid(), updated_at = now();
  perform public.log_admin_action(_action => 'points_enabled_changed', _meta => jsonb_build_object('enabled', _on),
                                  _reason => btrim(_reason));
  return public.points_overview();
end $$;
revoke all on function public.admin_set_points_enabled(boolean, text) from public, anon;
grant execute on function public.admin_set_points_enabled(boolean, text) to authenticated;

create or replace function public.admin_save_points_rule(
  _id uuid, _event text, _audience text, _material public.material_category,
  _points_flat integer, _points_per_m3 numeric, _points_per_usd numeric,
  _active boolean, _starts_at timestamptz, _ends_at timestamptz, _reason text)
returns public.points_rules
language plpgsql
security definer
set search_path to 'public'
as $$
declare _r public.points_rules;
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only super admins can change points rules.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = '22023';
  end if;
  if _material is not null and not exists (select 1 from public.material_prices where material = _material) then
    raise exception 'That product is not set up in Product Setup (material prices).' using errcode = '22023';
  end if;
  if _id is null then
    insert into public.points_rules (event, audience, material, points_flat, points_per_m3, points_per_usd,
                                     active, starts_at, ends_at, created_by)
    values (_event, _audience, _material, coalesce(_points_flat, 0), coalesce(_points_per_m3, 0),
            coalesce(_points_per_usd, 0), coalesce(_active, false), _starts_at, _ends_at, auth.uid())
    returning * into _r;
  else
    update public.points_rules
       set event = _event, audience = _audience, material = _material,
           points_flat = coalesce(_points_flat, 0), points_per_m3 = coalesce(_points_per_m3, 0),
           points_per_usd = coalesce(_points_per_usd, 0), active = coalesce(_active, false),
           starts_at = _starts_at, ends_at = _ends_at, updated_at = now()
     where id = _id returning * into _r;
    if not found then raise exception 'Rule not found.' using errcode = '22023'; end if;
  end if;
  perform public.log_admin_action(_action => 'points_rule_saved', _meta => to_jsonb(_r), _reason => btrim(_reason));
  return _r;
exception when unique_violation then
  raise exception 'There is already an active rule for that event, person type and product.' using errcode = '22023';
end $$;
revoke all on function public.admin_save_points_rule(uuid, text, text, public.material_category, integer, numeric, numeric, boolean, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_save_points_rule(uuid, text, text, public.material_category, integer, numeric, numeric, boolean, timestamptz, timestamptz, text) to authenticated;

create or replace function public.admin_adjust_points(_user uuid, _points integer, _reason text)
returns public.points_ledger
language plpgsql
security definer
set search_path to 'public'
as $$
declare _row public.points_ledger; _balance bigint;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  if _user = auth.uid() then raise exception 'You cannot adjust your own points.' using errcode = '42501'; end if;
  if _points is null or _points = 0 or abs(_points) > 100000 then
    raise exception 'Points must be a non-zero whole number up to 100,000.' using errcode = '22023';
  end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = _user) then
    raise exception 'User not found.' using errcode = '22023';
  end if;
  select coalesce(sum(points), 0) into _balance from public.points_ledger where user_id = _user;
  if _balance + _points < 0 then
    raise exception 'That would take the balance below zero (balance is %).', _balance using errcode = '22023';
  end if;
  insert into public.points_ledger (user_id, points, kind, reason, created_by, idempotency_key)
  values (_user, _points, 'adjustment', btrim(_reason), auth.uid(), 'adj:' || gen_random_uuid())
  returning * into _row;
  perform public.log_admin_action(_action => 'points_adjusted', _meta => jsonb_build_object('points', _points),
                                  _reason => btrim(_reason), _target_id => _row.id, _target_user => _user);
  return _row;
end $$;
revoke all on function public.admin_adjust_points(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_points(uuid, integer, text) to authenticated;

create or replace function public.admin_reverse_points(_ledger_id uuid, _reason text)
returns public.points_ledger
language plpgsql
security definer
set search_path to 'public'
as $$
declare _orig public.points_ledger; _row public.points_ledger;
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  if _reason is null or length(btrim(_reason)) < 5 then
    raise exception 'Give a reason (at least 5 characters).' using errcode = '22023';
  end if;
  select * into _orig from public.points_ledger where id = _ledger_id for update;
  if not found then raise exception 'Entry not found.' using errcode = '22023'; end if;
  if _orig.kind = 'reversal' then raise exception 'A reversal cannot be reversed.' using errcode = '22023'; end if;
  if _orig.user_id = auth.uid() then raise exception 'You cannot reverse your own points.' using errcode = '42501'; end if;
  if exists (select 1 from public.points_ledger where reverses_id = _ledger_id) then
    raise exception 'That entry has already been reversed.' using errcode = '22023';
  end if;
  insert into public.points_ledger (user_id, points, kind, event, job_id, referral_id, rule_id, basis, reverses_id,
                                    reason, created_by, idempotency_key)
  values (_orig.user_id, -_orig.points, 'reversal', _orig.event, _orig.job_id, _orig.referral_id, _orig.rule_id,
          _orig.basis, _orig.id, btrim(_reason), auth.uid(), 'rev:' || _orig.id)
  returning * into _row;
  perform public.log_admin_action(_action => 'points_reversed', _meta => jsonb_build_object('points', -_orig.points),
                                  _reason => btrim(_reason), _target_id => _row.id, _target_user => _orig.user_id);
  return _row;
end $$;
revoke all on function public.admin_reverse_points(uuid, text) from public, anon;
grant execute on function public.admin_reverse_points(uuid, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$
      select cron.schedule('process-points', '*/15 * * * *', 'select public.process_points();')
       where not exists (select 1 from cron.job where jobname = 'process-points')
    $q$;
  end if;
end $$;

commit;
