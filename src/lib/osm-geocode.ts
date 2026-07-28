// Free geocoding via OpenStreetMap Nominatim. No API key, no billing.
// Usage policy: keep volume low, identify via Referer (browsers set this automatically).
// https://operations.osmfoundation.org/policies/nominatim/

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data?.display_name as string) ?? null;
  } catch {
    return null;
  }
}

// [south, north, west, east] — same order as Nominatim's boundingbox field.
export type BoundingBox = [number, number, number, number];

export type GeocodeResult = {
  label: string;
  lat: number;
  lng: number;
  bbox?: BoundingBox;
};

export async function searchAddress(query: string, limit = 6): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=${limit}&addressdetails=1&countrycodes=zw&viewbox=25.2%2C-15.6%2C33.1%2C-22.5&bounded=1`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{
      display_name: string;
      lat: string;
      lon: string;
      boundingbox?: [string, string, string, string];
    }>;
    return data.map((d) => ({
      label: d.display_name,
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
      bbox: d.boundingbox
        ? ([
            parseFloat(d.boundingbox[0]), // south
            parseFloat(d.boundingbox[1]), // north
            parseFloat(d.boundingbox[2]), // west
            parseFloat(d.boundingbox[3]), // east
          ] as BoundingBox)
        : undefined,
    }));
  } catch {
    return [];
  }
}
