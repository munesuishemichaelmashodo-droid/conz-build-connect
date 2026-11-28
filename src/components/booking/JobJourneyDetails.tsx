import { jobKindLabel, timeLabel, truckLabel } from "@/lib/booking-journey";

type JourneyJob = {
  job_kind?: string | null;
  collection_name?: string | null;
  collection_contact?: string | null;
  collection_reference?: string | null;
  truck_requirement?: string | null;
  preferred_time?: string | null;
  load_details?: string | null;
};

/**
 * The 0183 booking details on a job. Shows only what the database returned: a driver who has not been selected
 * gets no contact or reference (mask_job_for_driver), so those rows simply do not appear for them.
 */
export function JobJourneyDetails({ job }: { job: JourneyJob }) {
  const kind = jobKindLabel(job.job_kind);
  if (!kind) return null;
  const rows: [string, string | null | undefined][] = [
    ["Booking", kind],
    ["Collect from", job.collection_name],
    ["Contact at collection", job.collection_contact],
    ["Order reference", job.collection_reference],
    ["Truck needed", truckLabel(job.truck_requirement)],
    ["Preferred time", timeLabel(job.preferred_time)],
    ["Load details", job.load_details],
  ];
  return (
    <dl
      className="space-y-1 border-t border-cz-border pt-2.5 text-sm"
      data-testid="job-journey-details"
    >
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-cz-muted">{k}</dt>
            <dd className="text-right font-medium">{v}</dd>
          </div>
        ))}
    </dl>
  );
}
