import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

type Row = { programme: "customer" | "driver"; milestone: number; revoked_at: string | null };

/**
 * Referral recognition on the person's own profile (0185, per programme). Recognition only: not money, credit or
 * a discount, and it does not change which jobs anyone is offered. Hidden until something is earned, or when the
 * table is not there yet.
 */
export function ReferralRecognitionCard() {
  const { userId } = useAuth();
  const q = useQuery({
    queryKey: ["my-referral-recognition", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("referral_programme_milestones" as never)
        .select("programme,milestone,revoked_at")
        .eq("user_id", userId as string);
      if (error) return [] as Row[];
      return (data ?? []) as unknown as Row[];
    },
  });
  const rows = (q.data ?? []).filter((r) => !r.revoked_at);
  if (!rows.length) return null;
  const best = (p: Row["programme"]) =>
    Math.max(0, ...rows.filter((r) => r.programme === p).map((r) => r.milestone));
  const parts = (["customer", "driver"] as const)
    .filter((p) => best(p) > 0)
    .map((p) => `${best(p)}+ recognised ${p} referral${best(p) === 1 ? "" : "s"}`);
  return (
    <section
      className="rounded-2xl border bg-card p-4 flex items-center gap-3"
      data-testid="referral-recognition"
    >
      <Trophy className="w-5 h-5 text-cz-amber-text shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm">Helping Con Z grow</p>
        <p className="text-xs text-muted-foreground">{parts.join(" · ")}</p>
      </div>
      <Link to="/refer" className="text-xs font-semibold underline shrink-0">
        Invite
      </Link>
    </section>
  );
}
