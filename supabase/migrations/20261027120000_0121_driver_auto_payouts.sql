-- 0121 — automatic driver payouts for Con Z Pay (owner decision 27/10/2026: "Auto-pay to EcoCash")
--
-- When a Con Z Pay job paid through Payonify is released, the driver's share already lands in their
-- wallet (release_escrow_and_complete, unchanged). This migration then moves that amount straight out
-- again as an automatic payout to the driver's EcoCash, sent by the server through Payonify Relay.
--
--   * driver_profiles.payout_ecocash_number + set_payout_ecocash_number(): the driver's payout number.
--     Changing it needs the withdrawal PIN when one is set, and always notifies the driver.
--   * driver_payouts: one row per payout. Created by a trigger when a Payonify escrow payment becomes
--     'released'. The wallet is debited at once (wallet transaction + ledger 'withdrawal_paid'), so the
--     money can't be spent twice. Paynow escrow is unchanged (stays in the wallet).
--   * Status: waiting_for_number (driver has no number yet; nothing debited) -> queued -> sending ->
--     sent (Payonify accepted it) -> succeeded. A definitive failure returns the money to the wallet
--     (status returned, reversal transaction + ledger 'withdrawal_reversed'); 'not enough settled funds'
--     goes back to queued with a later retry time. An unclear outcome stays 'sending' and is looked up,
--     never sent blind again: every attempt for a row reuses the same idempotency key.
--   * Server-only functions (service_role): payout_claim_next, payout_record_sent, payout_record_result,
--     payout_release_waiting. Admin: admin_retry_payout (re-queue a returned payout; super admin + step-up).
--
-- No existing row, balance or ledger entry is changed. Undo: supabase/rollbacks/20261027120000_0121_rollback.sql.

begin;

-- 1. Payout number ---------------------------------------------------------------------------------

alter table public.driver_profiles
  add column if not exists payout_ecocash_number text,
  add column if not exists payout_number_changed_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'driver_profiles_payout_number_format') then
    alter table public.driver_profiles add constraint driver_profiles_payout_number_format
      check (payout_ecocash_number is null or payout_ecocash_number ~ '^7[1-8][0-9]{7}$');
  end if;
end $$;

