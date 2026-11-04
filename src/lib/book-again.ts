// "Book again" on a delivered job: the booking screen's search parameters,
// filled from the past job. The price is never carried over; booking always
// takes a fresh quote. A preferred driver is only a request: the server keeps it
// only if that driver is verified (jobs_guard_insert, 0080).

type PastJob = {
  status: string;
  material?: string | null;
  quantity_m3?: number | string | null;
  delivery_address?: string | null;
  delivery_lat?: number | string | null;
  delivery_lng?: number | string | null;
  driver_id?: string | null;
};

export type BookAgainSearch = {
  material?: string;
  quantity?: number;
  address?: string;
  lat?: number;
  lng?: number;
  driverId?: string;
};

const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export function bookAgainSearch(
  job: PastJob,
  { sameDriver = false }: { sameDriver?: boolean } = {},
): BookAgainSearch | null {
  if (job.status !== "completed") return null;
  const s: BookAgainSearch = {};
  if (job.material && job.material !== "custom") s.material = job.material;
  const qty = num(job.quantity_m3);
  if (qty != null && qty > 0) s.quantity = qty;
  const address = job.delivery_address?.trim();
  if (address) s.address = address;
  const lat = num(job.delivery_lat);
  const lng = num(job.delivery_lng);
  if (lat != null && lng != null) {
    s.lat = lat;
    s.lng = lng;
  }
  if (sameDriver && job.driver_id) s.driverId = job.driver_id;
  return s;
}

export type RepeatableJob = PastJob & {
  id: string;
  quantity_m3: number | string | null;
  material: string;
};

// Minimal shape of the supabase query builder this helper uses, so it can be tested without a network.
type Query = {
  select: (cols: string) => Query;
  eq: (col: string, val: string) => Query;
  neq: (col: string, val: string) => Query;
  order: (col: string, opts: { ascending: boolean }) => Query;
  limit: (n: number) => Query;
  maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

const REPEAT_COLUMNS =
  "id,status,material,custom_material,quantity_m3,delivery_address,delivery_lat,delivery_lng,driver_id";

/**
 * The customer's most recent completed delivery that the booking screen can pre-fill (no custom material),
 * read straight from their history with one narrow query, so it does not matter how many newer jobs exist.
 * Returns null when there is none or the read fails (the card is simply not shown).
 */
export async function latestRepeatableJob(
  client: { from: (table: string) => unknown },
  userId: string,
): Promise<RepeatableJob | null> {
  const q = client.from("jobs") as Query;
  const { data, error } = await q
    .select(REPEAT_COLUMNS)
    .eq("customer_id", userId)
    .eq("status", "completed")
    .neq("material", "custom")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as RepeatableJob;
}
