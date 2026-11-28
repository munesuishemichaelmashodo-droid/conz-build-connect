-- 0189: the $20 promotional allowance covers the commission on the first completed job only.
-- Below $20 the rest expires; above $20 real Commission Credit pays the difference; cancellation never uses or expires
-- it; it cannot be reused; new grants only for drivers with no completed job; existing grants are left alone.
begin;
select plan(24);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust',  tests.create_user('p1_cust')::text, true);
select set_config('t.small', tests.create_driver('p1_small', 0)::text, true);    -- promo only; $100 job -> $7
select set_config('t.big',   tests.create_driver('p1_big', 50)::text, true);     -- $50 credit; $400 job -> $28
select set_config('t.canc',  tests.create_driver('p1_canc', 0)::text, true);     -- cancels first
select set_config('t.hist',  tests.create_driver('p1_hist', 0)::text, true);     -- historical grant, no new job
select set_config('t.vet',   tests.create_driver('p1_vet', 30)::text, true);     -- already completed a job
select set_config('t.admin', tests.create_user('p1_admin', array['admin','super_admin'])::text, true);

select tests.as_owner();
update public.system_settings set value = 'true'::jsonb where key = 'promo_credit_enabled';
-- grants as 0134 records them (one ledger line + promo bucket)
insert into public.promo_credit_ledger (user_id, amount, kind, note)
select u, 20, 'grant', 'test grant' from unnest(array[current_setting('t.small')::uuid, current_setting('t.big')::uuid,
                                                     current_setting('t.canc')::uuid, current_setting('t.hist')::uuid]) u;
update public.wallets set promo_balance = 20
 where user_id in (current_setting('t.small')::uuid, current_setting('t.big')::uuid, current_setting('t.canc')::uuid, current_setting('t.hist')::uuid);

create function pg_temp.assigned(_drv uuid, _price numeric) returns uuid language plpgsql as $f$
declare _j uuid; _b uuid;
begin
  perform tests.as_owner();
  _j := tests.create_job(current_setting('t.cust')::uuid, _price);
  _b := tests.create_bid(_j, _drv, _price);
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform public.accept_bid(_b);
  perform tests.as_owner();
  return _j;
end $f$;
create function pg_temp.finish(_j uuid) returns void language plpgsql as $f$
begin
  perform tests.login_as(current_setting('t.cust')::uuid);
  perform tests.complete(_j);
  perform tests.as_owner();
end $f$;
create function pg_temp.w(_u uuid) returns public.wallets language sql as $f$ select * from public.wallets where user_id = _u $f$;

-- ============================================================ A. commission below $20
select set_config('t.j1', pg_temp.assigned(current_setting('t.small')::uuid, 100)::text, true);
select ok((select promo_balance = 13 and held = 7 from pg_temp.w(current_setting('t.small')::uuid)),
          '1: a $100 job reserves only the $7 commission from the allowance');
select pg_temp.finish(current_setting('t.j1')::uuid);
select is((select promo_balance from pg_temp.w(current_setting('t.small')::uuid)), 0.00::numeric, '2: after the first completed job the unused $13 expires');
select is((select amount from public.promo_credit_ledger where user_id = current_setting('t.small')::uuid and kind = 'expire'), -13.00::numeric,
          '3: the expiry is a ledger line');
select is((select job_id from public.promo_credit_ledger where user_id = current_setting('t.small')::uuid and kind = 'expire'), current_setting('t.j1')::uuid,
          '4: tied to the first completed job');
select is((select sum(amount) from public.platform_ledger where job_id = current_setting('t.j1')::uuid and account = 'platform_revenue'), -7::numeric,
          '5: Con Z earns the $7 commission');
select is((select balance from pg_temp.w(current_setting('t.small')::uuid)), 0.00::numeric, '6: no real credit was used or created');
-- cannot be reused
select set_config('t.j1b', tests.create_job(current_setting('t.cust')::uuid, 100)::text, true);
select set_config('t.b1b', tests.create_bid(current_setting('t.j1b')::uuid, current_setting('t.small')::uuid, 100)::text, true);
select tests.login_as(current_setting('t.small')::uuid);
select is((public.driver_can_accept(current_setting('t.j1b')::uuid) ->> 'ok')::boolean, false,
          '7: the expired allowance cannot pay a second job (no real credit: cannot accept)');
select tests.as_owner();
select is(public.grant_promo_credit(current_setting('t.small')::uuid), false, '8: and it cannot be granted again');

