-- 0123 — price accuracy report for admins (owner request 27/10/2026: "make the calculator get better as it goes")
--
-- Read-only. For each material, compares the estimate saved on the job (jobs.pricing_breakdown->'recommended',
-- written when the customer booked) with the price the customer actually accepted (jobs.final_price). Admins use
-- it to adjust material and bucket prices with evidence. It never changes a price by itself.
-- Admin or super admin only; nothing about individual customers or drivers is returned.
-- Undo: supabase/rollbacks/20261027140000_0123_rollback.sql.

create or replace function public.admin_price_accuracy(_days integer default 180)
returns table (
  material text,
  jobs integer,
  median_estimate numeric,
  median_accepted numeric,
  median_gap_pct numeric,
  within_15_pct integer,
  last_job_at timestamptz
)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'super_admin')) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return query
  with s as (
    select j.material::text as material,
           (j.pricing_breakdown->>'recommended')::numeric as est,
           j.final_price::numeric as acc,
           j.created_at
      from public.jobs j
     where j.pricing_breakdown ? 'recommended'
       and (j.pricing_breakdown->>'recommended') ~ '^[0-9]+(\.[0-9]+)?$'
       and (j.pricing_breakdown->>'recommended')::numeric > 0
       and j.final_price > 0
       and j.status in ('accepted', 'in_progress', 'completed')
       and j.created_at >= now() - make_interval(days => greatest(1, least(coalesce(_days, 180), 730)))
  )
  select s.material,
         count(*)::int,
         round(percentile_cont(0.5) within group (order by s.est)::numeric, 2),
         round(percentile_cont(0.5) within group (order by s.acc)::numeric, 2),
         round(percentile_cont(0.5) within group (order by (s.acc - s.est) / s.est * 100)::numeric, 1),
         count(*) filter (where abs(s.acc - s.est) / s.est <= 0.15)::int,
         max(s.created_at)
    from s
   group by s.material
   order by count(*) desc, s.material;
end $$;
revoke all on function public.admin_price_accuracy(integer) from public, anon;
grant execute on function public.admin_price_accuracy(integer) to authenticated;
