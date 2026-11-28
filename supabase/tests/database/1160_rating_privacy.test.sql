-- 0182: rating rows are private to the two parties and admins; the public averages still work and now update.
begin;
select plan(22);

select tests.as_owner();
select set_config('t.c1',  tests.create_user('rp_cust1')::text, true);
select set_config('t.c2',  tests.create_user('rp_cust2')::text, true);
select set_config('t.x',   tests.create_user('rp_stranger')::text, true);
select set_config('t.adm', tests.create_user('rp_admin', array['admin'])::text, true);
select set_config('t.d1',  tests.create_driver('rp_drv1', 0)::text, true);
select set_config('t.d2',  tests.create_driver('rp_drv2', 0)::text, true);

create function pg_temp.done(_c uuid, _d uuid) returns uuid language plpgsql as $f$
declare _j uuid;
begin
  _j := tests.create_job(_c, 200, 'direct');
  update public.jobs set status = 'completed', driver_id = _d, final_price = 200, completed_at = now() where id = _j;
  return _j;
end $f$;
select set_config('t.j1', pg_temp.done(current_setting('t.c1')::uuid, current_setting('t.d1')::uuid)::text, true);
select set_config('t.j2', pg_temp.done(current_setting('t.c2')::uuid, current_setting('t.d1')::uuid)::text, true);
select set_config('t.jopen', tests.create_job(current_setting('t.c1')::uuid, 200, 'direct')::text, true);

-- ======================================================== ratings written by the real parties, through RLS
select tests.login_as(current_setting('t.c1')::uuid);
select lives_ok(format($$insert into public.ratings (job_id, customer_id, driver_id, quality, communication, reliability, delivery_time, comment)
                         values (%L, %L, %L, 5, 5, 4, 4, 'private note from customer 1')$$,
                       current_setting('t.j1'), current_setting('t.c1'), current_setting('t.d1')), '1: customer 1 rates their driver');
select tests.login_as(current_setting('t.c2')::uuid);
select lives_ok(format($$insert into public.ratings (job_id, customer_id, driver_id, quality, communication, reliability, delivery_time)
                         values (%L, %L, %L, 3, 3, 3, 3)$$, current_setting('t.j2'), current_setting('t.c2'), current_setting('t.d1')),
                '2: customer 2 rates the same driver');
select tests.login_as(current_setting('t.d1')::uuid);
select lives_ok(format($$insert into public.customer_ratings (job_id, driver_id, customer_id, punctuality, communication, payment, overall, comment)
                         values (%L, %L, %L, 4, 4, 4, 4, 'private note from driver')$$,
                       current_setting('t.j1'), current_setting('t.d1'), current_setting('t.c1')), '3: the driver rates customer 1');

-- ======================================================== averages now update (they stayed 0 before 0182)
select tests.as_owner();
select is((select rating_avg from public.driver_profiles where user_id = current_setting('t.d1')::uuid), 3.75::numeric,
          '4: driver average = mean of both ratings (4.5 and 3.0)');
select is((select rating_count from public.driver_profiles where user_id = current_setting('t.d1')::uuid), 2, '5: driver rating count = 2');
select is((select customer_rating_avg from public.profiles where id = current_setting('t.c1')::uuid), 4.00::numeric, '6: customer average updated');
select is((select customer_rating_count from public.profiles where id = current_setting('t.c1')::uuid), 1, '7: customer rating count updated');

-- ======================================================== who can read rating rows
select tests.login_as(current_setting('t.x')::uuid);
select is((select count(*)::int from public.ratings), 0, '8: an unrelated signed-in user reads no driver ratings');
select is((select count(*)::int from public.customer_ratings), 0, '9: nor any customer ratings');
select tests.login_as(current_setting('t.d2')::uuid);
select is((select count(*)::int from public.ratings), 0, '10: another driver reads none of them');
select tests.login_as(current_setting('t.c2')::uuid);
select is((select count(*)::int from public.ratings), 1, '11: customer 2 reads only the rating they gave');
select is((select count(*)::int from public.ratings where comment = 'private note from customer 1'), 0, '12: not customer 1''s comment');
select tests.login_as(current_setting('t.c1')::uuid);
select is((select count(*)::int from public.customer_ratings), 1, '13: customer 1 reads the rating about them');
select tests.login_as(current_setting('t.d1')::uuid);
select is((select count(*)::int from public.ratings), 2, '14: the driver reads the ratings about them');
select tests.login_as(current_setting('t.adm')::uuid);
select is((select count(*)::int from public.ratings), 2, '15: admins read all ratings');
select tests.as_anon();
select throws_ok($$select count(*) from public.ratings$$, '42501', null, '16: signed-out visitors cannot read ratings');

-- ======================================================== public figures unaffected
select tests.login_as(current_setting('t.x')::uuid);
select is((select rating_avg from public.driver_public_profiles where user_id = current_setting('t.d1')::uuid), 3.75::numeric,
          '17: anyone signed in still sees the driver''s public average');
select is((select rating_count from public.driver_public_profiles where user_id = current_setting('t.d1')::uuid), 2,
          '18: and count');

-- ======================================================== no editing, no fake ratings
select tests.login_as(current_setting('t.c1')::uuid);
select throws_ok(format($$update public.ratings set quality = 1 where job_id = %L$$, current_setting('t.j1')), '42501', null,
                 '19: a rating cannot be edited');
select throws_ok(format($$delete from public.ratings where job_id = %L$$, current_setting('t.j1')), '42501', null,
                 '20: or deleted');
select throws_ok(format($$insert into public.ratings (job_id, customer_id, driver_id, quality, communication, reliability, delivery_time)
                          values (%L, %L, %L, 5, 5, 5, 5)$$, current_setting('t.jopen'), current_setting('t.c1'), current_setting('t.d2')),
                 '42501', null, '21: a job that is not completed cannot be rated');
select throws_ok(format($$insert into public.ratings (job_id, customer_id, driver_id, quality, communication, reliability, delivery_time)
                          values (%L, %L, %L, 5, 5, 5, 5)$$, current_setting('t.j1'), current_setting('t.c1'), current_setting('t.d1')),
                 '23505', null, '22: one rating per job');

select * from finish();
rollback;
