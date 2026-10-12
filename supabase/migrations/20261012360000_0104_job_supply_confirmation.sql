-- 0104 — supplier / supply confirmation for active jobs (closes the "no confirmation step" gap).
--
-- Product principle (owner, 2026-10-12): customers can request materials whether or not any supplier has recorded stock
-- (0101). ConZ never claims availability it has not established. A job booked against a site with unknown or low recorded
-- stock therefore shows "availability not yet confirmed" until the assigned driver (who knows where materials can be
-- sourced) or an admin records that the supply is confirmed.
--
-- This migration:
--   * job_supply_confirmations: one row per job, written only by confirm_job_supply (append-once, first confirmation wins).
--     Separate table: no change to the jobs row or its guard triggers, so no money/commission/status column is touched.
--   * confirm_job_supply(job, note): assigned driver or admin; job must be accepted or in_progress; note <= 500 chars;
--     idempotent; notifies the customer once. Does NOT gate start_trip or payment (initial sourcing and the driver's own
--     sourcing are not blocked); it is information for the customer and the audit trail.
--   * RLS: the job's customer, its assigned driver and admins can read; nobody can write directly.
--
-- Deploy order: standalone (jobs, notifications, user_roles exist in production). App: driver job page button + customer
--   job page status line (uses supply_stock_status from 0101 for the unconfirmed label).
-- Rollback: drop function public.confirm_job_supply(uuid, text); drop table public.job_supply_confirmations;

create table if not exists public.job_supply_confirmations (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  confirmed_by uuid not null references auth.users(id),
  confirmed_by_role text not null check (confirmed_by_role in ('driver', 'admin')),
  note text check (note is null or length(note) <= 500),
  confirmed_at timestamptz not null default now()
);

alter table public.job_supply_confirmations enable row level security;

drop policy if exists "Job parties and admins read supply confirmations" on public.job_supply_confirmations;
create policy "Job parties and admins read supply confirmations"
  on public.job_supply_confirmations for select to authenticated
  using (
    exists (select 1 from public.jobs j
             where j.id = job_supply_confirmations.job_id
               and (j.customer_id = auth.uid() or j.driver_id = auth.uid()))
    or public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

revoke all on table public.job_supply_confirmations from public, anon, authenticated;
grant select on table public.job_supply_confirmations to authenticated;
grant all on table public.job_supply_confirmations to service_role;

create or replace function public.confirm_job_supply(_job_id uuid, _note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _job public.jobs%rowtype;
  _role text;
  _clean text := nullif(btrim(coalesce(_note, '')), '');
  _inserted integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if _clean is not null and length(_clean) > 500 then
    raise exception 'The note can be at most 500 characters';
  end if;

  select * into _job from public.jobs where id = _job_id for update;
  if not found then
    raise exception 'Job not found';
  end if;

  if public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'super_admin'::public.app_role) then
    _role := 'admin';
  elsif _job.driver_id is not null and _job.driver_id = auth.uid() then
    _role := 'driver';
  else
    raise exception 'Only the assigned driver or an admin can confirm the supply' using errcode = '42501';
  end if;

  if _job.status::text not in ('accepted', 'in_progress') then
    raise exception 'This job is not active yet (status %), so there is no supply to confirm', _job.status;
  end if;

  insert into public.job_supply_confirmations (job_id, confirmed_by, confirmed_by_role, note)
  values (_job_id, auth.uid(), _role, _clean)
  on conflict (job_id) do nothing;
  get diagnostics _inserted = row_count;

  if _inserted = 0 then
    return jsonb_build_object('confirmed', true, 'already', true);
  end if;

  insert into public.notifications (user_id, type, title, body, job_id)
  values (_job.customer_id, 'supply_confirmed', 'Supply confirmed',
          case when _role = 'driver' then 'Your driver has confirmed where your material will be loaded.'
               else 'ConZ has confirmed the supply for your order.' end,
          _job_id);

  return jsonb_build_object('confirmed', true, 'already', false);
end $$;

comment on function public.confirm_job_supply(uuid, text) is
  '0104: the assigned driver or an admin records that supply for an active job is confirmed. Idempotent; first confirmation wins; notifies the customer once. Not a gate for start_trip or payment.';

revoke all on function public.confirm_job_supply(uuid, text) from public, anon;
grant execute on function public.confirm_job_supply(uuid, text) to authenticated, service_role;
