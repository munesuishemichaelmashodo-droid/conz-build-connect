import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MapPin, MapPinOff, Loader2 } from "lucide-react";

/**
 * Stage 1 of geographic driver matching: lets a driver explicitly opt in
 * to "available for jobs", capturing their approximate current position
 * into driver_availability. Does NOT affect job discovery, ranking, or
 * bidding yet — that's a later stage. This is purely the foundation:
 * reliable availability + location state, nothing consumes it yet.
 *
 * "Available for jobs" is a deliberate, explicit driver action — distinct
 * from the existing profiles.last_active_at "app open" presence heartbeat,
 * which keeps running regardless of this toggle.
 */
export function DriverAvailabilityToggle() {
  const { userId } = useAuth();
  const [isAvailable, setIsAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("driver_availability" as any)
      .select("is_available")
      .eq("driver_id", userId)
      .maybeSingle()
      .then((res: any) => {
        const data = res?.data as { is_available?: boolean } | null;
        if (!cancelled) {
          setIsAvailable(!!data?.is_available);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const pushLocation = (available: boolean) => {
    if (!userId) return;
    if (!("geolocation" in navigator)) {
      // No geolocation support — still record the availability toggle
      // itself, just without coordinates (constraint requires both null
      // or both set, so this stays a valid, if location-less, row).
      void supabase.from("driver_availability" as any).upsert({
        driver_id: userId,
        is_available: available,
        updated_at: new Date().toISOString(),
      });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void supabase.from("driver_availability" as any).upsert({
          driver_id: userId,
          is_available: available,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          updated_at: new Date().toISOString(),
        });
      },
      () => {
        // Permission denied or unavailable — still record availability
        // without coordinates rather than blocking the toggle entirely.
        void supabase.from("driver_availability" as any).upsert({
          driver_id: userId,
          is_available: available,
          updated_at: new Date().toISOString(),
        });
        if (available) toast.error("Location unavailable — you're marked available, but without a position yet.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 },
    );
  };

  const toggle = async () => {
    if (!userId || busy) return;
    setBusy(true);
    const next = !isAvailable;
    setIsAvailable(next);
    pushLocation(next);
    setBusy(false);
    toast.success(next ? "You're available for jobs" : "You're offline");
  };

  // Heartbeat while available and the tab is foregrounded — same ~45s
  // cadence as the existing presence heartbeat (src/lib/auth.tsx), so
  // this table's freshness aligns with the precedent already documented
  // in migration 0052, rather than inventing a different interval.
  useEffect(() => {
    if (!isAvailable || !userId) {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      return;
    }
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      pushLocation(true);
    };
    intervalRef.current = window.setInterval(beat, 45_000);
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAvailable, userId]);

  if (!loaded) return null;

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
