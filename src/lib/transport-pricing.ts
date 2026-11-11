import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** True only when the owner has turned delivery-only pricing on. Any error means off. */
export function useTransportPricingEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ["transport-pricing-enabled"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 0158 function is newer than the generated types
      const { data, error } = await (supabase as any).rpc("transport_pricing_enabled");
      return !error && data === true;
    },
  });
  return data === true;
}
