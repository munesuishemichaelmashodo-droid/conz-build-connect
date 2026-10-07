-- =============================================================================
-- 0076 — Admin money controls (audit F5, F8 forged audit entries)
-- =============================================================================
--
-- Problems (verified live 07/10/2026):
--   * admin_wallet_adjust: ANY admin could credit up to $500 per call with
--     unlimited calls and no self-target check (self-minting, then another
--     admin approves the withdrawal).
--   * No MFA anywhere (require_admin_mfa() is a no-op since 17/09/2026).
--   * admin_approve_topup (a wallet credit) was open to ordinary admins.
--   * admin_wallet_reverse could race (two concurrent reversals).
--   * log_admin_action was EXECUTE-able by every signed-in user, so anyone
--     could write forged rows into admin_audit_log; the log was mutable.
--
-- Owner decisions (07/10/2026):
--   * Super_admin money actions require MFA (aal2) + daily caps + a second
--     super_admin's approval above a threshold.
--   * Ordinary admins may DEBIT (corrections) within a daily cap, never
--     credit, never themselves. Credits are super_admin only.
--
-- Defaults (system_settings.admin_money_controls, changeable only by a
-- super_admin with MFA via admin_set_money_controls()):
--   admin_debit_daily_cap         500   per ordinary admin per Harare day
--   super_admin_debit_daily_cap   500   per super_admin per day
--   super_admin_credit_daily_cap  500   per super_admin per day (direct credits)
--   second_approval_threshold     100   credits above this need a 2nd super_admin
-- With a single super_admin, credits above the threshold are impossible
-- until a second super_admin exists (fail-safe, documented in the plan).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. MFA helper: stable token the UI can detect
-- -----------------------------------------------------------------------------
create or replace function public.require_aal2()
returns void
language plpgsql
stable
set search_path to 'public'
as $$
begin
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'MFA_REQUIRED: verify with your authenticator app to perform this action.'
      using errcode = '42501';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Settings + accounting of admin money actions (for caps)
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value)
values ('admin_money_controls',
        '{"admin_debit_daily_cap":500,"super_admin_debit_daily_cap":500,"super_admin_credit_daily_cap":500,"second_approval_threshold":100}'::jsonb)
on conflict (key) do nothing;

create or replace function public.admin_money_setting(_name text)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select (value ->> _name)::numeric from public.system_settings where key = 'admin_money_controls'),
    case _name when 'second_approval_threshold' then 100 else 500 end)
$$;
revoke all on function public.admin_money_setting(text) from public, anon;
grant execute on function public.admin_money_setting(text) to authenticated, service_role;

create table if not exists public.admin_money_actions (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid not null,
  target_user_id uuid not null,
  direction      text not null check (direction in ('credit', 'debit')),
  kind           text not null check (kind in ('adjustment', 'reversal', 'approved_credit_request')),
  amount         numeric(12,2) not null check (amount > 0 and amount <= 100000),
  reference_id   uuid,
  created_at     timestamptz not null default now()
);
create index if not exists admin_money_actions_actor_day_idx on public.admin_money_actions(actor_id, created_at);
alter table public.admin_money_actions enable row level security;
revoke all on public.admin_money_actions from anon, authenticated;
grant select on public.admin_money_actions to authenticated;
drop policy if exists admin_money_actions_super_read on public.admin_money_actions;
create policy admin_money_actions_super_read on public.admin_money_actions
  for select to authenticated using (public.has_role(auth.uid(), 'super_admin'::app_role));

create or replace function public.append_only_guard()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;
drop trigger if exists trg_admin_money_actions_immutable on public.admin_money_actions;
create trigger trg_admin_money_actions_immutable
  before update or delete on public.admin_money_actions
  for each row execute function public.append_only_guard();

-- Start of the current business day (Zimbabwe).
create or replace function public.harare_day_start()
returns timestamptz language sql stable set search_path to 'public' as $$
  select date_trunc('day', now() at time zone 'Africa/Harare') at time zone 'Africa/Harare'
$$;

