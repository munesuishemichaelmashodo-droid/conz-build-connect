-- ratings_job_id_key (backing the UNIQUE(job_id) constraint) and
-- ratings_one_per_job were identical redundant unique indexes on the
-- same column, flagged by the Supabase performance advisor. Keeping
-- the constraint-backed one, dropping the redundant standalone index.
-- Applied live to ovwrsocjmkpiygipmrdk already; recorded here so
-- migration history matches the live schema.
DROP INDEX IF EXISTS public.ratings_one_per_job;
