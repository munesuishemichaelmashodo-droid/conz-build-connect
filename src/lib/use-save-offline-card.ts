import { useEffect, useState } from "react";
import { materialLabel } from "@/lib/domain";
import { buildOfflineCard, isActiveJobStatus, saveOfflineCard } from "@/lib/offline-card";

type JobForCard = Parameters<typeof buildOfflineCard>[0]["job"] & {
  custom_material?: string | null;
};

/**
 * While a delivery is under way, keep its card on this phone (see lib/offline-card.ts) so the driver or customer still
 * has the address, the other person's number and, for the customer, the PIN with no signal. Returns whether it is saved.
 */
export function useSaveOfflineCard(
  job: JobForCard,
  other: { full_name?: string | null; phone?: string | null } | null | undefined,
  role: "driver" | "customer",
): boolean {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!isActiveJobStatus(job.status)) return;
    const card = buildOfflineCard({
      job,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the job's material is a free string from the database
      materialName: materialLabel(job.material as any, job.custom_material ?? null),
      contact: other ? { full_name: other.full_name ?? null, phone: other.phone ?? null } : null,
      role,
    });
    if (!card) return;
    saveOfflineCard(card, window.localStorage);
    setSaved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-save only when what the card shows changes
  }, [
    job.id,
    job.status,
    job.delivery_address,
    job.delivery_lat,
    job.delivery_lng,
    job.notes,
    job.pickup_address,
    job.material,
    job.quantity_m3,
    other?.full_name,
    other?.phone,
    role,
  ]);
  return saved;
}
