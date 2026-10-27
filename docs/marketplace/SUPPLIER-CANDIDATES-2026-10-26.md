# Supplier candidates — public research, 26/10/2026 (reviewed and corrected the same day)

## Confirmed Con Z partners

**None are evidenced in this repository or the database.** No supplier below has a recorded agreement with Con Z.

## What is already in production (read-only check, 26/10/2026)

Two suppliers are in `public.suppliers` with `verification_status = 'verified'`:

| Supplier | Locations | Exact pins | Materials | Prices set | Stock set |
| --- | --- | --- | --- | --- | --- |
| Pomona Stone Quarries | 3 | 3 | crusher run, quarry dust, stones | 0 | 0 |
| Davis Granite | 10 | 2 | crusher run, stones | 0 | 0 |

Here "verified" means the **location** was checked from public sources (migrations 0050 and 0054 say so: "a
research/geographic seed for pricing, not a claim of commercial partnership or onboarding"). Customers see the
name on the price check as "Collected from … Listed supplier". The pickup point is set there, and the 0112 pickup
check flags loading more than 2 km away. Nothing in the app calls either company a partner. Prices come from Con Z's
own material price table, not from the supplier (`price_override_*` is empty for every location).

**Owner decision needed:** keep showing these names before any agreement, or show "a listed quarry in <area>"
until a supplier confirms. Both are honest; the second is more cautious.

## Everything else in this file: candidates

Nothing below is in the database or shown to customers, and no company has agreed to anything. Prices, stock,
phone numbers and map pins are deliberately left out: none were confirmed, and directory listings disagree.

Evidence classes, strongest first: **Read** = I opened the company's own page on 26/10/2026. **Search** = seen only
in a search-result summary; the page itself was not opened, so treat it as a lead. **Press** = news or trade press
(date given). **Not found** = standard and extended web searches on 26/10/2026 found nothing under that name. That
is not proof that the business doesn't exist.

## Summary

| Candidate | Found? | Best evidence | What it supplies (as published) | Fit for Con Z |
| --- | --- | --- | --- | --- |
| Pomona Stone Quarries (Pvt) Ltd, Alpes Road, Pomona, Harare | Yes, **already in production** (see above) | Read (products page) | Quarry dust (3 mm, 7 mm); stone 7, 10, 13, 19, 20, 40 mm; granite boulders; decomposed filling; ready-mix concrete 10–35 MPa. "Transport can be arranged." No prices published. | Strong: Harare, stone and dust, which Con Z sells |
| Davis Granite (with Premier Stonecrushers) | Yes, **already in production** (see above) | Press (Dec 2015, search summary); MAZ directory (search only) | Granite aggregates, road stone, builders' aggregate, sand; quarries reported in Bulawayo, Harare, Marondera (Gweru, Hwange via Premier) | Strong for stone; Harare site details are from 2015, so confirm the site still operates |
| Intercrete Zimbabwe Pvt Ltd | Yes | Read (services page); CIFOZ directory (search only) | Roof tiles, bricks, pavers, roofing timber; "building aggregates" listed (sand/stone not itemised on the services page); truck and tipper hire with a driver; sales offices in Harare, Marondera, Masvingo, Mutare, Gweru | Medium: possible supplier and possible fleet partner; confirm which aggregates it sells |
| Arcturus Stone Quarries, Pomona, Harare | Partly | Search only (its site timed out) | Granite aggregates (per search listing) | Unconfirmed; found while researching Pomona |
| Tenjo Quarry | Not found | — | — | Needs the exact name or registration from whoever suggested it |
| Fourways Quarry | Not found | — | — | Same |
| Derbyshire Stone Quarry | Not found in Zimbabwe | Only UK companies use the name | — | Same |
| Eyestone Quarry | Not found | Closest is Freestone Mine near Mutare (press, c. 2022, search summary only), which faced resident objections over its environmental impact assessment | — | Do not assume Freestone = Eyestone |

Other producers seen only in search summaries (leads, not checked): LLH Quarry Stones (Harare, founded 2024: 10, 19,
25 mm stone, dust, crusher run), Vuti Quarries (Makuti, 2–40 mm; trade press 2020), Beta Bricks (aggregates
plant at Mvurwi, 2019).

## Notes per candidate

**Pomona Stone Quarries.** Its own site says "our core business is stone and ready-mix concrete" and lists the
sizes above (read). A directory says it was established in 1951 (search only; 0050 cites the same date). Homestyle Bricks shares the Pomona Quarries Complex
address. No prices are published; quotes go through its sales office. Sources:
[products page](https://www.pomonastonequarries.com/products-services/),
[Zimbabwe Yellow Pages](https://www.zimyellow.com/zimbabwe/harare/quarry/pomona-stone-quarries),
[ZimPlaza](https://www.zimplaza.co.zw/?p=11189).

**Davis Granite.** Search summaries of trade press describe it as Bulawayo-headquartered and one of Zimbabwe's largest granite
aggregate producers. A December 2015 article reports Terex dump trucks at its Harare and Bulawayo sites moving
about 80,000 t a month. Sources:
[African Review](https://africanreview.com/mining/quarrying/terex-trucks-supplies-fourth-rigid-dump-truck-to-zimbabwe-s-davis-granite),
[MAZ directory](https://directory.maz.co.zw/?p=1350).

**Intercrete.** Its own site lists truck and tipper hire with an assigned driver, and "building aggregates".
The head office is listed in the Old Windsor Industrial Area (other listings say the factory is in Ruwa).
Phone numbers differ between listings; use the official contact page. Sources:
[services](https://www.intercrete.co.zw/our-services/),
[contact](https://www.intercrete.co.zw/contact/),
[CIFOZ directory](https://www.cifoz.co.zw/directory/listing/intercrete-zimbabwe).

**Not found (Tenjo, Fourways, Derbyshire, Eyestone).** Standard and extended web searches on 26/10/2026 found
no Zimbabwean business under these names. They may be local or informal names. Ask the person who suggested
them for a registration number or exact location before spending more time.

## Next steps (owner's call; nothing done)

1. Contact by the official channel only. Ask for: material list, price per m³ or tonne at the gate, loading
   hours, whether third-party tippers can load, payment terms, and an exact loading-point pin.
2. On a written yes, add the supplier through the admin screen as **unverified**. Mark it verified only after a
   site visit or documents, as the current admin flow requires.
3. Gate prices go into `material_supply_locations.price_override_min/mid/max` only with a date and a written
   source from the supplier. Note: the engine prices from Con Z's `material_prices` table; how a supplier's
   gate price should feed the quote is an open decision (see the release plan).
4. Never show a candidate's name to customers as a partner. "Listed supplier" is the term the app uses.
