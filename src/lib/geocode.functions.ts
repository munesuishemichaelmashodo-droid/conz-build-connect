import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// LocationIQ — free tier, no card required, 5,000 requests/day, built on
// OpenStreetMap data with real autocomplete-quality search. Kept server-side
// only so the key is never visible in the browser bundle and can't be
// scraped and used to burn through the free daily quota. Public (no auth) —
// used on the public /quote page as well as inside the authenticated app.

const SEARCH_URL = "https://api.locationiq.com/v1/autocomplete";
const REVERSE_URL = "https://us1.locationiq.com/v1/reverse";

type BoundingBox = [number, number, number, number];
type GeocodeResult = { label: string; lat: number; lng: number; bbox?: BoundingBox };

function parseBbox(bb?: [string, string, string, string]): BoundingBox | undefined {
  if (!bb) return undefined;
  return [parseFloat(bb[0]), parseFloat(bb[1]), parseFloat(bb[2]), parseFloat(bb[3])];
}

export const searchAddressServer = createServerFn({ method: "GET" })
  .inputValidator(z.object({ query: z.string(), limit: z.number().optional() }))
  .handler(async ({ data }): Promise<GeocodeResult[]> => {
    const q = data.query.trim();
    const limit = data.limit ?? 6;
    if (q.length < 3) return [];

    const key = process.env["LOCATIONIQ_API_KEY"]?.trim();
    if (!key) {
      // Safe fallback if the key isn't configured yet — keeps the app
      // working (free Nominatim) rather than breaking address search.
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=${limit}&addressdetails=1&countrycodes=zw&viewbox=25.2%2C-15.6%2C33.1%2C-22.5&bounded=1`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok) return [];
        const rows = (await res.json()) as Array<{ display_name: string; lat: string; lon: string; boundingbox?: [string, string, string, string] }>;
        return rows.map((d) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon), bbox: parseBbox(d.boundingbox) }));
      } catch {
        return [];
      }
    }

    try {
      const url = new URL(SEARCH_URL);
      url.searchParams.set("key", key);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("countrycodes", "zw");
      url.searchParams.set("viewbox", "25.2,-15.6,33.1,-22.5");
      url.searchParams.set("bounded", "1");
      url.searchParams.set("format", "json");
      url.searchParams.set("addressdetails", "1");
      url.searchParams.set("dedupe", "1");

      const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return [];
      const rows = (await res.json()) as Array<{ display_name: string; lat: string; lon: string; boundingbox?: [string, string, string, string] }>;
      return rows.map((d) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon), bbox: parseBbox(d.boundingbox) }));
    } catch {
      return [];
    }
  });

export const reverseGeocodeServer = createServerFn({ method: "GET" })
  .inputValidator(z.object({ lat: z.number(), lng: z.number() }))
  .handler(async ({ data }): Promise<string | null> => {
    const key = process.env["LOCATIONIQ_API_KEY"]?.trim();
    if (!key) {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${data.lat}&lon=${data.lng}&zoom=18&addressdetails=1`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) },
        );
        if (!res.ok) return null;
        const row = (await res.json()) as { display_name?: string };
        return row?.display_name ?? null;
      } catch {
        return null;
      }
    }

    try {
      const url = new URL(REVERSE_URL);
      url.searchParams.set("key", key);
      url.searchParams.set("lat", String(data.lat));
      url.searchParams.set("lon", String(data.lng));
      url.searchParams.set("format", "json");
      url.searchParams.set("zoom", "18");
      url.searchParams.set("addressdetails", "1");

      const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const row = (await res.json()) as { display_name?: string };
      return row?.display_name ?? null;
    } catch {
      return null;
    }
  });
