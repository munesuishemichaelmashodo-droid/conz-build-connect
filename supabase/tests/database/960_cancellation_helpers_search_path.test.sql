-- 0164: the two cancellation-reason helpers pin their search path (advisor: function_search_path_mutable), and still behave.
begin;
select plan(5);

select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'cancellation_reason_known'
             and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  'cancellation_reason_known has a fixed search_path');
select ok(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'cancellation_reason_allowed'
             and exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  'cancellation_reason_allowed has a fixed search_path');

select ok(public.cancellation_reason_known('other'), 'a known reason is accepted');
select ok(not public.cancellation_reason_known('made_up_reason'), 'an unknown reason is refused');
select ok(public.cancellation_reason_allowed('customer', 'price_too_high') and not public.cancellation_reason_allowed('driver', 'price_too_high'),
          'a driver still cannot use a customer-only reason');

select * from finish();
rollback;
