-- Expose verification_status through the public driver view so customers
-- can see a "Verified" badge on bids before accepting one. Not a new
-- privacy exposure: driver_profiles is already readable by any
-- authenticated user (see "Driver profiles readable by authenticated"),
-- this view just already omitted the one field that actually matters to
-- a customer choosing between drivers. Applied live to ovwrsocjmkpiygipmrdk
-- already; recorded here so migration history matches the live schema.
CREATE OR REPLACE VIEW public.driver_public_profiles AS
SELECT
  dp.user_id,
  COALESCE(agg.avg_rating, 0::numeric) AS rating_avg,
  COALESCE(agg.cnt, 0::bigint)::integer AS rating_count,
  dp.level,
  dp.jobs_completed,
  dp.verification_status
FROM driver_profiles dp
LEFT JOIN (
  SELECT ratings.driver_id,
         avg((ratings.quality + ratings.communication + ratings.reliability + ratings.delivery_time)::numeric / 4.0) AS avg_rating,
         count(*) AS cnt
  FROM ratings
  GROUP BY ratings.driver_id
) agg ON agg.driver_id = dp.user_id;
