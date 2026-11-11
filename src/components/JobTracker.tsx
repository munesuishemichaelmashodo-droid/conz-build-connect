import { useCallback, useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MapPin, Navigation2, Square, Loader2, ShieldOff, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { useLocationSharingEnabled } from "@/lib/location-privacy";
import { SpotlightCallout } from "@/components/SpotlightCallout";
import { isPermissionDenied, readShareIntent, shareHealth, shareNotice, writeShareIntent } from "@/lib/location-share";
import { RouteMap, type RouteResult } from "@/components/RouteMap";
import { PinMap } from "@/components/redesign/PinMap";
import { CARTO_VOYAGER_TILES } from "@/lib/map-tiles";

// Fix default marker icons (Vite breaks Leaflet's default path resolution)
const truckIcon = L.divIcon({
  className: "",
  html: `<div style="background:var(--cz-amber);color:var(--cz-amber-ink);width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:16px">🚚</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

// Pans the map to follow the truck without remounting it —
// avoids the tile-reload flash on every location update.
function Follow({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng]);
  }, [lat, lng, map]);
  return null;
}// Leaflet doesn't detect when its container resizes on its own
// (e.g. a dialog opening/closing shifts layout below it) — this
// nudges it to recalculate so it doesn't render a stale, zoomed-out view.
function ResizeFix() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

type Loc = { lat: number; lng: number; updated_at: string; heading: number | null; accuracy: number | null; stationary_since: string | null; anomaly_alerted_at: string | null };

const NOTICE_TONE: Record<"ok" | "warn" | "danger", string> = {
  ok: "border-cz-border bg-cz-surface",
  warn: "border-warning/50 bg-warning/10",
  danger: "border-destructive/50 bg-destructive/10",
};

/**
 * Driver live-location sharing for one job. A browser location watch ends silently when the page is left,
 * reloaded, backgrounded or the phone suspends the app, so this remembers that the driver started sharing,
 * restarts the watch when they come back or updates stop, and says clearly when the customer cannot see them.
 */
function useDriverShare(jobId: string, driverId: string) {
  const [privacyOn] = useLocationSharingEnabled();
  const [intended, setIntended] = useState(() =>
    readShareIntent(jobId, typeof window === "undefined" ? null : window.localStorage),
  );
  const [watching, setWatching] = useState(false);
  const [denied, setDenied] = useState(false);
  const [lastPushAt, setLastPushAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const watchRef = useRef<number | null>(null);
  const lastRestartRef = useRef(0);

  const stopWatch = useCallback(() => {
    if (watchRef.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchRef.current);
    }
    watchRef.current = null;
    setWatching(false);
  }, []);

  const push = useCallback(
    async (pos: GeolocationPosition) => {
      const { error } = await (supabase.from("driver_locations") as any).upsert(
        {
          job_id: jobId,
          driver_id: driverId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading,
          accuracy: pos.coords.accuracy,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "job_id" },
      );
      if (!error) setLastPushAt(Date.now());
    },
    [jobId, driverId],
  );

  const onWatchError = useCallback(
    (err: GeolocationPositionError) => {
      if (isPermissionDenied(err)) {
        stopWatch();
        setDenied(true);
      }
      // Timeouts and "position unavailable" are temporary: the stall check below retries.
    },
    [stopWatch],
  );

  const beginWatch = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    lastRestartRef.current = Date.now();
    watchRef.current = navigator.geolocation.watchPosition(push, onWatchError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000,
    });
    setWatching(true);
  }, [push, onWatchError]);

  const start = async () => {
    if (!privacyOn) return toast.error("Location sharing is off in privacy settings");
    if (typeof navigator === "undefined" || !("geolocation" in navigator))
      return toast.error("This phone or browser cannot share location");
    setBusy(true);
    try {
      const { locateOnce } = await import("@/lib/geolocate");
      const c = await locateOnce();
      setDenied(false);
      await push({
        coords: { latitude: c.lat, longitude: c.lng, heading: null as any, accuracy: c.accuracy ?? (null as any) },
      } as GeolocationPosition);
      writeShareIntent(jobId, true, window.localStorage);
      setIntended(true);
      beginWatch();
      toast.success("Live location sharing started");
    } catch (e: any) {
      if (isPermissionDenied(e)) setDenied(true);
      toast.error(e?.message ?? "Could not get location");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    writeShareIntent(jobId, false, window.localStorage);
    setIntended(false);
    stopWatch();
    setLastPushAt(null);
    await (supabase.from("driver_locations") as any).delete().eq("job_id", jobId);
    toast.success("Stopped sharing");
  };

  // Resume after the driver left and came back, reloaded, or the phone returned from the maps app.
  const resume = useCallback(async () => {
    if (!intended || !privacyOn || denied) return;
    try {
      const perm = await (navigator as any).permissions?.query?.({ name: "geolocation" });
      if (perm?.state === "denied") {
        stopWatch();
        setDenied(true);
        return;
      }
    } catch {
      /* permissions API not available: just try */
    }
    beginWatch();
  }, [intended, privacyOn, denied, beginWatch, stopWatch]);

  useEffect(() => {
    void resume();
    return () => stopWatch(); // leaving the screen ends the watch; intent stays, so it resumes on return
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intended, privacyOn]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void resume();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [resume]);

  // Every 15 s: refresh the clock; if updates stopped, prove the phone still has a position (a stationary truck
  // sends no movement events) and restart the watch.
  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (!intended || !privacyOn || denied) return;
      const h = shareHealth({
        intended,
        watching: watchRef.current !== null,
        denied,
        lastPushAt,
        watchStartedAt: lastRestartRef.current || null,
        now: n,
      });
      if (h !== "stalled" || n - lastRestartRef.current < 30_000) return;
      navigator.geolocation?.getCurrentPosition(
        (p) => void push(p),
        onWatchError,
        { enableHighAccuracy: true, maximumAge: 10_000, timeout: 10_000 },
      );
      beginWatch();
    }, 15_000);
    return () => clearInterval(t);
  }, [intended, privacyOn, denied, lastPushAt, push, onWatchError, beginWatch]);

  // Turning location sharing off in privacy settings ends any share.
  useEffect(() => {
    if (!privacyOn && (intended || watchRef.current !== null)) {
      stopWatch();
      writeShareIntent(jobId, false, window.localStorage);
      setIntended(false);
      (supabase.from("driver_locations") as any).delete().eq("job_id", jobId).then(() => {
        toast.message("Live location sharing paused", { description: "You turned it off in privacy settings." });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privacyOn]);

  const health = shareHealth({
    intended,
    watching,
    denied,
    lastPushAt,
    watchStartedAt: lastRestartRef.current || null,
    now,
  });
  return { privacyOn, health, busy, start, stop, notice: shareNotice(health, privacyOn) };
}

export function DriverShareLocation({ jobId, driverId, compact = false }: { jobId: string; driverId: string; compact?: boolean }) {
  const { privacyOn, health, busy, start, stop, notice } = useDriverShare(jobId, driverId);
  const sharingNow = health === "live" || health === "starting" || health === "stalled";
  const startLabel = health === "blocked" ? "Try again" : health === "stalled" ? "Restart sharing" : "Start sharing";

  const banner =
    notice.tone !== "ok" ? (
      <div role="alert" className={`rounded-xl border p-3 text-sm space-y-1 ${NOTICE_TONE[notice.tone]}`}>
        <div className="flex items-center gap-2 font-semibold">
          {privacyOn ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <ShieldOff className="w-4 h-4 shrink-0" />}
          {notice.title}
        </div>
        <p className="text-xs text-muted-foreground">
          {notice.detail}
          {!privacyOn && (
            <>
              {" "}
              <Link to="/profile" className="underline font-semibold">Open privacy settings</Link>
            </>
          )}
        </p>
      </div>
    ) : null;

  // Redesign: one-row "Live GPS" control for the active-job sheet. Same handlers and privacy gate as the full card.
  if (compact) {
    return (
      <div className="space-y-2">
        {banner}
        <div className="flex items-center gap-3 rounded-xl border border-cz-border bg-cz-surface px-3.5 py-3">
          <Navigation2 className={health === "live" ? "w-5 h-5 text-cz-green shrink-0" : "w-5 h-5 text-cz-amber-text shrink-0"} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold">
              Live location{" "}
              <span className={health === "live" ? "text-cz-green-text" : "text-cz-amber-text"}>
                · {health === "live" ? "On" : health === "starting" ? "Starting" : health === "stalled" ? "Not updating" : "Off"}
              </span>
            </div>
            <div className="text-xs text-cz-muted">
              {health === "live"
                ? "The customer can follow you live. Keep Con Z open."
                : "Start it every delivery so the customer can follow you."}
            </div>
          </div>
          {privacyOn &&
            (health === "live" || health === "starting" ? (
              <button
                type="button"
                onClick={stop}
                className="min-h-11 shrink-0 rounded-xl border border-cz-border-strong px-3.5 text-sm font-semibold"
              >
                <Square className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={start}
                disabled={busy}
                className="min-h-11 shrink-0 rounded-xl border-[1.5px] border-cz-amber px-3.5 text-sm font-bold text-cz-amber-text disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : startLabel}
              </button>
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-card border p-4 space-y-3">
      <div className="flex items-center gap-2 font-semibold text-sm">
        <Navigation2 className="w-4 h-4 text-cz-amber-text" /> Live GPS
      </div>
      <p className="text-xs text-muted-foreground">Share your live location with the customer while you deliver.</p>
      {banner}
      {privacyOn &&
        (sharingNow && health !== "stalled" ? (
          <Button onClick={stop} variant="outline" className="w-full">
            <Square className="w-4 h-4 mr-2" /> Stop sharing
          </Button>
        ) : (
          <Button onClick={start} disabled={busy} className="w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : startLabel}
          </Button>
        ))}
    </div>
  );
}

export type TrackStatus = { live: boolean; updatedAt: string | null; stalled: boolean; route: RouteResult | null };

export function CustomerTrackMap({
  jobId,
  variant = "card",
  height = 270,
  onStatus,
}: {
  jobId: string;
  /** "hero": redesign full-bleed map for the top of the tracking screen. */
  variant?: "card" | "hero";
  height?: number;
  onStatus?: (s: TrackStatus) => void;
}) {
  const [loc, setLoc] = useState<Loc | null>(null);
  const [destination, setDestination] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await (supabase.from("jobs") as any)
        .select("delivery_lat,delivery_lng")
        .eq("id", jobId)
        .maybeSingle();
      if (mounted && data?.delivery_lat != null && data?.delivery_lng != null) {
        setDestination({ lat: Number(data.delivery_lat), lng: Number(data.delivery_lng) });
      }
    })();
    return () => { mounted = false; };
  }, [jobId]);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const { data } = await (supabase.from("driver_locations") as any).select("*").eq("job_id", jobId).maybeSingle();
      if (mounted && data) setLoc(data as Loc);
    };
    load();

    const channel = supabase
      .channel(`track:${jobId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_locations", filter: `job_id=eq.${jobId}` },
        (payload: any) => {
          if (payload.eventType === "DELETE") setLoc(null);
          else setLoc(payload.new as Loc);
        })
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(channel); };
  }, [jobId]);

  const [route, setRoute] = useState<RouteResult | null>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => {
    onStatusRef.current?.({ live: !!loc, updatedAt: loc?.updated_at ?? null, stalled: !!loc?.anomaly_alerted_at, route });
  }, [loc, route]);

  if (variant === "hero") {
    return (
      <div className="relative w-full" style={{ height }}>
        {loc ? (
          <RouteMap bare height={height} driverLocation={{ lat: loc.lat, lng: loc.lng }} initialDestination={destination} onRoute={setRoute} />
        ) : destination ? (
          <PinMap point={destination} label="Deliver here" className="w-full h-full" />
        ) : (
          <div className="w-full h-full bg-cz-surface" />
        )}
        {!loc && (
          <div className="absolute inset-x-4 bottom-10 z-20 rounded-xl bg-cz-bg/95 px-3.5 py-2.5 text-[13px] text-cz-muted shadow-lg">
            Your driver isn't sharing their location right now. The truck appears here when they do.
          </div>
        )}
        {loc?.anomaly_alerted_at && (
          <div className="absolute inset-x-4 bottom-10 z-20 rounded-xl bg-cz-warn-tint px-3.5 py-2.5 text-[13px] text-cz-warn-text flex items-start gap-2 shadow-lg">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Your driver hasn't moved in a while — this has been logged. If something's wrong, use chat or raise a dispute.</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SpotlightCallout
        id="live-tracking"
        title="Watch your driver in real time"
        body="Once your driver starts sharing their location, you'll see them move on this map right up to your delivery point."
      />
      <div className="rounded-2xl bg-card border overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 font-semibold text-sm">
          <MapPin className="w-4 h-4 text-cz-amber-text" /> Live driver location
        </div>
        {!loc ? (
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            Driver isn't sharing their location right now.
          </p>
        ) : (
          <>
            {loc.anomaly_alerted_at && (
              <div className="mx-4 mb-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <span>Your driver hasn't moved in a while — this has been logged. If something's wrong, use chat or raise a dispute.</span>
              </div>
            )}
            <div className="h-64 w-full">
              <MapContainer center={[loc.lat, loc.lng]} zoom={15} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
                <ResizeFix />
                <Follow lat={loc.lat} lng={loc.lng} />
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url={CARTO_VOYAGER_TILES}
                    subdomains="abcd"
                    maxZoom={20}
                  />
                <Marker position={[loc.lat, loc.lng]} icon={truckIcon} title="Truck location">
                  <Popup>Updated {new Date(loc.updated_at).toLocaleTimeString()}</Popup>
                </Marker>
              </MapContainer>
            </div>
            <div className="px-4 py-2 text-[11px] text-muted-foreground flex justify-between">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> Live
              </span>
              <span>Updated {new Date(loc.updated_at).toLocaleTimeString()}</span>
            </div>
          </>
        )}
      </div>
      {loc && <RouteMap driverLocation={{ lat: loc.lat, lng: loc.lng }} initialDestination={destination} showNavigateButton />}
    </div>
  );
}

export function DriverRouteView({
  jobId,
  bare = false,
  height = 300,
  onRoute,
}: {
  jobId: string;
  /** Redesign: full-bleed map for the top of the active-job screen. */
  bare?: boolean;
  height?: number;
  onRoute?: (r: RouteResult) => void;
}) {
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [destination, setDestination] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await (supabase.from("jobs") as any)
        .select("delivery_lat,delivery_lng")
        .eq("id", jobId)
        .maybeSingle();
      if (mounted && data?.delivery_lat != null && data?.delivery_lng != null) {
        setDestination({ lat: Number(data.delivery_lat), lng: Number(data.delivery_lng) });
      }
    })();
    return () => { mounted = false; };
  }, [jobId]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    setSlow(false);
    // After 8s, the fast low-accuracy fix has likely already failed and
    // we're waiting on the high-accuracy GPS lock (up to 20s) — tell the
    // user it's still working instead of leaving a static spinner.
    const slowTimer = setTimeout(() => { if (mounted) setSlow(true); }, 8000);
    (async () => {
      try {
        const { locateOnce } = await import("@/lib/geolocate");
        const c = await locateOnce();
        if (mounted) setOrigin({ lat: c.lat, lng: c.lng });
      } catch (e: any) {
        if (mounted) setError(e?.message ?? "Could not get your location");
      } finally {
        if (mounted) setLoading(false);
        clearTimeout(slowTimer);
      }
    })();
    return () => { mounted = false; clearTimeout(slowTimer); };
  }, [jobId, attempt]);

  const retry = () => setAttempt((n) => n + 1);

  if (bare) {
    const box = "w-full flex flex-col items-center justify-center gap-2 bg-cz-surface px-6 text-center text-[13px] text-cz-muted";
    if (loading) {
      return (
        <div className={box} style={{ height }}>
          <Loader2 className="w-5 h-5 animate-spin text-cz-amber-text" />
          <span>Loading route to the delivery point…</span>
          {slow && (
            <>
              <span>Still locating you — this can take longer on a weak signal.</span>
              <button type="button" onClick={retry} className="min-h-11 rounded-xl border border-cz-border-strong px-4 font-semibold text-cz-text">
                Cancel and retry
              </button>
            </>
          )}
        </div>
      );
    }
    if (!destination) {
      return <div className={box} style={{ height }}>No delivery coordinates on this job — route can't be calculated.</div>;
    }
    if (!origin) {
      return (
        <div className="relative w-full" style={{ height }}>
          <PinMap point={destination} label="Drop-off" className="w-full h-full" />
          <div className="absolute inset-x-4 bottom-10 z-20 rounded-xl bg-cz-bg/95 px-3.5 py-2.5 text-[13px] text-cz-muted shadow-lg flex items-center gap-3">
            <span className="flex-1">{error ?? "Location required to show the route."}</span>
            <button type="button" onClick={retry} className="min-h-11 shrink-0 rounded-xl border border-cz-border-strong px-3 font-semibold text-cz-text">
              Try again
            </button>
          </div>
        </div>
      );
    }
    return <RouteMap bare height={height} driverLocation={origin} initialDestination={destination} onRoute={onRoute} />;
  }

  if (loading) {
    return (
      <div className="rounded-2xl bg-card border p-4 text-xs text-muted-foreground space-y-2">
        <div className="flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading route to delivery point…
        </div>
        {slow && (
          <div className="space-y-2">
            <p>Still locating you — this can take longer on a weak signal. Check your network/GPS or move somewhere with a clearer view of the sky.</p>
            <Button size="sm" variant="outline" onClick={retry} className="h-7 text-xs">
              Cancel and retry
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!destination) {
    return (
      <div className="rounded-2xl bg-card border p-4 text-xs text-muted-foreground">
        No delivery coordinates on this job — route can't be calculated.
      </div>
    );
  }

  if (!origin) {
    return (
      <div className="rounded-2xl bg-card border p-4 text-xs text-muted-foreground space-y-2">
        <p>{error ?? "Location required to show the route."}</p>
        <Button size="sm" variant="outline" onClick={retry} className="h-7 text-xs">
          Try again
        </Button>
      </div>
    );
  }

  return <RouteMap driverLocation={origin} initialDestination={destination} showNavigateButton />;
}
