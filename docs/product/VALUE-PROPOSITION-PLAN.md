# Customer and driver value proposition: audit, plan and status (03/11/2026)

Guiding question: why would a customer come back to Con Z for the next delivery, and why would a driver keep Con Z as one of the places they check for work?

Rules kept: no change to pricing, commission, payments, RLS or migrations; no guaranteed availability, lowest price or delivery; Con Z is not described as holding direct payments or paying drivers automatically; live location only while the driver shares it; a previous driver is *invited*, never assigned; transport-only booking is not advertised; the 7% is stated as 7% of the full job value (materials and transport); only the first completed job is commission-free.

## A. Implemented in this branch (copy, plus one small card)

| # | Where | Before | After | Psychology / benefit | Type |
|---|---|---|---|---|---|
| 1 | Public homepage | No explanation of why to use Con Z over calling around | New "Why book on Con Z" section: one request, likely price first, you choose, everything in one place, order again | Names the alternative (phone calls, WhatsApp) and its pain; raises sign-up and first booking | Copy |
| 2 | Homepage "How it works" | "Pick the material… drop a pin"; "Follow the job as it moves" | Adds one request instead of repeating details, estimate first, compare total/rating/truck, location while the driver shares it, messages and photos stay on the job | Each step now carries a reason; also removes an implied always-on tracking promise | Copy |
| 3 | Homepage driver card | "Find loads near you… Con Z takes 7% of each completed job" | See load, size and area before offering; set your price; build a visible record; 7% of the full job value, materials and transport included; first completed job has no commission | Control and a visible record motivate return visits; stating the 7% base up front builds trust | Copy |
| 4 | Customer home | "See a price in seconds, then pick a checked driver" | "Post it once instead of calling around. Check the likely price, compare offers, choose yourself" | Frames the effort saved and the customer's control | Copy |
| 5 | Customer home | No repeat path except inside a job | "Need the same again?" card for the latest completed delivery, opens booking pre-filled with a fresh price | Lowers the effort of the second order, which is the retention moment | Small product change (uses the existing book-again helper; nothing new on the server) |
| 6 | Customer home, jobs list, nav | "Recent jobs", "Jobs", "Completed & cancelled", tab "My jobs" | "Recent deliveries", "My deliveries", "Past deliveries", tab "Deliveries" | Reads as a record of past deliveries, not a task list | Copy |
| 7 | Booking sheet and job page | "We'll notify your previous driver so they can bid first"; "Book this driver again" | "We'll invite your previous driver to bid. Other verified drivers can bid too, and you choose"; "Invite this driver to bid again" | Accurate (no priority, no assignment) and keeps the customer in control | Copy |
| 8 | Booking footer | "Approved drivers near you see your request" | "Verified drivers can see your request and send offers. You compare them and make the final choice" | The feed is not filtered by area, so "near you" was inaccurate | Copy |
| 9 | Welcome slides | Customer: "tracked the whole way". Driver: "you get paid automatically once delivery is confirmed" | Location only while the driver shares it; first completed job has no commission, then 7% of the full job value | Both lines promised more than the product does | Copy |
| 10 | Driver home | "N loads near you", "Stay online…", "Job history & recent activity" | "N open requests", notifications wording that leaves the choice to the driver, "Your completed work and history" | The driver decides what is worth an offer; history reads as a record | Copy |
| 11 | Driver nav | Jobs / Active / Wallet / Profile | Find jobs / My jobs / Wallet / Profile | Says what each tab is for | Copy |
| 12 | Wallet, Help | "pays our 7% fee"; "first job is always commission-free"; "first driver to accept wins"; "real-time location"; "Book this driver again… bid first" | Commission base stated; first *completed* job; offers are compared and chosen, nothing is assigned automatically; location while shared; invite wording | Removes statements that do not match the product | Copy |
| 13 | Tests | none | `tests/unit/value-copy.test.ts` fails the build if a guarantee, lowest-price, transport-only, automatic-assignment, automatic-payout or always-on-tracking claim appears in these screens | Keeps future copy honest | Test |

## B. Product gaps (not built, not promised)

1. **Transport-only booking.** Does not exist. Not advertised anywhere. Needs its own product and pricing decision.
2. **Operating area for drivers.** The feed lists all open requests; distance and truck-fit hints exist, but a driver cannot set a service area. "Fits your operating area" is therefore not claimed. Build: an area preference on the driver profile plus a feed filter (small to medium).
3. **Driver public record.** Ratings, jobs done and level are shown on offers and the driver's own home. There is no public driver page a customer can open. Build: a read-only profile (medium; privacy review).
4. **Repeat-customer signal for drivers.** The database already notifies an invited driver (notification type `repeat_customer`), but the notification text and the feed card do not say "returning customer". Build: a label on the feed card and notification (small; the text lives in the database trigger, so it needs a migration).
5. **Customer delivery record.** Past deliveries are listed with receipts and photos. There is no export or per-site grouping. Build only if customers ask.
6. **Commission worked example for drivers.** The offer screen shows the Con Z fee line. A worked example ("$200 job: $14 commission, you keep $186") in the offer form would help. Copy plus a small component; not done here to keep this change small.
7. **Help page still describes Con Z Pay payout and top-up timing in general terms.** Escrow and withdrawals are switched off; a full rewrite should wait for the payment-provider decision.

## C. Priority order for what is next
1. Owner reviews wording (this PR). 2. Worked commission example in the offer form. 3. "Returning customer" label for drivers (needs a migration, so it follows the privacy and promo migrations). 4. Driver operating-area preference. 5. Public driver record.

## D. Evidence
Screenshots at 390 px from the local sample-data stand-in (not production): `docs/product/value-proposition-shots/` (public homepage, customer home with the repeat card, driver home). The unit tests, security lint, typecheck and build all pass; no database change.
