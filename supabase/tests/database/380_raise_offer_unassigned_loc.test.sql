-- 0108 — regression: "Raise your offer" must not fail with
--   record "_loc" is not assigned yet
-- tg_validate_job_budget read _loc outside the client-INSERT branch, so any
-- UPDATE of budget on a priced (enforced) material raised. Custom/unpriced
-- materials return early, which is why test jobs from tests.create_job's default
-- material never saw it.
begin;
select plan(4);

select set_config('t.cust', tests.create_user('rb_cust')::text, true);
select tests.as_owner();

-- Priced job at the trigger's default 15 km distance (no coordinates), created
-- as owner so it is not a client insert.
select set_config('t.offer',
  (public.compute_material_offer('stones', 5, 15))->>'offer', true);
select set_config('t.max',
  (public.compute_material_offer('stones', 5, 15))->>'max', true);

select is(((public.compute_material_offer('stones', 5, 15))->>'enforced')::boolean, true,
  '1: precondition — stones is a priced (enforced) material, so the trigger reaches the radius gate');

select set_config('t.job',
  tests.create_job(current_setting('t.cust')::uuid, current_setting('t.offer')::numeric, 'direct', 'stones', 5)::text, true);

select tests.login_as(current_setting('t.cust')::uuid);

select lives_ok(
  format('select public.raise_job_budget(%L, least(%L::numeric + 1, %L::numeric))',
         current_setting('t.job'), current_setting('t.offer'), current_setting('t.max')),
  '2: customer can raise the offer on a priced job (no unassigned-record error)');

select tests.as_owner();
select cmp_ok((select budget from public.jobs where id = current_setting('t.job')::uuid),
  '>=', current_setting('t.offer')::numeric,
  '3: the budget was not lowered');

-- Raising above the platform maximum is still refused by the price range check.
select tests.login_as(current_setting('t.cust')::uuid);
select throws_ok(
  format('select public.raise_job_budget(%L, %L::numeric + 1000)', current_setting('t.job'), current_setting('t.max')),
  null, null, '4: raising above the allowed range is still rejected');

select * from finish();
rollback;
