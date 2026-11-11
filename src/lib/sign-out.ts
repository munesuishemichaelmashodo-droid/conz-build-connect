import { clearContacts } from "@/lib/contact-cache";
import { clearOfflineData } from "@/lib/offline-card";

/**
 * Everything kept on this phone for no-signal moments (saved cards, delivery PINs, the other person's number). Call it
 * BEFORE signing out: with no signal the sign-out request fails and the "signed out" event never fires, and on a shared
 * phone the next person must not find the last person's delivery.
 */
export function clearDeviceData(
  storage: Pick<Storage, "length" | "key" | "removeItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
) {
  clearContacts(storage);
  clearOfflineData(storage);
}
