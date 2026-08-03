import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { materialLabel, money } from "@/lib/domain";
import { MapPin, Package, Truck, X, Loader2 } from "lucide-react";

type Offer = {
  id: string;
  job_id: string;
  driver_id: string;
  status: string;
  offered_at: string;
  expires_at: string;
};

type Job = {
  id: string;
  material: string;
  custom_material: string | null;
  quantity_m3: number;
  budget: number;
  delivery_address: string;
};

const WINDOW_MS = 10_000;

/**
 * Short beep via WebAudio; also vibrate if supported.
 * `variant`:
 *  - "dispatch" (default): urgent falling two-tone, long buzz — "accept now or lose it"
 *  - "nudge": softer rising two-tone, short double tap — "come look at this"
 */
export function alertPulse(variant: "dispatch" | "nudge" = "dispatch") {
  const nudge = variant === "nudge";
  try {
    if ("vibrate" in navigator) navigator.vibrate(nudge ? [60, 60, 60] : [200, 100, 200]);
  } catch {}
  try {
    const Ctx =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = nudge ? "triangle" : "sine";
    o.frequency.value = nudge ? 523 : 880;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(nudge ? 0.16 : 0.3, ctx.currentTime);
    o.start();
    o.frequency.setValueAtTime(nudge ? 784 : 660, ctx.currentTime + 0.12);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (nudge ? 0.35 : 0.5));
    o.stop(ctx.currentTime + (nudge ? 0.4 : 0.55));
  } catch {}
}


export function JobOfferListener() {
  const { userId, is } = useAuth();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const seenIds = useRef<Set<string>>(new Set());

  const isDriver = is("driver");

  const loadJob = useCallback(async (jobId: string) => {
    const { data } = await supabase
      .from("jobs")
      .select("id,material,custom_material,quantity_m3,budget,delivery_address")
      .eq("id", jobId)
      .maybeSingle();
    if (data) setJob(data as Job);
  }, []);

  const openOffer = useCallback(
    (o: Offer) => {
      if (seenIds.current.has(o.id)) return;
      // ignore if already expired
      if (new Date(o.expires_at).getTime() < Date.now()) return;
      seenIds.current.add(o.id);
      setOffer(o);
      setJob(null);
      loadJob(o.job_id);
      alertPulse();
    },
    [loadJob],
  );

  // Pick up any already-pending offers on mount (e.g. after refresh)
  useEffect(() => {
    if (!userId || !isDriver) return;
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("job_dispatch_offers")
        .select("*")
        .eq("driver_id", userId)
        .eq("status", "pending")
        .gte("expires_at", new Date().toISOString())
        .order("offered_at", { ascending: false })
        .limit(1);
      if (!cancelled && data?.[0]) openOffer(data[0] as Offer);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, isDriver, openOffer]);

  // Realtime subscription
  useEffect(() => {
    if (!userId || !isDriver) return;
    const ch = supabase
      .channel(`offers-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "job_dispatch_offers",
          filter: `driver_id=eq.${userId}`,
        },
        (payload) => {
          const o = payload.new as Offer;
          if (o.status === "pending") openOffer(o);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "job_dispatch_offers",
          filter: `driver_id=eq.${userId}`,
        },
        (payload) => {
          const o = payload.new as Offer;
          // If current offer was superseded/accepted elsewhere, close it
          setOffer((cur) => (cur && cur.id === o.id && o.status !== "pending" ? null : cur));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, isDriver, openOffer]);

  if (!offer) return null;
  return (
    <OfferModal
      offer={offer}
      job={job}
      onClose={() => setOffer(null)}
    />
  );
}

function OfferModal({
  offer,
  job,
  onClose,
}: {
  offer: Offer;
  job: Job | null;
  onClose: () => void;
}) {
  const nav = useNavigate();
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, new Date(offer.expires_at).getTime() - Date.now()),
  );
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      const r = Math.max(0, new Date(offer.expires_at).getTime() - Date.now());
      setRemaining(r);
      if (r <= 0) {
        clearInterval(id);
        // Ask server to expire + trigger next wave (best-effort)
        (supabase as any)
          .rpc("expire_stale_dispatch_offers", { _job_id: offer.job_id })
          .then(() => undefined);
        toast("Job offer expired — sending to next driver…");
        onClose();
      }
    }, 100);
    return () => clearInterval(id);
  }, [offer.expires_at, offer.job_id, onClose]);

  const secondsLeft = Math.ceil(remaining / 1000);
  const pct = Math.max(0, Math.min(1, remaining / WINDOW_MS));

  // Colour bands per the design guide.
  const color =
    secondsLeft >= 8
      ? "#22c55e" // green
      : secondsLeft >= 5
      ? "#84cc16" // lime
      : secondsLeft >= 2
      ? "#f97316" // orange
      : "#ef4444"; // red

  const accept = async () => {
    setAccepting(true);
    const { data, error } = await (supabase as any).rpc("accept_dispatch_offer", {
      _offer_id: offer.id,
    });
    setAccepting(false);
    if (error) {
      const msg = error.message ?? "Could not accept";
      if (/insufficient wallet balance/i.test(msg)) {
        toast.error("Wallet too low to accept — top up first");
        onClose();
        nav({ to: "/wallet" });
        return;
      }
      toast.error(msg);
      onClose();
      return;
    }
    toast.success("Job accepted!");
    onClose();
    if (data) nav({ to: "/jobs/$id", params: { id: String(data) } });
  };


  const R = 70;
  const C = 2 * Math.PI * R;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-sm p-0 overflow-hidden bg-gradient-to-b from-neutral-900 to-black text-white border-none">
        <DialogTitle className="sr-only">New job request</DialogTitle>
        <div className="p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-primary font-semibold">
              New job request
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {job && (
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2 text-sm">
              <Row icon={Package} label={materialLabel(job.material as any, job.custom_material)} value={`${Number(job.quantity_m3)} m³`} />
              <Row icon={MapPin} label="Delivery to" value={job.delivery_address} />
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <span className="text-xs text-white/60 uppercase tracking-widest">Trip value</span>
                <span className="font-display font-bold text-primary text-lg">{money(Number(job.budget))}</span>
              </div>
            </div>
          )}

          {/* Circular countdown */}
          <div className="relative mx-auto w-40 h-40">
            <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
              <circle cx="80" cy="80" r={R} stroke="rgba(255,255,255,0.1)" strokeWidth="10" fill="none" />
              <circle
                cx="80"
                cy="80"
                r={R}
                stroke={color}
                strokeWidth="10"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={C}
                strokeDashoffset={C * (1 - pct)}
                style={{ transition: "stroke-dashoffset 100ms linear, stroke 300ms" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="font-display font-bold text-5xl" style={{ color }}>
                {secondsLeft}
              </div>
              <div className="text-[10px] uppercase tracking-widest text-white/60">seconds</div>
            </div>
          </div>

          {/* Shrinking bar */}
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct * 100}%`,
                background: color,
                transition: "width 100ms linear, background 300ms",
              }}
            />
          </div>

          <Button
            onClick={accept}
            disabled={accepting || secondsLeft <= 0}
            className="w-full h-14 rounded-2xl font-display uppercase tracking-wide text-base"
          >
            {accepting ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Truck className="w-5 h-5 mr-2" /> Accept job
              </>
            )}
          </Button>
          <p className="text-[11px] text-center text-white/50">
            Accept quickly — after 10 seconds this goes to the next driver.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-white/60 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-white/50">{label}</div>
        <div className="text-sm truncate">{value}</div>
      </div>
    </div>
  );
}
