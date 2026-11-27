# ZIMRA, banking and Paynow company readiness — 27 November 2026

**Status:** preparation. Nothing here has been filed with ZIMRA, Paynow or a bank. Items marked **CONFIRM** need a written answer from ZIMRA, Paynow, a bank or a registered tax practitioner. No personal tax details are to be used for the company.

Company: Navysky Innovations (Private) Limited, company no. 145174A02102026 (as recorded in the Terms and Privacy Policy; **CONFIRM** the exact name against the certificate of incorporation). Trading name: Con Z. The company's own ZIMRA TIN is not yet recorded in the project; the old sole-proprietor TIN was removed from the website on 26/11 and must not be reused.

## 1. What is Navysky's revenue (what the code records)
- **Revenue = the 7% commission only**, recognised when a direct-pay job is verified complete (`platform_ledger` account `platform_revenue`, 0091/0134/0171). Example: $400 job → $28 revenue.
- **Not revenue:** the customer's fare (paid to the driver, never received by Con Z); Commission Credit top-ups until they are used for commission (a prepaid balance); the $20 promotional allowance (no cash received).
- Therefore do **not** fiscalise the job value. **CONFIRM** with a tax practitioner: (a) whether a fiscal tax invoice is required per commission charge or per Commission Credit top-up, (b) VAT registration threshold and position, (c) treatment of prepaid credit that is never used (breakage).

## 2. FDMS "No Branch Found"
- Known only as an error text in the project notes; the cause is not established. Typical causes to check, **CONFIRM** with ZIMRA:
  1. The company has no branch registered under its TIN in TaRMS (fiscal devices are tied to a branch).
  2. The device or POS app is being registered under the old individual TIN instead of the company's.
- Action: log in to TaRMS with the company's credentials, confirm the company TIN and its registered branch (address = registered office, which is not to be published on the website), then register the fiscal device against that branch.

## 3. Fiscal device route
- Options to compare with ZIMRA/tax practitioner: ZIMRA's free POS application, a Virtual Fiscal Device (VFD), or an accredited supplier. **CONFIRM** which ZIMRA accepts for an online platform issuing commission invoices, and whether invoices can be generated from Con Z's own ledger and submitted via the FDMS API.
- Technical readiness: every commission is already a single ledger row with job id and amount (`platform_ledger`), which is what an invoice generator would read. No invoice generation is built yet.

## 4. Bank account
- The company bank account is not open yet. Needed for Paynow verification and for settlement. Do not change the Paynow settlement account to a personal account.

## 5. Paynow company verification (integration ID 26052)
Paynow's stated requirements: company letter requesting verified merchant status; director's ID; proof of a bank account in the company's name; company logo.

Prepared in the app: payments now fail closed (#162, 0190): mode `off` / `test` / `live`, BuySafe-held payments are never credited until Paid/Delivered, and LIVE is set only by a super admin with a step-up and reason.

Open questions for Paynow (written answers needed):
1. Can the existing individual merchant profile be converted to the company, keeping integration ID 26052?
2. Can it keep operating unverified during the transition, and with what limits?
3. BuySafe: can a verified company merchant switch it off for Commission Credit top-ups?
4. Settlement timing and currency to the company account.
Until answered: do not create a second merchant account, and do not change merchant or bank details.

## 6. Launch decision for payments
Keep `paynow_mode` at `off` (or `live` on the current individual merchant only with the owner's explicit written approval) until 4 and 5 are answered.
