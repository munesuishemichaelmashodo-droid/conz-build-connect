// What the customer home should put first, from the jobs it already loads (no extra query).
// One state, one next action. The wording never says an offer exists: the home list does not
// carry offer counts, so an open request only says offers will appear on the job page.

export type CustomerJobLite = { id: string; status: string; created_at?: string | null };

export type CustomerNow = {
  kind: "in_progress" | "accepted" | "open" | "completed";
  title: string;
  meaning: string;
  action: string;
  jobId: string;
};

const pick = (jobs: CustomerJobLite[], status: string) => jobs.find((j) => j.status === status);

export function customerNow(jobs: CustomerJobLite[] | null | undefined): CustomerNow | null {
  const list = jobs ?? [];
  const live = pick(list, "in_progress");
  if (live)
    return {
      kind: "in_progress",
      title: "Your delivery is on the way",
      meaning:
        "The trip has started. The map shows the truck while the driver's phone is sharing its location.",
      action: "Track delivery",
      jobId: live.id,
    };
  const accepted = pick(list, "accepted");
  if (accepted)
    return {
      kind: "accepted",
      title: "You chose a driver",
      meaning: "The driver is getting ready to load. You can message them from the job.",
      action: "Open delivery",
      jobId: accepted.id,
    };
  const open = pick(list, "open");
  if (open)
    return {
      kind: "open",
      title: "Your request is open to offers",
      meaning:
        "Verified drivers can send offers. When they do, you compare them and choose. Nothing is accepted until you choose.",
      action: "Check offers",
      jobId: open.id,
    };
  const done = pick(list, "completed");
  if (done)
    return {
      kind: "completed",
      title: "Delivery complete",
      meaning: "Your receipt, rating and the option to order again are on the job.",
      action: "View delivery",
      jobId: done.id,
    };
  return null;
}
