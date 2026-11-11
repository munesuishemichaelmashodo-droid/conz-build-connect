# Competitor refresh, 09/11/2026 (addendum to `CONZ-COMPETITOR-RESEARCH.md`)

Method: standard web searches run on 09/11/2026 for each competitor named in the implementation spec. Only the search-result snippets were read (no page was opened, no app was installed or used, no
price was seen). Anything not shown in a result is marked **unverified**. Nothing here is a price or a feature claim to copy; it is a list of leads with sources.

## Named in the spec: not found

| Name | Result on 09/11/2026 |
| --- | --- |
| Movu (Zimbabwe) | No Zimbabwe result. The searches returned other products (see below). **Unverified that it operates in Zimbabwe.** |
| Takurirwa | No result under this name. |
| MoveZW | No result. |
| ZimboHaul | No result. |
| Truck on the Move | No result. |
| eTruckConnect | No result under this name. |

These names may be misspelt, very new, or not indexed by this search tool. Action for the owner: send the exact website or app-store link for any of them and they can be reviewed properly.

## Found in the same searches (leads, not verified)

| Product | What the result says | Source |
| --- | --- | --- |
| VAYA Logistics (Cassava) | Online platform linking customers to truck owners; customers enter cargo and an offered price, owners respond (bidding); whole-truck and shared-load options | [Herald, "VAYA Logistics unveils cargo distribution bidding platform"](https://www.heraldonline.co.zw/vaya-logistics-unveils-cargo-distribution-bidding-platform-that-links-customers-to-truck-owners/) |
| TruckLink | Landing page: instant truck booking, real-time bidding, discounted empty-return trucks ("up to 60% off" is its own marketing claim, **unverified**) | [empty-route-ace.lovable.app](https://empty-route-ace.lovable.app/) |
| Trift | Logistics marketplace to find transport for goods in Zimbabwe; founder post on Reddit (2026); no pricing shown | [Reddit snapshot](https://reddit.sentinel-team.org/posts/1t8n6ya/snapshots/2026-05-16T01%3A40%3A04.328942Z) |
| Takura Bid | Freight marketplace page: drivers post loads, customers accept bids; company not named | [takura-bid-six.vercel.app](https://takura-bid-six.vercel.app/) |
| AfroFleet | Digital logistics platform connecting businesses with verified transport operators in Southern Africa | [au-startups](https://au-startups.com/startups/afrofleet) |
| SADCLoads | Connects truck owners with loads across SADC | [VC4A](https://vc4a.com/ventures/sadcloads) |
| Kweli | Load-matching for the Zimbabwe corridor; WhatsApp load groups | [kweli.co.za](https://www.kweli.co.za/?p=2043) |
| Digital loadboard (Zimbabwean startup) | Loadboard linking businesses with transport operators; WhatsApp alerts | [NewsDay](https://www.newsday.co.zw/local-news/article/200058272/zimbabwean-tech-startup-launches-digital-loadboard-for-southern-african-road-freight-logistics) |
| inDrive courier | "Name your price" model extended to courier services in Zimbabwe | [The Independent](https://theindependent.co.zw/local-news/article/200033166/indrive-introduces-courier-services) |
| Saloodo! (DHL) | Digital road-freight platform (region-wide) | surfaced in the eTruckConnect search |

## What this means for ConZ (observations, not decisions)
- Bidding between customers and truck owners already exists in Zimbabwe (VAYA, TruckLink, Takura Bid). ConZ's difference is not "bidding" by itself: it is construction-material delivery,
  tipper-truck facts on each offer, the agreement card, the 90-day driver re-check, and not showing a bidding driver's contact details before the customer chooses.
- None of the leads show a published delivery price per kilometre or per load, so nothing here can calibrate ConZ's transport formula. The pricing guide stays labelled **uncalibrated**.
- Competitor claims above come from marketing pages and press; treat every feature as unverified until someone uses the product.

## Calibration report (spec: only if 10 jobs and 3 drivers per segment exist)
Not produced. Production has 11 completed jobs in total (09/11 count), spread over several materials and distances, so no segment can meet 10 jobs and 3 drivers. The pricing engine's own history
rule (`compute_material_offer`, 10 jobs and 3 drivers) is therefore also unused today.
