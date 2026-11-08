-- 0152: a customer comparing offers sees a safe bidder card (name, photo, last active, truck type, make,
-- model, colour, capacity, masked plate). Before the customer picks a driver the full plate is hidden; after,
-- the chosen driver's plate is shown. Nobody else can ask for the cards.
begin;
select plan(15);
select tests.enable_launch_features();
alter table public.jobs disable trigger trg_jobs_one_active_per_driver;

select set_config('t.cust',  tests.create_user('bc_cust')::text, true);
select set_config('t.other', tests.create_user('bc_other')::text, true);
select set_config('t.admin', tests.create_user('bc_admin', array['admin'])::text, true);
select set_config('t.da',    tests.create_driver('bc_da', 200, true)::text, true);
select set_config('t.db',    tests.create_driver('bc_db', 200, true)::text, true);

select tests.as_owner();
update public.profiles set phone = '+263771111111' where id = current_setting('t.da')::uuid;
update public.trucks set registration = 'AEF 1234', body_type = 'tipper', make = 'Isuzu', model = 'FVZ',
       colour = 'white' where driver_id = current_setting('t.da')::uuid;
select set_config('t.job', tests.create_job(current_setting('t.cust')::uuid, 100, 'direct')::text, true);
select set_config('t.ba', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.da')::uuid, 100)::text, true);
select set_config('t.bb', tests.create_bid(current_setting('t.job')::uuid, current_setting('t.db')::uuid, 110)::text, true);

-- 1-2 new truck facts exist and are limited
select has_column('public', 'trucks', 'body_type', 'trucks has body_type');
select throws_ok(format($$update public.trucks set body_type = 'spaceship' where driver_id = %L$$, current_setting('t.da')),
                 null, null, 'an unknown body type is refused');

-- 3-8 the customer's card
select tests.login_as(current_setting('t.cust')::uuid);
select is((select count(*)::int from public.offer_bidder_cards(current_setting('t.job')::uuid)), 2, 'the customer gets one card per offer');
select is((select plate_display from public.offer_bidder_cards(current_setting('t.job')::uuid) where bid_id = current_setting('t.ba')::uuid),
          'AEF ••••', 'before choosing, the plate is masked');
select is((select make || ' ' || model from public.offer_bidder_cards(current_setting('t.job')::uuid) where bid_id = current_setting('t.ba')::uuid),
          'Isuzu FVZ', 'make and model are shown');
select is((select body_type from public.offer_bidder_cards(current_setting('t.job')::uuid) where bid_id = current_setting('t.ba')::uuid),
          'tipper', 'body type is shown');
select ok((select position('phone' in pg_get_function_result('public.offer_bidder_cards(uuid)'::regprocedure)) = 0
           and position('email' in pg_get_function_result('public.offer_bidder_cards(uuid)'::regprocedure)) = 0),
          'the card has no phone or email column');

-- 9-10 other people cannot ask
select tests.login_as(current_setting('t.other')::uuid);
select is((select count(*)::int from public.offer_bidder_cards(current_setting('t.job')::uuid)), 0, 'an unrelated customer gets no cards');
select tests.login_as(current_setting('t.db')::uuid);
select is((select count(*)::int from public.offer_bidder_cards(current_setting('t.job')::uuid)), 0, 'another bidding driver gets no cards');

-- 11 anon cannot call it
select tests.as_anon();
select throws_ok(format($$select * from public.offer_bidder_cards(%L)$$, current_setting('t.job')), null, null, 'anonymous visitors cannot call it');

-- 12 admin can
select tests.login_as(current_setting('t.admin')::uuid);
select is((select count(*)::int from public.offer_bidder_cards(current_setting('t.job')::uuid)), 2, 'an admin can read the cards');

-- 13-14 after the customer chooses, the chosen driver's plate is shown, the other stays masked
select tests.login_as(current_setting('t.cust')::uuid);
select public.accept_bid(current_setting('t.ba')::uuid);
select is((select plate_display from public.offer_bidder_cards(current_setting('t.job')::uuid) where bid_id = current_setting('t.ba')::uuid),
          'AEF 1234', 'after choosing, the chosen truck shows its full plate');
select ok((select plate_display from public.offer_bidder_cards(current_setting('t.job')::uuid)
            where bid_id = current_setting('t.bb')::uuid) like '%••••', 'a driver who was not chosen stays masked');
select tests.as_owner();

-- 15-16 a change to a declared truck fact sends a verified driver back to review
update public.driver_profiles set verification_status = 'verified' where user_id = current_setting('t.db')::uuid;
select tests.login_as(current_setting('t.db')::uuid);
update public.trucks set body_type = 'tipper', make = 'Hino' where driver_id = current_setting('t.db')::uuid;
select tests.as_owner();
select is((select verification_status::text from public.driver_profiles where user_id = current_setting('t.db')::uuid), 'verified',
          'first time a driver fills in the declared facts, they stay verified');
select tests.login_as(current_setting('t.db')::uuid);
update public.trucks set make = 'Isuzu' where driver_id = current_setting('t.db')::uuid;
select tests.as_owner();
select is((select verification_status::text from public.driver_profiles where user_id = current_setting('t.db')::uuid), 'pending',
          'changing an already declared fact sends the driver back to review');

select * from finish();
rollback;
