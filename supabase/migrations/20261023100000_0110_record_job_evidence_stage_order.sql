-- 0110: delivery evidence follows the delivery stages and only the driver can file it.
--
-- PREPARED, NOT APPLIED. Owner approved applying it, but only AFTER the app release:
-- the live app (main) still offers the delivery-photo upload when a pickup photo
-- exists but start_trip failed (status still 'accepted'), and this migration refuses
-- delivery evidence before the trip starts. The release branch replaces that with a
-- "Start trip" retry (browser-checked 24/10, first attempt failing). DEPLOY ORDER:
-- deploy the app, then apply this file. The one job in that state on 23/10 is test
-- data (owner: disposable), so it does not block. No DROP statements (the Supabase
-- tool hangs on DROP).
--
-- Defect (read from the live definition, identical to the 13/08 baseline, 23/10/2026):
-- record_job_evidence is executable by every signed-in user and
--   * lets the job's CUSTOMER (or an admin) record 'pickup' / 'delivery' evidence;
--   * accepts a 'delivery' photo before pickup is confirmed and before the trip
--     has started (stage skipping);
--   * never checks that the file exists, so any path under the job id is accepted.
-- Only the FIRST photo of each kind becomes jobs.pickup_photo_url /
-- delivery_photo_url, and completion (job_has_delivery_evidence, 0096) requires
-- that photo to be the driver's own. So a customer filing a 'delivery' row first,
-- even with a made-up path, leaves the job impossible to complete, and a driver can
-- file "delivery" proof for a load that was never collected.
--
-- Fix (only these checks are added; the rest of the body is the live one):
--   * 'pickup' and 'delivery' evidence: assigned driver only, job active.
--   * 'delivery' evidence: only once the trip has started (status in_progress,
--     which start_trip only allows after the pickup photo).
--   * every evidence row must point at a file that really exists in the private
--     job-proof-photos bucket (the app always uploads first, then records).
--   * (24/10) recording a photo no longer copies its GPS over the job's pickup point
--     or delivery address. Live, every first pickup/delivery photo overwrote them, so
--     the admin dispute panel's "metres from the delivery address"
--     (evidence_distance_m) always read about 0 and the supplier pickup point was
--     lost (14 of 14 comparable live pickups read 0.0 km). A job with no pickup point
--     still takes it from the pickup photo. Points already overwritten are not
--     restored. Tested in pgTAP 420.
-- 'dispute' / 'other' evidence keeps its existing rule (any party to the job or an
-- admin). Storage policies, completion rules and existing rows are unchanged.
--
-- Rollback: supabase/rollbacks/20261023100000_0110_rollback.sql (the exact production
-- definition read 24/10/2026, body hash 12ae4e5b...; verified locally). After applying,
-- the live body hash (whitespace removed) must be 38cb79749d7c95c4e3a679dc72ac1895.

create or replace function public.record_job_evidence(
  _job_id uuid,
  _kind text,
  _storage_path text,
  _file_size bigint default null::bigint,
  _mime_type text default null::text,
  _lat double precision default null::double precision,
  _lng double precision default null::double precision,
  _accuracy_m numeric default null::numeric,
  _location_status text default 'unknown'::text
)
 returns job_evidence
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  _job public.jobs;
  _ev  public.job_evidence;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if _kind not in ('pickup','delivery','dispute','other') then
    raise exception 'Invalid evidence kind: %', _kind;
  end if;
  select * into _job from public.jobs where id = _job_id for update;
  if not found then raise exception 'Job not found'; end if;
  if _job.driver_id <> auth.uid()
     and _job.customer_id <> auth.uid()
     and not (public.has_role(auth.uid(), 'admin'::public.app_role)
           or public.has_role(auth.uid(), 'super_admin'::public.app_role)) then
    raise exception 'Not part of this job';
  end if;

  -- (0110) Pickup and delivery photos are the driver's proof of each stage.
  if _kind in ('pickup', 'delivery') then
    if _job.driver_id is distinct from auth.uid() then
      raise exception 'Only the assigned driver can record the % photo.', _kind
        using errcode = '42501';
    end if;
    if _job.status not in ('accepted', 'in_progress') then
      raise exception 'This job is not active.';
    end if;
    if _kind = 'delivery' and (_job.status <> 'in_progress' or _job.pickup_photo_url is null) then
      raise exception 'Confirm pickup and start the trip before taking the delivery photo.';
    end if;
  end if;

  -- path must sit under the job id — same rule the storage
  -- policies enforce
  if split_part(_storage_path, '/', 1) <> _job_id::text then
    raise exception 'Evidence path must start with the job id';
  end if;

  -- (0110) The photo must really be in the private evidence bucket.
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'job-proof-photos' and o.name = _storage_path) then
    raise exception 'The photo was not uploaded. Take or choose it again.';
  end if;

  insert into public.job_evidence
    (job_id, kind, storage_path, uploaded_by, file_size, mime_type,
     device_lat, device_lng, device_accuracy_m, location_status)
  values
    (_job_id, _kind, _storage_path, auth.uid(), _file_size, _mime_type,
     _lat, _lng, _accuracy_m,
     coalesce(_location_status, case when _lat is not null then 'captured'
                                     else 'unknown' end))
  returning * into _ev;
  -- point the jobs row at the FIRST photo of each kind only;
  -- later ones are recorded but do not replace it.
  -- The photo's GPS stays on the evidence row. The job keeps its own pickup point and
  -- delivery address (copying the photo's GPS over them made every "distance from the
  -- address" check read 0). Only a job with no pickup point ("driver arranges pickup")
  -- takes it from the pickup photo, so where the load came from is still recorded.
  if _kind = 'pickup' and _job.pickup_photo_url is null then
    update public.jobs
       set pickup_photo_url = _storage_path,
           pickup_lat = case when pickup_lat is null and pickup_lng is null and _lat is not null and _lng is not null
                             then _lat else pickup_lat end,
           pickup_lng = case when pickup_lat is null and pickup_lng is null and _lat is not null and _lng is not null
                             then _lng else pickup_lng end
     where id = _job_id;
  elsif _kind = 'delivery' and _job.delivery_photo_url is null then
    update public.jobs
       set delivery_photo_url = _storage_path
     where id = _job_id;
  end if;
  return _ev;
end $function$;

revoke all on function public.record_job_evidence(uuid, text, text, bigint, text, double precision, double precision, numeric, text) from public, anon;
grant execute on function public.record_job_evidence(uuid, text, text, bigint, text, double precision, double precision, numeric, text) to authenticated, service_role;
