-- -----------------------------------------------------------------------------
-- 0179: payment terms in the job agreement, and direct payments recorded per stage (deposit / balance / full).
--
-- Business model (owner, 26/11/2026): the customer pays the driver directly; ConZ never collects, holds or guarantees
-- the fare. ConZ records what the two parties agreed and what each of them says happened.
--
-- 1. job_agreements (0157/0162/0163) gains the driver's payment details and the stages:
--      recipient_name, recipient_account (e.g. an EcoCash number), payment_instructions,
--      deposit_due (when a deposit is due), deposit_reason, cancellation_terms;
--      payment_channel: the exact method (cash, ecocash, onemoney, innbucks, zipit, bank_transfer, other). The older
--      payment_method column keeps its four values (others are stored there as 'other'), so no constraint is dropped.
--    The plans it supports:
--      no deposit                 deposit 0, the whole price due at payment_timing;
--      deposit + balance          0 < deposit < price: deposit due at deposit_due, the rest at payment_timing;
--      full advance               deposit = price, due at deposit_due;
--      payment after delivery     deposit 0, payment_timing = on_delivery.
--    propose_job_agreement_terms() is propose_job_agreement() (0163) with the new fields. The driver alone sets the
--    deposit, the recipient details and the instructions; a customer's counter-proposal carries the ones in force.
--    The old function is kept unchanged for app versions still running it.
--    Payment details are readable only by the job's customer and driver and admins (existing job_agreements policy).
--
-- 2. direct_payment_stages: one row per job and stage ('deposit', 'balance' or 'full'), created when a party first
--    records something for that stage. Each row snapshots the expected amount, due stage, method and recipient from
--    the accepted agreement, then holds three write-once statements:
--      the customer's claim ("I paid": method, amount, reference),
--      the driver's confirmation ("I received": method, amount, reference),
--      the customer's acknowledgement of the driver's confirmation.
--    Nothing is overwritten and nothing is deleted. A deposit and a balance are separate rows, so recording the
--    balance never touches the deposit. Every statement is also written to direct_payment_stage_events
--    (append-only). Amounts that differ from what was agreed, or from each other, alert admins.
--    Neither statement is proof of settlement; commission is never changed by any of this.
--    0176's direct_payment_confirmations stays as it is (history); the app records new confirmations here.
--
-- No DROP, no DELETE. Undo: supabase/rollbacks/20261126110000_0179_rollback.sql.
-- Tests: supabase/tests/database/1130_agreement_terms_payment_stages.test.sql
-- -----------------------------------------------------------------------------

-- 1. Agreement payment terms --------------------------------------------------------------------------------------
alter table public.job_agreements
  add column if not exists recipient_name text check (recipient_name is null or (char_length(recipient_name) <= 100 and recipient_name !~ '[[:cntrl:]]')),
  add column if not exists recipient_account text check (recipient_account is null or (char_length(recipient_account) <= 60 and recipient_account !~ '[[:cntrl:]]')),
  add column if not exists payment_instructions text check (payment_instructions is null or char_length(payment_instructions) <= 500),
  add column if not exists deposit_due text check (deposit_due is null or deposit_due in ('on_agreement', 'before_pickup', 'on_pickup')),
  add column if not exists deposit_reason text check (deposit_reason is null or char_length(deposit_reason) <= 200),
  add column if not exists cancellation_terms text check (cancellation_terms is null or char_length(cancellation_terms) <= 500),
  add column if not exists payment_channel text check (payment_channel is null or payment_channel in
    ('cash', 'ecocash', 'onemoney', 'innbucks', 'zipit', 'bank_transfer', 'other'));

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

