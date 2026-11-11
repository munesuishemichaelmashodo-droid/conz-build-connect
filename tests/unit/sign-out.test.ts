import { describe, expect, it } from "vitest";
import { clearDeviceData } from "@/lib/sign-out";
import {
  buildOfflineCard,
  readOfflineCard,
  readPin,
  saveOfflineCard,
  savePin,
} from "@/lib/offline-card";
import { readContact, saveContact } from "@/lib/contact-cache";

const mem = () => {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

describe("clearDeviceData (sign-out, including with no signal, on a shared phone)", () => {
  it("removes saved cards, PINs and saved phone numbers, and nothing else", () => {
    const s = mem();
    const card = buildOfflineCard({
      job: { id: "j1", delivery_address: "Harward Road", status: "in_progress" },
      materialName: "River sand",
      contact: { full_name: "Rudo", phone: "263771000001" },
      role: "customer",
      now: 1_000,
    })!;
    saveOfflineCard(card, s);
    savePin("j1", "482917", s, 1_000);
    saveContact("j1", "d1", { full_name: "Farai", phone: "263771000002" }, s, 1_000);
    s.setItem("conz.locationSharingEnabled", "true");
    clearDeviceData(s);
    expect(readOfflineCard("j1", s, 2_000)).toBeNull();
    expect(readPin("j1", s, 2_000)).toBeNull();
    expect(readContact("j1", "d1", s, 2_000)).toBeNull();
    expect(s.getItem("conz.locationSharingEnabled")).toBe("true");
  });
  it("never throws on missing or broken storage", () => {
    expect(() => clearDeviceData(null)).not.toThrow();
  });
});