-- Normalise a Zimbabwe mobile number to the 9-digit form Payonify uses (e.g. 0771 111 111 -> 771111111).
create or replace function public.normalize_zw_mobile(_input text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when d ~ '^2637[1-8][0-9]{7}$' then substr(d, 4)
    when d ~ '^07[1-8][0-9]{7}$'   then substr(d, 2)
    when d ~ '^7[1-8][0-9]{7}$'    then d
    else null end
  from (select regexp_replace(coalesce(_input, ''), '[^0-9]', '', 'g') as d) s
$$;

create or replace function public.set_payout_ecocash_number(_number text, _pin text default null)
returns text
language plpgsql security definer set search_path to 'public', 'extensions'
as $$
declare _uid uuid := auth.uid(); _n text := public.normalize_zw_mobile(_number); _check text; _old text;
begin
  if _uid is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if not public.has_role(_uid, 'driver') then raise exception 'Only drivers have a payout number' using errcode = '42501'; end if;
  if _n is null then raise exception 'Enter a valid EcoCash number, for example 0771 234 567'; end if;

  select payout_ecocash_number into _old from public.driver_profiles where user_id = _uid for update;
  if not found then raise exception 'Driver profile missing'; end if;
  if _old is not distinct from _n then return 'ok'; end if;

  -- Changing where money goes needs the withdrawal PIN when the driver has one. A wrong PIN returns
  -- (rather than raising) so the failed attempt still counts towards the lockout.
  _check := public.check_withdrawal_pin(_uid, _pin);
  if _check = 'locked' then return 'pin_locked'; end if;
  if _check = 'wrong' then return 'wrong_pin'; end if;

  update public.driver_profiles
     set payout_ecocash_number = _n, payout_number_changed_at = now()
   where user_id = _uid;

  insert into public.wallet_audit_log(user_id, actor_id, action, meta)
  values (_uid, _uid, 'payout_number_changed',
          jsonb_build_object('old_last4', right(coalesce(_old, ''), 4), 'new_last4', right(_n, 4)));
  insert into public.notifications(user_id, type, title, body)
  values (_uid, 'wallet_withdrawal', 'Payout number changed',
          format('Con Z Pay earnings will now be sent to EcoCash ending %s. If this wasn''t you, contact support now.',
                 right(_n, 4)));

  -- Payouts that were waiting for a number can go now.
  perform public.payout_release_waiting(_uid);
  return 'ok';
end $$;
revoke all on function public.set_payout_ecocash_number(text, text) from public, anon;
grant execute on function public.set_payout_ecocash_number(text, text) to authenticated;

-- 2. Payout records --------------------------------------------------------------------------------

create table if not exists public.driver_payouts (
  id               uuid primary key default gen_random_uuid(),
  driver_id        uuid not null references auth.users(id),
  job_id           uuid not null references public.jobs(id),
  payment_id       uuid not null references public.payments(id),
  amount           numeric(12,2) not null check (amount > 0 and amount <= 100000),
  commission       numeric(12,2) not null default 0 check (commission >= 0),
  currency         text not null default 'USD' check (currency in ('USD', 'ZWG')),
  livemode         boolean not null,
  ecocash_number   text check (ecocash_number is null or ecocash_number ~ '^7[1-8][0-9]{7}$'),
  status           text not null check (status in
                     ('waiting_for_number', 'queued', 'sending', 'sent', 'succeeded', 'returned')),
  idempotency_key  uuid not null default gen_random_uuid(),
  provider_reference text,
  net_amount       numeric(12,2),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  failure_code     text,
  failure_message  text,
  debit_tx_id      uuid,
  return_tx_id     uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  sent_at          timestamptz,
  completed_at     timestamptz,
  constraint driver_payouts_provider_reference_unique unique (provider_reference)
);
-- One live payout per job; a returned one may be re-queued by an admin (same row).
create unique index if not exists driver_payouts_one_per_job on public.driver_payouts (job_id);
create unique index if not exists driver_payouts_idempotency_key on public.driver_payouts (idempotency_key);
create index if not exists driver_payouts_due on public.driver_payouts (status, next_attempt_at);
create index if not exists driver_payouts_driver on public.driver_payouts (driver_id, created_at desc);

alter table public.driver_payouts enable row level security;
revoke all on table public.driver_payouts from public, anon, authenticated;
grant select on table public.driver_payouts to authenticated;
grant select on table public.driver_payouts to service_role;   -- writes go through the functions below

drop policy if exists driver_payouts_driver_read on public.driver_payouts;
create policy driver_payouts_driver_read on public.driver_payouts
  for select to authenticated using (driver_id = auth.uid());
drop policy if exists driver_payouts_admin_read on public.driver_payouts;
create policy driver_payouts_admin_read on public.driver_payouts
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

-- Debit the wallet for a payout (the money leaves for EcoCash). Internal.
create or replace function public._payout_debit(_p public.driver_payouts)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _w public.wallets; _new_bal numeric; _tx uuid;
begin
  select * into _w from public.wallets where user_id = _p.driver_id for update;
  if not found then raise exception 'Wallet missing for driver %', _p.driver_id; end if;
  if coalesce(_w.balance, 0) - coalesce(_w.held, 0) - coalesce(_w.withdrawal_reserved, 0) < _p.amount then
    return null;   -- not enough available: leave it in the wallet
  end if;
  update public.wallets set balance = balance - _p.amount, updated_at = now()
   where user_id = _p.driver_id returning balance into _new_bal;
  insert into public.wallet_transactions(user_id, type, amount, balance_after, job_id, note, created_by)
  values (_p.driver_id, 'withdrawal', -_p.amount, _new_bal, _p.job_id,
          format('Automatic payout to EcoCash ending %s', right(_p.ecocash_number, 4)), _p.driver_id)
  returning id into _tx;
  perform public.post_ledger('withdrawal_paid',
    jsonb_build_array(
      jsonb_build_object('account', 'user_wallets', 'amount', _p.amount),
      jsonb_build_object('account', 'payouts_clearing', 'amount', -(_p.amount))),
    _p.payment_id, _p.job_id, _p.driver_id, format('Automatic payout %s', _p.id));
  return _tx;
end $$;
revoke all on function public._payout_debit(public.driver_payouts) from public, anon, authenticated;

-- Put a payout's money back in the wallet (definitive failure). Internal.
create or replace function public._payout_return(_p public.driver_payouts, _reason text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare _new_bal numeric; _tx uuid;
begin
  update public.wallets set balance = balance + _p.amount, updated_at = now()
   where user_id = _p.driver_id returning balance into _new_bal;
  insert into public.wallet_transactions(user_id, type, amount, balance_after, job_id, note, created_by,
                                         reversal_of_transaction_id)
  values (_p.driver_id, 'withdrawal', _p.amount, _new_bal, _p.job_id,
          format('Automatic payout could not be sent; returned to wallet (%s)', left(_reason, 120)),
          _p.driver_id, _p.debit_tx_id)
  returning id into _tx;
  perform public.post_ledger('withdrawal_reversed',
    jsonb_build_array(
      jsonb_build_object('account', 'user_wallets', 'amount', -_p.amount),
      jsonb_build_object('account', 'payouts_clearing', 'amount', _p.amount)),
    _p.payment_id, _p.job_id, _p.driver_id, format('Automatic payout %s returned', _p.id));
  return _tx;
end $$;
revoke all on function public._payout_return(public.driver_payouts, text) from public, anon, authenticated;

-- 3. Create a payout when a Payonify escrow payment is released ------------------------------------

create or replace function public.tg_queue_driver_payout()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _job public.jobs; _credit numeric; _number text; _p public.driver_payouts; _tx uuid;
begin
  if not (new.status = 'released' and old.status is distinct from 'released'
          and new.type = 'escrow' and new.provider = 'payonify' and new.job_id is not null) then
    return new;
  end if;
  select * into _job from public.jobs where id = new.job_id;
  -- The driver's share credited by release_escrow_and_complete moments ago, in this transaction.
  select amount into _credit from public.wallet_transactions
   where user_id = _job.driver_id and job_id = _job.id and type = 'topup' and amount > 0
     and note like 'Con Z Pay escrow release%'
   order by created_at desc limit 1;
  if coalesce(_credit, 0) <= 0 then return new; end if;
  if exists (select 1 from public.driver_payouts where job_id = _job.id) then return new; end if;

  select payout_ecocash_number into _number from public.driver_profiles where user_id = _job.driver_id;

  insert into public.driver_payouts (driver_id, job_id, payment_id, amount, commission, currency, livemode,
                                     ecocash_number, status)
  values (_job.driver_id, _job.id, new.id, _credit, greatest(new.amount - _credit, 0), new.currency,
          coalesce(new.provider_livemode, false), _number,
          case when _number is null then 'waiting_for_number' else 'queued' end)
  returning * into _p;

  if _number is null then
    insert into public.notifications(user_id, type, title, body, job_id)
    values (_job.driver_id, 'wallet_withdrawal', 'Add your EcoCash number to get paid',
            format('$%s from this job is in your wallet. Add your EcoCash number in Wallet and we''ll send it automatically.',
                   _credit::text), _job.id);
    return new;
  end if;

  _tx := public._payout_debit(_p);
  if _tx is null then
    -- Not enough available (e.g. the wallet was overdrawn): keep it in the wallet, tell admins.
    update public.driver_payouts set status = 'returned', failure_code = 'insufficient_wallet_balance',
           failure_message = 'Wallet did not have this amount available when the job was released',
           updated_at = now(), completed_at = now()
     where id = _p.id;
    perform public.notify_payment_anomaly(new.id, 'Automatic payout not sent',
      format('Driver payout of $%s for job %s stayed in the wallet: not enough available balance.', _credit, _job.id));
    return new;
  end if;
  update public.driver_payouts set debit_tx_id = _tx, updated_at = now() where id = _p.id;
  return new;
end $$;
revoke all on function public.tg_queue_driver_payout() from public, anon, authenticated;

drop trigger if exists payments_queue_driver_payout on public.payments;
create trigger payments_queue_driver_payout
  after update of status on public.payments
  for each row execute function public.tg_queue_driver_payout();

-- Payouts waiting for a number become queued (and are debited) once the number is set.
create or replace function public.payout_release_waiting(_driver uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare _p public.driver_payouts; _number text; _tx uuid; _n integer := 0;
begin
  select payout_ecocash_number into _number from public.driver_profiles where user_id = _driver;
  if _number is null then return 0; end if;
  for _p in select * from public.driver_payouts
             where driver_id = _driver and status = 'waiting_for_number' for update loop
    _p.ecocash_number := _number;
    _tx := public._payout_debit(_p);
    if _tx is null then continue; end if;   -- money already used: it stays a wallet balance
    update public.driver_payouts
       set ecocash_number = _number, status = 'queued', debit_tx_id = _tx, next_attempt_at = now(), updated_at = now()
     where id = _p.id;
    _n := _n + 1;
  end loop;
  return _n;
end $$;
revoke all on function public.payout_release_waiting(uuid) from public, anon, authenticated;

-- 4. Server-side sending (service_role only) -------------------------------------------------------

-- Claims the next due payouts for sending. 'sending' rows older than 10 minutes come back too, so an
-- unclear attempt is looked up / re-sent with the SAME idempotency key.
create or replace function public.payout_claim_next(_limit integer default 10, _livemode boolean default false)
returns setof public.driver_payouts
language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  update public.driver_payouts d
     set status = 'sending', attempts = d.attempts + 1, updated_at = now(), next_attempt_at = now() + interval '10 minutes'
   where d.id in (
     select id from public.driver_payouts
      where livemode = _livemode
        and ((status = 'queued' and next_attempt_at <= now())
          or (status = 'sending' and next_attempt_at <= now()))
      order by created_at
      limit greatest(1, least(_limit, 50))
      for update skip locked)
  returning d.*;
end $$;
revoke all on function public.payout_claim_next(integer, boolean) from public, anon, authenticated;
grant execute on function public.payout_claim_next(integer, boolean) to service_role;

-- Sent payouts whose result hasn't arrived by webhook: the server looks them up.
create or replace function public.payout_due_lookups(_limit integer default 20, _livemode boolean default false)
returns setof public.driver_payouts
language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  update public.driver_payouts d
     set next_attempt_at = now() + interval '15 minutes', updated_at = now()
   where d.id in (
     select id from public.driver_payouts
      where livemode = _livemode and status = 'sent' and next_attempt_at <= now()
      order by sent_at
      limit greatest(1, least(_limit, 50))
      for update skip locked)
  returning d.*;
end $$;
revoke all on function public.payout_due_lookups(integer, boolean) from public, anon, authenticated;
grant execute on function public.payout_due_lookups(integer, boolean) to service_role;

-- Payonify accepted the transfer (status pending at their end).
create or replace function public.payout_record_sent(_id uuid, _reference text, _net_amount numeric default null)
returns public.driver_payouts
language plpgsql security definer set search_path to 'public' as $$
declare _p public.driver_payouts;
begin
  select * into _p from public.driver_payouts where id = _id for update;
  if not found then raise exception 'Payout not found'; end if;
  if _p.status in ('succeeded', 'returned') then return _p; end if;
  if _p.provider_reference is not null and _p.provider_reference <> _reference then
    perform public.notify_payment_anomaly(_p.payment_id, 'Payout reference changed',
      format('Payout %s already had transfer %s; Payonify now reports %s. Check the Payonify dashboard.',
             _id, _p.provider_reference, _reference));
    return _p;
  end if;
  update public.driver_payouts
     set status = 'sent', provider_reference = _reference, net_amount = coalesce(_net_amount, net_amount),
         sent_at = coalesce(sent_at, now()), next_attempt_at = now() + interval '15 minutes', updated_at = now()
   where id = _id returning * into _p;
  return _p;
end $$;
revoke all on function public.payout_record_sent(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.payout_record_sent(uuid, text, numeric) to service_role;

-- Final or retryable outcome.
--   _outcome 'succeeded'  : money reached the driver.
--   _outcome 'failed'     : definitive failure; money goes back to the wallet.
--   _outcome 'retry_later': nothing was sent (e.g. funds not settled yet); try again after _retry_minutes.
create or replace function public.payout_record_result(
  _id uuid, _outcome text, _reference text default null, _failure_code text default null,
  _failure_message text default null, _retry_minutes integer default 60, _net_amount numeric default null)
returns public.driver_payouts
language plpgsql security definer set search_path to 'public' as $$
declare _p public.driver_payouts; _tx uuid;
begin
  if _outcome not in ('succeeded', 'failed', 'retry_later') then raise exception 'Unknown outcome %', _outcome; end if;
  select * into _p from public.driver_payouts where id = _id for update;
  if not found then raise exception 'Payout not found'; end if;
  if _p.status in ('succeeded', 'returned') then
    if _outcome = 'succeeded' and _p.status = 'returned' then
      -- Money reached the driver AND was returned to the wallet: a human must sort it out.
      perform public.notify_payment_anomaly(_p.payment_id, 'Payout succeeded after it was returned',
        format('Payout %s (transfer %s) succeeded after its $%s was returned to the wallet. The driver may have been paid twice.',
               _id, coalesce(_reference, _p.provider_reference, '?'), _p.amount));
    end if;
    return _p;
  end if;
  if _reference is not null and _p.provider_reference is not null and _reference <> _p.provider_reference then
    raise exception 'Transfer reference does not match this payout';
  end if;

  if _outcome = 'succeeded' then
    update public.driver_payouts
       set status = 'succeeded', provider_reference = coalesce(provider_reference, _reference),
           net_amount = coalesce(_net_amount, net_amount), completed_at = now(), updated_at = now(),
           failure_code = null, failure_message = null
     where id = _id returning * into _p;
    insert into public.notifications(user_id, type, title, body, job_id)
    values (_p.driver_id, 'wallet_withdrawal', 'Payment sent to your EcoCash',
            format('$%s for this job was sent to EcoCash ending %s.', _p.amount::text, right(_p.ecocash_number, 4)),
            _p.job_id);
  elsif _outcome = 'retry_later' then
    if _p.provider_reference is not null then
      raise exception 'A sent transfer cannot be retried; look it up instead';
    end if;
    update public.driver_payouts
       set status = 'queued', failure_code = _failure_code, failure_message = left(_failure_message, 300),
           next_attempt_at = now() + make_interval(mins => greatest(1, least(coalesce(_retry_minutes, 60), 1440))),
           updated_at = now()
     where id = _id returning * into _p;
  else
    _tx := public._payout_return(_p, coalesce(_failure_message, _failure_code, 'failed'));
    update public.driver_payouts
       set status = 'returned', provider_reference = coalesce(provider_reference, _reference),
           failure_code = _failure_code, failure_message = left(_failure_message, 300),
           return_tx_id = _tx, completed_at = now(), updated_at = now()
     where id = _id returning * into _p;
    insert into public.notifications(user_id, type, title, body, job_id)
    values (_p.driver_id, 'wallet_withdrawal', 'Payout not sent — money is in your wallet',
            format('We could not send $%s to EcoCash ending %s (%s). The money is back in your wallet; check your number in Wallet.',
                   _p.amount::text, right(coalesce(_p.ecocash_number, '????'), 4),
                   coalesce(_failure_message, _failure_code, 'payout failed')), _p.job_id);
    perform public.notify_payment_anomaly(_p.payment_id, 'Automatic payout failed',
      format('Payout %s of $%s failed (%s) and was returned to the driver''s wallet.', _id, _p.amount,
             coalesce(_failure_code, 'failed')));
  end if;
  return _p;
end $$;
revoke all on function public.payout_record_result(uuid, text, text, text, text, integer, numeric) from public, anon, authenticated;
grant execute on function public.payout_record_result(uuid, text, text, text, text, integer, numeric) to service_role;

-- 5. Admin: send a returned payout again -----------------------------------------------------------

create or replace function public.admin_retry_payout(_id uuid, _reason text)
returns public.driver_payouts
language plpgsql security definer set search_path to 'public' as $$
declare _p public.driver_payouts; _number text; _tx uuid;
begin
  if not public.has_role(auth.uid(), 'super_admin') then raise exception 'Forbidden' using errcode = '42501'; end if;
  perform public.require_aal2();
  if _reason is null or length(btrim(_reason)) < 5 then raise exception 'Give a reason (at least 5 characters)'; end if;
  select * into _p from public.driver_payouts where id = _id for update;
  if not found then raise exception 'Payout not found'; end if;
  if _p.driver_id = auth.uid() then raise exception 'You cannot process your own payout.' using errcode = '42501'; end if;
  if _p.status <> 'returned' then raise exception 'Only a returned payout can be sent again (this one is %)', _p.status; end if;
  if _p.provider_reference is not null then
    raise exception 'Payonify already has a transfer (%) for this payout; check it in the Payonify dashboard first', _p.provider_reference;
  end if;
  select payout_ecocash_number into _number from public.driver_profiles where user_id = _p.driver_id;
  if _number is null then raise exception 'The driver has no payout number yet'; end if;
  _p.ecocash_number := _number;
  _tx := public._payout_debit(_p);
  if _tx is null then raise exception 'The driver''s wallet no longer has $% available', _p.amount; end if;
  update public.driver_payouts
     set status = 'queued', ecocash_number = _number, debit_tx_id = _tx, return_tx_id = null,
         idempotency_key = gen_random_uuid(), failure_code = null, failure_message = null,
         next_attempt_at = now(), completed_at = null, updated_at = now()
   where id = _id returning * into _p;
  perform public.log_admin_action('payout_retried', jsonb_build_object('id', _id, 'amount', _p.amount),
                                  btrim(_reason), _id, _p.driver_id);
  return _p;
end $$;
revoke all on function public.admin_retry_payout(uuid, text) from public, anon;
grant execute on function public.admin_retry_payout(uuid, text) to authenticated;

commit;