-- 2. Payment stages -----------------------------------------------------------------------------------------------
create table if not exists public.direct_payment_stages (
  id                       uuid primary key default gen_random_uuid(),
  job_id                   uuid not null references public.jobs(id),
  stage                    text not null check (stage in ('deposit', 'balance', 'full')),
  agreement_id             uuid references public.job_agreements(id),
  expected_amount          numeric(12, 2) not null check (expected_amount > 0 and expected_amount <= 100000),
  currency                 text not null default 'USD' check (currency = 'USD'),
  due                      text,
  method_agreed            text,
  recipient_name           text,
  recipient_account        text,
  customer_claimed_at      timestamptz,
  customer_method          text,
  customer_amount          numeric(12, 2) check (customer_amount is null or (customer_amount > 0 and customer_amount <= 100000)),
  customer_reference       text check (customer_reference is null or (length(customer_reference) between 1 and 100 and customer_reference !~ '[[:cntrl:]]')),
  driver_confirmed_at      timestamptz,
  driver_method            text,
  driver_amount            numeric(12, 2) check (driver_amount is null or (driver_amount > 0 and driver_amount <= 100000)),
  driver_reference         text check (driver_reference is null or (length(driver_reference) between 1 and 100 and driver_reference !~ '[[:cntrl:]]')),
  customer_acknowledged_at timestamptz,
  created_at               timestamptz not null default now(),
  unique (job_id, stage),
  check ((customer_claimed_at is null) = (customer_amount is null)),
  check ((driver_confirmed_at is null) = (driver_amount is null)),
  check (customer_acknowledged_at is null or driver_confirmed_at is not null)
);

create table if not exists public.direct_payment_stage_events (
  id         bigint generated always as identity primary key,
  stage_id   uuid not null references public.direct_payment_stages(id),
  job_id     uuid not null,
  stage      text not null,
  actor      uuid not null,
  action     text not null check (action in ('customer_claimed', 'driver_confirmed', 'customer_acknowledged')),
  amount     numeric(12, 2),
  method     text,
  reference  text,
  created_at timestamptz not null default now()
);
create index if not exists direct_payment_stage_events_job on public.direct_payment_stage_events (job_id, created_at);

-- Write-once: the snapshot never changes; each statement, once made, never changes; nothing is deleted.
create or replace function public.direct_payment_stages_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'A payment record cannot be deleted. Raise a dispute instead.' using errcode = '42501';
  end if;
  if new.job_id <> old.job_id or new.stage <> old.stage or new.expected_amount <> old.expected_amount
     or new.agreement_id is distinct from old.agreement_id or new.recipient_account is distinct from old.recipient_account
     or (old.customer_claimed_at is not null and (new.customer_claimed_at, new.customer_method, new.customer_amount, new.customer_reference)
         is distinct from (old.customer_claimed_at, old.customer_method, old.customer_amount, old.customer_reference))
     or (old.driver_confirmed_at is not null and (new.driver_confirmed_at, new.driver_method, new.driver_amount, new.driver_reference)
         is distinct from (old.driver_confirmed_at, old.driver_method, old.driver_amount, old.driver_reference))
     or (old.customer_acknowledged_at is not null and new.customer_acknowledged_at is distinct from old.customer_acknowledged_at) then
    raise exception 'A payment record cannot be changed. Raise a dispute instead.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.direct_payment_stages_guard() from public, anon, authenticated;
create or replace trigger trg_direct_payment_stages_guard
  before update or delete on public.direct_payment_stages
  for each row execute function public.direct_payment_stages_guard();

create or replace function public.direct_payment_stage_events_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Payment history is append-only.' using errcode = '42501';
end $$;
revoke all on function public.direct_payment_stage_events_append_only() from public, anon, authenticated;
create or replace trigger trg_direct_payment_stage_events_append_only
  before update or delete on public.direct_payment_stage_events
  for each row execute function public.direct_payment_stage_events_append_only();

alter table public.direct_payment_stages enable row level security;
alter table public.direct_payment_stage_events enable row level security;
revoke all on public.direct_payment_stages, public.direct_payment_stage_events from public, anon, authenticated;
grant select on public.direct_payment_stages, public.direct_payment_stage_events to authenticated;
grant all on public.direct_payment_stages, public.direct_payment_stage_events to service_role;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'direct_payment_stages' and policyname = 'direct_payment_stages_parties_read') then
    create policy direct_payment_stages_parties_read on public.direct_payment_stages for select to authenticated
      using (exists (select 1 from public.jobs j where j.id = job_id and auth.uid() in (j.customer_id, j.driver_id))
             or public.has_role(auth.uid(), 'admin'::public.app_role)
             or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'direct_payment_stage_events' and policyname = 'direct_payment_stage_events_parties_read') then
    create policy direct_payment_stage_events_parties_read on public.direct_payment_stage_events for select to authenticated
      using (exists (select 1 from public.jobs j where j.id = job_id and auth.uid() in (j.customer_id, j.driver_id))
             or public.has_role(auth.uid(), 'admin'::public.app_role)
             or public.has_role(auth.uid(), 'super_admin'::public.app_role));
  end if;
