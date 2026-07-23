import { useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, MapPin, Navigation2, Route as RouteIcon } from "lucide-react";
import { toast } from "sonner";

const truckIcon = L.divIcon({
  className: "",
  html: `<div style="background:hsl(var(--primary));color:hsl(var(--primary-foreground));width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:16px">🚛</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const destIcon = L.divIcon({
  className: "",
  html: `<div style="background:hsl(var(--foreground));color:hsl(var(--background));width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><span style="transform:rotate(45deg);font-size:14px">📍</span></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

export type RouteResult = { distanceKm: number; etaMin: number; coords: [number, number][] };

type Props = {
  driverLocation: { lat: number; lng: number };
  initialDestination?: { lat: number; lng: number } | null;
  onRoute?: (r: RouteResult) => void;
  height?: number;
};

export function RouteMap({ driverLocation, initialDestination = null, onRoute, height = 320 }: Props) {
  const [destination, setDestination] = useState<{ lat: number; lng: number } | null>(initialDestination);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchRoute(dest: { lat: number; lng: number }) {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("quick-responder", {
        body: {
          startLat: driverLocation.lat,
          startLng: driverLocation.lng,
          destLat: dest.lat,
          destLng: dest.lng,
        },
      });
      if (error) throw error;
      const r = data as RouteResult;
      setRoute(r);
      onRoute?.(r);
    } catch (e: any) {
      console.error("Route fetch failed:", e);
      toast.error(e?.message ?? "Could not calculate route");
    } finally {
      setLoading(false);
    }
  }

  function ClickHandler() {
    useMapEvents({
      click(e) {
        const d = { lat: e.latlng.lat, lng: e.latlng.lng };
        setDestination(d);
        void fetchRoute(d);
      },
    });
    return null;
  }

  return (
    <div className="rounded-2xl bg-card border overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2 font-display font-bold uppercase text-sm tracking-wide">
        <RouteIcon className="w-4 h-4 text-primary" /> Route & ETA
      </div>
      <p className="px-4 pb-2 text-xs text-muted-foreground">
        Tap the map to drop a destination and see the driving route.
      </p>
      <div style={{ height }} className="w-full">
        <MapContainer
          center={[driverLocation.lat, driverLocation.lng]}
          zoom={13}
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <ClickHandler />
          <Marker position={[driverLocation.lat, driverLocation.lng]} icon={truckIcon}>
            <Popup>Driver</Popup>
          </Marker>
          {destination && (
            <Marker position={[destination.lat, destination.lng]} icon={destIcon}>
              <Popup>Destination</Popup>
            </Marker>
          )}
          {route?.coords?.length ? (
            <Polyline positions={route.coords} pathOptions={{ color: "hsl(var(--primary))", weight: 5, opacity: 0.85 }} />
          ) : null}
        </MapContainer>
      </div>
      <div className="px-4 py-3 flex items-center justify-between text-xs">
        {loading ? (
          <span className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> Calculating route…
          </span>
        ) : route ? (
          <>
            <span className="flex items-center gap-1 font-semibold">
              <Navigation2 className="w-3 h-3 text-primary" /> {route.distanceKm.toFixed(1)} km
            </span>
            <span className="flex items-center gap-1 font-semibold">
              <MapPin className="w-3 h-3 text-primary" /> ETA {route.etaMin} min
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">No destination selected yet.</span>
        )}
      </div>
    </div>
  );
}

export default RouteMap;
