-- 0136: clearing a notification hides it (archived_at); it never deletes the notification or anything it
-- refers to. The existing "Users update own notifications" policy already lets a person update their own rows.
-- Unread counts, grouping and categories are computed in the app from the existing columns. Additive; no DROP.
-- Undo: supabase/rollbacks/20261103180000_0136_rollback.sql
begin;
alter table public.notifications add column if not exists archived_at timestamptz;
create index if not exists notifications_user_active_idx on public.notifications (user_id, created_at desc) where archived_at is null;
commit;
