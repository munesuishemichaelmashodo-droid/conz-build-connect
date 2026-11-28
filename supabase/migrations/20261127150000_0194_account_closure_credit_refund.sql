-- 0194 account_closure_credit_refund
-- Owner decision (27/11/2026): a driver who closes their account may get back UNUSED PURCHASED Commission Credit,
-- through a safe, supported refund process. Promotional credit is excluded: it has no cash value and is forfeited.
--
-- Before this, account_deletion_blockers() (0173) refused deletion while wallets.balance > 0, so a driver with unused
-- purchased credit could never delete their account. This adds the closure process without any automatic payout:
--   * request_account_closure(method, destination): the driver asks; allowed only when nothing else blocks deletion
--     (no active jobs, held commission, disputes, pending top-ups, owed amounts...). The amount and promo balance are
--     recorded at request time. While a request is open the driver cannot send new offers.
--   * cancel_account_closure(id): the driver changes their mind while the request is still open.
--   * admin_record_closure_refund(id, reference, note): a SUPER ADMIN with a fresh step-up (require_aal2) records that
--     the money was sent outside the app (EcoCash/OneMoney/InnBucks/bank) with its transaction reference. The amount is
--     always the CURRENT purchased balance (row-locked); it is debited through the existing admin_apply_wallet_change
--     (category 'refund', ledger + audit + notification). References are unique. Afterwards balance = 0, so the normal
--     in-app deletion can complete.
--   * admin_decline_account_closure(id, reason): super admin closes a request without a refund (e.g. fraud review).
-- Nothing here moves money by itself, writes settings, or touches promo_balance. No DROP.

create table if not exists public.account_closure_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'refunded', 'declined', 'cancelled')),
  purchased_credit_at_request numeric(12, 2) not null check (purchased_credit_at_request >= 0),
  promo_forfeited numeric(12, 2) not null default 0 check (promo_forfeited >= 0),
  refund_method text not null check (refund_method in ('ecocash', 'onemoney', 'innbucks', 'bank', 'other')),
  refund_destination text not null check (length(btrim(refund_destination)) between 4 and 120),
  refunded_amount numeric(12, 2) check (refunded_amount is null or refunded_amount > 0),
  refund_reference text check (refund_reference is null or length(btrim(refund_reference)) between 4 and 80),
  wallet_transaction_id uuid references public.wallet_transactions(id),
  decision_note text,
  processed_by uuid references auth.users(id),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create unique index if not exists account_closure_requests_one_open
  on public.account_closure_requests (user_id) where status = 'requested';
create unique index if not exists account_closure_requests_reference_unique
  on public.account_closure_requests (lower(btrim(refund_reference))) where refund_reference is not null;

alter table public.account_closure_requests enable row level security;
revoke all on public.account_closure_requests from public, anon, authenticated;
grant select on public.account_closure_requests to authenticated;
grant all on public.account_closure_requests to service_role;

create policy "Closure requests: own or admin read" on public.account_closure_requests
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin'));

