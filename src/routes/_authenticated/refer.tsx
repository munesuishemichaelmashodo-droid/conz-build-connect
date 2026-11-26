import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/ui-bits";
import {
  Copy,
  Share2,
  Users,
  Trophy,
  MessageCircle,
  CheckCircle2,
  Info,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isNativePlatform } from "@/lib/native-push";
import {
  INVITE_COPY,
  MILESTONES,
  RULES,
  STAGE_LABEL,
  invitedLabel,
  inviteLink,
  milestoneLabel,
  monthLabel,
  nextMilestone,
  progressFraction,
  progressLine,
  type InviteRole,
  type ReferralProgressRow,
} from "@/lib/referral-copy";

export const Route = createFileRoute("/_authenticated/refer")({
  component: InvitePage,
});

type Rpc = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const callRpc = (name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as Rpc)(name, args);

type MilestoneRow = { milestone: number; achieved_at: string; revoked_at: string | null };
type ShareChannel = "whatsapp" | "share_sheet" | "copy_link" | "copy_code";

const STAGE_TONE: Record<string, string> = {
  in_progress: "bg-muted text-muted-foreground border-border",
  qualified: "bg-warning/15 text-warning border-warning/30",
  recognised: "bg-success/15 text-success border-success/30",
  not_recognised: "bg-muted text-muted-foreground border-border",
  being_checked: "bg-muted text-muted-foreground border-border",
};

