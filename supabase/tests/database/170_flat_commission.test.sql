-- 0091 — flat commission: one authoritative amount (commission_rate % of the
-- accepted job price, rounded to 2 dp) is held, checked, shown, charged and
-- released for EVERY driver level. Owner decision 11/10/2026: levels give no
-- commission discount. $400 job at 7% = $28.00 for bronze/silver/gold/platinum.

begin;
select plan(33);
select tests.enable_launch_features();

select set_config('t.cust',  tests.create_user('fc_cust')::text, true);
select set_config('t.super', tests.create_user('fc_super', array['super_admin','admin'])::text, true);
select set_config('t.d_bronze',   tests.create_driver('fc_bronze', 0)::text, true);
select set_config('t.d_silver',   tests.create_driver('fc_silver', 0)::text, true);
select set_config('t.d_gold',     tests.create_driver('fc_gold', 0)::text, true);
select set_config('t.d_platinum', tests.create_driver('fc_platinum', 0)::text, true);
select set_config('t.d_poor',     tests.create_driver('fc_poor', 0)::text, true);
select set_config('t.d_esc',      tests.create_driver('fc_escrow', 0)::text, true);

select tests.as_owner();
update public.driver_profiles set level = 'bronze'   where user_id = current_setting('t.d_bronze')::uuid;
update public.driver_profiles set level = 'silver'   where user_id = current_setting('t.d_silver')::uuid;
update public.driver_profiles set level = 'gold'     where user_id = current_setting('t.d_gold')::uuid;
update public.driver_profiles set level = 'platinum' where user_id = current_setting('t.d_platinum')::uuid;
update public.driver_profiles set level = 'gold'     where user_id = current_setting('t.d_esc')::uuid;

create temp table res (who text, held_at_accept numeric, commission numeric, held_after numeric, bal numeric);
grant all on res to public;

-- Legitimate funding (manual top-up approved by a super admin with MFA) so the
-- ledger reconciliation stays valid.
create function pg_temp.fund(_who text, _amt numeric) returns void language plpgsql as $$
declare _tu uuid;
begin
  perform tests.login_as(current_setting(_who)::uuid);
  _tu := (public.request_topup(_amt, 'ecocash', 'MP' || left(md5(random()::text), 8))).id;
  perform tests.login_as_mfa(current_setting('t.super')::uuid);
  perform public.admin_approve_topup(_tu);
  perform tests.as_owner();
end $$;

-- A direct-pay job end to end: bid -> customer accepts (hold) -> customer completes (charge).
-- _relevel: change the driver's level AFTER the hold, to model a hold made under earlier rules.
create function pg_temp.direct(_who text, _price numeric, _relevel text default null) returns uuid language plpgsql as $$
declare _drv uuid := current_setting(_who)::uuid; _b uuid; _j uuid; _h numeric;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.cust')::uuid, _price);
  _b := tests.create_bid(_j, _drv, _price);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(_b);
  perform tests.as_owner();
  select held into _h from public.wallets where user_id = _drv;
  if _relevel is not null then
    update public.driver_profiles set level = _relevel::public.driver_level where user_id = _drv;
  end if;
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform tests.complete(_j);
  perform tests.as_owner();
  insert into res
  select _who, _h, (select commission from public.jobs where id = _j),
         (select held from public.wallets where user_id = _drv),
         (select balance from public.wallets where user_id = _drv);
  return _j;
end $$;

select pg_temp.fund('t.d_bronze', 100);
select pg_temp.fund('t.d_silver', 100);
select pg_temp.fund('t.d_gold', 100);
select pg_temp.fund('t.d_platinum', 100);
select pg_temp.fund('t.d_poor', 20);
select pg_temp.fund('t.d_esc', 100);

select pg_temp.direct('t.d_bronze', 400);
select pg_temp.direct('t.d_silver', 400);
select pg_temp.direct('t.d_gold', 400);
select pg_temp.direct('t.d_platinum', 400);

