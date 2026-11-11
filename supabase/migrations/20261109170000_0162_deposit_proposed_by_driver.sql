-- 0162: the deposit is Driver-proposed and Customer-accepted (owner's product rule). Until now either side could set it.
-- A customer's new version of the agreement keeps the deposit of the latest non-declined version; asking for a different
-- amount is refused. The driver can propose any amount up to the fare. Nothing about ConZ money changes: the deposit is
-- paid straight to the driver. Function replacement only: no table, grant or data change; the undo restores the 0157 body.
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
  _carried numeric;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _j from public.jobs where id = _job for update;
  if not found then raise exception 'Job not found'; end if;
  if auth.uid() not in (_j.customer_id, _j.driver_id) then raise exception 'Only the customer or the driver of this job can do that'; end if;
  if _j.status not in ('accepted', 'in_progress') then raise exception 'The agreement can only be set while the job is assigned and not yet finished'; end if;
  _fare := coalesce(_j.final_price, _j.budget);
  if not public.is_valid_money(_fare) then raise exception 'This job has no valid agreed price'; end if;
  if coalesce(_deposit_amount, 0) < 0 or coalesce(_deposit_amount, 0) > _fare then raise exception 'The deposit cannot be more than the fare'; end if;

  -- The deposit is the driver's to propose. The customer can accept or decline it but not set or change it: a customer's
  -- new version keeps the deposit of the latest version that was not declined.
  select deposit_amount into _carried from public.job_agreements
   where job_id = _job and status <> 'declined' order by version desc limit 1;
  _carried := coalesce(_carried, 0);
  if auth.uid() = _j.customer_id and coalesce(_deposit_amount, 0) <> _carried then
    raise exception 'Only the driver can propose or change a deposit';
  end if;

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
