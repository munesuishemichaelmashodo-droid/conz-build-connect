-- 0136: clearing a notification archives it; nothing else changes and nobody can touch another person's notifications.
begin;
select plan(7);
select set_config('t.a', tests.create_user('nt_a')::text, true);
select set_config('t.b', tests.create_user('nt_b')::text, true);
select set_config('t.j', tests.create_job(current_setting('t.a')::uuid, 200)::text, true);
insert into public.notifications (user_id, type, title, body, job_id)
values (current_setting('t.a')::uuid, 'job_cancelled', 'Cancelled', 'x', current_setting('t.j')::uuid) returning id;
select set_config('t.n', (select id::text from public.notifications where user_id = current_setting('t.a')::uuid limit 1), true);

select tests.login_as(current_setting('t.a')::uuid);
select lives_ok(format($$update public.notifications set archived_at = now() where id = %L$$, current_setting('t.n')), 'a person can clear their own notification');
select is((select count(*)::int from public.notifications where archived_at is null), 0, 'it leaves the active list');
select is((select count(*)::int from public.notifications where id = current_setting('t.n')::uuid), 1, 'but the notification still exists');
select lives_ok(format($$update public.notifications set archived_at = null where id = %L$$, current_setting('t.n')), 'and clearing can be undone');
select lives_ok(format($$update public.notifications set read = false where id = %L$$, current_setting('t.n')), 'read / unread can be toggled');
select tests.login_as(current_setting('t.b')::uuid);
select is((select count(*)::int from public.notifications), 0, 'another person cannot read it');
select tests.as_owner();
select is((select status::text from public.jobs where id = current_setting('t.j')::uuid), 'open', 'the job it referred to is untouched');
select * from finish();
rollback;