-- 1-8: every level is held and charged exactly $28.00
select is((select held_at_accept from res where who = 't.d_bronze'),   28.00::numeric, 'bronze: $28.00 held at acceptance');
select is((select commission from res where who = 't.d_bronze'),       28.00::numeric, 'bronze: $28.00 charged');
select is((select held_at_accept from res where who = 't.d_silver'),   28.00::numeric, 'silver: $28.00 held');
select is((select commission from res where who = 't.d_silver'),       28.00::numeric, 'silver: $28.00 charged (no 5% discount)');
select is((select held_at_accept from res where who = 't.d_gold'),     28.00::numeric, 'gold: $28.00 held');
select is((select commission from res where who = 't.d_gold'),         28.00::numeric, 'gold: $28.00 charged (no 10% discount)');
select is((select held_at_accept from res where who = 't.d_platinum'), 28.00::numeric, 'platinum: $28.00 held');
select is((select commission from res where who = 't.d_platinum'),     28.00::numeric, 'platinum: $28.00 charged (no 20% discount)');

-- 9-10: holds are fully released and the wallet moved by exactly the commission
select is((select sum(held_after) from res), 0.00::numeric, 'all holds released at completion');
select is((select bal from res where who = 't.d_platinum'), 72.00::numeric, 'platinum balance = 100 - 28');

-- 11-13: authoritative rounding (2 dp, half away from zero), direct from the function
select tests.as_service();
select is(public.commission_amount(57.50), 4.03::numeric, '7% of 57.50 = 4.025 -> 4.03');
select is(public.commission_amount(10.01), 0.70::numeric, '7% of 10.01 = 0.7007 -> 0.70');
select is(public.commission_amount(0), 0.00::numeric, 'zero price -> zero commission');
select tests.as_owner();

-- 14-17: insufficient balance ($20 available, $28.00 needed)
select set_config('t.jp', tests.create_job(current_setting('t.cust')::uuid, 400)::text, true);
select set_config('t.bp', tests.create_bid(current_setting('t.jp')::uuid, current_setting('t.d_poor')::uuid, 400)::text, true);
select tests.login_as(current_setting('t.d_poor')::uuid);
select is((public.driver_can_accept(current_setting('t.jp')::uuid)->>'ok')::boolean, false, 'poor driver cannot afford the hold');
select is((public.driver_can_accept(current_setting('t.jp')::uuid)->>'shortfall')::numeric, 8.00::numeric, 'shortfall = 28.00 - 20.00');
select is((select commission_due from public.driver_available_jobs(50, 0) where id = current_setting('t.jp')::uuid), 28.00::numeric, 'open-jobs list shows the flat $28.00');
select is((select can_afford from public.driver_available_jobs(50, 0) where id = current_setting('t.jp')::uuid), false, 'open-jobs list marks it unaffordable');
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.accept_bid(%L)$$, current_setting('t.bp')), null, null, 'accept_bid refuses an unaffordable driver');
select tests.as_owner();
select is((select held from public.wallets where user_id = current_setting('t.d_poor')::uuid), 0.00::numeric, 'nothing was held for the refused acceptance');

-- 19-20: hold made under the old rule, level changed afterwards -> still $28.00, hold released
select pg_temp.direct('t.d_bronze', 400, 'platinum');
select is((select commission from res where who = 't.d_bronze' order by ctid desc limit 1), 28.00::numeric, 'level change after the hold does not change the charge');
select is((select held_after from res where who = 't.d_bronze' order by ctid desc limit 1), 0.00::numeric, 'and the earlier hold is fully released');

