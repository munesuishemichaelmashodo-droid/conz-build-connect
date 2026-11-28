-- Recovery for 0191 — forward-safe. Run in the SQL editor only if 0191 causes a problem in production.
-- Keeps every compliance record and its history and the guards that stop them being edited or deleted.
-- It can lift the one restriction (expired licence -> no new offers) by turning that trigger into a pass-through,
-- and pause the daily expiry sweep. Re-create them from 0191 to restore.
create or replace function public.tg_bid_requires_unexpired_licence()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  return new;
end $$;
select cron.alter_job(jobid, active := false) from cron.job where jobname = 'compliance-expiry-sweep';
