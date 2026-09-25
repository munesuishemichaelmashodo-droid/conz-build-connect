/**
 * CARTO basemap tiles (Voyager style) used by every Leaflet map in the app.
 *
 * Since 23/09/2026 CARTO requires an API key on basemaps.cartocdn.com —
 * without one every tile comes back as an "API KEY REQUIRED" image. The key
 * is a public, browser-side key (it's visible in tile requests by design),
 * so it's read from a VITE_ env var set in Vercel: VITE_CARTO_API_KEY.
 * Get one (free) at https://carto.com/basemaps/apikey.
 *
 * With no key set the URL is unchanged, so local dev and previews behave
 * exactly as before.
 */
const CARTO_KEY = (import.meta.env.VITE_CARTO_API_KEY as string | undefined)?.trim();

export const CARTO_VOYAGER_TILES =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" +
  (CARTO_KEY ? `?key=${encodeURIComponent(CARTO_KEY)}` : "");

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
