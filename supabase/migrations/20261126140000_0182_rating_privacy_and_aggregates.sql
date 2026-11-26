-- -----------------------------------------------------------------------------
-- 0182: rating privacy + rating averages that actually update (Stage 1, 26/11/2026).
--
-- Found by the 26/11 inspection (production, read-only):
--   1. ratings: policy "Ratings readable by authenticated" USING (true). Any signed-in user could list every
--      rating with customer_id, driver_id, job_id and the comment, i.e. who used which driver and when.
--   2. customer_ratings: policy "Authenticated can read customer ratings" USING (true). Same exposure for the
--      ratings drivers give customers.
--   3. Both average triggers (tg_rating_aggregate, tg_customer_rating_aggregate) run as the caller (SECURITY
--      INVOKER). The caller (a customer rating a driver, or a driver rating a customer) is not allowed to
--      update the other person's profile, so the UPDATE silently changed 0 rows: driver_profiles.rating_avg /
--      rating_count and profiles.customer_rating_avg / count never moved (reproduced locally: 0.00 / 0 after
--      a rating). Restricting reads alone would also have made the average count only rows the rater can see.
--
-- After:
--   * A rating row is readable only by the person who gave it, the person it is about, and admins.
--     Public figures stay where they were: driver_public_profiles (average, count) and the customer average on
--     profiles. The app reads rating rows only for "my own rating of this job" (unchanged).
--   * Both average triggers run as their owner (SECURITY DEFINER, fixed search_path) so they see every row and
--     can update the profile. Averages are recomputed once from the ratings that exist (production: 0 rows).
--   * anon loses SELECT; authenticated loses UPDATE/DELETE/TRUNCATE (RLS already had no such policies; ratings
--     cannot be edited or deleted by users).
-- Policies are changed with ALTER POLICY (no DROP). No DELETE.
-- Undo: supabase/rollbacks/20261126140000_0182_rollback.sql (exact previous definitions and grants).
-- -----------------------------------------------------------------------------

-- 1. Who can read rating rows -------------------------------------------------------------------------------
alter policy "Ratings readable by authenticated" on public.ratings
  using (customer_id = auth.uid()
         or driver_id = auth.uid()
         or public.has_role(auth.uid(), 'admin'::public.app_role)
         or public.has_role(auth.uid(), 'super_admin'::public.app_role));
alter policy "Ratings readable by authenticated" on public.ratings rename to "Ratings readable by the two parties and admins";

alter policy "Authenticated can read customer ratings" on public.customer_ratings
  using (driver_id = auth.uid()
         or customer_id = auth.uid()
         or public.has_role(auth.uid(), 'admin'::public.app_role)
         or public.has_role(auth.uid(), 'super_admin'::public.app_role));
alter policy "Authenticated can read customer ratings" on public.customer_ratings rename to "Customer ratings readable by the two parties and admins";

revoke select on public.ratings, public.customer_ratings from anon;
revoke update, delete, truncate on public.ratings, public.customer_ratings from anon, authenticated;

-- 2. Averages see every row and can update the profile -----------------------------------------------------
create or replace function public.tg_rating_aggregate()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _avg numeric; _cnt int;
begin
  select round(avg((quality + communication + reliability + delivery_time) / 4.0)::numeric, 2), count(*)
    into _avg, _cnt from public.ratings where driver_id = new.driver_id;
  update public.driver_profiles set rating_avg = coalesce(_avg, 0), rating_count = _cnt where user_id = new.driver_id;
  return new;
end $$;
revoke all on function public.tg_rating_aggregate() from public, anon, authenticated;

create or replace function public.tg_customer_rating_aggregate()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare _avg numeric; _cnt int;
begin
  select round(avg(overall)::numeric, 2), count(*)
    into _avg, _cnt from public.customer_ratings where customer_id = new.customer_id;
  update public.profiles set customer_rating_avg = _avg, customer_rating_count = _cnt where id = new.customer_id;
  return new;
end $$;
revoke all on function public.tg_customer_rating_aggregate() from public, anon, authenticated;

-- 3. One-off recompute from existing ratings (only rows whose figures are wrong change) ----------------------
update public.driver_profiles dp
   set rating_avg = a.avg, rating_count = a.cnt
  from (select driver_id, round(avg((quality + communication + reliability + delivery_time) / 4.0)::numeric, 2) avg,
               count(*)::int cnt
          from public.ratings group by driver_id) a
 where dp.user_id = a.driver_id
   and (dp.rating_avg is distinct from a.avg or dp.rating_count is distinct from a.cnt);

update public.profiles p
   set customer_rating_avg = a.avg, customer_rating_count = a.cnt
  from (select customer_id, round(avg(overall)::numeric, 2) avg, count(*)::int cnt
          from public.customer_ratings group by customer_id) a
 where p.id = a.customer_id
   and (p.customer_rating_avg is distinct from a.avg or p.customer_rating_count is distinct from a.cnt);
