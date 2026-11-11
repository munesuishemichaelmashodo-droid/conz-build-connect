-- Undo 0136. Archived notifications become visible again only if the column is dropped (they are not deleted).
begin;
drop index if exists public.notifications_user_active_idx;
alter table public.notifications drop column if exists archived_at;
commit;
