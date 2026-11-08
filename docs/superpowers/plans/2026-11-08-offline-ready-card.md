# "Ready offline" delivery card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A driver who has loaded a delivery once can still see where to go and ring the customer with no network, and a customer can still show their PIN, from details saved on their own phone.

**Architecture:** A small pure module saves a per-job "card" (and the customer's PIN) in `localStorage` with a 7-day life, removed at sign-out and when the job ends. The job page shows the card when the job cannot load; a narrow service-worker navigation fallback (`public/offline.html`) shows the same saved cards when a page itself cannot load. No database, payment or server change.

**Tech Stack:** TypeScript, React 19, TanStack Router/Query, Vitest, plain service worker, Playwright (manual verification).

**Spec:** `docs/offline/OFFLINE-RESEARCH-2026-11-08.md` (features D2, D5 partly, D10, C1; owner approved the recommended answers on 08/11/2026). Out of scope by owner order: anything touching commission, reserve/release, escrow, settlement, payment config. Photo outbox and server evidence-timing changes are the next plan.

## Global Constraints

- No payment, commission, wallet, escrow or settlement code is touched. No migration, no RPC change.
- Saved data lives only on the person's own phone, for at most 7 days (`7 * 24 * 60 * 60 * 1000` ms), and is removed at sign-out and when the job leaves `accepted`/`in_progress`.
- Words say "saved on this phone" and "no signal"; they never promise that anything will be sent or checked later.
- The PIN is only ever shown from the customer's own saved copy; the driver's phone never holds it.
- Existing push handlers in `public/sw.js` must keep working unchanged.

## Review Focus

1. Sign-out on a shared phone must remove every saved card and PIN (`clearOfflineData`).
2. A card older than 7 days must never be shown.
3. A card for a finished or cancelled job must not linger (a stale address for the wrong delivery).
4. A job with an address but no coordinates must still give a useful card and no broken map link.
5. The service worker must never break normal online navigation or push notifications.

---

### Task 1: Offline card model

**Files:**
- Create: `src/lib/offline-card.ts`
- Test: `tests/unit/offline-card.test.ts`

**Interfaces:**
- Produces:
  - `type OfflineCard = { jobId: string; role: "driver" | "customer"; title: string; deliveryAddress: string | null; lat: number | null; lng: number | null; pickupAddress: string | null; notes: string | null; contactName: string | null; contactPhone: string | null; savedAt: number }`
  - `CARD_PREFIX = "conz.offlinecard."`, `PIN_PREFIX = "conz.offlinepin."`
  - `buildOfflineCard(i: { job: { id: string; material?: string | null; quantity_m3?: number | string | null; delivery_address?: string | null; delivery_lat?: number | string | null; delivery_lng?: number | string | null; pickup_address?: string | null; notes?: string | null; status: string }; materialName: string; contact: { full_name: string | null; phone: string | null } | null; role: "driver" | "customer"; now?: number }): OfflineCard | null` (null when there is neither an address nor coordinates)
  - `saveOfflineCard(card, storage)`, `readOfflineCard(jobId, storage, now?)`, `listOfflineCards(storage, now?)`, `removeOfflineCard(jobId, storage)`
  - `savePin(jobId, pin, storage, now?)`, `readPin(jobId, storage, now?)`, `removePin(jobId, storage)`
  - `clearOfflineData(storage)`; `isActiveJobStatus(status: string): boolean` (accepted, in_progress)
  - `navLinks(card): { geo: string | null; web: string | null }`

- [ ] **Step 1: Write the failing tests** in `tests/unit/offline-card.test.ts`: builds a card with title `"River sand · 12 m³"`; returns null with no address and no coordinates; keeps an address-only card with `lat`/`lng` null; coordinates parsed from strings and rejected when not finite; save/read round-trip; per-job; expires after exactly 7 days (`7*DAY - 1` kept, `7*DAY + 1` gone); `listOfflineCards` returns only live cards, newest first; PIN save/read with the same expiry and not mixed into card lists; `clearOfflineData` removes both prefixes and nothing else; broken/null storage never throws; `isActiveJobStatus` true for `accepted`/`in_progress`, false for `completed`/`cancelled`/`open`; `navLinks` gives `geo:-17.8322,31.0181?q=-17.8322,31.0181(Harward%20Road)` and `https://www.google.com/maps/dir/?api=1&destination=-17.8322,31.0181&travelmode=driving`, and both `null` without coordinates.
- [ ] **Step 2: Run** `npx vitest run tests/unit/offline-card.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the module with the signatures above (storage typed with `Pick<Storage, ...>`, every access in try/catch, JSON values with `savedAt`).
- [ ] **Step 4: Run** the same command. Expected: all pass.
- [ ] **Step 5: Commit** `git add src/lib/offline-card.ts tests/unit/offline-card.test.ts && git commit -m "Offline card model: per-job saved delivery details and PIN"`.

### Task 2: Driver card is saved, shown as "Ready offline", and used when the job cannot load

**Files:**
- Create: `src/components/OfflineJobCard.tsx`
- Modify: `src/routes/_authenticated/jobs.$id.tsx` (DriverActiveJob; the job-loading block; job-level cleanup effect); `src/lib/auth.tsx` (sign-out calls `clearOfflineData`)
- Test: `tests/unit/offline-card.test.ts` (extend), manual browser check

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `OfflineJobCard({ card }: { card: OfflineCard })` (address, copyable coordinates, "Open in maps" via `navLinks`, "Call" via the existing `telLink`, notes, "Saved on this phone at HH:MM").

- [ ] **Step 1: Write the failing test** for `cardCopy(card, now)` (exported from `offline-card.ts`): subtitle `"Saved on this phone at 14:05"` format and `"Ready offline"` label only when the card is live; an address-only card says coordinates are not saved.
- [ ] **Step 2: Run** it. Expected: FAIL (`cardCopy` not defined).
- [ ] **Step 3: Implement** `cardCopy`, the `OfflineJobCard` component, an effect in `DriverActiveJob` that builds and saves the card once the job and `other` contact are loaded and the job is active, a "Ready offline" chip beside the contact card, the job-loading block showing `OfflineJobCard` when `readOfflineCard(id)` exists and the state is paused or errored, a cleanup effect removing the card and PIN when the job is not active, and `clearOfflineData(window.localStorage)` next to `clearContacts` at sign-out.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc --noEmit`. Expected: pass, no type errors. Then in the browser (local stand-in, driver on an active job): chip appears; go offline, open the job from the list: the card shows address, coordinates, Call and Open in maps; sign out: storage keys gone.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Driver: save the delivery card on this phone, show it when the job cannot load"`.

### Task 3: Customer PIN stays available without signal

**Files:**
- Modify: `src/routes/_authenticated/jobs.$id.tsx` (the `delivery-pin` query)
- Test: `tests/unit/offline-card.test.ts` (PIN cases already in Task 1), manual browser check

**Interfaces:**
- Consumes: `savePin`, `readPin`, `isNetworkFailure` (`src/lib/contact-cache.ts`).

- [ ] **Step 1: Write the failing test** `pinForDisplay({ fetched, error, cached })` in `offline-card.ts`: fetched PIN wins; a network failure falls back to the cached PIN; a non-network error and no cache give `null`; a successful empty answer (no PIN) gives `null` and never the stale cache.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** `pinForDisplay` and use it in the query: save on success, fall back on network failure.
- [ ] **Step 4: Run** `npx vitest run`. Expected: pass. Browser: customer sees the PIN online; offline the same screen still shows it.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Customer: keep the delivery PIN on their phone for no-signal sites"`.

### Task 4: Service-worker fallback page for pages that cannot load

**Files:**
- Create: `public/offline.html`, `src/lib/offline-fallback.ts`
- Modify: `public/sw.js` (install precache, navigation fallback; push handlers untouched), `src/routes/_authenticated/route.tsx` (register on mount)
- Test: `tests/unit/offline-fallback.test.ts`, manual browser check

**Interfaces:**
- Produces: `registerOfflineFallback(): Promise<void>` (registers `/sw.js` when supported, never throws).

- [ ] **Step 1: Write the failing test** for `shouldServeOfflinePage({ mode, method })` (exported from `offline-fallback.ts`, mirrored in the service worker): true only for `navigate` + `GET`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3: Implement** the helper, `registerOfflineFallback`, `public/offline.html` (self-contained: lists live cards from `localStorage` with address, coordinates, maps and call links, the customer's PIN, and a retry that reloads on the `online` event), and the `sw.js` additions: `install` precaches `/offline.html` then `skipWaiting`; `fetch` handles only navigations: `fetch(request).catch(() => caches.match("/offline.html"))`.
- [ ] **Step 4: Run** `npx vitest run`, `npx tsc --noEmit`, `npm run lint:security`, `npm run build`. Expected: all pass. Browser: signed-in driver with a saved card, service worker active, set the browser offline and open a job URL not loaded in this tab: the offline page shows the saved card; online navigation and a push test notification are unaffected.
- [ ] **Step 5: Commit** `git add -A && git commit -m "Service-worker fallback page that shows saved delivery details when a page cannot load"`.
