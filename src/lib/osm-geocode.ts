// Address search/reverse-geocoding — proxied server-side through LocationIQ
// (free tier, no card required) with a safe fallback to Nominatim if the
// key isn't configured. See src/lib/geocode.functions.ts for the actual
// implementation; this file just re-exports the same interface every
// caller already uses, so nothing else needed to change.

import { searchAddressServer, reverseGeocodeServer } from "@/lib/geocode.functions";

export type BoundingBox = [number, number, number, number];

export type GeocodeResult = {
  label: string;
  lat: number;
  lng: number;
  bbox?: BoundingBox;
};

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    return await reverseGeocodeServer({ data: { lat, lng } });
  } catch {
    return null;
  }
}

export async function searchAddress(query: string, limit = 6): Promise<GeocodeResult[]> {
  try {
    return await searchAddressServer({ data: { query, limit } });
  } catch {
    return [];
  }
}
