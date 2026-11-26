-- Undo 0180: restores the 0179 bodies of job_payment_plan and direct_payment_stage_row (NOT null-safe; see 0180).

create or replace function public.job_payment_plan(_job uuid)
returns table (stage text, expected_amount numeric, due text, method_agreed text, recipient_name text,
               recipient_account text, payment_instructions text, agreement_id uuid)
language plpgsql stable security definer set search_path to 'public' as $$
declare _j public.jobs; _a public.job_agreements; _fare numeric;
begin
  select * into _j from public.jobs where id = _job;
  if not found then raise exception 'Job not found'; end if;
  if not (auth.uid() in (_j.customer_id, _j.driver_id)
          or public.has_role(auth.uid(), 'admin'::public.app_role)
          or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Only the customer or the driver of this job can see its payment plan' using errcode = '42501';
  end if;
  select * into _a from public.job_agreements a where a.job_id = _job and a.status = 'accepted' order by a.version desc limit 1;
  _fare := coalesce(_a.fare, _j.final_price, _j.budget);
  if _a.id is null or coalesce(_a.deposit_amount, 0) = 0 then
    return query select 'full'::text, _fare, coalesce(_a.payment_timing, 'as_agreed'), coalesce(_a.payment_channel, _a.payment_method),
                        _a.recipient_name, _a.recipient_account, _a.payment_instructions, _a.id;
  elsif _a.deposit_amount >= _fare then
    return query select 'full'::text, _fare, _a.deposit_due, coalesce(_a.payment_channel, _a.payment_method),
                        _a.recipient_name, _a.recipient_account, _a.payment_instructions, _a.id;
  else
    return query select 'deposit'::text, _a.deposit_amount, _a.deposit_due, coalesce(_a.payment_channel, _a.payment_method),
                        _a.recipient_name, _a.recipient_account, _a.payment_instructions, _a.id
                 union all
                 select 'balance'::text, _fare - _a.deposit_amount, _a.payment_timing, coalesce(_a.payment_channel, _a.payment_method),
                        _a.recipient_name, _a.recipient_account, _a.payment_instructions, _a.id;
  end if;
end $$;
revoke all on function public.job_payment_plan(uuid) from public, anon;
grant execute on function public.job_payment_plan(uuid) to authenticated;

create or replace function public.direct_payment_stage_row(_job uuid, _stage text)
returns public.direct_payment_stages
language plpgsql security definer set search_path to 'public' as $$
declare _p record; _j public.jobs; _row public.direct_payment_stages;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _j from public.jobs where id = _job for update;
  if not found or auth.uid() not in (_j.customer_id, _j.driver_id) then
    raise exception 'Only the customer or the driver of this job can record its payments.' using errcode = '42501';
  end if;
  if _j.payment_method is distinct from 'direct' then raise exception 'This job was not paid directly to the driver.'; end if;
  if _j.driver_id is null or _j.status not in ('accepted', 'in_progress', 'completed') then
    raise exception 'Payments can only be recorded on an active or completed job.';
  end if;
  select * into _row from public.direct_payment_stages where job_id = _job and stage = _stage for update;
  if found then return _row; end if;
  select * into _p from public.job_payment_plan(_job) p where p.stage = _stage;
  if not found then raise exception 'This job has no % payment in its agreement.', _stage; end if;
  insert into public.direct_payment_stages (job_id, stage, agreement_id, expected_amount, due, method_agreed,
                                            recipient_name, recipient_account)
  values (_job, _stage, _p.agreement_id, _p.expected_amount, _p.due, _p.method_agreed, _p.recipient_name, _p.recipient_account)
  returning * into _row;
  return _row;
end $$;
revoke all on function public.direct_payment_stage_row(uuid, text) from public, anon, authenticated;
