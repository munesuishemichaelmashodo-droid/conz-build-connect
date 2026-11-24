-- Undo 0170: restore driver_public_profiles exactly as it was live on 24/11/2026
-- (pg_get_viewdef read from production). No DROP; grants are kept by CREATE OR REPLACE.
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
          group by ratings.driver_id) agg on ((agg.driver_id = dp.user_id)));

delete from supabase_migrations.schema_migrations where version = '20261124100000';
