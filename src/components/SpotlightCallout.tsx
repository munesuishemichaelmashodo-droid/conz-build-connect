import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { X, Lightbulb } from "lucide-react";

/**
 * Shows a small dismissible callout the first time a user encounters a
 * specific real feature (live tracking, receipts, bidding, Con Z Pay,
 * etc.), right next to that feature rather than in a separate upfront
 * tutorial — someone with zero context understands "this map shows your
 * driver moving" far better when they're actually looking at the map.
 *
 * Backed by profiles.spotlights_seen (jsonb) + mark_spotlight_seen() RPC.
 * Once dismissed for a given id, it never shows again for that user, on
 * any device.
 */
export function SpotlightCallout({ id, title, body }: { id: string; title: string; body: string }) {
  const { userId } = useAuth();
  const qc = useQueryClient();

  const { data: seen } = useQuery({
    queryKey: ["spotlights-seen", userId],
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("spotlights_seen").eq("id", userId!).maybeSingle();
      return (data?.spotlights_seen ?? {}) as Record<string, boolean>;
    },
  });

  if (!userId || !seen || seen[id]) return null;

  const dismiss = async () => {
    qc.setQueryData(["spotlights-seen", userId], { ...seen, [id]: true });
    await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<unknown>)(
      "mark_spotlight_seen",
      { _key: id },
    );
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 flex items-start gap-2.5">
      <Lightbulb className="w-4 h-4 text-primary shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
      </div>
      <button onClick={dismiss} className="text-muted-foreground shrink-0" aria-label="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