end $$;

-- The payment plan of a job, from its newest ACCEPTED agreement (or the agreed price when there is none).
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

-- Shared: the job (locked), the caller's side, and the stage row (created from the plan on first use).
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

create or replace function public.direct_payment_check_statement(_method text, _amount numeric, _reference text)
returns void language plpgsql immutable set search_path to 'public' as $$
begin
  if _method is null or _method not in ('cash', 'ecocash', 'onemoney', 'innbucks', 'zipit', 'bank_transfer', 'other') then
    raise exception 'Choose the payment method.';
  end if;
  if _amount is null or not public.is_valid_money(round(_amount, 2)) or _amount <= 0 then
    raise exception 'Enter the amount.';
  end if;
  if _reference is not null and (length(_reference) > 100 or _reference ~ '[[:cntrl:]]') then
    raise exception 'The payment reference is too long or has invalid characters.';
  end if;
end $$;
revoke all on function public.direct_payment_check_statement(text, numeric, text) from public, anon, authenticated;

create or replace function public.direct_payment_flag_mismatch(_row public.direct_payment_stages)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if (_row.customer_amount is not null and _row.customer_amount <> _row.expected_amount)
     or (_row.driver_amount is not null and _row.driver_amount <> _row.expected_amount)
     or (_row.customer_amount is not null and _row.driver_amount is not null and _row.customer_amount <> _row.driver_amount) then
    insert into public.notifications (user_id, type, title, body, job_id)
    select distinct ur.user_id, 'payment_anomaly', 'Direct payment amounts do not match',
           format('Job %s, %s payment: agreed $%s; customer says $%s; driver says $%s. Commission is unchanged.',
                  _row.job_id, _row.stage, _row.expected_amount,
                  coalesce(_row.customer_amount::text, '-'), coalesce(_row.driver_amount::text, '-')),
           _row.job_id
      from public.user_roles ur where ur.role in ('admin', 'super_admin');
  end if;
end $$;
revoke all on function public.direct_payment_flag_mismatch(public.direct_payment_stages) from public, anon, authenticated;

-- "I paid the driver" (customer).
create or replace function public.customer_claim_stage_payment(_job uuid, _stage text, _method text, _amount numeric,
                                                                _reference text default null)
returns public.direct_payment_stages
language plpgsql security definer set search_path to 'public' as $$
declare _j public.jobs; _row public.direct_payment_stages; _ref text := nullif(btrim(coalesce(_reference, '')), '');
        _amt numeric := round(_amount, 2);
begin
  _row := public.direct_payment_stage_row(_job, _stage);
  select * into _j from public.jobs where id = _job;
  if auth.uid() is distinct from _j.customer_id then
    raise exception 'Only the customer can say they paid.' using errcode = '42501';
  end if;
  perform public.direct_payment_check_statement(_method, _amt, _ref);
  if _row.customer_claimed_at is not null then
    if _row.customer_method = _method and _row.customer_amount = _amt and _row.customer_reference is not distinct from _ref then
      return _row;
    end if;
    raise exception 'You already recorded this payment. If something is wrong, raise a dispute.';
  end if;
  update public.direct_payment_stages
     set customer_claimed_at = now(), customer_method = _method, customer_amount = _amt, customer_reference = _ref
   where id = _row.id returning * into _row;
  insert into public.direct_payment_stage_events (stage_id, job_id, stage, actor, action, amount, method, reference)
  values (_row.id, _job, _stage, auth.uid(), 'customer_claimed', _amt, _method, _ref);
  insert into public.notifications (user_id, type, title, body, job_id)
  values (_j.driver_id, 'payment_reported', 'Customer says they paid you',
          format('The customer says they paid the %s: $%s (%s). Check you received it, then confirm it on the job. Con Z did not handle this payment.',
                 case _stage when 'full' then 'job' else _stage end, _amt, replace(_method, '_', ' ')),
          _job);
  perform public.direct_payment_flag_mismatch(_row);
  return _row;
