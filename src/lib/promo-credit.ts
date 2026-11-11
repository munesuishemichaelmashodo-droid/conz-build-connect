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

export function usePromoCredit(): PromoCredit {
  const { data } = useQuery({
    queryKey: ["promo-credit-public"],
    staleTime: 60_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- promo_credit_public() is newer than the generated types
      const { data, error } = await (supabase as any).rpc("promo_credit_public");
      if (error) return DEFAULT_PROMO_CREDIT;
      return parsePromoCredit(data);
    },
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

const LEGACY: { re: RegExp; to: (amount: number) => string }[] = [
  {
    re: /Your first completed job has no Con Z commission\. After that the commission is/g,
    to: (a) => `${promoCreditSentence(a)} The commission is`,
  },
  { re: /Your first completed job has no commission\./g, to: (a) => promoCreditSentence(a) },
  { re: /Your first completed job is commission-free\./g, to: (a) => promoCreditSentence(a) },
  {
    re: /\(your first completed job has no commission\)/g,
    to: () => "(promotional credit is spent first)",
  },
];

/** Replaces the legacy "first job free" phrases only once the credit is switched on. Other text is returned as is. */
export function promoCopy(text: string, promo: PromoCredit): string {
  if (!promo.enabled) return text;
  return LEGACY.reduce((t, { re, to }) => t.replace(re, to(promo.amount)), text);
}
