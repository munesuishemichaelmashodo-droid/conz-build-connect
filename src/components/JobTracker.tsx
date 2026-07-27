import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MapPin, Navigation2, Square, Loader2, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { useLocationSharingEnabled } from "@/lib/location-privacy";
import { RouteMap } from "@/components/RouteMap";

// Fix default marker icons (Vite breaks Leaflet's default path resolution)
const truckIcon = L.divIcon({
  className: "",
  html: `<div style="background:hsl(var(--primary));color:hsl(var(--primary-foreground));width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:16px">🚛</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

type Loc = { lat: number; lng: number; updated_at: string; heading: number | null; accuracy: number | null };

export function DriverShareLocation({ jobId, driverId }: { jobId: string; driverId: string }) {
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const watchRef = useRef<number | null>(null);
  const [privacyOn] = useLocationSharingEnabled();

  const stopWatch = () => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
  };

  useEffect(() => () => stopWatch(), []);

  // If the user turns off location sharing globally, tear down any active share.
  useEffect(() => {
    if (!privacyOn && (sharing || watchRef.current !== null)) {
      stopWatch();
      setSharing(false);
      (supabase.from("driver_locations") as any).delete().eq("job_id", jobId).then(() => {
        toast.message("Live location sharing paused", { description: "You turned it off in privacy settings." });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privacyOn]);

  const push = async (pos: GeolocationPosition) => {
    await (supabase.from("driver_locations") as any).upsert({
      job_id: jobId,
      driver_id: driverId,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      heading: pos.coords.heading,
      accuracy: pos.coords.accuracy,
      updated_at: new Date().toISOString(),
    }, { onConflict: "job_id" });
  };

  const start = async () => {
    if (!privacyOn) return toast.error("Location sharing is off in privacy settings");
    if (!("geolocation" in navigator)) return toast.error("Geolocation not supported");
    setBusy(true);
    try {
      const { locateOnce } = await import("@/lib/geolocate");
      const c = await locateOnce();
      await push({ coords: { latitude: c.lat, longitude: c.lng, heading: null as any, accuracy: c.accuracy ?? null as any } } as GeolocationPosition);
      watchRef.current = navigator.geolocation.watchPosition(push, (err) => toast.error(err.message), {
        enableHighAccuracy: true, maximumAge: 5000, timeout: 20000,
      });
      setSharing(true);
      setBusy(false);
      toast.success("Live location sharing started");
    } catch (e: any) {
      setBusy(false);
      toast.error(e.message ?? "Could not get location");
    }
  };

  const stop = async () => {
    stopWatch();
    setSharing(false);
    await (supabase.from("driver_locations") as any).delete().eq("job_id", jobId);
    toast.success("Stopped sharing");
  };

  return (
    <div className="rounded-2xl bg-card border p-4 space-y-3">
      <div className="flex items-center gap-2 font-display font-bold uppercase text-sm tracking-wide">
        <Navigation2 className="w-4 h-4 text-primary" /> Live GPS
      </div>
      <p className="text-xs text-muted-foreground">Share your live location with the customer while you deliver.</p>
      {!privacyOn ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs space-y-2">
          <div className="flex items-center gap-2 font-semibold text-warning">
            <ShieldOff className="w-4 h-4" /> Location sharing is turned off
          </div>
          <p className="text-muted-foreground">
            Turn it back on in{" "}
            <Link to="/profile" className="underline font-semibold">privacy settings</Link>{" "}
            to share your live GPS with customers.
          </p>
        </div>
      ) : !sharing ? (
        <Button onClick={start} disabled={busy} className="w-full">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Start sharing location"}
        </Button>
      ) : (
        <Button onClick={stop} variant="outline" className="w-full">
          <Square className="w-4 h-4 mr-2" /> Stop sharing
        </Button>
      )}
    </div>
  );
}

export function CustomerTrackMap({ jobId }: { jobId: string }) {
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

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card border overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 font-display font-bold uppercase text-sm tracking-wide">
          <MapPin className="w-4 h-4 text-primary" /> Live driver location
        </div>
        {!loc ? (
          <p className="px-4 pb-4 text-xs text-muted-foreground">Driver hasn't started sharing location yet.</p>
        ) : (
          <>
            <div className="h-64 w-full">
              <MapContainer center={[loc.lat, loc.lng]} zoom={15} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }} key={`${loc.lat},${loc.lng}`}>
                <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Marker position={[loc.lat, loc.lng]} icon={truckIcon}>
                  <Popup>Updated {new Date(loc.updated_at).toLocaleTimeString()}</Popup>
                </Marker>
              </MapContainer>
            </div>
            <div className="px-4 py-2 text-[11px] text-muted-foreground flex justify-between">
              <span>{loc.lat.toFixed(5)}, {loc.lng.toFixed(5)}</span>
              <span>Updated {new Date(loc.updated_at).toLocaleTimeString()}</span>
            </div>
          </>
        )}
      </div>
      {loc && <RouteMap driverLocation={{ lat: loc.lat, lng: loc.lng }} initialDestination={destination} />}
    </div>
  );
}

export function DriverRouteView({ jobId }: { jobId: string }) {
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  const [destination, setDestination] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    (async () => {
      try {
        const { locateOnce } = await import("@/lib/geolocate");
        const c = await locateOnce();
        if (mounted) setOrigin({ lat: c.lat, lng: c.lng });
      } catch (e: any) {
        if (mounted) setError(e?.message ?? "Could not get your location");
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [jobId]);

  if (loading) {
    return (
      <div className="rounded-2xl bg-card border p-4 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading route to delivery point…
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
      <div className="rounded-2xl bg-card border p-4 text-xs text-muted-foreground">
        {error ?? "Location required to show the route."}
      </div>
    );
  }
return <RouteMap driverLocation={origin} initialDestination={destination} showNavigateButton />
}
