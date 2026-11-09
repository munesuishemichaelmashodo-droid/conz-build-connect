-- 0165: read notifications clear after 14 days, unread after 180, nothing else is touched.
begin;
select plan(7);
select set_config('t.u', tests.create_user('nr_user')::text, true);

insert into public.notifications (user_id, type, title, body, "read", created_at) values
  (current_setting('t.u')::uuid, 't', 'read-old',      'b', true,  now() - interval '15 days'),
  (current_setting('t.u')::uuid, 't', 'read-recent',   'b', true,  now() - interval '2 days'),
  (current_setting('t.u')::uuid, 't', 'unread-recent', 'b', false, now() - interval '40 days'),
  (current_setting('t.u')::uuid, 't', 'unread-ancient','b', false, now() - interval '200 days');
insert into public.notifications (user_id, type, title, body, "read", created_at, archived_at) values
  (current_setting('t.u')::uuid, 't', 'archived-old',  'b', false, now() - interval '20 days', now() - interval '16 days');

select tests.login_as(current_setting('t.u')::uuid);
select throws_ok($$select public.prune_old_notifications()$$, '42501', null, 'a signed-in user cannot run the clean-up');
select tests.as_owner();

select is(public.prune_old_notifications(), 3, 'three notifications are cleared: read-old, archived-old, unread-ancient');
select ok(not exists (select 1 from public.notifications where title = 'read-old'), 'a read notification older than 14 days is gone');
select ok(not exists (select 1 from public.notifications where title = 'unread-ancient'), 'an unread one older than 180 days is gone');
select ok(exists (select 1 from public.notifications where title = 'read-recent'), 'a recently read notification stays');
select ok(exists (select 1 from public.notifications where title = 'unread-recent'), 'an unread notification of 40 days stays');
select is(public.prune_old_notifications(), 0, 'running it again clears nothing more');

select * from finish();
rollback;
