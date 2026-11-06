-- =============================================================================
-- 0142 · Admin operations, batch 1 (support report privacy, admin cancellation, admin search)
--
-- 1. SUPPORT REPORTS. `reports.admin_notes` was both the admin's "internal note" and, through the
--    customer's own select policy and the report screen, the "Admin reply" the reporter reads.
--    Anything an admin wrote as private was therefore customer-visible, and the reporter could also
--    write status/admin_notes on their own insert. Fix:
--      * admin_notes stays as it is and becomes PRIVATE (column privilege: only reachable through the
--        admin RPCs below). Existing reports and notes are untouched.
--      * new public columns admin_reply / admin_reply_at / admin_reply_by hold what the customer reads.
--      * customers can select only their own report's public columns and insert only
--        (user_id, job_id, description); nobody updates the table directly any more.
--      * admin_respond_to_report(): admin/super admin only, validates, audits, and notifies the reporter
--        once per real change (reply or status), never for an unchanged save.
--      * admin_list_reports(): the admin list, including the private note.
--    Realtime: `reports` is not in the realtime publication, so no private field is streamed.
--
-- 2. ADMIN CANCELLATION. cancel_job already blocks completed/cancelled jobs, releases the held commission,
--    queues escrow refunds, records cancelled_by / cancelled_at, and notifies both sides. Gaps closed here:
--      * an admin who is not a party to the job must give a reason of at least 5 characters (server-side,
--        previously only the screen checked it);
--      * the cancellation is written to admin_audit_log (actor, job, customer, prior status, reason);
--      * the notifications carry job_id so tapping them opens the job.
--    Everything else in the function body is the 0101 definition, unchanged.
--
-- 3. ADMIN SEARCH. admin_search(): one server-side, paginated search over customers, drivers, jobs,
--    payments, wallet transactions and support reports. Admin and super admin only. Money rows follow the
--    existing row-level rules: payments for both admin tiers (payments_admin_select), wallet transactions
--    for super admins in full and for ordinary admins today only (the 0031 policies).
--
-- No DROP. Undo: supabase/rollbacks/20261106100000_0142_rollback.sql
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Support reports
-- ---------------------------------------------------------------------------
alter table public.reports
  add column if not exists admin_reply    text,
  add column if not exists admin_reply_at timestamptz,
  add column if not exists admin_reply_by uuid references auth.users (id);

revoke all on public.reports from anon;
revoke select, insert, update on public.reports from authenticated;
grant select (id, user_id, job_id, description, status, created_at, admin_reply, admin_reply_at)
  on public.reports to authenticated;
grant insert (user_id, job_id, description) on public.reports to authenticated;

create or replace function public.admin_list_reports(
  _status text default null,
  _limit  integer default 50,
  _offset integer default 0
)
returns table (
  id uuid, user_id uuid, job_id uuid, description text, status text,
  admin_notes text, admin_reply text, admin_reply_at timestamptz, created_at timestamptz,
  reporter_name text, reporter_phone text, reporter_email text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role)
          or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Forbidden';
  end if;
  if _status is not null and _status not in ('open', 'resolved') then
    raise exception 'Invalid status';
  end if;
  return query
    select r.id, r.user_id, r.job_id, r.description, r.status,
           r.admin_notes, r.admin_reply, r.admin_reply_at, r.created_at,
           p.full_name, p.phone, p.email
      from public.reports r
      left join public.profiles p on p.id = r.user_id
     where _status is null or r.status = _status
     order by r.created_at desc
     limit greatest(1, least(coalesce(_limit, 50), 100))
    offset greatest(0, coalesce(_offset, 0));
end $function$;

