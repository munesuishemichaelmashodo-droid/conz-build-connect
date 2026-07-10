import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Sweeps stale open jobs (>10s old) every 3s while mounted. */
export function useExpireStaleJobs(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        await (supabase as any).rpc("expire_stale_open_jobs");
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled]);
}
