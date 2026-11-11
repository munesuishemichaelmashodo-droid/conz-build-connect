-- 0153: close the bidder exposure (policy changes only; no DROP; no new objects).
--
-- APPLY ONLY AFTER the app that calls offer_bidder_cards() (0152) is deployed: the offers
-- screen reads names, photos and truck facts through that function, not through these tables.
--
-- 1. profiles: a customer whose job received an offer could read the bidding driver's whole row
--    (phone, email). Nobody needs that before choosing: the policy is switched off in place.
--    After the customer chooses a driver, "Job partners read each other" still gives the
--    accepted driver's profile (contact details on a live job), exactly as before.
-- 2. trucks: customers could read the full row (registration, photo) of any truck that bid.
--    They may now read only the truck of the driver assigned to their own job.
alter policy "Customers view bidders on own jobs" on public.profiles
  using (false);

alter policy "Customers read trucks offered on their jobs" on public.trucks
  using (exists (
    select 1
      from public.jobs j
     where j.customer_id = auth.uid()
       and j.driver_id = trucks.driver_id
       and j.status in ('accepted', 'in_progress', 'completed')
  ));
