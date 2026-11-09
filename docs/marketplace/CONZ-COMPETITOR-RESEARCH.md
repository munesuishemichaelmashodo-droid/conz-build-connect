# ConZ competitor research: Zimbabwean transport and load-booking services

Access date for every source below: **8 November 2026**. Nothing was signed up for, ordered, paid or contacted. Only public pages were read.

Labels used on every statement:
- **VERIFIED-OFFICIAL (VO)**: on the competitor's own page; quoted or closely paraphrased.
- **MARKETING-CLAIM (MC)**: the competitor's own claim, unverified.
- **INFERENCE (INF)**: mine; reason given.
- **NOT-VERIFIED (NV)**: could not find or open.

ConZ reference model (from the brief, not researched): two roles, clients and verified independent drivers; client posts a real pickup and delivery point; drivers send offers; client chooses; client pays the driver directly; ConZ takes 7% from the driver's prepaid commission credit; no supplier accounts.

---

## 1. Method and limits

Tools: WebFetch on competitor pages, WebSearch for discovery. About 33 tool calls.

What I could open:
- MoveZW homepage and driver page: https://www.movezw.co.zw/ and https://www.movezw.co.zw/drivers (the `/terms` path returned the same homepage text, so no separate terms were read).
- ZimboHaul pricing, homepage and terms: https://zimbohaul.com/pricing, https://zimbohaul.com/, https://zimbohaul.com/terms
- eTruckConnect at **https://etruckconnect.co.zw/** (homepage only; `/pricing` and `/faq` returned 404).
- TruckLink demo-style page: https://empty-route-ace.lovable.app/
- TakuraBid page: https://takura-bid-six.vercel.app/
- Truck on the Move App Store listing, via search-result summary only (see below).
- Trift App Store mirror: https://mwm.ai/apps/trift-loads-transport/6764226063