create or replace function public.admin_respond_to_report(
  _report_id uuid,
  _reply     text default null,
  _note      text default null,
  _status    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _r public.reports;
  _reply_clean text := nullif(btrim(coalesce(_reply, '')), '');
  _note_clean  text := nullif(btrim(coalesce(_note, '')), '');
  _reply_changed  boolean;
  _status_changed boolean;
  _note_changed   boolean;
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role)
          or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Forbidden';
  end if;
  if _status is not null and _status not in ('open', 'resolved') then
    raise exception 'Invalid status';
  end if;
  if length(coalesce(_reply_clean, '')) > 2000 or length(coalesce(_note_clean, '')) > 2000 then
    raise exception 'Reply and note are limited to 2000 characters';
  end if;

  select * into _r from public.reports where id = _report_id for update;
  if not found then raise exception 'Report not found'; end if;

  _reply_changed  := _reply_clean is not null and _reply_clean is distinct from _r.admin_reply;
  _status_changed := _status is not null and _status is distinct from _r.status;
  _note_changed   := _note is not null and _note_clean is distinct from _r.admin_notes;
  if not (_reply_changed or _status_changed or _note_changed) then
    return jsonb_build_object('changed', false, 'status', _r.status);
  end if;

  update public.reports
     set admin_reply    = case when _reply_changed then _reply_clean else admin_reply end,
         admin_reply_at = case when _reply_changed then now() else admin_reply_at end,
         admin_reply_by = case when _reply_changed then auth.uid() else admin_reply_by end,
         admin_notes    = case when _note_changed then _note_clean else admin_notes end,
         status         = case when _status_changed then _status else status end
   where id = _report_id
  returning * into _r;

  perform public.log_admin_action(
    _action      => 'report_updated',
    _meta        => jsonb_build_object(
                      'report_id', _report_id,
                      'reply_changed', _reply_changed,
                      'note_changed', _note_changed,
                      'status', _r.status),
    _reason      => null,
    _target_id   => _report_id,
    _target_user => _r.user_id);

  -- The reporter hears about a real reply or status change, once. Private note edits tell them nothing.
  if (_reply_changed or _status_changed) and _r.user_id is distinct from auth.uid() then
    insert into public.notifications (user_id, type, title, body, job_id)
    values (
      _r.user_id,
      'report_update',
      case when _reply_changed then 'Con Z replied to your report'
           when _r.status = 'resolved' then 'Your report was marked resolved'
           else 'Your report was reopened' end,
      case when _reply_changed then left(_r.admin_reply, 140) else null end,
      _r.job_id);
  end if;

  return jsonb_build_object('changed', true, 'status', _r.status);
end $function$;

revoke all on function public.admin_list_reports(text, integer, integer) from public, anon;
grant execute on function public.admin_list_reports(text, integer, integer) to authenticated, service_role;
revoke all on function public.admin_respond_to_report(uuid, text, text, text) from public, anon;
grant execute on function public.admin_respond_to_report(uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. cancel_job: server-side admin reason, audit entry, job_id on notifications.
--    Body is the 0101 definition; the three additions are marked (0142).
-- ---------------------------------------------------------------------------
create or replace function public.cancel_job(_job_id uuid, _reason text default null::text)
returns jobs
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  _job public.jobs; _stage text; _is_admin boolean; _loc public.material_supply_locations;
  _prev_status text; _admin_acting boolean;
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

  -- (0142) An admin cancelling someone else's job must say why; the screen checks it, so does the database.
  _admin_acting := _is_admin and auth.uid() is distinct from _job.customer_id
                             and auth.uid() is distinct from _job.driver_id;
  if _admin_acting and length(btrim(coalesce(_reason, ''))) < 5 then
    raise exception 'A reason of at least 5 characters is required to cancel as an admin';
  end if;
  _prev_status := _job.status::text;

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

  -- (0142) Audit entry for an admin cancellation: who, which job, whose job, from which status, why.
  if _admin_acting then
    perform public.log_admin_action(
      _action      => 'job_cancelled_by_admin',
      _meta        => jsonb_build_object('job_id', _job_id, 'stage', _stage, 'previous_status', _prev_status),
      _reason      => btrim(_reason),
      _target_id   => _job_id,
      _target_user => _job.customer_id);
  end if;

  if _job.driver_id is not null and auth.uid() <> _job.driver_id then
    insert into public.notifications (user_id, type, title, body, job_id)
    values (_job.driver_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'The customer cancelled this job.'), _job_id);
  end if;
  if auth.uid() <> _job.customer_id then
    insert into public.notifications (user_id, type, title, body, job_id)
    values (_job.customer_id, 'job_cancelled', 'Job cancelled',
            coalesce(_reason, 'This job was cancelled.'), _job_id);
  end if;

  return _job;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. admin_search
