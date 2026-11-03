-- Undo 0114_trucks_review_and_visibility. Restores the production state of 25/10/2026:
-- no truck-change trigger, no driver check on job assignment, and the original
-- "Trucks readable by authenticated" policy (every signed-in user reads every truck).
-- Driver statuses already set back to 'pending' by 0114 are NOT reverted (re-approve
-- them in Verify). Note: the Supabase MCP tool hangs on DROP; run this in the SQL editor.
begin;
drop trigger if exists trg_truck_change_needs_review on public.trucks;
drop function if exists public.tg_truck_change_needs_review();
drop trigger if exists trg_jobs_driver_must_be_verified on public.jobs;
drop function if exists public.tg_jobs_driver_must_be_verified();
drop policy if exists "Admins read trucks" on public.trucks;
drop policy if exists "Customers read trucks offered on their jobs" on public.trucks;
drop policy if exists "Trucks readable by authenticated" on public.trucks;
create policy "Trucks readable by authenticated" on public.trucks
  for select to authenticated using (true);
commit;