What I could NOT open or verify:
- **Movu (https://www.mannastore.co.zw/ and /pricing): HTTP 403 Forbidden.** No Movu page was read. Searches for Movu and mannastore.co.zw returned nothing relevant. **Every Movu point the brief asked about (client-to-driver payment, prepaid commission credit, minimum balance, vehicle-class multipliers, sample amounts, driver incentives) is NOT-VERIFIED.** No Movu figures are recorded in this document. The only "Movu" hit was an unrelated company's help page (https://movu.freshdesk.com/en/support/solutions/articles/44002489216-payment-methods), which I do not treat as this Movu.
- **Takurirwa (https://www.takurirwa.com/ and /terms):** the fetches returned only the page title, "Takurirwa – Book Trucks Instantly | Zimbabwe's #1 Logistics App" (MC for the "#1" claim). The site is probably script-rendered, so body text was not captured. Participants, offers, counter-offers, handlers, payment and availability are all NOT-VERIFIED. Search found nothing else on it.
- **etruckconnect.com** did not resolve (DNS failure from this session). The working official domain I found is **etruckconnect.co.zw**; whether `.com` is a second official domain is NV.
- **Truck on the Move:** the direct App Store URL (https://apps.apple.com/app/id6754504022) returned 404 to WebFetch, but the search tool returned the listing text. Details below come from that search summary of the developer's own listing, so treat as VO-by-secondhand. No official website or FAQ found. The "recommended fee" feature is NV.
- **BuildMate Zimbabwe:** no Zimbabwean product found. The only hit was a Brazilian site-supply app (https://apps.apple.com/br/app/buildmate/id6744857327), which is unrelated. **DeliQuote:** not searched separately beyond the general queries; nothing found. Both NV.
- VAYA Logistics articles (heraldonline.co.zw, newsday.co.zw) returned 403 on fetch; only search snippets seen. Treated as secondary, low weight.
- No ratings, review counts or in-app screens were visible for anyone. App-only content (driver cards, offer screens) cannot be seen without logging in, which was out of scope.

Reliability caution: TruckLink and TakuraBid are hosted on `lovable.app` / `vercel.app` subdomains and carry large unverifiable numbers (for example "12,400+ verified trucks"). I treat them as marketing pages or prototypes, not proof of an operating market presence.

---

## 2. Comparison table

Columns abbreviated. "NS" = not stated on the page read. All rows access date 8 Nov 2026.

| | MoveZW | ZimboHaul | eTruckConnect | Truck on the Move | Trift | TruckLink (lovable.app) | TakuraBid (vercel.app) | Movu | Takurirwa |
|---|---|---|---|---|---|---|---|---|---|
| **What it is (their words)** | "Zimbabwe's trusted transport marketplace" (VO) | "Zimbabwe's #1 Freight Platform" connecting cargo owners and truckers (MC) | "Zimbabwe's Freight & Logistics Operating System" (VO) | App with "Find a Truck" and "Book a Truck" (VO, listing) | "connects loads with movers directly" (VO, listing); also a shop and local-seller app | "the smart marketplace for trucks & logistics", "InDrive for trucks" (MC) | "Africa's Freight Marketplace" (MC) | NV (403) | "Book Trucks Instantly" (title only) |
| **Participants** | Customers; verified drivers (VO) | Customers who ship; truckers (VO) | Customers, drivers; parcel and cross-border (VO) | Customers, company users, drivers/transporters (VO, listing) | Load owners, transporters (VO, listing) | Customers, drivers, truck owners, logistics companies (MC) | Businesses, truck owners, independent drivers (MC) | NV | NV |
| **How a price is produced** | Customer enters a budget; drivers send quotes; customer chooses (VO) | Published per-km rates plus minimum charge (VO, section 4); homepage says "instant quotes" (MC) | "Hybrid Pricing: Market-calibrated, customer-set"; no rates shown (VO wording, no numbers) | "Book a Truck" goes to verified transporters who respond with offers (VO, listing) | "fixed budget or opening loads to competitive bidding" (VO, listing FAQ) | Live bids; "AI matching engine suggests pricing" (MC) | Drivers "Name your price"; clients compare bids (MC) | NV | NV |
| **Who pays whom, when** | Customer pays "the agreed delivery price to your chosen driver"; "currently supports cash on delivery" (VO) | Payments through the platform; truckers paid after delivery confirmation, minus fees (VO, terms 6.2) | NS ("local payment gateway" only) | In-app prepaid wallet is for feature access only; app "does not handle payouts, earnings transfers, or bank disbursements" (VO, listing) | Transport: NS | EcoCash, OneMoney, InnBucks, Visa, Mastercard; escrow released after proof of delivery (MC) | NS; "paid after accepting a job and delivering on time" (MC) | NV | NV |
| **What a driver must hold or prepay** | Documents only; "Free to join"; no commission mentioned (VO) | Commercial licence, vehicle registration and roadworthiness, required insurance, document verification (VO, terms 4); service fee on completed shipments, rate not published (VO, 6.1) | "Commission Tiers", "Loyalty earns lower fees", no amounts (VO wording) | Wallet balance needed to "accept jobs or confirm offers"; top-up via Paynow (VO, listing); amounts NS | NS | NS | NS ("No hidden fees") | NV | NV |
| **Client sees about driver/vehicle before choosing** | NS (page says offers come from "ID-verified drivers") | NS | NS; driver "reliability score" visible to the driver; customer visibility NS | NS | NS | "bidders can be compared by rating"; trust badges; rating 4.92 (MC) | Bids shown alongside "driver ratings and truck types" (MC) | NV | NV |
| **Trust shown** | National ID, driver's licence, vehicle registration reviewed by admin; "background-checked"; real-time tracking (VO/MC) | "verified truckers" (MC); dispute window 7 days (VO) | "document checks and background validation"; GPS tracking; SMS/WhatsApp/push alerts (VO/MC) | Admin approval of providers (VO) | NS | ID, licence and vehicle checks, badges, escrow (MC) | Identity and vehicle verification (MC) | NV | NV |
| **Coverage claimed** | "Anywhere in Zimbabwe", Harare to Bulawayo "and beyond" (MC); the word "nationwide" is not used | "50+ Cities Covered", "across the country" (MC) | "Nationwide coverage"; same-day parcels Harare and major centres; cross-border to SA, Zambia, Mozambique (MC) | NS | Zimbabwe, SA, Mozambique, Zambia (founder post, MC) | "Live in Zimbabwe", 32 cities (MC) | Zimbabwe, Zambia, SA "and beyond" (MC) | NV | "Zimbabwe" (title only) |
| **Published sample amounts** | None | Rates in section 4 (undated page) | None | None | None | None | None | NV | NV |
| **Support** | NS | NS | WhatsApp bot, phone +263 77 338 9623, Harare office (VO) | NS | admin@trift.co.zw (listing) | NS | NS | NV | NV |

Source URLs by column: MoveZW https://www.movezw.co.zw/ and /drivers; ZimboHaul https://zimbohaul.com/pricing, https://zimbohaul.com/, https://zimbohaul.com/terms (terms last updated 24 January 2026 per page); eTruckConnect https://etruckconnect.co.zw/; Truck on the Move https://apps.apple.com/app/id6754504022 (search summary); Trift https://mwm.ai/apps/trift-loads-transport/6764226063 (first released 4 May 2026, under 1,000 downloads, one rating); TruckLink https://empty-route-ace.lovable.app/; TakuraBid https://takura-bid-six.vercel.app/.

Other Zimbabwean services seen only in search snippets (NOT opened, NV on detail): VAYA Logistics (EcoCash/Cassava; on-demand booking of 1 to 30 tonne trucks per Herald snippet, https://www.heraldonline.co.zw/vaya-logistics-unveils-cargo-distribution-bidding-platform-that-links-customers-to-truck-owners/); a Newsday-reported digital load board where carriers must be verified to bid or counter-offer (https://www.newsday.co.zw/local-news/article/200058272/zimbabwean-tech-startup-launches-digital-loadboard-for-southern-african-road-freight-logistics); Kweli, a load board and WhatsApp-group directory (https://www.kweli.co.za/zimbabwe-truck-loads-whatsapp-group/). inDrive (taxi) was mentioned for its commission model (reported under 10% after an initial free period, per a search snippet, unverified); it is a taxi app and is not analysed.

---

## 3. Driver and vehicle information shown to clients

**What competitors show (as far as public pages reveal):**
- MoveZW: only that drivers are ID-verified and background-checked; what a quote card displays is NV. (https://www.movezw.co.zw/)
- eTruckConnect: verification claim, a driver reliability score and a rating system exist; whether customers see them is NV. No photo or plate claim. (https://etruckconnect.co.zw/)
- TruckLink and TakuraBid: ratings, truck type and trust badges are claimed (MC). (https://empty-route-ace.lovable.app/, https://takura-bid-six.vercel.app/)
- ZimboHaul, Truck on the Move, Trift: nothing stated about client-side driver or vehicle display.
- Nobody's public page claims that clients see make/model, payload, vehicle photos or the registration number before choosing. **That is a gap in what I could see, not proof that it is absent** (offer screens are behind login). INF.

**What a client needs to answer, and the ConZ question each maps to:**

| Question | What the client needs on the offer |
|---|---|
| Who is offering? | Name, photo, verification badge, jobs completed, rating (if enough jobs) |
| What truck will arrive? | Make/model, registration number, vehicle photo |
| Can it carry my load? | Body type (tipper), payload in tonnes and m3, plain "fits / may not fit" for the stated load |
| How much? | One total price in USD, the driver's own offer |
| When can it reach me? | Pickup arrival time, expected delivery time, offer expiry |
| What is included? | Loading, distance, waiting, tolls or fees explicitly in or out |
| What happens next? | Accept, how and when to pay the driver, tracking, delivery confirmation, what to do if something goes wrong |

Basis: INF, from the brief's question list and the absence of this information on competitor public pages.

---

## 4. Pricing structures observed (reference only, not adopted)

**ZimboHaul**, https://zimbohaul.com/pricing, accessed 8 Nov 2026; **the page shows no publication date**. Commercial freight benchmark, not a two-sided driver marketplace (INF: it adds a 10% platform fee and category rates rather than driver offers). Reference only, not adopted.

| Category | Truck | Rate per km | Minimum |
|---|---|---|---|
| Agriculture | 4-7 ton | $1.80 | $150 |
| General cargo | 8-15 ton | $2.10 | $200 |
| Construction materials | 8-15 ton, tippers | $2.10 | $200 |
| Mining and heavy | 20-30 ton | $2.50 | $350 |
| Bulk fuel / hazardous | Tankers | $2.70 | $400 |
| Vehicles and equipment | Flatbeds | $2.30 | $300 |
| Specialized | Custom | $2.20 | $250 |

Extras per page: 10% platform fee; surge multipliers (example Express +25%); handling charges (Fragile $50, Perishable $75, Loading assist $100 per location). Page says rates are "benchmarked against Zimbabwe's top hauliers". Components: per-km rate, category, minimum charge, surcharges. No weight component beyond truck class.

**Movu:** NV. Vehicle multipliers, distance and weight components, sample amounts could not be read (403). Nothing recorded. If the owner can supply a screenshot or copy of the pages, they can be added, marked "reference only, not adopted".

**MoveZW:** customer-set budget plus driver offers; no rates published (VO). **Trift:** "fixed budget or competitive bidding" (VO listing). **eTruckConnect:** "Hybrid Pricing: Market-calibrated, customer-set", no numbers (VO). **Truck on the Move:** offers; recommended fee NV. **TruckLink:** AI-suggested pricing (MC).

INF: the only published numbers found are ZimboHaul's, and they are for general haulage by distance. They say nothing reliable about short-haul tipper loads of river sand or stone priced per load. Do not benchmark ConZ's quote ranges from them.

---

## 5. Payment and commission models observed

| Model | Who | Evidence |
|---|---|---|
| Direct customer-to-driver, cash on delivery, no stated commission | MoveZW | VO: "currently supports cash on delivery"; driver page "Free to join". https://www.movezw.co.zw/drivers |
| Prepaid wallet for feature access; no payouts handled by the app | Truck on the Move | VO listing: wallet topped up via Paynow, needed to accept jobs or confirm offers. https://apps.apple.com/app/id6754504022 (search summary) |
| Platform-processed payment, trucker paid after delivery confirmation, service fee (rate unpublished), 10% platform fee on rate card | ZimboHaul | VO terms 6.1-6.3, updated 24 Jan 2026; pricing page. |
| Escrow released after proof of delivery, wallet-style mobile money rails | TruckLink | MC. |
| Commission tiers with loyalty discounts, local payment gateway | eTruckConnect | VO wording, no amounts. |
| Prepaid driver commission credit with minimum balance | Movu (per brief) | **NV: could not verify.** |

Reading across (INF): Truck on the Move is the only verified example of a "driver prepays to unlock accepting jobs" pattern, and it uses a wallet that cannot pay out. That is structurally close to ConZ's prepaid commission credit, but its fee level is NV so no rate comparison is possible. MoveZW shows direct pay can work with no driver fee, but offers a weaker economic base. Nobody publicly shows a number for a driver commission rate.

---

## 6. The journey from six viewpoints

Mostly INF, built on the VO facts above and ConZ's described model. No ConZ numbers are asserted.

**First-time client**
- Frustrates: not knowing whether the price is real; unknown driver; uncertainty whether the truck fits a 6 to 12 m3 load; a fee surprise at delivery.
- Confidence: verified badge, a clear truck description, a single all-in price, visible tracking (competitors that claim tracking: MoveZW, eTruckConnect).
- Booking fails when: no offers arrive; offers are late; the offer says nothing about the truck; the client cannot tell what is included.
- ConZ can do better: show a price guide before posting (ConZ already has a price check per CLAUDE.md), and every offer card answering the seven questions in section 3.

**Returning client**
- Frustrates: re-entering addresses; re-finding a good driver.
- Confidence: past jobs with the same driver; history.
- Fails when: the previous driver is unavailable and nothing replaces them quickly.
- Better: "rebook" and "ask this driver first". Not found at any competitor (NV), so treat as untested.

**Driver**
- Frustrates: prepaying with no job guarantee; unclear commission; offers that go unanswered; far-away pickups.
- Confidence: a simple stated rate (the 7% in ConZ's case), seeing distance before offering, paid directly by the client.
- Fails when: credit runs out mid-week, or a client does not pay, or the pickup point is wrong.
- Better: a clear low-balance warning before an offer is blocked; show exact pickup and drop points before the driver commits.

**ConZ operator/admin**
- Frustrates: disputes about what was agreed; drivers disappearing; jobs that reach no driver.
- Confidence: evidence trail (photos, GPS, chat), credit and commission ledger.
- Fails when: verification is slow or inconsistent; commission credit disputes.
- Better: document checks and the evidence trail ConZ already records (per CLAUDE.md); competitor pages claim checks but show no evidence trail (NV).

**Competitor**
- MoveZW is the closest model: budget, driver offers, direct pay, ID checks (VO). It publishes no driver fee and no vehicle details publicly.
- Others are broad freight boards or app prototypes aimed at long-haul or cross-border.
- INF: no competitor found is specifically about building-material tipper loads with real loading and delivery points. Movu may be, but is NV.

**Business economics**
- A 7% commission deducted from prepaid credit avoids collecting money from clients and avoids holding client funds (INF from the brief). The risks: drivers who do not top up, drivers who take clients off-platform after the first match, and a client paying cash which ConZ cannot see.
- Truck on the Move's wallet is the only verified comparable. Its levels are NV.
- Do not base unit economics on ZimboHaul's 10% fee; it is a different business.

---

## 7. Adopt / Do not adopt / Already have

"Already have" reflects only what the project instructions (CLAUDE.md) state and was not re-verified in code today.

| Decision | Item | One-line reason | Source |
|---|---|---|---|
| **Adopt** | Offer card answering all seven questions in section 3 (truck make/model, plate, payload, photo, included items, arrival time) | No competitor public page shows this, and a client cannot decide safely without it | INF; gap seen across all competitor pages |
| **Adopt** | Plain-language "what is included" line on every offer | Fee surprise is the main stated risk of direct pay | INF; MoveZW cash on delivery https://www.movezw.co.zw/ |
| **Adopt** | Low-credit warning to drivers before the offer is blocked | Prepaid models only work if drivers are never surprised | Truck on the Move wallet gating (VO listing) |
| **Adopt (test)** | Publish the driver verification checklist in simple words | MoveZW and eTruckConnect make trust claims but not specific ones | https://www.movezw.co.zw/, https://etruckconnect.co.zw/ |
| **Do not adopt** | ZimboHaul per-km rates, minimums or 10% fee | Different business, undated, general haulage | https://zimbohaul.com/pricing |
| **Do not adopt** | Any Movu figure or multiplier | Could not be verified; nothing to adopt | Movu 403 |
| **Do not adopt** | Cash-on-delivery-only with no driver fee (MoveZW) | Would remove ConZ's 7% revenue | https://www.movezw.co.zw/drivers |
| **Do not adopt** | AI price suggestion or escrow just because TruckLink claims them | Marketing claim on an unverified prototype page | https://empty-route-ace.lovable.app/ |
| **Do not adopt** | Large user or truck counts as marketing | Unverified numbers on TruckLink and ZimboHaul erode trust | same |
| **Already have** | Verified drivers with a registered vehicle | Matches MoveZW, eTruckConnect, TakuraBid claims | Brief; CLAUDE.md |
| **Already have** | Driver offers, offer expiry, withdraw, raise budget | Offers are the core model at MoveZW and Trift | CLAUDE.md (0060, 0062) |
| **Already have** | In-app chat, live GPS tracking, delivery photos/PIN, admin dispute panel | Tracking claimed at MoveZW and eTruckConnect; evidence trail not seen elsewhere | CLAUDE.md |
| **Already have** | Pickup location check and route trail | Not seen at any competitor (NV) | CLAUDE.md (0112) |
| **Already have** | Prepaid driver commission credit, direct client pay | Close to Truck on the Move's wallet gate | Brief; https://apps.apple.com/app/id6754504022 |
| **Open (needs owner input)** | Movu and Takurirwa details | Could not open; owner or a browser with access should capture the pages | NV |

---

## Gaps to close

1. Movu, Takurirwa: obtain page text (screenshots or exported text) from a normal browser.
2. App-only screens (offer cards, driver profiles) at MoveZW, eTruckConnect, Truck on the Move: viewable only by installing and logging in, which was out of scope.
3. Whether etruckconnect.com is an official domain.
4. BuildMate Zimbabwe and DeliQuote: no public presence found.
5. Truck on the Move's website, FAQ and any recommended-fee feature.
