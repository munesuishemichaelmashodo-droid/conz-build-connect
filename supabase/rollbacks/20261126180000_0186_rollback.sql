-- Undo 0186 (SQL editor: contains DROP). Restores accept_job_agreement and propose_job_agreement_terms to their
-- previous bodies, removes the snapshot/immutability/audit triggers and the new functions. Keeps the snapshot columns
-- and job_agreement_events (history is not thrown away); drop them by hand only if the owner asks.
drop trigger if exists trg_job_agreement_snapshot on public.job_agreements;
drop trigger if exists trg_job_agreement_immutable on public.job_agreements;
drop trigger if exists trg_job_agreement_log on public.job_agreements;
drop trigger if exists trg_job_agreed_details_changed on public.jobs;
drop trigger if exists trg_job_agreement_events_append_only on public.job_agreement_events;
drop function if exists public.job_agreement_in_force(uuid);
drop function if exists public.propose_job_agreement_full(uuid, text, text, numeric, text, text, text, text, text, text, text, text, text, text, text, text, text, date);
drop function if exists public.tg_job_agreement_snapshot();
drop function if exists public.tg_job_agreement_immutable();
drop function if exists public.tg_job_agreement_log();
drop function if exists public.tg_job_agreed_details_changed();
drop function if exists public.tg_job_agreement_events_append_only();
drop function if exists public.job_agreement_actor_role(uuid, uuid);
drop function if exists public.job_agreement_changed_fields(jsonb, jsonb);
drop function if exists public.job_agreement_row_facts(public.job_agreements);
drop function if exists public.job_agreement_job_facts(uuid);

-- accept_job_agreement as in 0157 (unchanged by 0162/0163/0179):
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

-- propose_job_agreement_terms as in 0179:
create or replace function public.propose_job_agreement_terms(
  _job uuid,
  _payment_method text,
  _payment_timing text,
  _deposit_amount numeric default 0,
  _deposit_due text default null,
  _deposit_reason text default null,
  _recipient_name text default null,
  _recipient_account text default null,
  _payment_instructions text default null,
  _cancellation_terms text default null,
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
  _in_force public.job_agreements;
  _other uuid;
  _is_customer boolean;
  _dep numeric := round(coalesce(_deposit_amount, 0), 2);
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into _j from public.jobs where id = _job for update;
  if not found then raise exception 'Job not found'; end if;
  if auth.uid() not in (_j.customer_id, _j.driver_id) then raise exception 'Only the customer or the driver of this job can do that'; end if;
  if _j.status not in ('accepted', 'in_progress') then raise exception 'The agreement can only be set while the job is assigned and not yet finished'; end if;
  _fare := coalesce(_j.final_price, _j.budget);
  if not public.is_valid_money(_fare) then raise exception 'This job has no valid agreed price'; end if;
  if _payment_method is null or _payment_method not in ('cash', 'ecocash', 'onemoney', 'innbucks', 'zipit', 'bank_transfer', 'other') then
    raise exception 'Choose a payment method';
  end if;
  if _payment_timing is null or _payment_timing not in ('on_delivery', 'on_pickup', 'before_pickup', 'other') then
    raise exception 'Choose when the payment is due';
  end if;
  _is_customer := auth.uid() = _j.customer_id;

  -- The terms in force: the newest version still proposed or accepted (0163 rule).
  select * into _in_force from public.job_agreements
   where job_id = _job and status in ('proposed', 'accepted') order by version desc limit 1;

  if _is_customer then
    -- Deposit, its timing and reason, and where the driver is paid are the driver's to set.
    if _dep <> coalesce(_in_force.deposit_amount, 0) then
      raise exception 'Only the driver can propose or change a deposit';
    end if;
    _deposit_due := _in_force.deposit_due;
    _deposit_reason := _in_force.deposit_reason;
    _recipient_name := _in_force.recipient_name;
    _recipient_account := _in_force.recipient_account;
    _payment_instructions := _in_force.payment_instructions;
  end if;

  if _dep < 0 or _dep > _fare then raise exception 'The deposit cannot be more than the fare'; end if;
  if _dep > 0 and (_deposit_due is null or _deposit_due not in ('on_agreement', 'before_pickup', 'on_pickup')) then
    raise exception 'Say when the deposit is due';
  end if;
  if _dep = 0 then _deposit_due := null; _deposit_reason := null; end if;

  select coalesce(max(version), 0) + 1 into _next from public.job_agreements where job_id = _job;
  update public.job_agreements set status = 'superseded' where job_id = _job and status = 'proposed';

  insert into public.job_agreements (job_id, version, proposed_by, fare, payment_method, payment_channel, payment_timing, deposit_amount,
                                     deposit_due, deposit_reason, recipient_name, recipient_account, payment_instructions,
                                     cancellation_terms, pickup_window, delivery_window, inclusions, exclusions,
                                     customer_accepted_at, driver_accepted_at)
  values (_job, _next, auth.uid(), _fare,
          case when _payment_method in ('cash', 'ecocash', 'bank_transfer') then _payment_method else 'other' end,
          _payment_method, _payment_timing, _dep,
          _deposit_due, nullif(btrim(_deposit_reason), ''), nullif(btrim(_recipient_name), ''),
          nullif(btrim(_recipient_account), ''), nullif(btrim(_payment_instructions), ''),
          nullif(btrim(_cancellation_terms), ''),
          nullif(btrim(_pickup_window), ''), nullif(btrim(_delivery_window), ''),
          nullif(btrim(_inclusions), ''), nullif(btrim(_exclusions), ''),
          case when _is_customer then now() end,
          case when not _is_customer then now() end)
  returning * into _row;

  _other := case when _is_customer then _j.driver_id else _j.customer_id end;
  begin
    insert into public.notifications (user_id, type, title, body, job_id)
    values (_other, 'job_agreement', 'Agreement to confirm',
            'The other person set out the price, payment and timing for this delivery. Open the job to confirm or change it.', _job);
  exception when others then
    raise warning 'agreement notice failed: %', sqlerrm;
  end;
  return _row;
end $$;
revoke all on function public.propose_job_agreement_terms(uuid, text, text, numeric, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.propose_job_agreement_terms(uuid, text, text, numeric, text, text, text, text, text, text, text, text, text, text) to authenticated;
