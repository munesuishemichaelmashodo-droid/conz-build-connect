-- ONE-OFF DATA OPERATION (not a migration; never run by the test harness or `db push`).
-- EXECUTED in production on 04/11/2026 with the owner's approval: 248 rows changed (guarded: it aborts unless exactly 248),
-- 35 assigned-driver rows kept. Afterwards 0 other-driver rows differ from the area-only text. Originals are recoverable:
-- each was the prefix plus coalesce(dropoff_address, delivery_address, 'a nearby location') of its job (checked for all 248).
--
-- What it changes: ONLY public.notifications.body, ONLY on rows with type = 'new_job' whose recipient is NOT the
-- driver the job was given to. The text after " delivery to " is replaced by the area (suburb, city) from
-- coarse_place(), the same value 0140 now writes. Nothing else changes: not id, user_id, type, title, job_id,
-- read, created_at, archived_at; no other notification type; no job, bid, payment or wallet row.
-- Rows for the assigned driver are left as they are (that driver is entitled to the address).
-- Live check 04/11: 283 new_job rows, 35 belong to the assigned driver (kept), 248 would change, 0 in an unexpected format.
--
-- Recovery: step 1 prints the original bodies. Save that output (CSV) BEFORE step 2; it is the only copy.

-- STEP 1 (read-only preview, and the backup to save):
select n.id, n.user_id, n.job_id, n.body as original_body,
       substring(n.body from '^(.*? delivery to )') ||
         coalesce(public.coarse_place(coalesce(j.dropoff_address, j.delivery_address)), 'a nearby area') as new_body
  from public.notifications n
  join public.jobs j on j.id = n.job_id
 where n.type = 'new_job'
   and j.driver_id is distinct from n.user_id
   and n.body ~ '^.*? delivery to '
 order by n.created_at;

-- STEP 2 (the change; run in one transaction and check the row count equals the preview):
begin;
update public.notifications n
   set body = substring(n.body from '^(.*? delivery to )') ||
              coalesce(public.coarse_place(coalesce(j.dropoff_address, j.delivery_address)), 'a nearby area')
  from public.jobs j
 where j.id = n.job_id
   and n.type = 'new_job'
   and j.driver_id is distinct from n.user_id
   and n.body ~ '^.*? delivery to '
   and n.body <> substring(n.body from '^(.*? delivery to )') ||
                 coalesce(public.coarse_place(coalesce(j.dropoff_address, j.delivery_address)), 'a nearby area');
-- check the reported "UPDATE n" matches the preview, then:
commit;
