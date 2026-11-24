import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The one-time promotional commission credit (migration 0134, owner decision 09/11/2026: demo money that replaces
 * the free first job). It is not cash, cannot be withdrawn or transferred, and can only pay Con Z commission.
 * The database tells everyone, including signed-out visitors, whether it is on: until it is switched on the
 * wording stays as it was, so the app can be deployed before the database step. If the read fails the wording
 * stays as it was, which can only under-promise.
 */
export type PromoCredit = { enabled: boolean; amount: number };

export const DEFAULT_PROMO_CREDIT: PromoCredit = { enabled: false, amount: 20 };

export function parsePromoCredit(raw: unknown): PromoCredit {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const amount =
    typeof r.amount === "number" && Number.isFinite(r.amount) && r.amount > 0 && r.amount <= 1000
      ? r.amount
      : DEFAULT_PROMO_CREDIT.amount;
  return { enabled: r.enabled === true, amount };
}

/** Reads the public switch. null when it cannot be read (network, database). */
export async function fetchPromoCredit(): Promise<PromoCredit | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- promo_credit_public() is newer than the generated types
    const { data, error } = await (supabase as any).rpc("promo_credit_public");
    if (error) return null;
    return parsePromoCredit(data);
  } catch {
    return null;
  }
}

/**
 * The switch, for a screen. `initial` is what a route loader already read on the server, so the first HTML
 * and the browser agree; without it the screen starts from "off" and updates once the read arrives.
 */
export function usePromoCredit(initial?: PromoCredit | null): PromoCredit {
  const { data } = useQuery({
    queryKey: ["promo-credit-public"],
    staleTime: 60_000,
    initialData: initial ?? undefined,
    queryFn: async () => (await fetchPromoCredit()) ?? DEFAULT_PROMO_CREDIT,
  });
  return data ?? DEFAULT_PROMO_CREDIT;
}

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** The plain-language sentence that replaces "your first job is free". */
export function promoCreditSentence(amount: number): string {
  return `When you are verified you get a one-time ${money(amount)} commission credit. It can only pay Con Z commission: it is not cash and cannot be withdrawn or transferred.`;
}

/** What the Terms say about it (legal wording: for the owner's lawyer to review). */
export function promoCreditTerms(amount: number): string {
  return `Each newly verified Driver receives a one-time promotional commission credit of ${money(amount)}. It can only be used to pay Con Z commission, has no cash value, and cannot be withdrawn or transferred.`;
}

// The free first job was retired on 09/11/2026 (owner decision), so these phrases are never shown as written:
// with the credit on they become the credit sentence; while it is off, or not read yet (the first HTML), they are
// dropped, which can only under-promise.
const LEGACY: { re: RegExp; on: (amount: number) => string; off: string }[] = [
  {
    re: /Your first completed job has no Con Z commission\. After that the commission is/g,
    on: (a) => `${promoCreditSentence(a)} The commission is`,
    off: "The commission is",
  },
  {
    re: /Your first completed job has no commission\. After that, Con Z commission is/g,
    on: (a) => `${promoCreditSentence(a)} Con Z commission is`,
    off: "Con Z commission is",
  },
  {
    re: /Your first completed job has no commission\.\s*/g,
    on: (a) => `${promoCreditSentence(a)} `,
    off: "",
  },
  {
    re: /Your first completed job is commission-free\./g,
    on: (a) => promoCreditSentence(a),
    off: "",
  },
  {
    re: /Your first completed job has no Con Z commission\.\s*/g,
    on: (a) => `${promoCreditSentence(a)} `,
    off: "",
  },
  {
    re: /\s*\(your first completed job has no commission\)/g,
    on: () => " (promotional credit is spent first)",
    off: "",
  },
];

/** Replaces the retired "first job free" phrases: the credit sentence when it is on, nothing otherwise. */
export function promoCopy(text: string, promo: PromoCredit): string {
  return LEGACY.reduce(
    (t, { re, on, off }) => t.replace(re, promo.enabled ? on(promo.amount) : off),
    text,
  ).trim();
}
