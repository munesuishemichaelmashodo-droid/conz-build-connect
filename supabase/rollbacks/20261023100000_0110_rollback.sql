-- Undo 0110_record_job_evidence_stage_order: restores record_job_evidence exactly as
-- read from production on 24/10/2026, before 0110 was applied (body hash, whitespace
-- removed: 12ae4e5bbcd8f32c1d54c6fdc3596915). Grants were already
-- {postgres, authenticated, service_role} and are restated.

create or replace function public.record_job_evidence(_job_id uuid, _kind text, _storage_path text, _file_size bigint DEFAULT NULL::bigint, _mime_type text DEFAULT NULL::text, _lat double precision DEFAULT NULL::double precision, _lng double precision DEFAULT NULL::double precision, _accuracy_m numeric DEFAULT NULL::numeric, _location_status text DEFAULT 'unknown'::text)
 RETURNS job_evidence
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  -- path must sit under the job id — same rule the storage
  -- policies enforce
  if split_part(_storage_path, '/', 1) <> _job_id::text then
    raise exception 'Evidence path must start with the job id';
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
  -- later ones are recorded but do not replace it
  if _kind = 'pickup' and _job.pickup_photo_url is null then
    update public.jobs
       set pickup_photo_url = _storage_path,
           pickup_lat = coalesce(_lat, pickup_lat),
           pickup_lng = coalesce(_lng, pickup_lng)
     where id = _job_id;
  elsif _kind = 'delivery' and _job.delivery_photo_url is null then
    update public.jobs
       set delivery_photo_url = _storage_path,
           delivery_lat = coalesce(_lat, delivery_lat),
           delivery_lng = coalesce(_lng, delivery_lng)
     where id = _job_id;
  end if;

  return _ev;
end $function$;

revoke all on function public.record_job_evidence(uuid, text, text, bigint, text, double precision, double precision, numeric, text) from public, anon;
grant execute on function public.record_job_evidence(uuid, text, text, bigint, text, double precision, double precision, numeric, text) to authenticated, service_role;
