import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@tanstack/react-router";
import { materialLabel, money, type MaterialCategory } from "@/lib/domain";
import { alertPulse } from "@/components/JobOfferListener";
import { Bell, MapPin, Package, X } from "lucide-react";

type NewJob = {
  id: string;
  material: MaterialCategory;
  custom_material: string | null;
  quantity_m3: number;
  budget: number;
  delivery_address: string;
  status: string;
  customer_id: string;
};

/**
 * Lightweight "a new job was posted" nudge for drivers on the open-bidding flow.
 * Deliberately NOT the 10-second dispatch modal: no countdown, no blocking overlay.
 */
export function NewJobListener() {
  const { userId, is } = useAuth();
  const nav = useNavigate();
  const [job, setJob] = useState<NewJob | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const isDriver = is("driver");

  const show = useCallback((j: NewJob) => {
    if (seen.current.has(j.id)) return;
    seen.current.add(j.id);
    setJob(j);
    alertPulse("nudge");
  }, []);

  useEffect(() => {
    if (!userId || !isDriver) return;
    const ch = supabase
      .channel(`new-open-jobs-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "jobs" },
        (payload) => {
          const j = payload.new as NewJob;
          if (j.status !== "open") return;
          if (j.customer_id === userId) return; // don't nudge yourself
          show(j);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, isDriver, show]);

  // Auto-dismiss after 20s — it's informational only.
  useEffect(() => {
    if (!job) return;
    const t = setTimeout(() => setJob(null), 20_000);
    return () => clearTimeout(t);
  }, [job]);

  if (!job) return null;

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[1100] animate-in slide-in-from-bottom-4 fade-in">
      <div className="sm:w-80 rounded-2xl border-2 border-primary/40 bg-card shadow-xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-semibold text-primary">
            <Bell className="w-3.5 h-3.5" />
            New job posted — open for bids
          </div>
          <button
            onClick={() => setJob(null)}
            aria-label="Dismiss"
            className="w-6 h-6 rounded-full bg-muted hover:bg-muted/70 flex items-center justify-center shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="truncate">
              {materialLabel(job.material, job.custom_material)} · {Number(job.quantity_m3)} m³
            </span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="truncate text-muted-foreground">{job.delivery_address}</span>
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-border">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Offer</span>
            <span className="font-display font-bold text-primary">{money(Number(job.budget))}</span>
          </div>
        </div>

        <Button
          size="sm"
          className="w-full rounded-xl"
          onClick={() => {
            const id = job.id;
            setJob(null);
            nav({ to: "/jobs/$id", params: { id } });
          }}
        >
          View job
        </Button>
        <p className="text-[11px] text-center text-muted-foreground">
          No rush — place a bid whenever you're ready.
        </p>
      </div>
    </div>
  );
}
