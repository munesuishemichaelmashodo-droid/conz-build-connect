import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const RouteInput = z.object({
  startLat: z.number(),
  startLng: z.number(),
  destLat: z.number(),
  destLng: z.number(),
});

export type RouteResult = {
  distanceKm: number;
  etaMin: number;
  coords: [number, number][];
  source: "osrm" | "haversine";
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Real road route via OSRM's free public routing API, with a haversine
 * fallback so bookings still get a distance estimate if OSRM is slow/down.
 */
export const getRoute = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => RouteInput.parse(input))
  .handler(async ({ data }): Promise<RouteResult> => {
    const { startLat, startLng, destLat, destLng } = data;
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${startLng},${startLat};${destLng},${destLat}` +
      `?overview=full&geometries=geojson`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const json = (await res.json()) as {
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { coordinates: [number, number][] };
        }>;
      };
      const r = json.routes?.[0];
      if (!r) throw new Error("No route returned");
      const distanceKm = r.distance / 1000;
      const etaMin = Math.max(1, Math.round(r.duration / 60));
      // GeoJSON is [lng, lat]; react-leaflet Polyline expects [lat, lng].
      const coords: [number, number][] = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      return {
        distanceKm: Math.round(distanceKm * 10) / 10,
        etaMin,
        coords,
        source: "osrm",
      };
    } catch {
      const distanceKm = haversineKm({ lat: startLat, lng: startLng }, { lat: destLat, lng: destLng });
      const etaMin = Math.max(5, Math.round((distanceKm / 40) * 60) + 15);
      return {
        distanceKm: Math.round(distanceKm * 10) / 10,
        etaMin,
        coords: [
          [startLat, startLng],
          [destLat, destLng],
        ],
        source: "haversine",
      };
    }
  });