-- The driver asks to close the account and get unused purchased credit back.
create or replace function public.request_account_closure(_method text, _destination text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  _uid uuid := auth.uid();
  _blockers text[];
  _bal numeric;
  _promo numeric;
  _id uuid;
begin
  if _uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if _method is null or _method not in ('ecocash', 'onemoney', 'innbucks', 'bank', 'other') then
    raise exception 'Choose how the refund should be sent.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(_destination, ''))) not between 4 and 120 then
    raise exception 'Give the number or account the refund should go to.' using errcode = '22023';
  end if;
  if exists (select 1 from public.account_closure_requests where user_id = _uid and status = 'requested') then
    raise exception 'You already have a closure request in progress.' using errcode = '23505';
  end if;
  select balance, coalesce(promo_balance, 0) into _bal, _promo from public.wallets where user_id = _uid for update;
  if coalesce(_bal, 0) <= 0 then
    raise exception 'You have no unused purchased Commission Credit to refund. You can delete your account directly.'
      using errcode = '22023';
  end if;
  _blockers := array_remove(public.account_deletion_blockers(_uid), 'wallet_balance_positive');
  if coalesce(array_length(_blockers, 1), 0) > 0 then
    raise exception 'Finish these first: %', array_to_string(_blockers, ', ') using errcode = '55000';
  end if;

  insert into public.account_closure_requests (user_id, purchased_credit_at_request, promo_forfeited, refund_method, refund_destination)
  values (_uid, _bal, _promo, _method, btrim(_destination))
  returning id into _id;

  insert into public.notifications (user_id, type, title, body)
  select distinct ur.user_id, 'account_closure_request', 'Account closure request',
         format('A driver asked to close their account. Unused purchased Commission Credit: $%s.', to_char(_bal, 'FM999999990.00'))
    from public.user_roles ur where ur.role = 'super_admin';
  return _id;
end $$;
revoke all on function public.request_account_closure(text, text) from public, anon;
grant execute on function public.request_account_closure(text, text) to authenticated;

create or replace function public.cancel_account_closure(_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.account_closure_requests set status = 'cancelled', cancelled_at = now()
   where id = _id and user_id = auth.uid() and status = 'requested';
  if not found then raise exception 'No open closure request to cancel.' using errcode = 'P0002'; end if;
end $$;
revoke all on function public.cancel_account_closure(uuid) from public, anon;
grant execute on function public.cancel_account_closure(uuid) to authenticated;

-- A super admin records the refund that was sent outside the app.
create or replace function public.admin_record_closure_refund(_id uuid, _reference text, _note text)
returns public.account_closure_requests language plpgsql security definer set search_path to 'public' as $$
declare
  _r public.account_closure_requests;
  _bal numeric;
  _held numeric;
  _tx public.wallet_transactions;
  _ref text := nullif(btrim(coalesce(_reference, '')), '');
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only a super admin can record a closure refund.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _ref is null or length(_ref) not between 4 and 80 then
    raise exception 'Give the transaction reference of the refund you sent.' using errcode = '22023';
  end if;
  select * into _r from public.account_closure_requests where id = _id for update;
  if not found or _r.status <> 'requested' then
    raise exception 'This closure request is not open.' using errcode = '55000';
  end if;
  if exists (select 1 from public.account_closure_requests where lower(btrim(refund_reference)) = lower(_ref)) then
    raise exception 'That reference was already used for another refund.' using errcode = '23505';
  end if;
  select balance, coalesce(held, 0) + coalesce(withdrawal_reserved, 0) into _bal, _held
    from public.wallets where user_id = _r.user_id for update;
  if coalesce(_bal, 0) <= 0 then raise exception 'There is no purchased credit left to refund.' using errcode = '55000'; end if;
  if _held > 0 then raise exception 'Commission is still reserved on this account.' using errcode = '55000'; end if;

  _tx := public.admin_apply_wallet_change(_r.user_id, -_bal, 'refund'::public.wallet_adjustment_category,
           format('Account closure refund of unused purchased Commission Credit, reference %s', _ref));

  update public.account_closure_requests
     set status = 'refunded', refunded_amount = _bal, refund_reference = _ref, wallet_transaction_id = _tx.id,
         decision_note = nullif(btrim(coalesce(_note, '')), ''), processed_by = auth.uid(), processed_at = now()
   where id = _id
   returning * into _r;
  perform public.log_admin_action('account_closure_refunded',
    jsonb_build_object('amount', _bal, 'method', _r.refund_method, 'promo_forfeited', _r.promo_forfeited),
    coalesce(_r.decision_note, 'Account closure refund'), _r.id, _r.user_id);
  return _r;
end $$;
revoke all on function public.admin_record_closure_refund(uuid, text, text) from public, anon;
grant execute on function public.admin_record_closure_refund(uuid, text, text) to authenticated;

create or replace function public.admin_decline_account_closure(_id uuid, _reason text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare _uid uuid; _why text := nullif(btrim(coalesce(_reason, '')), '');
begin
  if not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'Only a super admin can decline a closure request.' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if _why is null or length(_why) < 10 then raise exception 'Give the reason (at least 10 characters).' using errcode = '22023'; end if;
  update public.account_closure_requests
     set status = 'declined', decision_note = _why, processed_by = auth.uid(), processed_at = now()
   where id = _id and status = 'requested' returning user_id into _uid;
  if not found then raise exception 'This closure request is not open.' using errcode = '55000'; end if;
  perform public.log_admin_action('account_closure_declined', '{}'::jsonb, _why, _id, _uid);
  insert into public.notifications (user_id, type, title, body)
  values (_uid, 'account_closure_declined', 'Account closure request', 'Your closure request was not approved: ' || _why);
end $$;
revoke all on function public.admin_decline_account_closure(uuid, text) from public, anon;
grant execute on function public.admin_decline_account_closure(uuid, text) to authenticated;

-- No new offers while a closure request is open (the credit is about to be refunded).
create or replace function public.tg_bids_block_during_closure()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if exists (select 1 from public.account_closure_requests where user_id = new.driver_id and status = 'requested') then
    raise exception 'You asked to close your account. Cancel that request to send offers again.' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function public.tg_bids_block_during_closure() from public, anon, authenticated;
create or replace trigger bids_block_during_closure
  before insert on public.bids for each row execute function public.tg_bids_block_during_closure();
