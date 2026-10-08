-- Phase 4 / audit F2 — escrow lifecycle: release, refund on cancel / expiry /
-- dispute, late and duplicate payments, double release / double refund /
-- release-after-refund / refund-after-release, refund confirmation (MFA),
-- and the escrow ledger invariants.

begin;
select plan(54);

select set_config('t.cust',  tests.create_user('cust')::text, true);
select set_config('t.drv',   tests.create_driver('drv', 100)::text, true);
select set_config('t.super', tests.create_user('super', array['super_admin','admin'])::text, true);
select set_config('t.admin', tests.create_user('admin', array['admin'])::text, true);

-- An accepted escrow job + an initiated $300 payment for it. Returns job id;
-- payment id goes to t.p_<name>.
create or replace function pg_temp.escrow_job(_name text, _status text default 'accepted', _pay boolean default true)
returns uuid language plpgsql as $$
declare _j uuid; _p uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.cust')::uuid, 300, 'escrow');
  update public.jobs set status = _status::public.job_status, driver_id = current_setting('t.drv')::uuid, final_price = 300
   where id = _j;
  insert into public.payments (user_id, job_id, type, amount, currency, method, status, paynow_poll_url)
  values (current_setting('t.cust')::uuid, _j, 'escrow', 300, 'USD', 'paynow', 'initiated',
          'https://www.paynow.co.zw/Interface/CheckPayment/?guid=' || _name)
  returning id into _p;
  perform set_config('t.p_' || _name, _p::text, true);
  if _pay then
    perform tests.as_service();
    perform public.apply_paynow_result(_p, 'ipn', 'Paid', '300.00', _p::text);
    perform tests.as_owner();
  end if;
  return _j;
end $$;

create or replace function pg_temp.pstatus(_name text) returns text language sql as $$
  select status from public.payments where id = current_setting('t.p_' || _name)::uuid
$$;

-- ===========================================================================
-- A. pay -> complete -> release
-- ===========================================================================
select set_config('t.ja', pg_temp.escrow_job('a')::text, true);
select is(pg_temp.pstatus('a'), 'paid', 'A: escrow payment is paid (held)');
select is(tests.balance(current_setting('t.drv')::uuid), 100.00::numeric, 'A: nothing reaches the driver before delivery');

select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.complete_job(%L)$$, current_setting('t.ja')), 'A: customer confirms delivery');
select tests.as_owner();
select is(pg_temp.pstatus('a'), 'released', 'A: payment released');
select is(tests.balance(current_setting('t.drv')::uuid), 379.00::numeric, 'A: driver receives $300 - 7% ($21) = $279');
select is((select status::text from public.jobs where id = current_setting('t.ja')::uuid), 'completed', 'A: job completed');

select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(format($$select public.complete_job(%L)$$, current_setting('t.ja')), null, null,
  'A: double release is impossible');
select throws_ok(format($$select public.cancel_job(%L, 'changed my mind')$$, current_setting('t.ja')), null, null,
  'A: a completed (released) job cannot be cancelled into a refund');
select tests.as_service();
select throws_ok(format($$select public.escrow_mark_refund_due(%L, 'job_cancelled')$$, current_setting('t.p_a')), null, null,
  'A: refund after release is impossible');
select tests.as_owner();
select is(tests.balance(current_setting('t.drv')::uuid), 379.00::numeric, 'A: driver balance unchanged by the blocked attempts');

-- ===========================================================================
-- B. pay -> cancel -> refund_due -> refunded (super_admin + MFA)
-- ===========================================================================
select set_config('t.jb', pg_temp.escrow_job('b')::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.cancel_job(%L, 'no longer needed')$$, current_setting('t.jb')), 'B: customer cancels a paid escrow job');
select tests.as_owner();
select is(pg_temp.pstatus('b'), 'refund_due', 'B: F2 — paid escrow becomes refund_due (not stranded)');
select is((select status from public.escrow_refunds where payment_id = current_setting('t.p_b')::uuid), 'due', 'B: refund queued');
select is((select reason from public.escrow_refunds where payment_id = current_setting('t.p_b')::uuid), 'job_cancelled', 'B: refund reason recorded');
select is((select amount from public.escrow_refunds where payment_id = current_setting('t.p_b')::uuid), 300.00::numeric, 'B: full amount queued');
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.super')::uuid and type = 'escrow_refund_due'),
  'B: super admins alerted');
select ok(exists(select 1 from public.notifications where user_id = current_setting('t.cust')::uuid and type = 'escrow_refund_due'),
  'B: customer told the refund is being processed');
