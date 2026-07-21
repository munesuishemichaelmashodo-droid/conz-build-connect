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

export type GeocodeResult = { label: string; lat: number; lng: number };

export async function searchAddress(query: string, limit = 6): Promise<GeocodeResult[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=${limit}&addressdetails=1`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string }>;
    return data.map((d) => ({ label: d.display_name, lat: parseFloat(d.lat), lng: parseFloat(d.lon) }));
  } catch {
    return [];
  }
}