-- ============================================================ B. commission above $20
select set_config('t.j2', pg_temp.assigned(current_setting('t.big')::uuid, 400)::text, true);
select ok((select promo_balance = 0 and held = 28 and balance = 70 from pg_temp.w(current_setting('t.big')::uuid)),
          '9: a $400 job reserves the full $20 allowance plus $8 of real Commission Credit');
select is((select held_commission_promo from public.jobs where id = current_setting('t.j2')::uuid), 20.00::numeric, '10: $20 of it is promotional');
select pg_temp.finish(current_setting('t.j2')::uuid);
select is((select balance from pg_temp.w(current_setting('t.big')::uuid)), 42.00::numeric,
          '11: after completion the driver''s own credit went down by $8 only ($50 -> $42)');
select is((select count(*)::int from public.promo_credit_ledger where user_id = current_setting('t.big')::uuid and kind = 'expire'), 0,
          '12: nothing left to expire');
select is((select sum(amount) from public.platform_ledger where job_id = current_setting('t.j2')::uuid and account = 'platform_revenue'), -28::numeric,
          '13: Con Z earns the full $28');

-- ============================================================ C. cancellation never uses or expires it
select set_config('t.j3', pg_temp.assigned(current_setting('t.canc')::uuid, 100)::text, true);
select tests.login_as(current_setting('t.cust')::uuid);
select public.cancel_job(current_setting('t.j3')::uuid, 'Changed my mind');
select tests.as_owner();
select ok((select promo_balance = 20 and held = 0 and balance = 0 from pg_temp.w(current_setting('t.canc')::uuid)),
          '14: a cancelled job returns the reservation to the allowance, not to cash');
select is((select count(*)::int from public.promo_credit_ledger where user_id = current_setting('t.canc')::uuid and kind = 'expire'), 0,
          '15: and nothing expired');
select set_config('t.j3b', pg_temp.assigned(current_setting('t.canc')::uuid, 100)::text, true);
select pg_temp.finish(current_setting('t.j3b')::uuid);
select is((select promo_balance from pg_temp.w(current_setting('t.canc')::uuid)), 0.00::numeric,
          '16: the allowance is used on the first job that is actually completed');

-- ============================================================ D. existing grants and eligibility
select is((select promo_balance from pg_temp.w(current_setting('t.hist')::uuid)), 20.00::numeric,
          '17: an existing grant is untouched until that driver completes a job');
select set_config('t.vj', pg_temp.assigned(current_setting('t.vet')::uuid, 100)::text, true);
select pg_temp.finish(current_setting('t.vj')::uuid);
select is(public.grant_promo_credit(current_setting('t.vet')::uuid), false, '18: a driver who has already completed a job is not granted the allowance');
select set_config('t.fresh', tests.create_user('p1_fresh')::text, true);
insert into public.driver_profiles (user_id, verification_status) values (current_setting('t.fresh')::uuid, 'pending');
update public.driver_profiles set verification_status = 'verified' where user_id = current_setting('t.fresh')::uuid;
select is((select promo_balance from pg_temp.w(current_setting('t.fresh')::uuid)), 20.00::numeric, '19: a newly verified driver with no jobs gets $20');

-- ============================================================ E. integrity
select is((select count(*)::int from public.promo_credit_ledger l where l.kind = 'expire'
            and exists (select 1 from public.promo_credit_ledger g where g.user_id = l.user_id and g.kind = 'expire' and g.id <> l.id)), 0,
          '20: at most one expiry per driver');
update public.jobs set status = 'completed' where id = current_setting('t.j1')::uuid;
select is((select count(*)::int from public.promo_credit_ledger where user_id = current_setting('t.small')::uuid and kind = 'expire'), 1,
          '21: a repeated completion event does not expire twice');
select throws_ok($$insert into public.promo_credit_ledger (user_id, amount, kind) values (current_setting('t.hist')::uuid, -5, 'expire')$$,
                 '23514', null, '22: an expiry must be tied to a job');
select throws_like(format($$update public.promo_credit_ledger set amount = -1 where user_id = %L and kind = 'expire'$$, current_setting('t.small')),
                   '%', '23: ledger lines cannot be edited');
select tests.login_as(current_setting('t.admin')::uuid);
select ok((select bool_and(ok) from public.promo_credit_reconciliation()), '24: promo buckets still reconcile with the ledger');

select * from finish();
rollback;
