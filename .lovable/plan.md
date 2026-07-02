
# Con Z — Booking, AI Pricing, RBAC & Live Progress

Delivered in three phases across separate turns. Each phase ends in a working preview.

## Phase 1 — Booking flow, AI pricing, radar search

**Database**
- `material_prices`: add optional `demand_multiplier` (default 1.0) and keep `min_price`/`max_price` hidden from customers via a new public view `v_material_prices_public` that exposes only `material`, `label`, `unit`. Revoke SELECT on `material_prices` from `anon`/`authenticated`; keep it readable only through server functions.
- Trigger `tg_validate_job_budget` stays (server-side floor/ceiling enforcement is the security backstop).

**Server function `computeOffer` (hybrid AI)**
- Deterministic formula (server-side, no LLM in the money loop):
  `base = midpoint(min,max) * qty_factor * distance_factor * demand_multiplier`
  clamped to `[min, max]`, rounded to nearest $5.
- Then Lovable AI (`google/gemini-3-flash-preview`) generates a one-line human explanation only. Price is never taken from the LLM.
- Returns `{ offer, min, max, step, explanation, etaMinutes, distanceKm }` — `min`/`max` used only by the increment/decrement guard, never rendered.

**Booking UX (`/customer/book`, replaces `/jobs/new`)**
- 3-step wizard: (1) delivery address (Google Maps AddressPicker + current location) → (2) material + quantity chips → (3) offer screen.
- Offer screen shows only: `YOUR OFFER` `US$XXX`, `–` `+`, short AI explanation, "Confirm booking" button.
- Steps: <$100 → $5, $100–300 → $10, >$300 → $20.
- On `–` below `min`: toast "Minimum offer reached." On `+` above `max`: toast "Maximum offer reached." Values never revealed.
- Submit → creates `jobs` row (budget = offer) → navigates to `/jobs/$id` with radar overlay.

**Radar search screen (`SearchingTrucks` component)**
- Full-screen overlay while `jobs.status = 'open'` and no bids yet.
- Animated concentric radar rings (CSS keyframes), rotating sweep line, 3 truck icons orbiting inward.
- Copy cycles: "Searching for nearby tipper trucks…" → "Finding the best available driver…"
- Estimated wait based on nearby driver count from `driver_locations`.
- Auto-dismisses when first bid arrives (Realtime).

**Hide platform fee**
- Remove commission line from `/wallet` customer view, home cards, and job detail customer panel.
- Keep it visible on driver wallet and `/admin/revenue`.

**Driver-side job card** (no code change to pricing) — already shows offer, material, qty, address. Add ETA + distance from Routes API.

## Phase 2 — RBAC hardening + navigation

**Roles**
- Roles already live in `public.user_roles` (good). Add server function `getMyRole()` that returns the highest role, called on every protected page.
- New `_admin` pathless layout under `_authenticated`: `beforeLoad` checks `has_role(admin|super_admin)` server-side. `_super_admin` layout for super-only pages.
- Move `/admin/*` under `_authenticated/_admin/*` (already gated in `beforeLoad` — hardening: also gate each server-fn mutation with `requireSupabaseAuth` + role check inside the handler).

**Navigation**
- SidePanel becomes role-aware. Menu items filtered by role:
  - Customer: Home, Book delivery, My jobs, Notifications, Profile, Become a driver
  - Driver: Dashboard, Available jobs, Accepted jobs, Earnings, Notifications, Profile
  - Admin/Super admin: adds "Control Center" link into `/admin`
- Admin tab removed from any bottom/tab nav (already removed in prior turn — verify).
- Drivers with customer role also see a "Switch to Customer mode" toggle (existing `useViewMode`).

**Become a Driver**
- Profile page CTA "Become a driver" (visible when user lacks `driver` role) → opens `/profile/become-driver` form: full name, ID number, license, phone, truck details, doc uploads (existing `driver-docs` bucket).
- Submits `driver_applications` row (new table) with status `pending`.
- Admin verification queue reads from `driver_applications` (rename existing `admin.verifications` to consume this).
- On approve: server function grants `driver` role via `admin_grant_role`, creates `driver_profiles` + `wallets` rows if missing, keeps `customer` role.
- On reject: sets status `rejected` with `reason`; user can resubmit.

**Database**
```sql
CREATE TABLE public.driver_applications (
  id uuid PK,
  user_id uuid REFERENCES auth.users,
  full_name, id_number, license_number, phone text,
  truck_reg, truck_capacity_m3, docs jsonb,
  status text CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
  reason text, reviewed_by uuid, reviewed_at, created_at, updated_at
);
-- GRANT to authenticated + service_role
-- RLS: user can insert/select own; admins can select all + update
```

## Phase 3 — Live booking progress

**Database**
- Extend `jobs.status` enum with: `driver_travelling`, `driver_arrived`, `loading`, `transporting`. Keep `accepted`, `in_progress`, `completed`.
- Add `job_status_events` table (audit trail) — timestamped log of every stage change.

**Driver flow**
- On accepted job page, driver sees a single big "Advance status" button that cycles through stages with confirmation dialogs.
- Each tap writes `jobs.status` + inserts `job_status_events`.

**Customer flow**
- Vertical stepper on `/jobs/$id` with 7 stages. Current stage: animated pulsing dot + progress bar between stages. Completed stages: check icon.
- Realtime subscription to `jobs` row updates the stepper.
- Notifications trigger already exists — extend `tg_notify_job_status` to cover new stages.

**Live map**
- Existing `CustomerTrackMap` (Leaflet) upgraded to Google Maps (matches Phase 1 map polish). Driver marker interpolates smoothly between location updates.

## Design polish (throughout)
- Rounded-2xl cards, larger tap targets (h-14 primary buttons), Barlow Condensed for numbers/CTAs, Inter for body.
- Construction-themed icons (`Truck`, `Package`, `MapPin`, `HardHat`) from lucide.
- Dark theme stays primary; orange accent (`--primary`) unchanged.
- Framer-motion for radar, stepper transitions, offer number changes.

## Out of scope for now
- Real-time demand modelling (uses simple `driver_locations` count).
- Audit logs UI for super admin (data captured but no dedicated screen).
- Payment integration.
- Push notifications (in-app realtime notifications only).

## Turn plan
- **This turn**: Phase 1 (booking flow, AI offer, radar, hide fee).
- **Next turn**: Phase 2 (RBAC + Become-a-Driver).
- **Turn after**: Phase 3 (7-stage live progress + Google Maps tracking).

Reply "go" to start Phase 1, or tell me what to change.
