-- 0153: a customer who only has an offer cannot read the bidder's phone, email or truck row;
-- after choosing, the chosen driver's contact details and truck are readable; other customers,
-- other drivers and the offers function keep working as designed.
begin;
select plan(9);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust',  tests.create_user('bx_cust')::text, true);
select set_config('t.other', tests.create_user('bx_other')::text, true);
select set_config('t.da',    tests.create_driver('bx_da', 200, true)::text, true);
select set_config('t.db',    tests.create_driver('bx_db', 200, true)::text, true);

select tests.as_owner();
update public.profiles set phone = '+263771111111' where id in (current_setting('t.da')::uuid, current_setting('t.db')::uuid);
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
select set_config('t.ba', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.da')::uuid, 100)::text, true);
select set_config('t.bb', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.db')::uuid, 110)::text, true);

-- before choosing
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.profiles where id in (current_setting('t.da')::uuid, current_setting('t.db')::uuid)), 0,
          'a customer with offers cannot read the bidders'' profile rows');
select is((select count(*)::int from public.trucks where driver_id in (current_setting('t.da')::uuid, current_setting('t.db')::uuid)), 0,
          'a customer with offers cannot read the bidders'' truck rows');
select is((select count(*)::int from public.offer_bidder_cards(current_setting('t.job')::uuid)), 2,
          'the offers function still works');
select ok((select every(plate_display like '%••••') from public.offer_bidder_cards(current_setting('t.job')::uuid)),
          'and shows only masked plates');

-- after choosing driver A
select public.accept_bid(current_setting('t.ba')::uuid);
select is((select phone from public.profiles where id = current_setting('t.da')::uuid), '+263771111111',
          'the chosen driver''s contact details are readable on the live job');
select is((select count(*)::int from public.profiles where id = current_setting('t.db')::uuid), 0,
          'the driver who was not chosen stays unreadable');
select is((select count(*)::int from public.trucks where driver_id = current_setting('t.da')::uuid), 1,
          'the chosen driver''s truck is readable');
select is((select count(*)::int from public.trucks where driver_id = current_setting('t.db')::uuid), 0,
          'the other truck is not');

-- an unrelated customer sees none of it
select tests.login_as(current_setting('t.other')::uuid);
select is((select count(*)::int from public.profiles where id = current_setting('t.da')::uuid)
        + (select count(*)::int from public.trucks where driver_id = current_setting('t.da')::uuid), 0,
          'an unrelated customer cannot read the driver or the truck');

select * from finish();
rollback;
