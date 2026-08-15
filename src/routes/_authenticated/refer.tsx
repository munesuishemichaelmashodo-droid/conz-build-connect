import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { StatusBadge, EmptyState } from "@/components/ui-bits";
import { money } from "@/lib/domain";
import { Gift, Copy, Share2, Users, Clock, CheckCircle2, Trophy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/refer")({
  component: ReferPage,
});

const MILESTONES = [1, 5, 10, 25, 50];

type ReferralRow = {
  id: string;
  referred_id: string;
  referred_role: string;
  verification_status: string;
  reward_status: string;
  reward_amount: number | null;
  created_at: string;
};

const REWARD_STATUS_TONE: Record<string, string> = {
  pending: "bg-muted text-muted-foreground border-border",
  hold: "bg-warning/15 text-warning border-warning/30",
  approved: "bg-secondary/15 text-secondary-foreground border-secondary/30",
  released: "bg-success/15 text-success border-success/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  frozen: "bg-destructive/15 text-destructive border-destructive/30",
};

function ReferPage() {
  const { profile, userId } = useAuth();

  const referralsQuery = useQuery({
    queryKey: ["my-referrals", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("referrals")
        .select("id,referred_id,referred_role,verification_status,reward_status,reward_amount,created_at")
        .eq("referrer_id", userId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReferralRow[];
    },
  });

  const milestonesQuery = useQuery({
    queryKey: ["my-referral-milestones", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("referral_milestones_achieved")
        .select("milestone")
        .eq("user_id", userId as string);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.milestone));
    },
  });

  const referrals = referralsQuery.data ?? [];
  const achieved = milestonesQuery.data ?? new Set<number>();

  const releasedCount = referrals.filter((r) => r.reward_status === "released").length;
  const pendingCount = referrals.filter((r) => ["pending", "hold", "approved"].includes(r.reward_status)).length;
  const earnedTotal = referrals
    .filter((r) => r.reward_status === "released")
    .reduce((sum, r) => sum + (r.reward_amount ?? 0), 0);
  const pendingTotal = referrals
    .filter((r) => ["hold", "approved"].includes(r.reward_status))
    .reduce((sum, r) => sum + (r.reward_amount ?? 0), 0);

  const code = profile?.referral_code;
  const link = code ? `${window.location.origin}/auth?mode=register&ref=${code}` : "";

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Couldn't copy — copy it manually");
    }
  };

  const shareWhatsapp = () => {
    const msg = `Join Con Z Connect and get materials delivered fast! Use my referral code ${code} when you sign up: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank");
  };

  const shareGeneric = async () => {
    if (navigator.share && code) {
      try {
        await navigator.share({ title: "Join Con Z Connect", text: `Use my referral code ${code}`, url: link });
      } catch {
        /* user cancelled */
      }
    } else {
      copy(link, "Referral link");
    }
  };

  const nextMilestone = MILESTONES.find((m) => !achieved.has(m)) ?? null;
  const prevMilestone = [...MILESTONES].reverse().find((m) => achieved.has(m)) ?? 0;
  const progressPct = nextMilestone
    ? Math.min(100, ((releasedCount - prevMilestone) / (nextMilestone - prevMilestone)) * 100)
    : 100;

  return (
    <AppShell title="Refer & Earn">
      <div className="space-y-5">
        {/* Referral code card */}
        <div className="rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground p-5 shadow-lift relative overflow-hidden">
          <Gift className="absolute -right-3 -bottom-3 w-24 h-24 opacity-15" />
          <p className="text-xs uppercase tracking-wider opacity-80 font-semibold">Your referral code</p>
          <p className="font-display font-black text-3xl tracking-wide mt-1">{code ?? "…"}</p>
          <p className="text-sm opacity-90 mt-2">
            Share it with friends. You earn when they complete their first job — they get a bonus too.
          </p>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button
              onClick={() => code && copy(code, "Referral code")}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-white/15 hover:bg-white/25 py-2 text-sm font-semibold"
            >
              <Copy className="w-4 h-4" /> Copy code
            </button>
            <button
              onClick={shareGeneric}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-white/15 hover:bg-white/25 py-2 text-sm font-semibold"
            >
              <Share2 className="w-4 h-4" /> Share link
            </button>
          </div>
          <button
            onClick={shareWhatsapp}
            className="w-full mt-2 flex items-center justify-center gap-1.5 rounded-lg bg-[#25D366] text-black py-2 text-sm font-semibold"
          >
            <MessageCircle className="w-4 h-4" /> Share on WhatsApp
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard icon={Users} label="Total referrals" value={String(referrals.length)} />
          <StatCard icon={Clock} label="Pending" value={String(pendingCount)} />
          <StatCard icon={CheckCircle2} label="Earned" value={money(earnedTotal)} tone="text-success" />
          <StatCard icon={Gift} label="Pending value" value={money(pendingTotal)} tone="text-warning" />
        </div>

        {/* Milestones */}
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-4 h-4 text-primary" />
            <h3 className="font-display font-bold text-sm uppercase tracking-wide">Milestones</h3>
          </div>
          <div className="flex gap-2 mb-3">
            {MILESTONES.map((m) => (
              <div
                key={m}
                className={cn(
                  "flex-1 flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] font-semibold",
                  achieved.has(m) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
                )}
              >
                <Trophy className={cn("w-4 h-4", achieved.has(m) ? "text-primary" : "text-muted-foreground/40")} />
                {m}
              </div>
            ))}
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            {nextMilestone
              ? `${releasedCount}/${nextMilestone} released referrals to your next badge`
              : "You've hit every milestone — ambassador status unlocked!"}
          </p>
        </div>

        {/* History */}
        <div className="space-y-2">
          <h3 className="font-display font-bold text-sm uppercase tracking-wide">Referral history</h3>
          {referralsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : !referrals.length ? (
            <EmptyState icon={Gift} title="No referrals yet" hint="Share your code above to start earning." />
          ) : (
            <div className="space-y-2">
              {referrals.map((r) => (
                <div key={r.id} className="rounded-xl border bg-card p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold capitalize">{r.referred_role} referral</p>
                    <p className="text-[11px] text-muted-foreground">
                      Joined {new Date(r.created_at).toLocaleDateString()} · {r.verification_status}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {r.reward_amount != null && (
                      <p className="text-sm font-semibold">{money(r.reward_amount)}</p>
                    )}
                    <StatusBadge label={r.reward_status} className={REWARD_STATUS_TONE[r.reward_status]} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <Icon className={cn("w-4 h-4 mb-1", tone ?? "text-muted-foreground")} />
      <p className={cn("font-display font-bold text-lg", tone)}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}
