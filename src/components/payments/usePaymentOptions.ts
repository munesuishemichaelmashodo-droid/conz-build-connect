import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { paymentOptions, type PaymentOptions } from "@/lib/payonify.functions";

/**
 * Which ways to pay the server offers this user (Paynow, Payonify EcoCash or both). While it
 * loads, or if it can't be read, Paynow alone is shown, as before the switch existed; the
 * server refuses any provider it does not offer, so the screen can't be used to bypass it.
 */
export function usePaymentOptions(): PaymentOptions & { loaded: boolean } {
  const fetchOptions = useServerFn(paymentOptions);
  const { data } = useQuery({
    queryKey: ["payment-options"],
    queryFn: () => fetchOptions(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data
    ? { ...data, loaded: true }
    : { paynow: true, payonify: false, payonifyMode: null, loaded: false };
}

export const ecocashLabel = (mode: PaymentOptions["payonifyMode"]) =>
  mode === "test" ? "EcoCash (Payonify test)" : "EcoCash";

export const ecocashDetail = (mode: PaymentOptions["payonifyMode"]) =>
  mode === "test"
    ? "Test mode: use 0771 111 111 (succeeds) or 0771 111 113 (fails). No real money moves."
    : "Enter your EcoCash number, then approve the payment on your phone with your PIN.";
