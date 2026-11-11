-- 0157: job agreement card. After a customer chooses a driver, the two of them confirm in one place what was agreed:
-- the fare (read from the job, never typed), how and when it is paid, any deposit paid TO THE DRIVER, what is included
-- and excluded, and when pickup/delivery should happen. Versioned: a change is a new version, the old one is kept as
-- history; each side accepts explicitly.
--
-- Money: this is a record between the two people. It never touches wallets, commission, the job price or any payment
-- table: the fare is copied from jobs.final_price (or budget) at proposal time, and ConZ does not hold or move the deposit.
-- Access: participants and admins can read; nobody writes the table directly (functions only).
-- No DROP. Undo: supabase/rollbacks/20261109120000_0157_rollback.sql (has DROP: SQL editor).

create table if not exists public.job_agreements (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  version integer not null check (version >= 1),
  proposed_by uuid not null references auth.users(id),
  fare numeric(12,2) not null check (fare > 0),
  payment_method text not null check (payment_method in ('cash', 'ecocash', 'bank_transfer', 'other')),
  payment_timing text not null check (payment_timing in ('on_delivery', 'on_pickup', 'before_pickup', 'other')),
  deposit_amount numeric(12,2) not null default 0 check (deposit_amount >= 0),
  pickup_window text check (pickup_window is null or char_length(pickup_window) <= 120),
  delivery_window text check (delivery_window is null or char_length(delivery_window) <= 120),
  inclusions text check (inclusions is null or char_length(inclusions) <= 500),
  exclusions text check (exclusions is null or char_length(exclusions) <= 500),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'superseded', 'declined')),
  customer_accepted_at timestamptz,
  driver_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, version),
  check (deposit_amount <= fare)
);
create index if not exists job_agreements_job_idx on public.job_agreements (job_id, version desc);

alter table public.job_agreements enable row level security;
revoke all on public.job_agreements from public, anon, authenticated;
grant select on public.job_agreements to authenticated;

create policy "Participants and admins read agreements" on public.job_agreements
  for select to authenticated
  using (
    exists (select 1 from public.jobs j
             where j.id = job_agreements.job_id
               and (j.customer_id = auth.uid() or j.driver_id = auth.uid()))
    or public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- Propose (or change) the agreement. The proposer's side is accepted automatically; the other side must accept.
create or replace function public.propose_job_agreement(
  _job uuid,
  _payment_method text,
  _payment_timing text,
  _deposit_amount numeric default 0,
  _pickup_window text default null,
  _delivery_window text default null,
  _inclusions text default null,
  _exclusions text default null
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
  _other uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _j from public.jobs where id = _job for update;
  if not found then raise exception 'Job not found'; end if;
  if auth.uid() not in (_j.customer_id, _j.driver_id) then raise exception 'Only the customer or the driver of this job can do that'; end if;
  if _j.status not in ('accepted', 'in_progress') then raise exception 'The agreement can only be set while the job is assigned and not yet finished'; end if;
  _fare := coalesce(_j.final_price, _j.budget);
  if not public.is_valid_money(_fare) then raise exception 'This job has no valid agreed price'; end if;
  if coalesce(_deposit_amount, 0) < 0 or coalesce(_deposit_amount, 0) > _fare then raise exception 'The deposit cannot be more than the fare'; end if;

  select coalesce(max(version), 0) + 1 into _next from public.job_agreements where job_id = _job;
  update public.job_agreements set status = 'superseded' where job_id = _job and status = 'proposed';

  insert into public.job_agreements (job_id, version, proposed_by, fare, payment_method, payment_timing, deposit_amount,
                                     pickup_window, delivery_window, inclusions, exclusions,
                                     customer_accepted_at, driver_accepted_at)
  values (_job, _next, auth.uid(), _fare, _payment_method, _payment_timing, coalesce(_deposit_amount, 0),
          nullif(btrim(_pickup_window), ''), nullif(btrim(_delivery_window), ''),
          nullif(btrim(_inclusions), ''), nullif(btrim(_exclusions), ''),
          case when auth.uid() = _j.customer_id then now() end,
          case when auth.uid() = _j.driver_id then now() end)
  returning * into _row;

  _other := case when auth.uid() = _j.customer_id then _j.driver_id else _j.customer_id end;
  begin
    insert into public.notifications (user_id, type, title, body, job_id)
    values (_other, 'job_agreement', 'Agreement to confirm',
            'The other person set out the fare, payment and timing for this delivery. Open the job to confirm or change it.', _job);
  exception when others then
    raise warning 'agreement notice failed: %', sqlerrm;
  end;
  return _row;
end $$;

-- The other side accepts the current proposal.
create or replace function public.accept_job_agreement(_agreement uuid)
returns public.job_agreements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _a public.job_agreements;
  _j public.jobs;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _a from public.job_agreements where id = _agreement for update;
  if not found then raise exception 'Agreement not found'; end if;
  select * into _j from public.jobs where id = _a.job_id for update;
  if auth.uid() not in (_j.customer_id, _j.driver_id) then raise exception 'Only the customer or the driver of this job can do that'; end if;
  if _a.status <> 'proposed' then raise exception 'This version is no longer open'; end if;
  if _j.status not in ('accepted', 'in_progress') then raise exception 'The job is no longer open for changes'; end if;
  if auth.uid() = _a.proposed_by then raise exception 'The other person has to confirm your proposal'; end if;

  update public.job_agreements
     set customer_accepted_at = case when auth.uid() = _j.customer_id then coalesce(customer_accepted_at, now()) else customer_accepted_at end,
         driver_accepted_at   = case when auth.uid() = _j.driver_id   then coalesce(driver_accepted_at, now())   else driver_accepted_at end,
         status = 'accepted'
   where id = _agreement
   returning * into _a;
  return _a;
end $$;

-- The other side turns the proposal down (they can then propose their own version).
create or replace function public.decline_job_agreement(_agreement uuid)
returns public.job_agreements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _a public.job_agreements;
  _j public.jobs;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _a from public.job_agreements where id = _agreement for update;
  if not found then raise exception 'Agreement not found'; end if;
  select * into _j from public.jobs where id = _a.job_id;
  if auth.uid() not in (_j.customer_id, _j.driver_id) then raise exception 'Only the customer or the driver of this job can do that'; end if;
  if _a.status <> 'proposed' then raise exception 'This version is no longer open'; end if;
  if auth.uid() = _a.proposed_by then raise exception 'Withdraw by proposing a new version instead'; end if;
  update public.job_agreements set status = 'declined' where id = _agreement returning * into _a;
  return _a;
end $$;

revoke all on function public.propose_job_agreement(uuid, text, text, numeric, text, text, text, text) from public, anon;
revoke all on function public.accept_job_agreement(uuid) from public, anon;
revoke all on function public.decline_job_agreement(uuid) from public, anon;
grant execute on function public.propose_job_agreement(uuid, text, text, numeric, text, text, text, text) to authenticated;
grant execute on function public.accept_job_agreement(uuid) to authenticated;
grant execute on function public.decline_job_agreement(uuid) to authenticated;
