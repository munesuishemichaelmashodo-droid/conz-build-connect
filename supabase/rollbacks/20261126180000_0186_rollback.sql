-- Recovery for 0186 — forward-safe, run in the SQL editor only if 0186 causes a problem in production.
--
-- This script deliberately does NOT remove the protections 0186 adds: the snapshot, the immutability guard on
-- agreement versions, the append-only history and the content hash stay in place, and no recorded version, history
-- row or payment term is touched. Removing them would let agreement records be rewritten again.
--
-- What it does undo is the one behaviour change that could block people: accepting a version that was proposed before
-- the job changed. accept_job_agreement goes back to its 0157 body plus the null-safe party check, so customers and
-- drivers can always confirm. The change is still recorded in job_agreement_events and shown by job_agreement_in_force.
-- propose_job_agreement_terms and propose_job_agreement_full keep working.
--
-- If a protection itself is found to be wrong, fix it forward with a new migration instead of dropping it.

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
  if not coalesce(auth.uid() in (_j.customer_id, _j.driver_id), false) then
    raise exception 'Only the customer or the driver of this job can do that' using errcode = '42501';
  end if;
  if _a.status <> 'proposed' then raise exception 'This version is no longer open'; end if;
  if _j.status not in ('accepted', 'in_progress') then raise exception 'The job is no longer open for changes'; end if;
  if auth.uid() = _a.proposed_by then raise exception 'The other person has to confirm your proposal'; end if;

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
