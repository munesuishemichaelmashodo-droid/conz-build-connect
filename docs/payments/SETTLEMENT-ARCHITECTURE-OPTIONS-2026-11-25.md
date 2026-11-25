# Driver settlement: EcoCash problem and architecture options (25/11/2026)

**Decision document. No implementation.** Collection, records and switches are unchanged. Marketplace settlement stays OFF; production is untouched.

Owner's concern: most target drivers use **EcoCash**, but Linkwa's payout API documents **SmileCash only**.

## 1. What the evidence says (sources: `docs/payments/linkwa/`, the Developer API page screenshots, the sandbox evidence log in `LINKWA-PAYOUT-API-CONTRACT-2026-11-25.md`)

| Question | Answer | Evidence class |
| --- | --- | --- |
| EcoCash **collection** (customer pays) | **Yes.** EcoCash, OneMoney, InnBucks, Omari, SmileCash, Visa/Mastercard at checkout; `disallowed_payment_gateways` lists `"ecocash"`. The sandbox EcoCash success number 0788687707 is documented but not yet run by us | Documented |
| EcoCash **recipient registration / payout** via API | **No.** `/wallets`: "We currently only support SmileCash wallets". The real answer for a non-SmileCash number was 422 `requires_registration` for **SmileCash** | Documented + sandbox evidence (T2e) |
| Bank payouts via API | **Not documented.** The dashboard (owner's own destination only) offers **ZIPIT: banks & mobile money, "Instant", 4.5% total fee (0% for payouts ≤ $5)**. The real `/wallets` answer contains undocumented `bank_name`, `bank_display_name` and `account_number` fields, which hints that a bank model exists internally. Not usable by us until documented | Dashboard only; hint in a real response |
| Other payout mechanism at Linkwa | Owner self-payout (`oeuid_` + wallet) and app auto-payout, both to **the app owner**, not to third parties. The dashboard says support for more payout wallets is "coming soon" | Documented / dashboard |
| Does the SmileCash payout itself work? | **Not yet.** The sandbox `POST /payouts` $1 returned **HTTP 500**; balance and statement were unchanged (S4 sent to Linkwa) | Sandbox evidence |
| SmileCash for drivers | Free to open (*225# or online), "powered by ZB Bank, no ZB account needed", cash-out at SmileCash/ZB agents and ZB branches. Payout fee to SmileCash: **0%** | Linkwa dashboard text |
| Can SmileCash money move on to EcoCash? | **Unknown** (probably via ZIPIT at a fee); not in any document we hold | Not documented |

**Documented costs (USD 340 example, driver share 316.20, ConZ 7% = 23.80):**

| Item | Cost |
| --- | --- |
| Linkwa buyer fees (paid by the customer on top) | 1% + 2% = **10.20** (sandbox 25/11: customer paid 350.20) |
| Payout to SmileCash | **0%** |
| Payout via ZIPIT (dashboard; not API) | **4.5% = 14.23**: 60% of ConZ's commission, if ConZ absorbs it |
| Card collections | Settle in 3–4 working days (pending until then) |
| Developer plan | USD 5/month (public pages, unverified) |
| EcoCash/bank payout through any other provider | **Not documented** |

## 2. Settlement options

| | Option | How the driver gets paid | Custody | Cost per $340 job (documented) | Main risks | Evidence still needed |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | **Direct pay (live today)** | Customer pays the driver directly (EcoCash or cash); ConZ's 7% comes from prepaid commission credit (Paynow top-ups) | **None:** ConZ never touches the fare | Nothing extra for the customer. Paynow top-up fees on credit only | Drivers dodging commission off-platform; credit friction; no protection for the customer's payment | None; it is running |
| **B** | Linkwa collects, Linkwa pays out to **SmileCash** | Driver opens SmileCash; ConZ calls `/payouts` after verified delivery | **ConZ app ledger at Linkwa** until payout (ConZ controls release) | Customer +10.20; payout 0% | Drivers must adopt SmileCash (target drivers use EcoCash); payout 500 unresolved; custody needs legal sign-off | Fix for S4; real payout success, timing and status; driver willingness to use SmileCash |
| **C** | Linkwa collects, Linkwa pays out via **ZIPIT** to EcoCash/bank | Same, but to the driver's EcoCash/bank | Same as B | Customer +10.20; **payout 4.5% (14.23)** | Not available in the API; fee eats most of the commission; custody | Linkwa confirmation that third-party ZIPIT payouts exist in the API, with fields, fees and whether EcoCash is reachable |
| **D** | Linkwa collects, **another provider** pays EcoCash/bank | ConZ moves the driver share from Linkwa to the payout provider's float, which then pays EcoCash | **ConZ holds a float at two providers** (stronger custody than B) | Linkwa fees + transfer out of Linkwa (owner payout: SmileCash 0% or ZIPIT 4.5%) + the other provider's disbursement fee (unknown) | Two custody points, liquidity/float management, reconciliation across two ledgers, regulatory exposure (stored value / payment facilitation) | A named, approved disbursement provider with documented EcoCash B2C API, fees, KYC and terms; legal opinion |
| **E** | **Hybrid:** A by default; B for drivers who choose SmileCash | Either directly (EcoCash) or SmileCash payout | None for A jobs; app ledger for B jobs | As A or B per job | Two flows to run and explain; B risks still apply to its share | As B |

**Assessment.**
- Only **A** is proven and EcoCash-friendly today.
- **B** works on paper but asks EcoCash drivers to switch wallets, and its payout has not succeeded yet.
- **C** depends on an API Linkwa has not documented, and its fee makes it uneconomic unless the customer or driver bears it.
- **D** gives the widest reach but the most custody, cost and integration risk; with no named provider it cannot be priced.
- **E** keeps today's model and lets SmileCash payouts be proven on willing drivers first.

## 3. Can our database and code support several payout providers without a rewrite?

**Mostly yes.** The records were built provider-neutral:

| Part | State | Change needed for a second payout provider |
| --- | --- | --- |
| `driver_payables` (93/7 per job) | Provider-neutral | None |
| `driver_payouts` | Has its own `provider`, `destination_masked`, idempotency key, `provider_reference`, `unknown` status, retry after confirmed failure | None to the table |
| `provider_fees` | Per provider, kinds collection/payout/refund | None |
| `driver_provider_accounts` (0177) | Keyed by (driver, **provider**); `receiving_account_type` already allows ecocash/onemoney/innbucks/smilecash/bank | Add a destination id column (Linkwa `external_wallet_id`; another provider's equivalent) |
| `driver_provider_account_ready()` / the job gate | Defaults to `payment_provider`, so collection and payout provider are **assumed to be the same** | Add a separate `payout_provider` setting and use it here (small migration) |
| App adapter interface (`ProviderAdapter`) | One interface mixes collection and payout status; has no "instruct payout" method yet | Split into a collection adapter and a payout adapter; the registry picks each by its own setting |
| **Moving money between providers (option D)** | **Not modelled at all** | A new float-transfer ledger and its reconciliation. This is the only real new design work, and it is also the custody problem |

So B, C and E fit the current design with small additions. D needs the float ledger plus legal and accounting sign-off.

## 4. If Linkwa stays for collection and another provider settles drivers

1. Settings: `payment_provider = linkwa`, a new `payout_provider = <x>`; both switches stay off until approved.
2. Driver onboarding at provider X (its KYC/registration API); `driver_provider_accounts` row with provider X.
3. Funding: move the drivers' share from Linkwa's app ledger to X's float (owner payout from Linkwa, at its fee and timing). It is recorded as a float transfer, reconciled against both statements.
4. Payout: X's disbursement API writes `driver_payouts` with provider X. Status only from X's confirmation.
5. Liquidity rule: never instruct X beyond the confirmed float.
6. Legal: ConZ holds third-party funds in two places. This needs an RBZ/lawyer opinion before any build.

## 5. Evidence still needed (in priority order)

1. **Linkwa:**
   - the S4 answer (why the payout returns 500);
   - whether **ZIPIT/EcoCash/bank payouts to third parties** are or will be in the API, with fields, fees and timing;
   - whether SmileCash → EcoCash transfers are possible for a driver, and at what cost;
   - the date for "more payout wallets".
2. **Drivers:** would target drivers open and use SmileCash (free, ZB agents) if paid there instantly at 0%? A short survey of current drivers.
3. **Any EcoCash disbursement provider** the owner is willing to approve: documented B2C API, fees, KYC, sandbox. None is documented in this repository.
4. **Legal/accounting:** custody of drivers' funds in the Linkwa app ledger (B/C/E) and in a second float (D).

**Recommendation:** keep **A** live; pursue **E** as the next step once Linkwa fixes S4 and drivers confirm they would use SmileCash; ask Linkwa for C's API before considering D.