select is(tests.balance(current_setting('t.cust')::uuid), 0.00::numeric, 'B: refund is NOT turned into withdrawable wallet money');

select tests.as_service();
select is(public.escrow_mark_refund_due(current_setting('t.p_b')::uuid, 'job_cancelled'), 'already', 'B: double refund_due is a no-op');
select throws_ok(format($$select public.release_escrow_and_complete(%L, null)$$, current_setting('t.jb')), null, null,
  'B: release after refund is impossible');

select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.admin_mark_escrow_refunded(%L, 'PNR-1')$$, current_setting('t.p_b')), '42501', null,
  'B: an ordinary admin cannot confirm refunds');
select tests.login_as(current_setting('t.super')::uuid);
select throws_ok(format($$select public.admin_mark_escrow_refunded(%L, 'PNR-1')$$, current_setting('t.p_b')), '42501', null,
  'B: super_admin without MFA cannot confirm refunds');
select tests.login_as_mfa(current_setting('t.super')::uuid);
select throws_ok(format($$select public.admin_mark_escrow_refunded(%L, '')$$, current_setting('t.p_b')), null, null,
  'B: a Paynow refund reference is required');
select lives_ok(format($$select public.admin_mark_escrow_refunded(%L, 'PNR-1', 'refunded in portal')$$, current_setting('t.p_b')),
  'B: super_admin with MFA confirms the refund');
select lives_ok(format($$select public.admin_mark_escrow_refunded(%L, 'PNR-1')$$, current_setting('t.p_b')),
  'B: confirming twice is idempotent');
select tests.as_owner();
select is(pg_temp.pstatus('b'), 'refunded', 'B: payment refunded');
select is((select status from public.escrow_refunds where payment_id = current_setting('t.p_b')::uuid), 'refunded', 'B: queue item closed');
select is((select count(*)::int from public.platform_ledger where payment_id = current_setting('t.p_b')::uuid and kind = 'escrow_refunded'), 2,
  'B: refund posted to the ledger exactly once');
select tests.as_service();
select throws_ok(format($$update public.payments set status = 'released' where id = %L$$, current_setting('t.p_b')), '42501', null,
  'B: a refunded payment can never be released');

-- ===========================================================================
-- C. pay -> driver no-show (24h expiry) -> refund_due
-- ===========================================================================
select set_config('t.jc', pg_temp.escrow_job('c')::text, true);
alter table public.jobs disable trigger t_jobs_updated;
update public.jobs set updated_at = now() - interval '25 hours' where id = current_setting('t.jc')::uuid;
alter table public.jobs enable trigger t_jobs_updated;
select tests.as_service();
select ok(public.expire_stale_accepted_jobs() >= 1, 'C: expiry sweep cancels the stale job');
select tests.as_owner();
select is(pg_temp.pstatus('c'), 'refund_due', 'C: F2 — expired job''s escrow becomes refund_due');
select is((select reason from public.escrow_refunds where payment_id = current_setting('t.p_c')::uuid), 'job_expired', 'C: reason job_expired');

-- ===========================================================================
-- D. pay -> dispute -> refund (in full); other outcomes keep escrow held
-- ===========================================================================
select set_config('t.jd', pg_temp.escrow_job('d', 'in_progress')::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select set_config('t.dd', (public.raise_dispute(current_setting('t.jd')::uuid, null, 'other', 'Load never arrived at site')).id::text, true);
select tests.as_service();
select is(public.auto_release_escrow_payments(), 0, 'D: an open dispute blocks auto-release');
select tests.login_as(current_setting('t.admin')::uuid);
select lives_ok(format($$select public.resolve_dispute(%L, 'refund', 'Refund in full')$$, current_setting('t.dd')),
  'D: admin resolves the dispute as a refund');
select tests.as_owner();
select is(pg_temp.pstatus('d'), 'refund_due', 'D: F2 — escrow refunded in full (refund_due)');
select is((select status::text from public.jobs where id = current_setting('t.jd')::uuid), 'cancelled', 'D: job cancelled, not completed');
select is(tests.balance(current_setting('t.drv')::uuid), 379.00::numeric, 'D: driver receives nothing from a refunded job');
select is(tests.balance(current_setting('t.cust')::uuid), 0.00::numeric, 'D: no wallet credit to the customer for an escrow refund');

select set_config('t.je', pg_temp.escrow_job('e', 'in_progress')::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select set_config('t.de', (public.raise_dispute(current_setting('t.je')::uuid, null, 'other', 'Truck arrived late today')).id::text, true);
select tests.login_as(current_setting('t.admin')::uuid);
select lives_ok(format($$select public.resolve_dispute(%L, 'no_action', 'Delivered as agreed')$$, current_setting('t.de')),
  'D: dispute resolved in the driver''s favour');
select tests.as_owner();
select is(pg_temp.pstatus('e'), 'paid', 'D: escrow stays held for normal release');
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.complete_job(%L)$$, current_setting('t.je')), 'D: release in full after the dispute closes');
select tests.as_owner();
select is(pg_temp.pstatus('e'), 'released', 'D: escrow released');