-- -----------------------------------------------------------------------------
-- 2. The single authorization gate for admin wallet changes
-- -----------------------------------------------------------------------------
-- _kind: 'adjustment' (direct), 'reversal', 'approved_credit_request'.
create or replace function public.admin_money_guard(
  _target uuid, _amount numeric, _direction text, _kind text default 'adjustment', _reference uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _uid uuid := auth.uid();
  _is_super boolean := public.has_role(auth.uid(), 'super_admin'::app_role);
  _is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  _cap numeric;
  _used numeric;
begin
  if _uid is null or not (_is_super or _is_admin) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if _target = _uid then
    raise exception 'Admins cannot change their own wallet.' using errcode = '42501';
  end if;
  if not public.is_valid_money(_amount) then
    raise exception 'Amount must be a positive value up to $100,000';
  end if;
  if _direction not in ('credit', 'debit') then
    raise exception 'Unknown direction %', _direction;
  end if;

  -- Serialise this admin's money actions so concurrent calls cannot both
  -- slip under the daily cap.
  perform pg_advisory_xact_lock(hashtextextended('admin_money:' || _uid::text, 0));

  if _direction = 'credit' then
    -- Ordinary admins never create money (owner decision).
    if not _is_super then
      raise exception 'Only a super admin can credit a wallet.' using errcode = '42501';
    end if;
    perform public.require_aal2();
    if _kind = 'adjustment' and _amount > public.admin_money_setting('second_approval_threshold') then
      raise exception 'SECOND_APPROVAL_REQUIRED: credits over $% need a second super admin. Submit a credit request instead.',
        public.admin_money_setting('second_approval_threshold') using errcode = '42501';
    end if;
    _cap := public.admin_money_setting('super_admin_credit_daily_cap');
  else
    if _is_super then
      perform public.require_aal2();
      _cap := public.admin_money_setting('super_admin_debit_daily_cap');
    else
      _cap := public.admin_money_setting('admin_debit_daily_cap');
    end if;
  end if;

  -- Credits approved by a second super_admin are bounded by that two-person
  -- review, not by the approver's direct-credit cap.
  if _kind <> 'approved_credit_request' then
    select coalesce(sum(amount), 0) into _used
      from public.admin_money_actions
     where actor_id = _uid and direction = _direction
       and kind <> 'approved_credit_request'
       and created_at >= public.harare_day_start();
    if _used + _amount > _cap then
      raise exception 'Daily % limit reached: $% of $% already used today.', _direction, _used, _cap
        using errcode = '42501';
    end if;
  end if;

  insert into public.admin_money_actions (actor_id, target_user_id, direction, kind, amount, reference_id)
  values (_uid, _target, _direction, _kind, _amount, _reference);
end $$;
revoke all on function public.admin_money_guard(uuid, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_money_guard(uuid, numeric, text, text, uuid) to service_role;

-- Apply a signed wallet change after the guard has passed. Internal only.
create or replace function public.admin_apply_wallet_change(
  _user_id uuid, _amount numeric, _category wallet_adjustment_category, _reason text,
  _ip text default null, _device jsonb default '{}'::jsonb, _reversal_of uuid default null
)
returns public.wallet_transactions
language plpgsql
security definer
set search_path to 'public'
as $$
declare _prev numeric; _new numeric; _tx public.wallet_transactions;
begin
  insert into public.wallets(user_id, balance) values (_user_id, 0) on conflict (user_id) do nothing;
  select balance into _prev from public.wallets where user_id = _user_id for update;
  _new := _prev + _amount;
  if _new < 0 then
    raise exception 'This would take the wallet negative (balance %, change %)', _prev, _amount;
  end if;
  update public.wallets set balance = _new, updated_at = now(), limited = false where user_id = _user_id;

  insert into public.wallet_transactions
    (user_id, type, amount, balance_after, previous_balance, category, note, created_by, ip_address, device_info, reversal_of_transaction_id)
  values (_user_id, 'adjustment', _amount, _new, _prev, _category, _reason, auth.uid(), _ip, _device, _reversal_of)
  returning * into _tx;

  -- Credits come out of admin_adjustments into the user's wallet; debits the reverse.
  perform public.post_ledger(
    case when _reversal_of is not null then 'admin_reversal' when _amount > 0 then 'admin_credit' else 'admin_debit' end,
    jsonb_build_array(
      jsonb_build_object('account', 'admin_adjustments', 'amount',  _amount),
      jsonb_build_object('account', 'user_wallets',      'amount', -_amount)),
    null, null, _user_id, _reason);

  perform public.log_admin_action(
    case when _reversal_of is not null then 'wallet_transaction_reversed'
         when _amount > 0 then 'wallet_credited_by_admin' else 'wallet_debited_by_admin' end,
    jsonb_build_object('amount', _amount, 'category', _category, 'previous_balance', _prev, 'new_balance', _new,
                       'ip', _ip, 'device', _device, 'reversal_of', _reversal_of),
    _reason, _tx.id, _user_id);

  insert into public.notifications(user_id, type, title, body)
  values (_user_id, case when _reversal_of is not null then 'wallet_adjustment_reversed' else 'wallet_adjustment' end,
    case when _reversal_of is not null then 'Wallet adjustment reversed'
         when _amount > 0 then 'Wallet credited' else 'Wallet debited' end,
    format('Your wallet was %s $%s. Reason: %s', case when _amount > 0 then 'credited with' else 'debited by' end,
           to_char(abs(_amount), 'FM999999990.00'), _reason));
  return _tx;
end $$;
revoke all on function public.admin_apply_wallet_change(uuid, numeric, wallet_adjustment_category, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.admin_apply_wallet_change(uuid, numeric, wallet_adjustment_category, text, text, jsonb, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- 3. Direct adjustments (UI: admin Users -> wallet)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_wallet_adjust(_user_id uuid, _amount numeric, _category wallet_adjustment_category, _reason text, _ip text DEFAULT NULL::text, _device jsonb DEFAULT '{}'::jsonb)
 RETURNS wallet_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _amount IS NULL OR _amount = 0 OR NOT public.is_valid_money(abs(_amount)) THEN
    RAISE EXCEPTION 'Amount must be a non-zero value up to $100,000';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN RAISE EXCEPTION 'A written reason (at least 5 characters) is required'; END IF;
  PERFORM public.admin_money_guard(_user_id, abs(_amount), CASE WHEN _amount > 0 THEN 'credit' ELSE 'debit' END);
  RETURN public.admin_apply_wallet_change(_user_id, _amount, _category, btrim(_reason), _ip, _device);
END $function$;

-- Legacy direct credit RPC (not used by the UI): same gate, same accounting.
CREATE OR REPLACE FUNCTION public.admin_credit_wallet(_user_id uuid, _amount numeric, _note text)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _w public.wallets;
begin
  if not public.has_role(auth.uid(),'super_admin') then raise exception 'Only super admins can credit wallets directly'; end if;
  if _amount is null or _amount = 0 or not public.is_valid_money(abs(_amount)) then
    raise exception 'Amount must be a non-zero value up to $100,000';
  end if;
  if _note is null or length(btrim(_note)) < 5 then raise exception 'A written reason (at least 5 characters) is required'; end if;
  perform public.admin_money_guard(_user_id, abs(_amount), case when _amount > 0 then 'credit' else 'debit' end);
  perform public.admin_apply_wallet_change(_user_id, _amount, 'other'::wallet_adjustment_category, btrim(_note));
  select * into _w from public.wallets where user_id = _user_id; return _w;
end $function$;

-- Reversal of an admin adjustment: super_admin + MFA + caps; once only.
create unique index if not exists wallet_transactions_one_reversal_idx
  on public.wallet_transactions (reversal_of_transaction_id) where reversal_of_transaction_id is not null;

CREATE OR REPLACE FUNCTION public.admin_wallet_reverse(_transaction_id uuid, _reason text)
 RETURNS wallet_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _orig public.wallet_transactions;
BEGIN
  IF NOT public.has_role(auth.uid(),'super_admin') THEN RAISE EXCEPTION 'Only super admins can reverse transactions'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 5 THEN RAISE EXCEPTION 'A written reason (at least 5 characters) is required'; END IF;

  SELECT * INTO _orig FROM public.wallet_transactions WHERE id = _transaction_id;
  IF _orig IS NULL THEN RAISE EXCEPTION 'Transaction not found'; END IF;
  IF _orig.type <> 'adjustment' OR _orig.reversal_of_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'Only admin credit/deduct adjustments can be reversed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE reversal_of_transaction_id = _orig.id) THEN
    RAISE EXCEPTION 'This transaction has already been reversed';
  END IF;

  PERFORM public.admin_money_guard(_orig.user_id, abs(_orig.amount),
    CASE WHEN -_orig.amount > 0 THEN 'credit' ELSE 'debit' END, 'reversal', _orig.id);
  -- The unique index above makes a concurrent second reversal fail.
  RETURN public.admin_apply_wallet_change(_orig.user_id, -_orig.amount, coalesce(_orig.category, 'other'::wallet_adjustment_category),
    'Reversal: ' || btrim(_reason), null, '{}'::jsonb, _orig.id);
END $function$;

-- -----------------------------------------------------------------------------
-- 4. Two-person credits above the threshold
-- -----------------------------------------------------------------------------
create table if not exists public.admin_credit_requests (
  id             uuid primary key default gen_random_uuid(),
  requested_by   uuid not null,
  target_user_id uuid not null,
  amount         numeric(12,2) not null check (amount > 0 and amount <= 100000),
  category       wallet_adjustment_category not null,
  reason         text not null,
  status         text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  decided_by     uuid,
  decided_at     timestamptz,
  decision_note  text,
  transaction_id uuid,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '48 hours'
);
alter table public.admin_credit_requests enable row level security;
revoke all on public.admin_credit_requests from anon, authenticated;
grant select on public.admin_credit_requests to authenticated;
drop policy if exists admin_credit_requests_super_read on public.admin_credit_requests;
create policy admin_credit_requests_super_read on public.admin_credit_requests
  for select to authenticated using (public.has_role(auth.uid(), 'super_admin'::app_role));

create or replace function public.admin_request_wallet_credit(
  _user_id uuid, _amount numeric, _category wallet_adjustment_category, _reason text
)
returns public.admin_credit_requests
language plpgsql
security definer
set search_path to 'public'
as $$
declare _r public.admin_credit_requests;
begin
  if not public.has_role(auth.uid(), 'super_admin'::app_role) then
    raise exception 'Only a super admin can request a credit' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _user_id = auth.uid() then raise exception 'Admins cannot credit their own wallet.' using errcode = '42501'; end if;
  if not public.is_valid_money(_amount) then raise exception 'Amount must be a positive value up to $100,000'; end if;
  if _reason is null or length(btrim(_reason)) < 5 then raise exception 'A written reason (at least 5 characters) is required'; end if;

  insert into public.admin_credit_requests (requested_by, target_user_id, amount, category, reason)
  values (auth.uid(), _user_id, round(_amount, 2), _category, btrim(_reason))
  returning * into _r;

  perform public.log_admin_action('wallet_credit_requested',
    jsonb_build_object('request_id', _r.id, 'amount', _r.amount, 'category', _category), _reason, _r.id, _user_id);

  insert into public.notifications (user_id, type, title, body)
  select distinct ur.user_id, 'admin_credit_request', 'Wallet credit needs your approval',
         format('A $%s wallet credit is waiting for a second super admin (request %s).', _r.amount, _r.id)
    from public.user_roles ur
   where ur.role = 'super_admin' and ur.user_id <> auth.uid() and ur.user_id <> _user_id;
  return _r;
end $$;
revoke all on function public.admin_request_wallet_credit(uuid, numeric, wallet_adjustment_category, text) from public, anon;
grant execute on function public.admin_request_wallet_credit(uuid, numeric, wallet_adjustment_category, text) to authenticated;

create or replace function public.admin_decide_wallet_credit(_request_id uuid, _approve boolean, _note text default null)
returns public.admin_credit_requests
language plpgsql
security definer
set search_path to 'public'
as $$
declare _r public.admin_credit_requests; _tx public.wallet_transactions;
begin
  if not public.has_role(auth.uid(), 'super_admin'::app_role) then
    raise exception 'Only a super admin can decide a credit request' using errcode = '42501';
  end if;
  perform public.require_aal2();

  select * into _r from public.admin_credit_requests where id = _request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if _r.status <> 'pending' then raise exception 'This request is already %', _r.status; end if;
  if _r.requested_by = auth.uid() then
    raise exception 'A second super admin must approve this request.' using errcode = '42501';
  end if;
  if _r.target_user_id = auth.uid() then
    raise exception 'You cannot approve a credit to your own wallet.' using errcode = '42501';
  end if;
  if _r.expires_at < now() then
    update public.admin_credit_requests set status = 'expired', decided_at = now() where id = _r.id returning * into _r;
    return _r;
  end if;

  if _approve then
    perform public.admin_money_guard(_r.target_user_id, _r.amount, 'credit', 'approved_credit_request', _r.id);
    _tx := public.admin_apply_wallet_change(_r.target_user_id, _r.amount, _r.category,
             format('%s (approved credit request %s)', _r.reason, _r.id));
    update public.admin_credit_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = _note, transaction_id = _tx.id
     where id = _r.id returning * into _r;
  else
    update public.admin_credit_requests
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = _note
     where id = _r.id returning * into _r;
  end if;

  perform public.log_admin_action(case when _approve then 'wallet_credit_approved' else 'wallet_credit_rejected' end,
    jsonb_build_object('request_id', _r.id, 'amount', _r.amount, 'requested_by', _r.requested_by), _note, _r.id, _r.target_user_id);
  return _r;
end $$;
revoke all on function public.admin_decide_wallet_credit(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_wallet_credit(uuid, boolean, text) to authenticated;

-- Settings changes: super_admin + MFA, audited.
create or replace function public.admin_set_money_controls(_controls jsonb, _reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare _k text; _clean jsonb := '{}'::jsonb;
begin
  if not public.has_role(auth.uid(), 'super_admin'::app_role) then raise exception 'Forbidden' using errcode = '42501'; end if;
  perform public.require_aal2();
  if _reason is null or length(btrim(_reason)) < 5 then raise exception 'A written reason is required'; end if;
  foreach _k in array array['admin_debit_daily_cap','super_admin_debit_daily_cap','super_admin_credit_daily_cap','second_approval_threshold'] loop
    if not public.is_valid_money((_controls ->> _k)::numeric, 10000) then
      raise exception 'Setting % must be between $0.01 and $10,000', _k;
    end if;
    _clean := _clean || jsonb_build_object(_k, round((_controls ->> _k)::numeric, 2));
  end loop;
  update public.system_settings set value = _clean where key = 'admin_money_controls';
  perform public.log_admin_action('admin_money_controls_changed', _clean, _reason, null, null);
  return _clean;
end $$;
revoke all on function public.admin_set_money_controls(jsonb, text) from public, anon;
grant execute on function public.admin_set_money_controls(jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Approvals: top-ups credit money (super_admin + MFA); super_admins need
--    MFA to approve withdrawals too. (Bodies = live + marked changes.)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_approve_topup(_id uuid)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _r public.wallet_topup_requests; _new_bal numeric; _w public.wallets;
begin
  -- F5: approving a top-up credits a wallet, so it is a super_admin + MFA action.
  if not public.has_role(auth.uid(),'super_admin') then raise exception 'Only a super admin can approve top-ups' using errcode = '42501'; end if;
  perform public.require_aal2();
  select * into _r from public.wallet_topup_requests where id=_id for update;
  if _r is null then raise exception 'Request not found'; end if;
  if _r.user_id = auth.uid() then raise exception 'You cannot approve your own top-up.'; end if;
  if _r.status = 'approved' then select * into _w from public.wallets where user_id=_r.user_id; return _w; end if;
  if _r.status <> 'pending' then raise exception 'Request not pending'; end if;
  insert into public.wallets(user_id, balance) values (_r.user_id, 0) on conflict (user_id) do nothing;
  update public.wallets set balance = balance + _r.amount, updated_at=now(), limited=false where user_id=_r.user_id returning balance into _new_bal;
  insert into public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    values (_r.user_id,'topup',_r.amount,_new_bal, format('Top-up via %s (ref %s)',_r.method,coalesce(_r.reference,'-')), auth.uid());
  update public.wallet_topup_requests set status='approved', decided_by=auth.uid(), decided_at=now() where id=_id;
  insert into public.wallet_audit_log(user_id,actor_id,action,meta)
    values (_r.user_id,auth.uid(),'topup_approved', jsonb_build_object('id',_id,'amount',_r.amount,'new_balance',_new_bal));
  perform public.log_admin_action('topup_approved', jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method), null, _id, _r.user_id);
  insert into public.notifications(user_id,type,title,body)
    values (_r.user_id,'wallet_topup','Top-up approved', format('$%s added to your wallet.',_r.amount::text));
  select * into _w from public.wallets where user_id=_r.user_id; return _w;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_approve_withdrawal(_id uuid)
 RETURNS wallets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _r public.wallet_withdrawal_requests; _new_bal numeric; _w public.wallets;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'super_admin')) then raise exception 'Forbidden'; end if;
  -- F5: super_admin money actions require MFA.
  if public.has_role(auth.uid(),'super_admin') then perform public.require_aal2(); end if;
  select * into _r from public.wallet_withdrawal_requests where id=_id for update;
  if _r is null or _r.status <> 'pending' then raise exception 'Not pending'; end if;
  if _r.user_id = auth.uid() then raise exception 'You cannot approve your own withdrawal.'; end if;
  select * into _w from public.wallets where user_id = _r.user_id for update;
  if coalesce(_w.limited, false) then raise exception 'This wallet is limited; resolve that before paying out.'; end if;
  if coalesce(_w.balance,0) - coalesce(_w.held,0) < _r.amount then raise exception 'Insufficient available balance (held funds are reserved).'; end if;
  update public.wallets set balance = balance - _r.amount, updated_at=now() where user_id=_r.user_id returning balance into _new_bal;
  if _new_bal < 0 then raise exception 'Insufficient balance'; end if;
  insert into public.wallet_transactions(user_id,type,amount,balance_after,note,created_by)
    values (_r.user_id,'withdrawal',-_r.amount,_new_bal, format('Withdrawal via %s',_r.method), auth.uid());
  update public.wallet_withdrawal_requests set status='approved', decided_by=auth.uid(), decided_at=now() where id=_id;
  insert into public.wallet_audit_log(user_id,actor_id,action,meta)
    values (_r.user_id,auth.uid(),'withdrawal_approved', jsonb_build_object('id',_id,'amount',_r.amount,'new_balance',_new_bal));
  perform public.log_admin_action('withdrawal_approved', jsonb_build_object('id', _id, 'amount', _r.amount, 'method', _r.method), null, _id, _r.user_id);
  insert into public.notifications(user_id,type,title,body)
    values (_r.user_id,'wallet_withdrawal','Withdrawal approved', format('$%s withdrawn from your wallet.',_r.amount::text));
  select * into _w from public.wallets where user_id=_r.user_id; return _w;
end $function$;

-- -----------------------------------------------------------------------------
-- 6. Audit log: only server code / admin RPCs write it; nobody edits it
-- -----------------------------------------------------------------------------
revoke execute on function public.log_admin_action(text, jsonb, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.log_admin_action(text, jsonb, text, uuid, uuid) to service_role;
revoke insert, update, delete, truncate on public.admin_audit_log from anon, authenticated;

drop trigger if exists trg_admin_audit_log_immutable on public.admin_audit_log;
create trigger trg_admin_audit_log_immutable
  before update or delete on public.admin_audit_log
  for each row execute function public.append_only_guard();
