-- 0170: driver_public_profiles shows verified drivers only (plus your own row, and admins).
--
-- Before: any signed-in user could read every driver's user_id, rating, level, job count and
-- verification_status, including pending, rejected and suspended drivers (the view is
-- SECURITY DEFINER, so driver_profiles RLS does not apply). The app reads it only for drivers
-- who bid on the viewer's job (jobs.$id.tsx) and for a chat partner (chat.$jobId.tsx); both are
-- verified drivers, so the screens are unchanged.
--
-- Same columns, same order, same grants (CREATE OR REPLACE VIEW keeps them). No DROP.
-- Undo: supabase/rollbacks/20261124100000_0170_rollback.sql (restores the exact live definition).

create or replace view public.driver_public_profiles as
 select dp.user_id,
    coalesce(agg.avg_rating, (0)::numeric) as rating_avg,
    (coalesce(agg.cnt, (0)::bigint))::integer as rating_count,
    dp.level,
    dp.jobs_completed,
    dp.verification_status
   from (driver_profiles dp
     left join ( select ratings.driver_id,
            avg((((((ratings.quality + ratings.communication) + ratings.reliability) + ratings.delivery_time))::numeric / 4.0)) as avg_rating,
            count(*) as cnt
           from ratings
          group by ratings.driver_id) agg on ((agg.driver_id = dp.user_id)))
  where dp.verification_status = 'verified'
     or dp.user_id = auth.uid()
     or public.has_role(auth.uid(), 'admin'::public.app_role)
     or public.has_role(auth.uid(), 'super_admin'::public.app_role);

-- Grants unchanged from production: authenticated may SELECT; anon may not.
revoke all on public.driver_public_profiles from anon;
grant select on public.driver_public_profiles to authenticated;
