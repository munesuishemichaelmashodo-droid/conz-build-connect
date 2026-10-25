# ConZ payments — provider comparison

Sources seen 25/10/2026. Classes: **Documented** = the provider's own docs say the product does it ·
**Advertised** = marketing wording only · **Unknown** = no official source found · **Confirmed for ConZ** = a
written answer from the provider about ConZ's account (none yet). Paynow fee and BuySafe claims were re-read
directly from paynow.co.zw by the lead reviewer; other rows come from the provider-research agent.

## Summary

| | Paynow | Pesepay | EcoCash Open API | ZB Smile&Pay / Steward Pay / ZimSwitch via bank |
| --- | --- | --- | --- | --- |
| Already integrated in ConZ | Yes (top-ups) | No | No | No |
| Company onboarding | Register; Verified status needs director letter, director ID, company bank proof, logo ([verify](https://verify.paynow.co.zw/)) | Corporate: CR14, certificate of incorporation, director IDs, merchant agreement, bank proof ([onboarding](https://developers.pesepay.com/getting-started/onboarding/)) | EcoCash merchant account + test script + review; KYC list not published ([go-live](https://developers.ecocash.co.zw/docs/go-live)) | Through the bank; not published |
| Methods (USD) | EcoCash, OneMoney, InnBucks, O'mari, Zimswitch, Visa/MC, Telecash, Vpayments ([tutorial](https://www.paynow.co.zw/Home/MerchantTutorial)) | EcoCash ($1–$500), InnBucks, O'mari, Zimswitch, Visa, MC; no OneMoney ([methods](https://developers.pesepay.com/payment-methods/overview/)) | EcoCash only | Mixed, not published |
| Fees | EcoCash/OneMoney/Telecash 2.5%; Visa/MC 3.5% + 50c; Vpayments 1% + 50c; no signup/usage fee ([fees](https://www.paynow.co.zw/Home/Fees)); $8.50 per USD settlement ([verify](https://verify.paynow.co.zw/)) | Mobile money 2%, Zimswitch 2%, cards 3%; no integration fee ([pricing](https://www.pesepay.com/pricing)) — currency not stated | Unknown | Unknown |
| Settlement | Mobile money T+1 after the payment **or after funds clear BuySafe**; non-Verified: weekly on Tuesday; Verified: daily Mon–Sat | T+2 via trust account | Unknown | Unknown |
| Buyer escrow on by default | **Yes — BuySafe; only Verified merchants may disable it** | No (Documented: not mentioned) | No | — |
| Server-side verification | SHA-512 hash on every message + poll URL (Documented) | Unsigned callback; must re-query status; no retries (Documented) | Lookup by correlator; callback signature undocumented | Unknown |
| Test mode | Yes, test numbers 0771111111 etc.; authemail must be the merchant email | Sandbox (USD: EcoCash, Visa, MC) | Sandbox, self sign-up | Unknown |
| Refunds / payouts by API | No (gateway API) | Advertised only ("instant transfers") | **Documented**: Merchant-to-Subscriber, Enterprise Cash-In (eligibility Unknown) | Split "to accounts approved by the bank" (Advertised) |
| Prepaid wallet acceptable in terms | Unknown | Unknown | Unknown | Unknown |

Not viable for a Zimbabwe company: Stripe, Paystack, Flutterwave (not supported); DPO Pay (left Zimbabwe, 10/2024, secondary source).

## What this means for ConZ

1. **Paynow can do what ConZ needs now** (USD top-ups from EcoCash, OneMoney, InnBucks, cards) with a verifiable
   hash and polling. No change of provider is justified by the evidence.
2. **BuySafe is the real issue.** While ConZ is not a Verified merchant, each top-up sits in Paynow's escrow,
   reports "Awaiting Delivery", is settled only after delivery is confirmed (weekly), and the driver can dispute it.
   ConZ's code already credits the wallet on "Awaiting Delivery" (`apply_paynow_result`), so a driver could spend
   credit on commission and then dispute the top-up. Fix: become a Verified merchant and ask Paynow to disable
   BuySafe for this integration; until then credit only on "Paid" or accept the dispute risk knowingly.
   Paynow's terms require **3 months as an ordinary member** before Verified status
   ([terms](https://www.paynow.co.zw/Home/Terms)), and they forbid "payment processors [collecting] payments on
   behalf of merchants" — so Paynow cannot be used for escrow of customers' job payments.
3. **Payouts and escrow are not available from Paynow's gateway API.** If ConZ ever pays drivers out, EcoCash's
   Open API is the only documented route found; that needs its own merchant approval and a legal check.
4. **Pesepay is the fallback** if Paynow onboarding stalls: clear corporate KYC and published fees, but no OneMoney,
   a $500 EcoCash cap, and unsigned callbacks that must be re-queried.

## Enquiries to send

**Paynow** (from the account owner's email):
> Navysky Innovations (Private) Limited (company no. 145174A02102026) operates ConZ, a Harare marketplace. Truck
> drivers pre-pay a small USD credit on our platform that only pays our 7% commission; it is never withdrawn.
> 1) Is this use acceptable under your merchant terms? 2) After Verified status, can BuySafe be disabled for our
> integration, and how long does review take? 3) Current fees for Zimswitch, InnBucks and O'mari, and per-transaction
> limits for EcoCash, OneMoney and InnBucks in USD? 4) Can the merchant account be moved from a sole-proprietor
> registration to our company, keeping the integration? 5) Any refund or payout API for merchants?

**Pesepay:**
> Same introduction. 1) Do the 2% / 3% fees apply to USD? 2) Is OneMoney planned? 3) Are EcoCash USD limits per
> transaction, and can they be raised? 4) Is there a payout API and who is eligible? 5) Any restriction on platforms
> holding prepaid credit?

