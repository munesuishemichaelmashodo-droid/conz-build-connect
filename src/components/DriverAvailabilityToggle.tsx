import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MapPin, MapPinOff, Loader2 } from "lucide-react";
import { availabilityValues, saveAvailability, type SaveResult } from "@/lib/driver-reach";

/**
 * The driver's Online / Offline switch. Saves the driver's own row in
 * driver_availability with their approximate position. Automatic dispatch
 * (migration 0089) only offers jobs to drivers who are online with a position
 * under 15 minutes old, so a save that fails is always reported, never hidden.
 *
 * Separate from the profiles.last_active_at "app open" presence heartbeat,
 * which keeps running regardless of this switch.
 */
export function DriverAvailabilityToggle({ variant = "button" }: { variant?: "button" | "pill" } = {}) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [isAvailable, setIsAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const intervalRef = useRef<number | null>(null);
  // One warning per run of failed heartbeats, not one every 45 seconds.
  const beatFailedRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("driver_availability")
      .select("is_available")
      .eq("driver_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setIsAvailable(!!data?.is_available);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Saves the driver's own row, with a position when the phone gives one, and
  // reports whether the save worked. Nothing is shown as saved until it is.
  const pushLocation = async (
    available: boolean,
    { heartbeat = false } = {},
  ): Promise<SaveResult & { noPosition?: boolean; skipped?: boolean }> => {
    if (!userId) return { ok: false, message: "Sign in again to change your status." };
    const position = available ? await currentPosition() : null;
    // A heartbeat with no fix saves nothing: the last real position stays and
    // simply ages out after 15 minutes, instead of being wiped by a brief GPS gap.
    if (heartbeat && !position) return { ok: true, skipped: true };
    const res = await saveAvailability(
      supabase,
      availabilityValues(userId, available, position, new Date().toISOString()),
    );
    // The driver home reads the same row for "Getting offers near you".
    void queryClient.invalidateQueries({ queryKey: ["driver-fix", userId] });
    if (res.ok && available && !position) {
      return { ...res, noPosition: true };
    }
    return res;
  };

  const toggle = async () => {
    if (!userId || busy) return;
    setBusy(true);
    const next = !isAvailable;
    const res = await pushLocation(next);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.message);
      return;
    }
    beatFailedRef.current = false;
    setIsAvailable(next);
    if ("noPosition" in res && res.noPosition) {
      toast.error("You're online, but Con Z can't see your location yet. Allow location to get nearby offers.");
    } else {
      toast.success(next ? "You're online" : "You're offline");
    }
  };

  // Heartbeat while available and the app is in front — same ~45s cadence as
  // the presence heartbeat (src/lib/auth.tsx). Dispatch only offers jobs to
  // drivers whose position is under 15 minutes old (migration 0089).
  useEffect(() => {
    if (!isAvailable || !userId) {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      return;
    }
    const beat = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await pushLocation(true, { heartbeat: true });
      if (!res.ok && !beatFailedRef.current) toast.error(res.message);
      beatFailedRef.current = !res.ok;
    };
    intervalRef.current = window.setInterval(beat, 45_000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAvailable, userId]);

  if (!loaded) return null;

  // Redesign: compact Online / Offline pill for the driver header. Same
  // toggle() as the full-width button below — presentation only.
  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={isAvailable}
        aria-label={isAvailable ? "You're online — tap to go offline" : "You're offline — tap to go online"}
        className={
          isAvailable
            ? "flex items-center gap-2 min-h-11 px-4 rounded-full border border-cz-green-border bg-cz-green-tint text-cz-green-text font-semibold text-[15px]"
            : "flex items-center gap-2 min-h-11 px-4 rounded-full border border-cz-border-strong bg-cz-surface text-cz-muted font-semibold text-[15px]"
        }
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span aria-hidden className={isAvailable ? "w-2.5 h-2.5 rounded-full bg-cz-green" : "w-2.5 h-2.5 rounded-full bg-cz-faint"} />
        )}
        {isAvailable ? "Online" : "Offline"}
      </button>
    );
  }

  return (
    <Button
      onClick={toggle}
      disabled={busy}
      variant={isAvailable ? "default" : "outline"}
      className="w-full gap-2"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : isAvailable ? <MapPin className="h-4 w-4" /> : <MapPinOff className="h-4 w-4" />}
      {isAvailable ? "Available for jobs" : "Offline"}
    </Button>
  );
}

/** The phone's approximate position, or null when it is refused or unavailable. */
function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 },
    );
  });
}
