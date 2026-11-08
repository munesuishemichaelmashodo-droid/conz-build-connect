// The other party's name and phone number for a job, kept on this phone so the Call button still works when the
// phone has no data (a driver at a gate in a dead zone can still ring the customer; a call needs voice, not data).
// Kept for the life of a delivery PIN (7 days), per job and per person, and removed at sign-out.

const PREFIX = "conz.contact.";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Contact = { full_name: string | null; phone: string | null };
type Saved = Contact & { at: number };

const key = (jobId: string, otherId: string) => `${PREFIX}${jobId}.${otherId}`;

export function saveContact(
  jobId: string,
  otherId: string,
  contact: Contact,
  storage: Pick<Storage, "setItem"> | null,
  now: number = Date.now(),
) {
  try {
    const value: Saved = {
      full_name: contact.full_name ?? null,
      phone: contact.phone ?? null,
      at: now,
    };
    storage?.setItem(key(jobId, otherId), JSON.stringify(value));
  } catch {
    /* storage unavailable: the live lookup still works while there is signal */
  }
}

export function readContact(
  jobId: string,
  otherId: string,
  storage: Pick<Storage, "getItem"> | null,
  now: number = Date.now(),
): Contact | null {
  try {
    const raw = storage?.getItem(key(jobId, otherId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Saved> | null;
    if (!v || typeof v.at !== "number" || now - v.at > TTL_MS) return null;
    return { full_name: v.full_name ?? null, phone: v.phone ?? null };
  } catch {
    return null;
  }
}

export function clearContacts(storage: Pick<Storage, "length" | "key" | "removeItem"> | null) {
  try {
    if (!storage) return;
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => storage.removeItem(k));
  } catch {
    /* nothing more to do */
  }
}

/**
 * A failed request (no signal, timeout) as opposed to an answer from the database: the client's fetch failures
 * carry no database error code. Real database or permission errors keep their own handling.
 */
export function isNetworkFailure(
  error: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!error) return false;
  if (error.code) return false;
  return /failed to fetch|load failed|network|abort|timed? ?out|fetch/i.test(error.message ?? "");
}