function InvitePage() {
  const { profile, userId, is } = useAuth();
  const role: InviteRole = is("driver") ? "driver" : "customer";
  const copyText = INVITE_COPY[role];

  const progressQuery = useQuery({
    queryKey: ["my-referral-progress", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await callRpc("my_referral_progress");
      if (error) throw error;
      return (data ?? []) as ReferralProgressRow[];
    },
  });

  const milestonesQuery = useQuery({
    queryKey: ["my-referral-milestones", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("referral_milestones_achieved")
        .select("*")
        .eq("user_id", userId as string);
      if (error) throw error;
      return (data ?? []) as unknown as MilestoneRow[];
    },
  });

  const rows = progressQuery.data ?? [];
  const milestones = milestonesQuery.data ?? [];
  const earned = new Set(milestones.filter((m) => !m.revoked_at).map((m) => m.milestone));
  const withdrawn = new Set(milestones.filter((m) => m.revoked_at).map((m) => m.milestone));
  const counted = rows.filter((r) => r.stage === "recognised").length;
  const inProgress = rows.filter(
    (r) => r.stage === "in_progress" || r.stage === "qualified",
  ).length;
  const next = nextMilestone(counted);

  const code = profile?.referral_code ?? null;
  const link = code ? inviteLink(window.location.origin, code) : "";

  const logShare = (channel: ShareChannel) => {
    // Counting only: a failed count never stops the share.
    void callRpc("record_referral_share", { _channel: channel }).catch(() => undefined);
  };

  const copy = async (text: string, label: string, channel: ShareChannel) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
      logShare(channel);
    } catch {
      toast.error("Couldn't copy. Press and hold to copy it instead.");
    }
  };

  const shareWhatsapp = async () => {
    if (!link) return;
    const url = `https://wa.me/?text=${encodeURIComponent(copyText.share(link))}`;
    logShare("whatsapp");
    // window.open is ignored inside the Android WebView; Browser.open hands the link to WhatsApp there
    // and opens a normal tab on the web.
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
  };

  const shareSheet = async () => {
    if (!link) return;
    const text = copyText.share(link);
    if (isNativePlatform()) {
      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({ title: "Join Con Z", text, dialogTitle: "Send your invitation" });
        logShare("share_sheet");
        return;
      } catch {
        /* cancelled: fall back to copying */
      }
    } else if (navigator.share) {
      try {
        await navigator.share({ title: "Join Con Z", text });
        logShare("share_sheet");
        return;
      } catch {
        return; // the person closed the share sheet
      }
    }
    void copy(link, "Invitation link", "copy_link");
  };

  return (
    <AppShell title="Invite">
      <div className="space-y-5">
        {/* Invitation card */}
        <section
          className="rounded-2xl border bg-card p-5 shadow-sm space-y-4"
          aria-labelledby="invite-title"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary/15 p-2.5 text-cz-amber-text">
              <UserPlus className="w-5 h-5" aria-hidden />
            </div>
            <div>
              <h2 id="invite-title" className="font-display font-bold text-lg leading-tight">
                {copyText.title}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">{copyText.lead}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Your invitation link</p>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm" data-testid="invite-link">
                {link || "Preparing your link…"}
              </span>
              <button
                onClick={() => link && copy(link, "Invitation link", "copy_link")}
                disabled={!link}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-muted disabled:opacity-50"
                aria-label="Copy invitation link"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={shareWhatsapp}
              disabled={!link}
              className="col-span-2 flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-[#25D366] text-black py-2 text-sm font-semibold disabled:opacity-50"
            >
              <MessageCircle className="w-4 h-4" aria-hidden /> Send on WhatsApp
            </button>
            <button
              onClick={shareSheet}
              disabled={!link}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              <Share2 className="w-4 h-4" aria-hidden /> Share
            </button>
            <button
              onClick={() => code && copy(code, "Invitation code", "copy_code")}
              disabled={!code}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
            >
              <Copy className="w-4 h-4" aria-hidden /> Code {code ?? ""}
            </button>
          </div>
        </section>

        {/* Why and what they get */}
        <section className="grid gap-3 sm:grid-cols-2">
          <ListCard title="Why invite them" items={copyText.why} />
          <ListCard title="What they get" items={copyText.theyGet} />
        </section>

        {/* Invitations and their progress */}
        <section className="space-y-2" aria-labelledby="progress-title">
          <div className="flex items-end justify-between gap-2">
            <h3 id="progress-title" className="font-semibold text-sm">
              Your invitations
            </h3>
            <p className="text-xs text-muted-foreground">
              {rows.length} joined · {inProgress} on their way · {counted} counted
            </p>
          </div>
          {progressQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : progressQuery.isError ? (
            <p className="text-xs text-muted-foreground">
              Your invitations could not be loaded. Check your signal and try again.
            </p>
          ) : !rows.length ? (
            <EmptyState
              icon={Users}
              title="No one has joined with your link yet"
              hint="When someone joins, you will see how far they have got here."
            />
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.ref_key} className="rounded-xl border bg-card p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{invitedLabel(r.invited_as)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Joined {monthLabel(r.joined_month)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                        STAGE_TONE[r.stage] ?? STAGE_TONE.in_progress,
                      )}
                    >
                      {STAGE_LABEL[r.stage] ?? r.stage}
                    </span>
                  </div>
                  <div
                    className="h-1.5 rounded-full bg-muted overflow-hidden"
                    role="progressbar"
                    aria-label={`${invitedLabel(r.invited_as)} progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progressFraction(r) * 100)}
                  >
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${progressFraction(r) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{progressLine(r)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recognition */}
        <section
          className="rounded-xl border bg-card p-4 space-y-3"
          aria-labelledby="recognition-title"
        >
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-cz-amber-text" aria-hidden />
            <h3 id="recognition-title" className="font-semibold text-sm">
              Your recognition
            </h3>
          </div>
          <ul className="grid grid-cols-5 gap-1.5">
            {MILESTONES.map((m) => (
              <li
                key={m}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border py-2 text-[11px] font-semibold",
                  earned.has(m)
                    ? "border-primary bg-primary/10 text-cz-amber-text"
                    : "text-muted-foreground",
                )}
                aria-label={`${milestoneLabel(m)}: ${earned.has(m) ? "earned" : withdrawn.has(m) ? "withdrawn" : "not yet"}`}
              >
                <Trophy
                  className={cn(
                    "w-4 h-4",
                    earned.has(m) ? "text-cz-amber-text" : "text-muted-foreground/40",
                  )}
                  aria-hidden
                />
                {m}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {counted === 0
              ? "Your first milestone appears when one of your invitations counts."
              : next
                ? `${counted} counted. ${next - counted} more to reach ${next}.`
                : "You have reached every milestone. Thank you for helping Con Z grow."}
          </p>
          {withdrawn.size > 0 && (
            <p className="text-xs text-muted-foreground">
              A milestone was withdrawn because an invitation it counted did not meet the rules
              after review.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Only you can see this. It is separate from ratings and driver levels.
          </p>
        </section>

        {/* Rules */}
        <section className="rounded-xl border bg-card p-4 space-y-2" aria-labelledby="rules-title">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" aria-hidden />
            <h3 id="rules-title" className="font-semibold text-sm">
              How invitations count
            </h3>
          </div>
          <p className="text-sm">{copyText.counts}</p>
          <ul className="space-y-1.5">
            {RULES.map((rule) => (
              <li key={rule} className="flex gap-2 text-xs text-muted-foreground">
                <span aria-hidden>•</span>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="font-semibold text-sm mb-2">{title}</h3>
      <ul className="space-y-2">
        {items.map((t) => (
          <li key={t} className="flex gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-success" aria-hidden />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
