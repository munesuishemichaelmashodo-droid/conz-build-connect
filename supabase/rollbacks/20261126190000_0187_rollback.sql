-- Undo 0187 (SQL editor: contains DROP). Restores the previous photo-record guard and the admin storage policy, and
-- removes the new functions and triggers. Keeps job_stage_reports (history); drop it by hand only if the owner asks.
drop trigger if exists trg_job_stage_reports_append_only on public.job_stage_reports;
drop function if exists public.tg_job_stage_reports_append_only();
drop function if exists public.report_job_stage(uuid, text, text, text, numeric, integer, text, uuid, uuid);
drop function if exists public.job_evidence_record(uuid);
drop function if exists public.supersede_job_evidence(uuid, uuid, text);
drop function if exists public.job_has_open_dispute(uuid);
alter policy "job proof: admin all" on storage.objects
  using ((bucket_id = 'job-proof-photos') and (public.has_role(auth.uid(), 'admin'::app_role) or public.has_role(auth.uid(), 'super_admin'::app_role)));

-- job_evidence_immutable as in the 13/08 baseline:
CREATE OR REPLACE FUNCTION public.job_evidence_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Evidence records cannot be deleted. Supersede instead.'
      using errcode = '42501';
  end if;

  -- only the supersede fields and notes may ever change
  if new.job_id       is distinct from old.job_id
     or new.kind         is distinct from old.kind
     or new.storage_path is distinct from old.storage_path
     or new.uploaded_by  is distinct from old.uploaded_by
     or new.uploaded_at  is distinct from old.uploaded_at
     or new.device_lat   is distinct from old.device_lat
     or new.device_lng   is distinct from old.device_lng
  then
    raise exception 'Evidence records are immutable.' using errcode = '42501';
  end if;
  return new;
end $function$
;
