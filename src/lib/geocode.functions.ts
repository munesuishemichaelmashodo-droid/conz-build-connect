import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Address search / reverse geocoding, proxied server-side.
//
// Primary: LocationIQ (free tier, no card, built on OpenStreetMap). The key
// stays server-side so it can't be scraped from the bundle. IMPORTANT: the
// free tier serves /search and /reverse but NOT /autocomplete — using
// /autocomplete returns an "Access Restricted" error on a free key, which is
// why forward search silently returned nothing while the map pin (/reverse)
// worked. We use /search here.
//
// Fallback: OpenStreetMap's public Nominatim, used when no LocationIQ key is
// configured AND whenever a LocationIQ call fails (bad key, quota, outage).
// Nominatim's usage policy REQUIRES a descriptive User-Agent — requests
// without one get a 403, so it must always be sent.
//
// Public (no auth): used on the public /quote page and inside the app.

const LIQ_SEARCH_URL = "https://us1.locationiq.com/v1/search";
const LIQ_REVERSE_URL = "https://us1.locationiq.com/v1/reverse";
const NOMINATIM_UA = "ConZ/1.0 (+https://conz.co.zw; support@conz.co.zw)";
// Zimbabwe bounding box, used as a soft result bias (bounded=0), not a hard
// filter — countrycodes=zw already restricts results to Zimbabwe. bounded=1
// previously threw away valid in-country matches in some cases.
const ZW_VIEWBOX = "25.2,-15.6,33.1,-22.5";

type BoundingBox = [number, number, number, number];
type GeocodeResult = { label: string; lat: number; lng: number; bbox?: BoundingBox };
type OsmRow = { display_name: string; lat: string; lon: string; boundingbox?: [string, string, string, string] };

function parseBbox(bb?: [string, string, string, string]): BoundingBox | undefined {
  if (!bb) return undefined;
  return [parseFloat(bb[0]), parseFloat(bb[1]), parseFloat(bb[2]), parseFloat(bb[3])];
}

function mapRows(rows: OsmRow[]): GeocodeResult[] {
  return rows
    .filter((d) => d && d.lat && d.lon)
    .map((d) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon), bbox: parseBbox(d.boundingbox) }));
}

async function nominatimSearch(q: string, limit: number): Promise<GeocodeResult[]> {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}` +
    `&limit=${limit}&addressdetails=1&countrycodes=zw&viewbox=${encodeURIComponent(ZW_VIEWBOX)}&bounded=0`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": NOMINATIM_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    console.error(`[geocode] nominatim search HTTP ${res.status} for "${q}"`);
    return [];
  }
  return mapRows((await res.json()) as OsmRow[]);
}

export const searchAddressServer = createServerFn({ method: "GET" })
  .inputValidator(z.object({ query: z.string(), limit: z.number().optional() }))
  .handler(async ({ data }): Promise<GeocodeResult[]> => {
    const q = data.query.trim();
    const limit = data.limit ?? 6;
    if (q.length < 3) return [];

    const key = process.env["LOCATIONIQ_API_KEY"]?.trim();

    if (key) {
      try {
        const url = new URL(LIQ_SEARCH_URL);
        url.searchParams.set("key", key);
        url.searchParams.set("q", q);
        url.searchParams.set("limit", String(limit));
        url.searchParams.set("countrycodes", "zw");
        url.searchParams.set("viewbox", ZW_VIEWBOX);
        url.searchParams.set("bounded", "0");
        url.searchParams.set("format", "json");
        url.searchParams.set("addressdetails", "1");
        url.searchParams.set("dedupe", "1");

        const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          return mapRows((await res.json()) as OsmRow[]);
        }
        // Bad key / quota / autocomplete-not-on-plan / outage: log the real
        // reason and fall through to Nominatim instead of returning nothing.
        const body = await res.text().catch(() => "");
        console.error(`[geocode] LocationIQ search HTTP ${res.status} for "${q}": ${body.slice(0, 200)}`);
      } catch (err) {
        console.error(`[geocode] LocationIQ search threw for "${q}":`, err instanceof Error ? err.message : err);
      }
    }

    // No key, or LocationIQ failed — use Nominatim (with the required UA).
    try {
      return await nominatimSearch(q, limit);
    } catch (err) {
      console.error(`[geocode] nominatim search threw for "${q}":`, err instanceof Error ? err.message : err);
      return [];
    }
  });

export const reverseGeocodeServer = createServerFn({ method: "GET" })
  .inputValidator(z.object({ lat: z.number(), lng: z.number() }))
  .handler(async ({ data }): Promise<string | null> => {
    const key = process.env["LOCATIONIQ_API_KEY"]?.trim();

    if (key) {
      try {
        const url = new URL(LIQ_REVERSE_URL);
        url.searchParams.set("key", key);
        url.searchParams.set("lat", String(data.lat));
        url.searchParams.set("lon", String(data.lng));
        url.searchParams.set("format", "json");
        url.searchParams.set("zoom", "18");
        url.searchParams.set("addressdetails", "1");

        const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const row = (await res.json()) as { display_name?: string };
          return row?.display_name ?? null;
        }
        const body = await res.text().catch(() => "");
        console.error(`[geocode] LocationIQ reverse HTTP ${res.status}: ${body.slice(0, 200)}`);
      } catch (err) {
        console.error("[geocode] LocationIQ reverse threw:", err instanceof Error ? err.message : err);
      }
    }

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${data.lat}&lon=${data.lng}&zoom=18&addressdetails=1`,
        { headers: { Accept: "application/json", "User-Agent": NOMINATIM_UA }, signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) {
        console.error(`[geocode] nominatim reverse HTTP ${res.status}`);
        return null;
      }
      const row = (await res.json()) as { display_name?: string };
      return row?.display_name ?? null;
    } catch (err) {
      console.error("[geocode] nominatim reverse threw:", err instanceof Error ? err.message : err);
      return null;
    }
  });
