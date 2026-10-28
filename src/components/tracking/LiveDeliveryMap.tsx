import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useServerFn } from "@tanstack/react-start";
import { Clock, Locate, Maximize2, Minimize2, Navigation, MapPin } from "lucide-react";
import { getRoute } from "@/lib/routing.functions";
import { CARTO_ATTRIBUTION, CARTO_DARK_TILES, CARTO_VOYAGER_TILES } from "@/lib/map-tiles";
import { formatArrival, formatDistance, formatDuration } from "@/lib/format";
import {
  AT_SITE_M,
  distanceM,
  etaChipText,
  shouldRefreshRoute,
  truckEtaMin,
  type LatLng,
} from "@/lib/live-map";
import { deliveryPinIcon } from "@/components/redesign/PinMap";

/**
 * The one map on the shared tracking link: where the truck is, where it is going, the road
 * between them and roughly when it arrives. Free tiles (CARTO, OpenStreetMap data) and the free
 * route service; the route is re-asked only when the truck has really moved.
 */

type Props = {
  truck: (LatLng & { updatedAt: string }) | null;
  /** The truck's position is fresh (the driver's phone is still reporting). */
  live: boolean;
  destination: LatLng | null;
  driverName?: string | null;
  /** Direction of travel in degrees (0 = north), when the database sends it (0126). */
  heading?: number | null;
  /** Line driven since loading, [lat, lng] pairs (0126). */
  trail?: [number, number][] | null;
};

