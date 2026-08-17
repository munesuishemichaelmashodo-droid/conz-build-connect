import type { TourConfig, TourResolveCtx, TourStep } from "./types";

const DASHBOARD = "/driver";

/** Any open job on the marketplace right now — used for the "job details" /
 *  "place a bid" steps, which don't need to be *this* driver's job, just a
 *  real one to look at. Null (skip, logged) if the marketplace is briefly
 *  empty. */
async function findOpenJob({ supabase }: TourResolveCtx): Promise<{ id: string } | null> {
  const { data } = await supabase.from("jobs").select("id").eq("status", "open").order("created_at", { ascending: false }).limit(1);
  return data?.[0] ?? null;
}

/** A still-open job this driver has already bid on — for the "bid status"
 *  step. */
async function findJobWithMyBid({ supabase, userId }: TourResolveCtx): Promise<{ id: string } | null> {
  const { data: bids } = await supabase.from("bids").select("job_id").eq("driver_id", userId).order("created_at", { ascending: false }).limit(10);
  if (!bids?.length) return null;
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id")
    .eq("status", "open")
    .in("id", bids.map((b: any) => b.job_id))
    .limit(1);
  return jobs?.[0] ?? null;
}

/** A job actually assigned to this driver, in one of the given statuses —
 *  for chat/tracking/status-update/complete, all of which only make sense
 *  once a job has been accepted. */
async function findAssignedJob({ supabase, userId }: TourResolveCtx, statuses: string[]): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("driver_id", userId)
    .in("status", statuses)
    .order("updated_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

const steps: TourStep[] = [
  {
    id: "driver-dashboard",
    title: "Your dashboard",
    description: "Open jobs near you, your wallet, and your level all live here.",
    route: DASHBOARD,
    target: "#tour-dashboard-hero",
  },
  {
    id: "driver-verification",
    title: "Get verified",
    description: "Upload your ID, truck, and a selfie here — verified drivers get first pick of jobs.",
    route: "/profile",
    target: "#tour-driver-verification-section",
  },
  {
    id: "driver-browse-jobs",
    title: "Browse open jobs",
    description: "Every open delivery request in your area shows up here.",
    route: "/jobs",
    target: "#tour-jobs-list",
  },
  {
    id: "driver-job-details",
    title: "Check the job details",
    description: "Material, quantity, delivery point, and the customer's offer — all here before you bid.",
    route: (ctx) => findOpenJob(ctx).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-job-header",
    waitMs: 3000,
  },
  {
    id: "driver-place-bid",
    title: "Place your bid",
    description: "Offer your price for the job — the customer can accept it or counter.",
    route: (ctx) => findOpenJob(ctx).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-place-bid",
    waitMs: 3000,
  },
  {
    id: "driver-bid-status",
    title: "Track your bid",
    description: "Once you've bid, this same spot shows whether it's pending or countered.",
    route: (ctx) => findJobWithMyBid(ctx).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-place-bid",
    waitMs: 3000,
  },
  {
    id: "driver-chat",
    title: "Message your customer",
    description: "Confirm access details or timing directly, right from the job.",
    route: (ctx) => findAssignedJob(ctx, ["accepted", "in_progress", "completed"]).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-chat-link",
    waitMs: 3000,
  },
  {
    id: "driver-accepted",
    title: "When you're accepted",
    description: "This section updates with what to do next the moment a customer accepts your bid.",
    route: (ctx) => findAssignedJob(ctx, ["accepted", "in_progress"]).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-next-steps",
    waitMs: 3000,
  },
  {
    id: "driver-live-tracking",
    title: "Share your live location",
    description: "Once you're on the road, the customer can watch your truck move in real time.",
    route: (ctx) => findAssignedJob(ctx, ["accepted", "in_progress"]).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-tracking",
    waitMs: 3000,
  },
  {
    id: "driver-update-status",
    title: "Confirm pickup and delivery",
    description: "Snap a photo when you load up, and again once you've delivered.",
    route: (ctx) => findAssignedJob(ctx, ["accepted", "in_progress"]).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-next-steps",
    waitMs: 3000,
  },
  {
    id: "driver-complete",
    title: "Wrap up the job",
    description: "For Con Z Pay jobs, enter the customer's code here to confirm and release your payment.",
    route: (ctx) => findAssignedJob(ctx, ["accepted", "in_progress"]).then((j) => (j ? `/jobs/${j.id}` : null)),
    target: "#tour-next-steps",
    waitMs: 3000,
  },
  {
    id: "driver-earnings",
    title: "Your earnings",
    description: "Completed jobs land here — top up, withdraw, and see your balance anytime.",
    route: "/wallet",
    target: "#tour-wallet-balance",
  },
];

export const driverTour: TourConfig = {
  key: "driver",
  label: "How Con Z works for drivers",
  steps,
};
