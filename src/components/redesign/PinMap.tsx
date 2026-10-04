import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CARTO_VOYAGER_TILES } from "@/lib/map-tiles";

/** Amber delivery pin with a pulsing ring and a "Deliver here" label.
 *  Inline SVG (no emoji) so it renders the same on every Android WebView. */
export function deliveryPinIcon(label: string | null = "Deliver here") {
  const tag = label
    ? `<div style="position:absolute;left:50%;bottom:58px;transform:translateX(-50%);white-space:nowrap;padding:5px 12px;border-radius:999px;background:#010101;color:#FCFAF8;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4)">${label}</div>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:44px;height:50px">
      <span class="cz-pulse-ring" style="position:absolute;left:2px;top:28px;width:40px;height:40px;margin-top:-20px;border-radius:50%;background:rgba(255,119,22,.28)"></span>
      <svg width="44" height="50" viewBox="0 0 24 26" style="position:relative;display:block"><path d="M12 1C7 1 3 5 3 10c0 6.5 9 15 9 15s9-8.5 9-15c0-5-4-9-9-9z" fill="#FF7716" stroke="#0B0907" stroke-width=".6"/><circle cx="12" cy="10" r="3.5" fill="#0B0907"/></svg>
      ${tag}
    </div>`,
    iconSize: [44, 50],
    iconAnchor: [22, 48],
  });
}

/** Approximate truck position (~1 km) with an optional label, e.g. "$150". */
export function truckMarkerIcon(label?: string | null) {
  const tag = label
    ? `<span style="position:absolute;left:34px;top:5px;white-space:nowrap;padding:3px 8px;border-radius:999px;background:#FF7716;color:#0B0907;font:700 12px Inter,system-ui,sans-serif">${label}</span>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:32px;height:32px;border-radius:9px;background:#010101;border:1.5px solid #FF7716;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.4)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FF7716" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7h12v9H2z"/><path d="M14 10h4l4 3.5V16h-8"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="18" cy="17.5" r="1.8"/></svg>${tag}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

export type TruckMarker = { lat: number; lng: number; label?: string | null };

function Recenter({ lat, lng, zoom }: { lat: number; lng: number; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], zoom);
  }, [lat, lng, zoom, map]);
  return null;
}

/** Zooms out just enough to show the pin plus any truck markers. */
function FitPoints({
  point,
  trucks,
}: {
  point: { lat: number; lng: number };
  trucks: TruckMarker[];
}) {
  const map = useMap();
  const key = trucks.map((t) => `${t.lat},${t.lng}`).join("|");
  useEffect(() => {
    if (!trucks.length) return;
    map.fitBounds(
      [[point.lat, point.lng], ...trucks.map((t) => [t.lat, t.lng] as [number, number])],
      { padding: [48, 48], maxZoom: 14 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, point.lat, point.lng, map]);
  return null;
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
 * Read-only map centred on one point with the delivery pin. Used behind
 * the customer "Driver offers" sheet and as the tracking fallback before
 * the driver starts sharing GPS. Same Leaflet + CARTO tiles as the rest of
 * the app.
 */
export function PinMap({
  point,
  label = "Deliver here",
  zoom = 14,
  className,
  trucks = [],
}: {
  point: { lat: number; lng: number };
  label?: string | null;
  zoom?: number;
  className?: string;
  /** Approximate positions of Online trucks (migration 0062). */
  trucks?: TruckMarker[];
}) {
  return (
    <div className={className} style={{ background: "#110e0c" }}>
      <MapContainer
        center={[point.lat, point.lng]}
        zoom={zoom}
        scrollWheelZoom={false}
        zoomControl={false}
        attributionControl
        style={{ height: "100%", width: "100%" }}
      >
        <ResizeFix />
        <Recenter lat={point.lat} lng={point.lng} zoom={zoom} />
        <FitPoints point={point} trucks={trucks} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url={CARTO_VOYAGER_TILES}
          subdomains="abcd"
          maxZoom={20}
        />
        <Marker
          position={[point.lat, point.lng]}
          icon={deliveryPinIcon(label)}
          interactive={false}
        />
        {trucks.map((t, i) => (
          <Marker
            key={`${t.lat},${t.lng},${i}`}
            position={[t.lat, t.lng]}
            icon={truckMarkerIcon(t.label)}
            interactive={false}
          />
        ))}
      </MapContainer>
    </div>
  );
}
