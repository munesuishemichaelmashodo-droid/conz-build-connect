---
name: zimbabwe-payments-research
description: Use when ConZ needs facts about a payment provider or rule in Zimbabwe (Paynow, Pesepay, EcoCash, OneMoney, InnBucks, ZimSwitch/ZIPIT, banks, card gateways, RBZ/ZIMRA rules) — eligibility, fees, currencies, APIs, callbacks, payouts, split payments, escrow. Produces a sourced claim table and a provider enquiry. Not for auditing ConZ's own code (use conz-payment-audit).
---

# Zimbabwe payments research

ConZ (Navysky Innovations (Private) Limited, Harare) needs payment facts it can rely on. Marketing pages,
blogs and memory are not evidence of what ConZ's account may do.

## When to use
- Choosing or re-checking a provider, fee, limit, currency or settlement rule.
- Before building anything that depends on payouts, split settlement, escrow or stored value.
- When a founder asks "can provider X do Y for us?"

## Workflow
1. Write the question as one capability ConZ needs (e.g. "server-to-server status check for a USD EcoCash top-up").
2. Open the provider's official documentation and terms (web fetch, not a search snippet). Record URL and date seen.
3. Record each fact as a separate claim. Label the source: official docs, official terms, provider support reply,
   regulator (RBZ, ZIMRA, POTRAZ), or secondary (law firm, news, blog).
4. Classify each claim:
   - **Confirmed for ConZ** — written confirmation from the provider for ConZ's account and model.
   - **Documented** — official docs say the product does it; ConZ's eligibility not confirmed.
   - **Advertised** — marketing wording only.
   - **Unknown** — no official source found.
5. Never upgrade a class: "Advertised" never becomes "Documented" without a doc page; "Documented" never becomes
   "Confirmed for ConZ" without the provider's reply.
6. For every Unknown that matters, draft a short enquiry (see output).
7. Store results in `docs/payments/PROVIDER-COMPARISON.md` (update, do not duplicate).

## Required evidence
URL, date seen, exact claim text or a close paraphrase, source type, class.

## Output
| Provider | Capability | Claim | Class | Source (URL, date) |
Then: shortlist with one-line reasons, and enquiry emails (≤ 120 words each, numbered questions, ConZ's company
name and use case, no secrets).
