// Shape of job_evidence_record() (0187) and the warnings an admin should see first. Flags point at things to check;
// they never decide a dispute.

export type EvidenceRecord = {
  job_id: string;
  status: string;
  basis: string;
  timeline: { step: string; at: string }[];
  photos: {
    id: string;
    kind: string;
    uploaded_at: string;
    by_role: string;
    location_status: string;
    has_location: boolean;
    is_photo_of_record: boolean;
    replaced_by: string | null;
    replaced_note: string | null;
    added_after_dispute: boolean;
    verification: "submitted";
  }[];
  reports: {
    id: string;
    event: string;
    by_role: "customer" | "driver";
    issue: string | null;
    condition: string | null;
    quantity_m3: number | null;
    eta_minutes: number | null;
    note: string | null;
    corrects: string | null;
    at: string;
    added_after_dispute: boolean;
    verification: "statement";
  }[];
  delivery_code: {
    issued: boolean;
    confirmed_at: string | null;
    wrong_attempts: number | null;
    verification: string;
  };
  quantity: {
    ordered_m3: number | null;
    delivered_m3: number | null;
    receiver_name: string | null;
  };
  disputes: { status: string; category: string; opened_at: string; resolved_at: string | null }[];
  recorded_gps_points: number | null;
};

export function evidenceRecordFlags(r: EvidenceRecord): string[] {
  const out: string[] = [];
  const late =
    r.photos.filter((p) => p.added_after_dispute).length +
    r.reports.filter((x) => x.added_after_dispute).length;
  if (late) out.push(`${late} item(s) added after the dispute opened`);
  const replaced = r.photos.filter((p) => p.replaced_by).length;
  if (replaced)
    out.push(`${replaced} photo(s) replaced by the person who took them (originals kept)`);
  const noLoc = r.photos.filter((p) => !p.has_location).length;
  if (noLoc) out.push(`${noLoc} photo(s) without a location`);
  if ((r.delivery_code.wrong_attempts ?? 0) > 0)
    out.push(`${r.delivery_code.wrong_attempts} wrong delivery code attempt(s)`);
  const loaded = r.reports.filter((x) => x.event === "collection_confirmed").at(-1)?.quantity_m3;
  if (
    loaded != null &&
    r.quantity.ordered_m3 != null &&
    Number(loaded) < Number(r.quantity.ordered_m3)
  )
    out.push(`Driver reported ${loaded} m³ loaded for ${r.quantity.ordered_m3} m³ ordered`);
  if (r.reports.some((x) => x.event === "delivery_problem"))
    out.push("The customer or driver reported a delivery problem");
  return out;
}
