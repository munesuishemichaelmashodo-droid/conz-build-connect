import { useEffect } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { CARTO_ATTRIBUTION, CARTO_VOYAGER_TILES } from "@/lib/map-tiles";

export type TrailMark = { lat: number; lng: number; label: string; color: string };

function FitAll({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 14);
    else if (points.length > 1) map.fitBounds(points, { padding: [24, 24] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

/**
 * Admin-only map of a trip: the recorded route trail (0112) plus labelled marks
 * (expected supplier, pickup photo, delivery photo, delivery address). Loaded lazily
 * from the dispute panel so Leaflet never weighs on other screens.
 */
export default function RouteTrailMap({
  trail,
  marks,
}: {
  trail: { lat: number; lng: number }[];
  marks: TrailMark[];
}) {
  const all: [number, number][] = [
    ...trail.map((p) => [p.lat, p.lng] as [number, number]),
    ...marks.map((m) => [m.lat, m.lng] as [number, number]),
  ];
  if (!all.length) return null;
  return (
    <div className="h-56 w-full overflow-hidden rounded-lg border">
      <MapContainer
        center={all[0]}
        zoom={13}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution={CARTO_ATTRIBUTION}
          url={CARTO_VOYAGER_TILES}
          subdomains="abcd"
          maxZoom={20}
        />
        {trail.length > 1 && (
          <Polyline
            positions={trail.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: "#1f5fa8", weight: 4 }}
          />
        )}
        {marks.map((m) => (
          <CircleMarker
            key={m.label}
            center={[m.lat, m.lng]}
            radius={7}
            pathOptions={{ color: "#0b0907", weight: 1.5, fillColor: m.color, fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {m.label}
            </Tooltip>
          </CircleMarker>
        ))}
        <FitAll points={all} />
      </MapContainer>
    </div>
  );
}