-- 21-23: escrow completion for a gold driver ($400 -> $28 commission, $372 payout)
select set_config('t.je', tests.create_job(current_setting('t.cust')::uuid, 400, 'escrow')::text, true);
update public.jobs set status = 'accepted', driver_id = current_setting('t.d_esc')::uuid, final_price = 400 where id = current_setting('t.je')::uuid;
select public.hold_job_commission(current_setting('t.je')::uuid);
insert into public.payments (user_id, job_id, type, amount, currency, method, status)
values (current_setting('t.cust')::uuid, current_setting('t.je')::uuid, 'escrow', 400, 'USD', 'paynow', 'initiated')
returning set_config('t.pe', id::text, true);
select tests.as_service();
select public.apply_paynow_result(current_setting('t.pe')::uuid, 'ipn', 'Paid', '400.00', current_setting('t.pe'));
select public.apply_paynow_result(current_setting('t.pe')::uuid, 'ipn', 'Paid', '400.00', current_setting('t.pe'));
select tests.login_as(current_setting('t.cust')::uuid);
select tests.complete(current_setting('t.je')::uuid);
select tests.as_owner();
select is((select commission from public.jobs where id = current_setting('t.je')::uuid), 28.00::numeric, 'escrow: gold driver commission = $28.00');
select is(tests.balance(current_setting('t.d_esc')::uuid), 100.00::numeric + 372.00::numeric, 'escrow: payout = 400 - 28 added once (duplicate IPN ignored)');
select is((select held from public.wallets where user_id = current_setting('t.d_esc')::uuid), 0.00::numeric, 'escrow: hold released');

-- 24-25: duplicate completion does not charge twice
select tests.login_as(current_setting('t.cust')::uuid);
select is((tests.complete(current_setting('t.je')::uuid))->>'already', 'true', 'a second completion is an idempotent no-op');
select tests.as_owner();
select is(tests.balance(current_setting('t.d_esc')::uuid), 472.00::numeric, 'balance unchanged by the duplicate request');

-- 26-28: cancellation after payment -> refund path; the hold is released, no commission charged
select set_config('t.jc', tests.create_job(current_setting('t.cust')::uuid, 200, 'escrow')::text, true);
update public.jobs set status = 'accepted', driver_id = current_setting('t.d_gold')::uuid, final_price = 200 where id = current_setting('t.jc')::uuid;
select public.hold_job_commission(current_setting('t.jc')::uuid);
select is((select held from public.wallets where user_id = current_setting('t.d_gold')::uuid), 14.00::numeric, 'cancellation case: $14.00 held on a $200 job');
insert into public.payments (user_id, job_id, type, amount, currency, method, status)
values (current_setting('t.cust')::uuid, current_setting('t.jc')::uuid, 'escrow', 200, 'USD', 'paynow', 'initiated')
returning set_config('t.pc', id::text, true);
select tests.as_service();
select public.apply_paynow_result(current_setting('t.pc')::uuid, 'ipn', 'Paid', '200.00', current_setting('t.pc'));
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.jc')::uuid, 'not needed');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select public.admin_mark_escrow_refunded(current_setting('t.pc')::uuid, 'PNR-FC-1');
select tests.as_owner();
select is((select held from public.wallets where user_id = current_setting('t.d_gold')::uuid), 0.00::numeric, 'cancel/refund released the hold');
select is((select commission from public.jobs where id = current_setting('t.jc')::uuid), null, 'no commission recorded on a refunded job');

-- 29-30: ledger reconciliation holds after all of the above
select tests.as_service();
select is((select count(*)::int from public.financial_reconciliation() where not ok), 0, 'financial reconciliation: every check ok');
select is((select ok from public.financial_reconciliation() where check_name = 'held_commission_matches_jobs'), true, 'held commission matches active jobs');

-- 31-32: the legacy per-level multiplier can no longer express a discount
select tests.as_service();
select is((select count(distinct public.driver_level_commission_multiplier(l))::int from unnest(enum_range(null::public.driver_level)) l), 1,
  'every driver level maps to the same commission multiplier');
select is((select min(public.driver_level_commission_multiplier(l)) from unnest(enum_range(null::public.driver_level)) l), 1.00::numeric,
  'and that multiplier is 1.00 (no level discount)');
select tests.as_owner();

select * from finish();
rollback;
