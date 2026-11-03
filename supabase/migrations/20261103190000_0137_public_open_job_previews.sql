-- -----------------------------------------------------------------------------
-- 0137: safe public preview of open delivery requests, for drivers who are not signed in yet.
--
-- Shows only: material, quantity, the customer's budget, the area (suburb and city, never a street or
-- coordinates), when it was posted and the preferred date. No job id, notes, contact, address or location
-- detail, so nothing can be used to find or contact the customer. Real, open, unexpired requests only
-- (newest 12); no invented activity. A driver must sign in (and be verified) to see more or to offer.
-- No DROP. Undo: supabase/rollbacks/20261103190000_0137_rollback.sql
-- -----------------------------------------------------------------------------

begin;

create or replace function public.public_open_job_previews(_limit integer default 12)
returns table (material text, custom_material text, quantity_m3 numeric, budget numeric, area text,
               posted_at timestamptz, preferred_date date)
language sql
stable
security definer
set search_path to 'public'
as $$
  select j.material::text,
         case when j.material = 'custom' then public.redact_contacts(left(coalesce(j.custom_material, ''), 40)) else null end,
         j.quantity_m3, j.budget,
         public.coarse_place(j.delivery_address),
         j.created_at, j.preferred_date
    from public.jobs j
   where j.status = 'open' and j.driver_id is null
     and (j.expires_at is null or j.expires_at > now())
   order by j.created_at desc
   limit greatest(1, least(coalesce(_limit, 12), 20))
$$;

revoke all on function public.public_open_job_previews(integer) from public;
grant execute on function public.public_open_job_previews(integer) to anon, authenticated;

commit;
