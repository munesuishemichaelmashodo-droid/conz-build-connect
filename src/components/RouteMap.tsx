import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getRoute } from "@/lib/routing.functions";
import { Navigation2, Route as RouteIcon } from "lucide-react";
import { toast } from "sonner";
import { RouteStats } from "@/components/RouteStats";
const truckIcon = L.divIcon({
  className: "",
  html: `<div style="background:hsl(var(--primary));color:hsl(var(--primary-foreground));width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:16px">ðŸš›</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const destIcon = L.divIcon({
  className: "",
  html: `<div style="background:hsl(var(--foreground));color:hsl(var(--background));width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><span style="transform:rotate(45deg);font-size:14px">ðŸ“</span></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});
// Leaflet doesn't detect when its container resizes on its own
// (e.g. a dialog opening/closing shifts layout below it) â€” this
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
export type RouteResult = { distanceKm: number; etaMin: number; coords: [number, number][] };

type Props = {
  driverLocation: { lat: number; lng: number };
  initialDestination?: { lat: number; lng: number } | null;
  onRoute?: (r: RouteResult) => void;
  height?: number;
  showNavigateButton?: boolean;
};

export function RouteMap({ driverLocation, initialDestination = null, onRoute, height = 320, showNavigateButton = false }: Props) {
  const [destination, setDestination] = useState<{ lat: number; lng: number } | null>(initialDestination);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchRoute(dest: { lat: number; lng: number }) {
    setLoading(true);
    try {
      const r = await getRoute({
        data: {
          startLat: driverLocation.lat,
          startLng: driverLocation.lng,
          destLat: dest.lat,
          destLng: dest.lng,
        },
      });
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
  <ResizeFix />
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
<RouteStats distanceKm={route?.distanceKm} etaMin={route?.etaMin} loading={loading} />
     {showNavigateButton && destination && (
        <div className="px-4 pb-4">
          <a
href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
  `${destination.lat},${destination.lng}`
)}&travelmode=driving`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary text-primary-foreground font-semibold text-sm py-2.5 hover:opacity-90 transition"
          >
            <Navigation2 className="w-4 h-4" /> Navigate with Google Maps
          </a>
        </div>
      )}
    </div>
  );
}
export default RouteMap;
