import { describe, expect, it } from "vitest";
import { clearContacts, isNetworkFailure, readContact, saveContact } from "@/lib/contact-cache";

const mem = () => {
  const m = new Map<string, string>();
  return {
    get size() {
      return m.size;
    },
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
const DAY = 86_400_000;

describe("contact cache", () => {
  it("remembers the other party's name and number for this job, so Call works with no data", () => {
    const s = mem();
    saveContact("j1", "d1", { full_name: "Farai M", phone: "263771000002" }, s, 1_000);
    expect(readContact("j1", "d1", s, 2_000)).toEqual({
      full_name: "Farai M",
      phone: "263771000002",
    });
  });
  it("is per job and per person", () => {
    const s = mem();
    saveContact("j1", "d1", { full_name: "A", phone: "1" }, s, 0);
    expect(readContact("j2", "d1", s, 1)).toBeNull();
    expect(readContact("j1", "d2", s, 1)).toBeNull();
  });
  it("forgets after seven days (the life of a delivery PIN)", () => {
    const s = mem();
    saveContact("j1", "d1", { full_name: "A", phone: "1" }, s, 0);
    expect(readContact("j1", "d1", s, 7 * DAY - 1)).not.toBeNull();
    expect(readContact("j1", "d1", s, 7 * DAY + 1)).toBeNull();
  });
  it("never stores a missing number as if it were one", () => {
    const s = mem();
    saveContact("j1", "d1", { full_name: "A", phone: null }, s, 0);
    expect(readContact("j1", "d1", s, 1)).toEqual({ full_name: "A", phone: null });
  });
  it("clears everything on sign-out and leaves other keys alone", () => {
    const s = mem();
    saveContact("j1", "d1", { full_name: "A", phone: "1" }, s, 0);
    s.setItem("unrelated", "x");
    clearContacts(s);
    expect(readContact("j1", "d1", s, 1)).toBeNull();
    expect(s.getItem("unrelated")).toBe("x");
  });
  it("survives blocked or broken storage", () => {
    const broken = {
      length: 1,
      key: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => saveContact("j1", "d1", { full_name: "A", phone: "1" }, broken, 0)).not.toThrow();
    expect(readContact("j1", "d1", broken, 1)).toBeNull();
    expect(() => clearContacts(broken)).not.toThrow();
    expect(readContact("j1", "d1", null, 1)).toBeNull();
  });
  it("tolerates a corrupted entry", () => {
    const s = mem();
    s.setItem("conz.contact.j1.d1", "{nope");
    expect(readContact("j1", "d1", s, 1)).toBeNull();
  });
});

describe("isNetworkFailure", () => {
  it("is true for the client's fetch failures, which carry no database error code", () => {
    expect(isNetworkFailure({ message: "TypeError: Failed to fetch", code: "" })).toBe(true);
    expect(isNetworkFailure({ message: "Load failed" })).toBe(true);
    expect(isNetworkFailure({ message: "NetworkError when attempting to fetch resource." })).toBe(
      true,
    );
    expect(isNetworkFailure({ message: "signal is aborted without reason" })).toBe(true);
  });
  it("is false for real database or permission errors, which keep their old graceful handling", () => {
    expect(
      isNetworkFailure({ message: "permission denied for table profiles", code: "42501" }),
    ).toBe(false);
    expect(
      isNetworkFailure({ message: "column profiles.phone does not exist", code: "42703" }),
    ).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
  });
});
