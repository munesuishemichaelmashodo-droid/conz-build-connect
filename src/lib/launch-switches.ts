import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * MVP launch switches (migration 0107). The database enforces them; the app reads them only to
 * show the right screens. If the read fails (offline, or the migration is not applied yet) the
 * app falls back to the restrictive MVP defaults, which can only hide a feature, never expose one.
 */
export type LaunchSwitches = {
  escrowEnabled: boolean;
  withdrawalsEnabled: boolean;
  maxJobBudget: number;
  maxWalletBalance: number;
  minTopup: number;
};

export const DEFAULT_LAUNCH_SWITCHES: LaunchSwitches = {
  escrowEnabled: false,
  withdrawalsEnabled: false,
  maxJobBudget: 500,
  maxWalletBalance: 150,
  minTopup: 1,
};

export function parseLaunchSwitches(raw: unknown): LaunchSwitches {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d;
  return {
    escrowEnabled: r.escrowEnabled === true,
    withdrawalsEnabled: r.withdrawalsEnabled === true,
    maxJobBudget: num(r.maxJobBudget, DEFAULT_LAUNCH_SWITCHES.maxJobBudget),
    maxWalletBalance: num(r.maxWalletBalance, DEFAULT_LAUNCH_SWITCHES.maxWalletBalance),
    minTopup: num(r.minTopup, DEFAULT_LAUNCH_SWITCHES.minTopup),
  };
}

export function useLaunchSwitches(): LaunchSwitches {
  const { data } = useQuery({
    queryKey: ["launch-switches"],
    staleTime: 60_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- launch_switches() is newer than the generated types
      const { data, error } = await (supabase as any).rpc("launch_switches");
      if (error) return DEFAULT_LAUNCH_SWITCHES;
      return parseLaunchSwitches(data);
    },
  });
  return data ?? DEFAULT_LAUNCH_SWITCHES;
}

/**
 * Trust line on the customer home. Escrow (Con Z Pay) is only promised while the
 * escrow switch is on; otherwise the line states something that is always true.
 */
export function customerTrustPill(escrowEnabled: boolean): string {
  return escrowEnabled ? "Escrow protected with Con Z Pay" : "Drivers checked by Con Z";
}