end $$;

-- "I received it" (driver).
create or replace function public.driver_confirm_stage_payment(_job uuid, _stage text, _method text, _amount numeric,
                                                                _reference text default null)
returns public.direct_payment_stages
language plpgsql security definer set search_path to 'public' as $$
declare _j public.jobs; _row public.direct_payment_stages; _ref text := nullif(btrim(coalesce(_reference, '')), '');
        _amt numeric := round(_amount, 2);
begin
  _row := public.direct_payment_stage_row(_job, _stage);
  select * into _j from public.jobs where id = _job;
  if auth.uid() is distinct from _j.driver_id then
    raise exception 'Only the driver can confirm receiving a payment.' using errcode = '42501';
  end if;
  perform public.direct_payment_check_statement(_method, _amt, _ref);
  if _row.driver_confirmed_at is not null then
    if _row.driver_method = _method and _row.driver_amount = _amt and _row.driver_reference is not distinct from _ref then
      return _row;
    end if;
    raise exception 'You already confirmed this payment. If something is wrong, raise a dispute.';
  end if;
  update public.direct_payment_stages
     set driver_confirmed_at = now(), driver_method = _method, driver_amount = _amt, driver_reference = _ref
   where id = _row.id returning * into _row;
  insert into public.direct_payment_stage_events (stage_id, job_id, stage, actor, action, amount, method, reference)
  values (_row.id, _job, _stage, auth.uid(), 'driver_confirmed', _amt, _method, _ref);
  insert into public.notifications (user_id, type, title, body, job_id)
  values (_j.customer_id, 'payment_confirmed', 'Driver confirmed your payment',
          format('Your driver confirmed receiving the %s: $%s (%s). Con Z did not handle this payment.',
                 case _stage when 'full' then 'payment' else _stage end, _amt, replace(_method, '_', ' ')),
          _job);
  perform public.direct_payment_flag_mismatch(_row);
  return _row;
end $$;

-- "That is what I paid" (customer agrees with the driver's confirmation).
create or replace function public.customer_acknowledge_stage_payment(_job uuid, _stage text)
returns public.direct_payment_stages
language plpgsql security definer set search_path to 'public' as $$
declare _j public.jobs; _row public.direct_payment_stages;
begin
  _row := public.direct_payment_stage_row(_job, _stage);
  select * into _j from public.jobs where id = _job;
  if auth.uid() is distinct from _j.customer_id then
    raise exception 'Only the customer can agree with the driver''s confirmation.' using errcode = '42501';
  end if;
  if _row.driver_confirmed_at is null then raise exception 'The driver has not confirmed this payment yet.'; end if;
  if _row.customer_acknowledged_at is not null then return _row; end if;
  update public.direct_payment_stages set customer_acknowledged_at = now() where id = _row.id returning * into _row;
  insert into public.direct_payment_stage_events (stage_id, job_id, stage, actor, action, amount)
  values (_row.id, _job, _stage, auth.uid(), 'customer_acknowledged', _row.driver_amount);
  return _row;
end $$;

revoke all on function public.customer_claim_stage_payment(uuid, text, text, numeric, text) from public, anon;
revoke all on function public.driver_confirm_stage_payment(uuid, text, text, numeric, text) from public, anon;
revoke all on function public.customer_acknowledge_stage_payment(uuid, text) from public, anon;
grant execute on function public.customer_claim_stage_payment(uuid, text, text, numeric, text) to authenticated;
grant execute on function public.driver_confirm_stage_payment(uuid, text, text, numeric, text) to authenticated;
grant execute on function public.customer_acknowledge_stage_payment(uuid, text) to authenticated;