-- An admin cannot resolve a dispute on a job they are a party to.
select set_config('t.jf', pg_temp.escrow_job('f', 'in_progress')::text, true);
update public.jobs set driver_id = current_setting('t.admin')::uuid where id = current_setting('t.jf')::uuid;
select tests.login_as(current_setting('t.cust')::uuid);
select set_config('t.df', (public.raise_dispute(current_setting('t.jf')::uuid, null, 'other', 'Self-dealing admin test')).id::text, true);
select tests.login_as(current_setting('t.admin')::uuid);
select throws_ok(format($$select public.resolve_dispute(%L, 'no_action', 'mine')$$, current_setting('t.df')), '42501', null,
  'D: admins cannot resolve disputes on their own jobs');

-- ===========================================================================
-- E. late payment (job already cancelled) and duplicate payment
-- ===========================================================================
select set_config('t.jg', pg_temp.escrow_job('g', 'accepted', false)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select lives_ok(format($$select public.cancel_job(%L, 'cancel before paying')$$, current_setting('t.jg')), 'E: job cancelled while payment pending');
select tests.as_service();
select is(public.apply_paynow_result(current_setting('t.p_g')::uuid, 'ipn', 'Paid', '300.00', current_setting('t.p_g'))->>'status',
  'refund_due', 'E: a payment that lands after cancellation goes straight to refund_due');

select set_config('t.jh', pg_temp.escrow_job('h')::text, true);
insert into public.payments (user_id, job_id, type, amount, currency, method, status, paynow_poll_url)
values (current_setting('t.cust')::uuid, current_setting('t.jh')::uuid, 'escrow', 300, 'USD', 'paynow', 'initiated',
        'https://www.paynow.co.zw/Interface/CheckPayment/?guid=h2')
returning set_config('t.p_h2', id::text, true);
select tests.as_service();
select is(public.apply_paynow_result(current_setting('t.p_h2')::uuid, 'ipn', 'Paid', '300.00', current_setting('t.p_h2'))->>'status',
  'refund_due', 'E: a duplicate payment for the same job goes to refund_due');
select tests.as_owner();
select is(pg_temp.pstatus('h'), 'paid', 'E: the original payment stays held');
select is((select reason from public.escrow_refunds where payment_id = current_setting('t.p_h2')::uuid), 'duplicate_payment', 'E: reason duplicate_payment');

-- ===========================================================================
-- Ledger invariants (I-7, escrow part)
-- ===========================================================================
select tests.as_owner();
select is((select count(*)::int from (select entry_group from public.platform_ledger group by entry_group having sum(amount) <> 0) x), 0,
  'Ledger: every entry group balances to zero');
select is(coalesce((select -sum(amount) from public.platform_ledger where account = 'escrow_held'), 0),
          coalesce((select sum(amount) from public.payments where type = 'escrow' and status = 'paid'), 0),
  'Ledger: escrow_held equals the total of paid (held) escrow payments');
select is(coalesce((select -sum(amount) from public.platform_ledger where account = 'refunds_payable'), 0),
          coalesce((select sum(amount) from public.payments where type = 'escrow' and status = 'refund_due'), 0),
  'Ledger: refunds_payable equals the total of refund_due payments');
select is(coalesce((select -sum(amount) from public.platform_ledger where account = 'platform_revenue'), 0), 42.00::numeric,
  'Ledger: platform revenue = commission on the two released escrows ($21 x 2)');
select is((select sum(amount) from public.wallet_transactions where user_id = current_setting('t.drv')::uuid and job_id is not null), 558.00::numeric,
  'Ledger: driver wallet received exactly two $279 releases and nothing from refunded jobs');
select throws_ok($$delete from public.platform_ledger$$, '42501', null, 'Ledger is append-only');

select * from finish();
rollback;
