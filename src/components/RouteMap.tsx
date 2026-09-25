import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getRoute } from "@/lib/routing.functions";
import { Navigation2, Route as RouteIcon } from "lucide-react";
import { toast } from "sonner";
import { RouteStats } from "@/components/RouteStats";
import { CARTO_VOYAGER_TILES } from "@/lib/map-tiles";
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
// Leaflet doesn't detect when its container resizes on its own
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
// Redesign ("bare") markers: inline SVG so they render identically on every
// Android WebView (the emoji markers above depend on the device font).
const czTruckIcon = L.divIcon({
  className: "",
  html: `<div style="width:38px;height:38px;border-radius:12px;background:#121316;border:2px solid #F5A524;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.45)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F5A524" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7h12v9H2z"/><path d="M14 10h4l4 3.5V16h-8"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="18" cy="17.5" r="1.8"/></svg></div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});
const czDestIcon = L.divIcon({
  className: "",
  html: `<svg width="36" height="40" viewBox="0 0 24 26" style="display:block;filter:drop-shadow(0 3px 6px rgba(0,0,0,.45))"><path d="M12 1C7 1 3 5 3 10c0 6.5 9 15 9 15s9-8.5 9-15c0-5-4-9-9-9z" fill="#F2F0EB" stroke="#121316" stroke-width=".8"/><rect x="8.5" y="6.5" width="7" height="7" rx="1" fill="#121316"/></svg>`,
  iconSize: [36, 40],
  iconAnchor: [18, 38],
});

// Fits both markers (or the whole route) in view — the bare variant has no
// "Route & ETA" chrome, so the map itself has to show the full trip.
function FitTrip({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length < 2) return;
    map.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export type RouteResult = { distanceKm: number; etaMin: number; coords: [number, number][] };

type Props = {
  driverLocation: { lat: number; lng: number };
  initialDestination?: { lat: number; lng: number } | null;
  onRoute?: (r: RouteResult) => void;
  height?: number;
  showNavigateButton?: boolean;
  /** Redesign: render only the map (full-bleed, no card/header/stats). The
   *  route is still fetched exactly the same way; read it via onRoute. */
  bare?: boolean;
};

export function RouteMap({ driverLocation, initialDestination = null, onRoute, height = 320, showNavigateButton = false, bare = false }: Props) {
  const [destination, setDestination] = useState<{ lat: number; lng: number } | null>(initialDestination);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);

  // A real delivery address is already fixed on the job in every actual use
  // of this component (customer tracking, driver navigation, public
  // tracking) — tapping the map must never be able to silently move it.
  // Only fall back to click-to-set when this map genuinely has no
  // destination yet.
  const locked = !!initialDestination;

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

  // Previously the route was only ever computed from a map click, which
  // never fires when the destination is locked (the normal case for every
  // real job) — so Route & ETA silently never populated. Auto-fetch here
  // instead, debounced so live GPS updates during tracking don't spam OSRM.
  useEffect(() => {
    if (!destination) return;
    const t = setTimeout(() => { void fetchRoute(destination); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination?.lat, destination?.lng, driverLocation.lat, driverLocation.lng]);

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

  if (bare) {
    const pts: [number, number][] = route?.coords?.length
      ? route.coords
      : [[driverLocation.lat, driverLocation.lng], ...(destination ? [[destination.lat, destination.lng] as [number, number]] : [])];
    return (
      <div style={{ height, background: "#1a1c20" }} className="w-full">
        <MapContainer
          center={[driverLocation.lat, driverLocation.lng]}
          zoom={13}
          scrollWheelZoom={false}
          zoomControl={false}
          style={{ height: "100%", width: "100%" }}
        >
          <ResizeFix />
          <FitTrip points={pts} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url={CARTO_VOYAGER_TILES}
            subdomains="abcd"
            maxZoom={20}
          />
          {!locked && <ClickHandler />}
          <Marker position={[driverLocation.lat, driverLocation.lng]} icon={czTruckIcon}>
            <Popup>Driver</Popup>
          </Marker>
          {destination && (
            <Marker position={[destination.lat, destination.lng]} icon={czDestIcon}>
              <Popup>Destination</Popup>
            </Marker>
          )}
          {route?.coords?.length ? (
            <Polyline positions={route.coords} pathOptions={{ color: "#F5A524", weight: 5, opacity: 0.9 }} />
          ) : null}
        </MapContainer>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-card border overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4 pb-2 font-display font-bold uppercase text-sm tracking-wide">
        <RouteIcon className="w-4 h-4 text-primary" /> Route & ETA
      </div>
      <p className="px-4 pb-2 text-xs text-muted-foreground">
        {locked ? "Delivery destination is set for this job." : "Tap the map to drop a destination and see the driving route."}
      </p>
      <div style={{ height }} className="w-full">
        <MapContainer
  center={[driverLocation.lat, driverLocation.lng]}
  zoom={13}
  scrollWheelZoom={false}
  style={{ height: "100%", width: "100%" }}
> 
  <ResizeFix />
  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url={CARTO_VOYAGER_TILES}
                    subdomains="abcd"
                    maxZoom={20}
                  />
  {!locked && <ClickHandler />}
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
