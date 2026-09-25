-- Recovered verbatim from live supabase_migrations.schema_migrations on
-- 2026-09-25 (was applied live without a committed file).
-- Prevents a driver from inserting a bid on a job that is no longer
-- accepting bids (already assigned/accepted, cancelled, completed, or
-- past its bidding window). Previously only enforced client-side.
create or replace function public.tg_guard_bid_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _job public.jobs;
begin
  select * into _job from public.jobs where id = new.job_id for share;

  if not found then
    raise exception 'Job not found' using errcode = '42501';
  end if;

  if _job.status <> 'open' then
    raise exception 'This job has already been assigned to another driver.' using errcode = '42501';
  end if;

  if _job.driver_id is not null then
    raise exception 'This job has already been assigned to another driver.' using errcode = '42501';
  end if;

  if _job.expires_at is not null and _job.expires_at < now() then
    raise exception 'The bidding window for this job has expired.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_bid_insert on public.bids;
create trigger trg_guard_bid_insert
  before insert on public.bids
  for each row execute function public.tg_guard_bid_insert();