-- ---------------------------------------------------------------------------
create or replace function public.admin_search(
  _q      text,
  _kind   text default 'all',
  _limit  integer default 20,
  _offset integer default 0
)
returns table (
  kind text, id uuid, title text, subtitle text, status text, amount numeric,
  created_at timestamptz, job_id uuid, user_id uuid, total_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  _is_super boolean;
  _t   text := btrim(coalesce(_q, ''));
  _pat text;
  _lim integer := greatest(1, least(coalesce(_limit, 20), 50));
  _off integer := greatest(0, coalesce(_offset, 0));
begin
  if not (public.has_role(auth.uid(), 'admin'::public.app_role)
          or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Forbidden';
  end if;
  if length(_t) < 2 then raise exception 'Type at least 2 characters to search'; end if;
  if length(_t) > 80 then raise exception 'Search text is too long'; end if;
  if _kind not in ('all', 'customers', 'drivers', 'jobs', 'payments', 'transactions', 'reports') then
    raise exception 'Unknown search type';
  end if;
  _is_super := public.has_role(auth.uid(), 'super_admin'::public.app_role);
  -- Escape LIKE wildcards so "50%" or "a_b" search for what was typed.
  _pat := '%' || replace(replace(replace(_t, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with hits as (
    -- Customers
    select 'customers'::text as k, p.id as rid, p.full_name as ttl,
           concat_ws(' · ', p.email, p.phone) as sub, p.status::text as st,
           null::numeric as amt, p.created_at as at, null::uuid as jid, p.id as uid
      from public.profiles p
     where (_kind in ('all', 'customers'))
       and exists (select 1 from public.user_roles ur where ur.user_id = p.id and ur.role = 'customer'::public.app_role)
       and (p.full_name ilike _pat or p.email ilike _pat or p.phone ilike _pat or p.id::text ilike _pat)
    union all
    -- Drivers (also found by truck registration)
    select 'drivers', p.id, p.full_name,
           concat_ws(' · ', p.email, p.phone), dp.verification_status::text,
           null::numeric, p.created_at, null::uuid, p.id
      from public.profiles p
      join public.driver_profiles dp on dp.user_id = p.id
     where (_kind in ('all', 'drivers'))
       and (p.full_name ilike _pat or p.email ilike _pat or p.phone ilike _pat or p.id::text ilike _pat
            or exists (select 1 from public.trucks t where t.driver_id = p.id and t.registration ilike _pat))
    union all
    -- Jobs (by id, address, material, or either party's name)
    select 'jobs', j.id,
           concat_ws(' · ', j.material::text, j.quantity_m3::text || ' m³'),
           j.delivery_address, j.status::text, coalesce(j.final_price, j.budget)::numeric,
           j.created_at, j.id, j.customer_id
      from public.jobs j
     where (_kind in ('all', 'jobs'))
       and (j.id::text ilike _pat or j.delivery_address ilike _pat or j.pickup_address ilike _pat
            or j.material::text ilike _pat
            or exists (select 1 from public.profiles cp where cp.id in (j.customer_id, j.driver_id) and cp.full_name ilike _pat))
    union all
    -- Support reports
    select 'reports', r.id, left(r.description, 80), p.full_name, r.status,
           null::numeric, r.created_at, r.job_id, r.user_id
      from public.reports r
      left join public.profiles p on p.id = r.user_id
     where (_kind in ('all', 'reports'))
       and (r.description ilike _pat or r.id::text ilike _pat or p.full_name ilike _pat)
    union all
    -- Payments: same audience as the payments_admin_select policy (admin and super admin)
    select 'payments', pay.id, concat_ws(' · ', pay.type, pay.method), p.full_name,
           pay.status, pay.amount, pay.created_at, pay.job_id, pay.user_id
      from public.payments pay
      left join public.profiles p on p.id = pay.user_id
     where (_kind in ('all', 'payments'))
       and (pay.id::text ilike _pat or pay.paynow_reference ilike _pat or p.full_name ilike _pat)
    union all
    -- Wallet transactions: super admin all; ordinary admin today only (as the row-level policies do)
    select 'transactions', wt.id, wt.type::text, concat_ws(' · ', p.full_name, wt.note),
           null::text, wt.amount, wt.created_at, wt.job_id, wt.user_id
      from public.wallet_transactions wt
      left join public.profiles p on p.id = wt.user_id
     where (_kind in ('all', 'transactions'))
       and (_is_super or wt.created_at >= date_trunc('day', now()))
       and (wt.id::text ilike _pat or wt.note ilike _pat or p.full_name ilike _pat)
  )
  select h.k, h.rid, h.ttl, h.sub, h.st, h.amt, h.at, h.jid, h.uid, count(*) over ()
    from hits h
   order by h.at desc, h.rid
   limit _lim offset _off;
end $function$;

revoke all on function public.admin_search(text, text, integer, integer) from public, anon;
grant execute on function public.admin_search(text, text, integer, integer) to authenticated, service_role;

commit;