**EcoCash (Econet) — only if payouts are ever needed:**
> Same introduction. 1) Documents for a new private company to get an EcoCash merchant account and Open API
> production access? 2) Are Merchant-to-Subscriber and Enterprise Cash-In available to a marketplace paying drivers;
> is prefunding required? 3) Fees and limits in USD? 4) Settlement timing? 5) Is the notify callback signed?

## Sources opened
Paynow: [MerchantTutorial](https://www.paynow.co.zw/Home/MerchantTutorial), [Fees](https://www.paynow.co.zw/Home/Fees),
[Verify](https://verify.paynow.co.zw/), [Initiate](https://developers.paynow.co.zw/docs/initiate_transaction.html),
[Express checkout](https://developers.paynow.co.zw/docs/paynow/express_checkout_transactions),
[Hash](https://developers.paynow.co.zw/docs/paynow/generating_hash/),
[Status update](https://developers.paynow.co.zw/docs/paynow/status_update/),
[Polling](https://developers.paynow.co.zw/docs/paynow/polling_status/),
[Test mode](https://developers.paynow.co.zw/docs/paynow/test_mode/).
Pesepay: [Onboarding](https://developers.pesepay.com/getting-started/onboarding/),
[Methods](https://developers.pesepay.com/payment-methods/overview/), [Pricing](https://www.pesepay.com/pricing),
[Callback](https://developers.pesepay.com/webhooks/result-callback/).
EcoCash: [Developers](https://developers.ecocash.co.zw/), [Go-live](https://developers.ecocash.co.zw/docs/go-live),
[Online payments](https://developers.ecocash.co.zw/docs/online-payments),
[Merchant to subscriber](https://developers.ecocash.co.zw/docs/merchant-to-subscriber).
Others: [ZimSwitch Online](https://zimswitch.co.zw/solutions/zimswitch-online/),
[ZB merchant gateway](https://zbnet.zb.co.zw/merchant_gateway),
[Paystack countries](https://support.paystack.com/en/articles/2130562),
[Flutterwave methods](https://developer.flutterwave.com/docs/payment-methods), [Stripe global](https://stripe.com/global),
[DPO exit (news)](https://www.theanchor.co.zw/c-trade-says-dpo-payment-option-no-longer-available-after-zim-exit/).
