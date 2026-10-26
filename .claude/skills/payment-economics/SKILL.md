---
name: payment-economics
description: Use when ConZ needs the cost and money-flow consequences of a payment choice — per-job commission, gateway fees, IMTT, VAT, settlement delays, wallet caps, float — or the regulatory meaning of a model (merchant payments vs stored value vs holding customer funds vs payouts). Produces a worked example and the questions for an accountant or lawyer.
---

# Payment economics and compliance framing

## When to use
- Comparing payment models or providers.
- Changing the commission rate, base, minimum top-up or wallet cap.
- Before enabling escrow or withdrawals.

## Workflow
1. Name the money flow precisely: who pays whom, which account receives it, who can take it out.
2. Classify ConZ's activity for that flow:
   - receiving its own revenue (merchant payments);
   - holding a driver's prepaid commission credit that cannot be withdrawn or transferred;
   - holding customer money for someone else (escrow);
   - paying money out to users (payouts/withdrawals).
   Each step down the list raises regulatory questions; never assume a merchant account covers the later ones.
3. Use only official numbers (provider fee pages, ZIMRA, RBZ). Anything else is an assumption, labelled.
4. Build a per-job table for a stated job price (e.g. $200): commission, top-up size, gateway fee, IMTT if it
   applies, VAT if registered, net to ConZ, cash the driver must pre-fund.
5. State sensitivity: what happens at 2x fees, or if top-ups are $5 instead of $20.
6. List questions that need an accountant (VAT, fiscalised invoices, IMTT, revenue recognition of unused credit)
   and a lawyer (RBZ position on stored value, escrow, payouts).

## Output
Model classification · per-job table with every assumption marked · sensitivity line · accountant and lawyer
questions. Store in `docs/payments/ARCHITECTURE-DECISION.md` (economics section).
