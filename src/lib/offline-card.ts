// "Ready offline": the delivery details a driver needs at the gate (address, coordinates, a landmark note, a phone number to
// ring) and the customer's PIN, kept on the person's OWN phone so they are still there with no signal. A phone call needs
// voice, not data. Everything is per job, lives at most 7 days, is removed when the job ends and at sign-out, and is never
// shared. Nothing here moves money or is read by the server.

export const CARD_PREFIX = "conz.offlinecard.";
export const PIN_PREFIX = "conz.offlinepin.";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // the life of a delivery PIN

export type OfflineCard = {
  jobId: string;
  role: "driver" | "customer";
  title: string;
  deliveryAddress: string | null;
  lat: number | null;
  lng: number | null;
  pickupAddress: string | null;
  notes: string | null;
  contactName: string | null;
  contactPhone: string | null;
  savedAt: number;
};

type JobLike = {
  id: string;
  material?: string | null;
  quantity_m3?: number | string | null;
  delivery_address?: string | null;
  delivery_lat?: number | string | null;
  delivery_lng?: number | string | null;
  pickup_address?: string | null;
  notes?: string | null;
  status: string;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Only a delivery that is under way needs saved details. */
export function isActiveJobStatus(status: string): boolean {
  return status === "accepted" || status === "in_progress";
}

export function buildOfflineCard(i: {
  job: JobLike;
  materialName: string;
  contact: { full_name: string | null; phone: string | null } | null;
  role: "driver" | "customer";
  now?: number;
}): OfflineCard | null {
  const address = text(i.job.delivery_address);
  const lat = num(i.job.delivery_lat);
  const lng = num(i.job.delivery_lng);
  const hasPoint = lat != null && lng != null;
  if (!address && !hasPoint) return null;
  const qty = num(i.job.quantity_m3);
  return {
    jobId: i.job.id,
    role: i.role,
    title: qty != null ? `${i.materialName} · ${qty} m³` : i.materialName,
    deliveryAddress: address,
    lat: hasPoint ? lat : null,
    lng: hasPoint ? lng : null,
    pickupAddress: text(i.job.pickup_address),
    notes: text(i.job.notes),
    contactName: text(i.contact?.full_name),
    contactPhone: text(i.contact?.phone),
    savedAt: i.now ?? Date.now(),
  };
}

type Writable = Pick<Storage, "setItem"> | null;
type Readable = Pick<Storage, "getItem"> | null;
type Removable = Pick<Storage, "removeItem"> | null;
type Listable = Pick<Storage, "length" | "key" | "getItem"> | null;
type Clearable = Pick<Storage, "length" | "key" | "removeItem"> | null;

export function saveOfflineCard(card: OfflineCard, storage: Writable) {
  try {
    storage?.setItem(CARD_PREFIX + card.jobId, JSON.stringify(card));
  } catch {
    /* storage unavailable: the live screens still work while there is signal */
  }
}

function parseCard(raw: string | null | undefined, now: number): OfflineCard | null {
  try {
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<OfflineCard> | null;
    if (
      !c ||
      typeof c.jobId !== "string" ||
      typeof c.savedAt !== "number" ||
      now - c.savedAt > TTL_MS
    )
      return null;
    return c as OfflineCard;
  } catch {
    return null;
  }
}

export function readOfflineCard(
  jobId: string,
  storage: Readable,
  now: number = Date.now(),
): OfflineCard | null {
  try {
    return parseCard(storage?.getItem(CARD_PREFIX + jobId), now);
  } catch {
    return null;
  }
}

export function listOfflineCards(storage: Listable, now: number = Date.now()): OfflineCard[] {
  const cards: OfflineCard[] = [];
  try {
    if (!storage) return [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (!k || !k.startsWith(CARD_PREFIX)) continue;
      const card = parseCard(storage.getItem(k), now);
      if (card) cards.push(card);
    }
  } catch {
    return [];
  }
  return cards.sort((a, b) => b.savedAt - a.savedAt);
}

export function removeOfflineCard(jobId: string, storage: Removable) {
  try {
    storage?.removeItem(CARD_PREFIX + jobId);
  } catch {
    /* nothing more to do */
  }
}

export function savePin(jobId: string, pin: string, storage: Writable, now: number = Date.now()) {
  try {
    storage?.setItem(PIN_PREFIX + jobId, JSON.stringify({ pin, savedAt: now }));
  } catch {
    /* storage unavailable */
  }
}

export function readPin(jobId: string, storage: Readable, now: number = Date.now()): string | null {
  try {
    const raw = storage?.getItem(PIN_PREFIX + jobId);
    if (!raw) return null;
    const v = JSON.parse(raw) as { pin?: unknown; savedAt?: unknown } | null;
    if (
      !v ||
      typeof v.pin !== "string" ||
      typeof v.savedAt !== "number" ||
      now - v.savedAt > TTL_MS
    )
      return null;
    return v.pin;
  } catch {
    return null;
  }
}

export function removePin(jobId: string, storage: Removable) {
  try {
    storage?.removeItem(PIN_PREFIX + jobId);
  } catch {
    /* nothing more to do */
  }
}

/** Sign-out on a shared phone: every saved card and PIN goes, and nothing else is touched. */
export function clearOfflineData(storage: Clearable) {
  try {
    if (!storage) return;
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && (k.startsWith(CARD_PREFIX) || k.startsWith(PIN_PREFIX))) doomed.push(k);
    }
    doomed.forEach((k) => storage.removeItem(k));
  } catch {
    /* nothing more to do */
  }
}

/** Links for a maps app installed on the phone (works with no data) and for the web; none without coordinates. */
export function navLinks(card: OfflineCard): { geo: string | null; web: string | null } {
  if (card.lat == null || card.lng == null) return { geo: null, web: null };
  const point = `${card.lat},${card.lng}`;
  const label = card.deliveryAddress ? `(${encodeURIComponent(card.deliveryAddress)})` : "";
  return {
    geo: `geo:${point}?q=${point}${label}`,
    web: `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=driving`,
  };
}

/** The words on a saved card. Honest: it says what is saved on this phone, never that anything will be sent later. */
export function cardCopy(
  card: OfflineCard,
  clock: (ms: number) => string = (ms) =>
    new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
): { ready: string; saved: string; coordinates: string; pinHelp: string } {
  return {
    ready: "Ready offline",
    pinHelp:
      "Show this PIN to the driver only after your load is delivered and checked. ConZ will never ask you for it.",
    saved: `Saved on this phone at ${clock(card.savedAt)}`,
    coordinates:
      card.lat != null && card.lng != null
        ? `${card.lat.toFixed(5)}, ${card.lng.toFixed(5)}`
        : "Map position not saved",
  };
}

/**
 * Which PIN the customer's screen shows. A real answer from the server wins, including "no PIN" (a stale saved PIN must
 * never come back to life). Only a request that failed for lack of signal falls back to the copy saved on this phone.
 */
export function pinForDisplay(i: {
  fetched: string | null;
  networkFailed: boolean;
  cached: string | null;
}): { pin: string | null; failed: boolean } {
  if (!i.networkFailed) return { pin: i.fetched, failed: false };
  return i.cached ? { pin: i.cached, failed: false } : { pin: null, failed: true };
}
