import type { TourConfig, TourResolveCtx, TourStep } from "./types";

const DASHBOARD = "/customer";
const BOOK = "/customer/book";

/**
 * Real customer jobs in a given lifecycle state, newest first. Used by the
 * later steps (bids/chat/track/receipt/dispute) which only make sense
 * against an actual job of theirs in the right state — a brand-new
 * customer legitimately has none of these yet, in which case the step is
 * skipped (see useGuidedTour's missing-target handling), not faked.
 */
async function findCustomerJob(
  { supabase, userId }: TourResolveCtx,
  opts: { statuses?: string[]; notStatus?: string; notEscrow?: boolean; requireTrackingToken?: boolean },
): Promise<{ id: string } | null> {
  let q = supabase.from("jobs").select("id, payment_method, tracking_token").eq("customer_id", userId).order("created_at", { ascending: false }).limit(10);
  if (opts.statuses) q = q.in("status", opts.statuses);
  if (opts.notStatus) q = q.neq("status", opts.notStatus);
  const { data, error } = await q;
  if (error || !data?.length) return null;
  const filtered = data.filter((j: any) => {
    if (opts.notEscrow && j.payment_method === "escrow") return false;
    if (opts.requireTrackingToken && !j.tracking_token) return false;
    return true;
  });
  return filtered[0] ?? null;
}

/** A job of theirs that's still open and has at least one bid — for the
 *  "bids received" / "compare drivers" / "accept" steps. */
async function findJobWithBids({ supabase, userId }: TourResolveCtx): Promise<{ id: string } | null> {
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("customer_id", userId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(10);
  if (!jobs?.length) return null;
  for (const j of jobs as any[]) {
    const { count } = await supabase.from("bids").select("id", { count: "exact", head: true }).eq("job_id", j.id);
    if (count && count > 0) return j;
  }
  return null;
}

const steps: TourStep[] = [
  {
    id: "customer-dashboard",
    title: "Your dashboard",
    description: "Everything starts here — recent jobs, your wallet status, and quick actions.",
    route: DASHBOARD,
    target: '[data-tour="dashboard-hero"]',
  },
  {
    id: "customer-post-job",
    title: "Book a delivery",
    description: "Tap “Book a delivery” to start your first order — we'll walk through it together.",
    route: DASHBOARD,
    target: '[data-tour="book-delivery-cta"]',
    advance: "click",
  },
  {
    id: "customer-material",
    title: "Pick your material",
    description: "Tap the material you need — river sand, stones, gravel and more — then press Next.",
    route: BOOK,
    target: '[data-tour="book-material"]',
    waitForUser: true,
    waitingText: "Opening the booking screen…",
  },
  {
    id: "customer-quantity",
    title: "How much?",
    description: "Set the quantity in m³ with + and −, or tap a quick load size. A tipper carries about 10 m³.",
    route: BOOK,
    target: '[data-tour="book-quantity"]',
    waitForUser: true,
  },
  {
    id: "customer-location",
    title: "Set the delivery point",
    description:
      "Pickup is arranged for you — you only choose where it's delivered. Search your address at the top, or tap the map to drop a pin. The tour continues once your pin is set.",
    route: BOOK,
    target: '[data-tour="book-address"]',
    // The card sits at the bottom so it never covers the search results
    // dropdown or the map you need to tap.
    cardPosition: "bottom",
    advance: "done",
    doneWhen: '[data-tour="book-see-price"][data-location-ready="true"]',
    waitingText: "Search for your address or tap the map to drop a pin — the tour continues once it's set.",
    waitForUser: true,
  },
  {
    id: "customer-review",
    title: "Date and notes",
    description: "Optional: open this to add a preferred date or notes for the driver, then press Next.",
    route: BOOK,
    target: '[data-tour="book-review"]',
    waitForUser: true,
  },
  {
    id: "customer-see-price",
    title: "Get your price",
    description: "Tap “See price”. We price it instantly from real material and fuel costs.",
    route: BOOK,
    target: '[data-tour="book-see-price"]',
    advance: "done",
    doneWhen: '[data-tour="book-offer"]',
    waitingText: "Tap “See price” to continue.",
    waitForUser: true,
  },
  {
    id: "customer-budget",
    title: "Choose your price",
    description: "Pick Low, Recommended or High — higher prices get faster offers. Then press Next.",
    route: BOOK,
    target: '[data-tour="book-offer"]',
    waitForUser: true,
  },
  {
    id: "customer-post",
    title: "Confirm your booking",
    description: "This posts your job for real, so it's Next-only here — no accidental taps.",
    route: BOOK,
    target: '[data-tour="book-confirm"]',
    waitForUser: true,
  },
  {
    id: "customer-bids-received",
    title: "Bids come in here",
    description: "Once drivers see your job, their offers appear on the job page.",
    route: (ctx) => findJobWithBids(ctx).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-bids-received",
    waitMs: 3000,
  },
  {
    id: "customer-compare-drivers",
    title: "Compare drivers",
    description: "Check each driver's rating, level, and verification badge before choosing.",
    route: (ctx) => findJobWithBids(ctx).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-bids-received",
    waitMs: 3000,
  },
  {
    id: "customer-accept",
    title: "Accept a bid",
    description: "Accepting locks in that driver for the job, so this is Next-only too.",
    route: (ctx) => findJobWithBids(ctx).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-accept-bid",
    waitMs: 3000,
  },
  {
    id: "customer-chat",
    title: "Message your driver",
    description: "Coordinate pickup details or ask questions directly, right from the job.",
    route: (ctx) => findCustomerJob(ctx, { notStatus: "open" }).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-chat-link",
    waitMs: 3000,
  },
  {
    id: "customer-track",
    title: "Track your delivery live",
    description: "Once your driver is on the way, watch the truck move on the map in real time.",
    route: (ctx) => findCustomerJob(ctx, { statuses: ["accepted", "in_progress"] }).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-tracking",
    waitMs: 3000,
  },
  {
    id: "customer-confirm-delivery",
    title: "Confirm delivery",
    description: "Once the load arrives, confirm it here to close out the job.",
    route: (ctx) =>
      findCustomerJob(ctx, { statuses: ["accepted", "in_progress"], notEscrow: true }).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-confirm-delivery",
    waitMs: 3000,
  },
  {
    id: "customer-receipt",
    title: "Your receipt",
    description: "Every completed job gets a receipt with photos and a downloadable PDF.",
    route: (ctx) =>
      findCustomerJob(ctx, { statuses: ["completed"], requireTrackingToken: true }).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-receipt-link",
    waitMs: 3000,
  },
  {
    id: "customer-disputes",
    title: "Something wrong? Raise a dispute",
    description: "If a delivery doesn't go as agreed, our team can step in from right here.",
    route: (ctx) =>
      findCustomerJob(ctx, { statuses: ["accepted", "in_progress", "completed"] }).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-dispute",
    waitMs: 3000,
  },
];

export const customerTour: TourConfig = {
  key: "customer",
  label: "How Con Z works for customers",
  steps,
};