function truckIcon(live: boolean, heading: number | null) {
  const ring = live
    ? `<span class="cz-pulse-ring" style="position:absolute;inset:-7px;border-radius:14px;background:rgba(255,119,22,.30)"></span>`
    : "";
  const border = live ? "#FF7716" : "#8A847E";
  // Small arrow outside the badge pointing the way the truck is driving.
  const arrow =
    live && heading != null
      ? `<div style="position:absolute;inset:-14px;transform:rotate(${heading}deg)"><svg width="10" height="10" viewBox="0 0 10 10" style="position:absolute;left:50%;top:0;margin-left:-5px" aria-hidden="true"><path d="M5 0 L10 9 L5 7 L0 9 Z" fill="#FF7716" stroke="#010101" stroke-width="1"/></svg></div>`
      : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:38px;height:38px">${ring}${arrow}<div style="position:relative;width:38px;height:38px;border-radius:11px;background:#010101;border:2px solid ${border};display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.45)${live ? "" : ";opacity:.85"}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${border}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 7h12v9H2z"/><path d="M14 10h4l4 3.5V16h-8"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="18" cy="17.5" r="1.8"/></svg></div></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

function useDarkMode() {
  const read = () =>
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

function ResizeFix() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/**
 * Keeps the whole trip in view as the truck moves, until the person pans or zooms the map
 * themselves; "Show whole trip" hands control back.
 */
function FitTrip({
  points,
  follow,
  onUserMove,
  fitNonce,
}: {
  points: [number, number][];
  follow: boolean;
  onUserMove: () => void;
  fitNonce: number;
}) {
  const map = useMap();
  const fitting = useRef(false);
  useMapEvents({
    dragstart: () => onUserMove(),
    zoomstart: () => {
      if (!fitting.current) onUserMove();
    },
  });
  const key = points.map((p) => p.map((n) => n.toFixed(4)).join(",")).join("|");
  useEffect(() => {
    if (!follow || points.length === 0) return;
    fitting.current = true;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(points, { padding: [56, 56], maxZoom: 16 });
    const t = setTimeout(() => (fitting.current = false), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, follow, fitNonce, map]);
  return null;
}

type Route = { coords: [number, number][]; distanceKm: number; carMin: number; source: string };

export function LiveDeliveryMap({
  truck,
  live,
  destination,
  driverName,
  heading = null,
  trail = null,
}: Props) {
  const runGetRoute = useServerFn(getRoute);
  const dark = useDarkMode();
  const [route, setRoute] = useState<Route | null>(null);
  const lastAsk = useRef<{ from: LatLng; at: number } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [follow, setFollow] = useState(true);
  const [fitNonce, setFitNonce] = useState(0);
  const [big, setBig] = useState(false);

  const atSite = !!truck && !!destination && distanceM(truck, destination) <= AT_SITE_M;

  // Road route from the truck to the site, only while the position is live and only when the
  // truck has moved enough (or 3 minutes passed).
  useEffect(() => {
    if (!truck || !destination || !live || atSite) return;
    if (!shouldRefreshRoute(lastAsk.current, truck, Date.now())) return;
    lastAsk.current = { from: { lat: truck.lat, lng: truck.lng }, at: Date.now() };
    runGetRoute({
      data: {
        startLat: truck.lat,
        startLng: truck.lng,
        destLat: destination.lat,
        destLng: destination.lng,
      },
    })
      .then((r) => {
        if (!mounted.current) return;
        setRoute({
          coords: r.coords,
          distanceKm: r.distanceKm,
          carMin: r.etaMin,
          source: r.source,
        });
      })
      .catch(() => {
        // Keep the last route; the map still shows the truck and the site.
        lastAsk.current = null;
      });
    // Primitives on purpose: a new object with the same position must not re-ask for a route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truck?.lat, truck?.lng, destination?.lat, destination?.lng, live, atSite]);

  // A straight line only means "no road route available": don't draw it as if it were a road.
  const roadRoute = route && route.source !== "haversine" && route.coords.length > 1 ? route : null;
  const showEta = live && !atSite && route != null;
  const etaMin = showEta ? truckEtaMin(route.carMin) : null;
  const chip = atSite
    ? `${driverName ?? "The truck"} is at the delivery site`
    : showEta
      ? etaChipText(etaMin, route.distanceKm)
      : truck && !live
        ? "Waiting for a fresh location"
        : null;

  const trailStartLat = trail?.[0]?.[0];
  const trailStartLng = trail?.[0]?.[1];
  const points = useMemo(() => {
    const p: [number, number][] = [];
    if (truck) p.push([truck.lat, truck.lng]);
    if (destination) p.push([destination.lat, destination.lng]);
    // Where the trip started (first point after loading), so the driven line is in view too.
    if (trailStartLat != null && trailStartLng != null) p.push([trailStartLat, trailStartLng]);
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truck?.lat, truck?.lng, destination?.lat, destination?.lng, trailStartLat, trailStartLng]);

  const destIcon = useMemo(() => deliveryPinIcon(null), []);
  const tIcon = useMemo(() => truckIcon(live, heading), [live, heading]);
  const driven = useMemo<[number, number][]>(() => {
    if (!trail || trail.length === 0) return [];
    return truck ? [...trail, [truck.lat, truck.lng]] : trail;
  }, [trail, truck]);

  const center = points[0];
  if (!center) return null;

  return (
    <div>
      <div
        className="relative w-full transition-[height] duration-200"
        style={{ height: big ? "70dvh" : 300, background: dark ? "#1b1b1b" : "#f2efe9" }}
      >
        <MapContainer
          center={center}
          zoom={14}
          scrollWheelZoom={false}
          zoomControl={false}
          attributionControl
          style={{ height: "100%", width: "100%" }}
          ref={(m) => {
            m?.attributionControl.setPrefix(false);
          }}
        >
          <ResizeFix />
          <FitTrip
            points={points}
            follow={follow}
            fitNonce={fitNonce}
            onUserMove={() => setFollow(false)}
          />
          <TileLayer
            key={dark ? "dark" : "light"}
            attribution={CARTO_ATTRIBUTION}
            url={dark ? CARTO_DARK_TILES : CARTO_VOYAGER_TILES}
            subdomains="abcd"
            maxZoom={20}
          />
          {driven.length > 1 && (
            <Polyline
              positions={driven}
              pathOptions={{
                color: dark ? "#9b948d" : "#6f6862",
                weight: 4,
                opacity: 0.8,
                dashArray: "2 8",
                lineCap: "round",
              }}
            />
          )}
          {roadRoute && live && !atSite && (
            <>
              <Polyline
                positions={roadRoute.coords}
                pathOptions={{ color: dark ? "#000" : "#3a2410", weight: 9, opacity: 0.35 }}
              />
              <Polyline
                positions={roadRoute.coords}
                pathOptions={{ color: "#FF7716", weight: 5, opacity: 0.95 }}
              />
            </>
          )}
          {destination && (
            <Marker
              position={[destination.lat, destination.lng]}
              icon={destIcon}
              title="Delivery site"
              alt="Delivery site"
            />
          )}
          {truck && (
            <Marker
              position={[truck.lat, truck.lng]}
              icon={tIcon}
              title={live ? "Truck, live" : "Truck, last known position"}
              alt="Truck"
              zIndexOffset={1000}
            />
          )}
        </MapContainer>

        {chip && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute left-3 right-3 top-3 z-[500] flex"
          >
            <span
              className={
                "rounded-full px-3.5 py-2 text-sm font-semibold shadow-lg " +
                (live || atSite ? "bg-cz-text text-cz-bg" : "bg-cz-surface text-cz-text")
              }
            >
              {chip}
            </span>
          </div>
        )}

        <div className="absolute bottom-7 right-3 z-[500] flex flex-col gap-2">
          {!follow && (
            <button
              type="button"
              onClick={() => {
                setFollow(true);
                setFitNonce((n) => n + 1);
              }}
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-cz-surface px-3.5 text-sm font-semibold text-cz-text shadow-lg"
            >
              <Locate aria-hidden className="h-4 w-4" /> Show whole trip
            </button>
          )}
          <button
            type="button"
            onClick={() => setBig((b) => !b)}
            aria-label={big ? "Make the map smaller" : "Make the map bigger"}
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-full bg-cz-surface text-cz-text shadow-lg"
          >
            {big ? (
              <Minimize2 aria-hidden className="h-5 w-5" />
            ) : (
              <Maximize2 aria-hidden className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      {showEta && etaMin != null && (
        <dl className="grid grid-cols-3 divide-x divide-cz-border border-t border-cz-border text-center">
          <div className="px-2 py-3">
            <dt className="flex items-center justify-center gap-1 text-xs text-cz-muted">
              <MapPin aria-hidden className="h-3 w-3" /> Arrives
            </dt>
            <dd className="text-[15px] font-semibold tabular-nums">{formatArrival(etaMin)}</dd>
          </div>
          <div className="px-2 py-3">
            <dt className="flex items-center justify-center gap-1 text-xs text-cz-muted">
              <Clock aria-hidden className="h-3 w-3" /> Drive time
            </dt>
            <dd className="text-[15px] font-semibold tabular-nums">{formatDuration(etaMin)}</dd>
          </div>
          <div className="px-2 py-3">
            <dt className="flex items-center justify-center gap-1 text-xs text-cz-muted">
              <Navigation aria-hidden className="h-3 w-3" /> By road
            </dt>
            <dd className="text-[15px] font-semibold tabular-nums">
              {formatDistance(route.distanceKm)}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
