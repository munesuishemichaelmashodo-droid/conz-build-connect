-- Undo 0153: restore the two policies as they were (0114 for trucks, baseline for profiles).
alter policy "Customers view bidders on own jobs" on public.profiles
  using (exists (
    select 1 from public.bids b join public.jobs j on j.id = b.job_id
     where b.driver_id = profiles.id and j.customer_id = auth.uid()));

alter policy "Customers read trucks offered on their jobs" on public.trucks
  using (exists (
    select 1 from public.bids b join public.jobs j on j.id = b.job_id
     where b.truck_id = trucks.id and j.customer_id = auth.uid()));
