import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/** Amber delivery pin with a pulsing ring and a "Deliver here" label.
 *  Inline SVG (no emoji) so it renders the same on every Android WebView. */
export function deliveryPinIcon(label: string | null = "Deliver here") {
  const tag = label
    ? `<div style="position:absolute;left:50%;bottom:58px;transform:translateX(-50%);white-space:nowrap;padding:5px 12px;border-radius:999px;background:#121316;color:#F2F0EB;font:600 13px Barlow,system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4)">${label}</div>`
    : "";
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:44px;height:50px">
      <span class="cz-pulse-ring" style="position:absolute;left:2px;top:28px;width:40px;height:40px;margin-top:-20px;border-radius:50%;background:rgba(245,165,36,.28)"></span>
      <svg width="44" height="50" viewBox="0 0 24 26" style="position:relative;display:block"><path d="M12 1C7 1 3 5 3 10c0 6.5 9 15 9 15s9-8.5 9-15c0-5-4-9-9-9z" fill="#F5A524" stroke="#1A1204" stroke-width=".6"/><circle cx="12" cy="10" r="3.5" fill="#1A1204"/></svg>
      ${tag}
    </div>`,
    iconSize: [44, 50],
    iconAnchor: [22, 48],
  });
}

function Recenter({ lat, lng, zoom }: { lat: number; lng: number; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], zoom);
  }, [lat, lng, zoom, map]);
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
}: {
  point: { lat: number; lng: number };
  label?: string | null;
  zoom?: number;
  className?: string;
}) {
  return (
    <div className={className} style={{ background: "#1a1c20" }}>
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
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />
        <Marker
          position={[point.lat, point.lng]}
          icon={deliveryPinIcon(label)}
          interactive={false}
        />
      </MapContainer>
    </div>
  );
}
