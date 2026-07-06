import { useEffect, useState } from "react";
import { LocateFixed, MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as string | undefined;
const TRACKING_ID = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as string | undefined;

declare global {
  interface Window {
    google?: any;
    __gmapsInitPromise?: Promise<void>;
    __gmapsInitResolve?: () => void;
    __initGmaps?: () => void;
  }
}

function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();
  if (window.__gmapsInitPromise) return window.__gmapsInitPromise;
  if (!BROWSER_KEY) return Promise.reject(new Error("Google Maps key missing"));
  window.__gmapsInitPromise = new Promise<void>((resolve) => {
    window.__gmapsInitResolve = resolve;
    window.__initGmaps = () => window.__gmapsInitResolve?.();
    const s = document.createElement("script");
    const params = new URLSearchParams({
      key: BROWSER_KEY,
      libraries: "places,marker",
      loading: "async",
      callback: "__initGmaps",
      v: "weekly",
    });
    if (TRACKING_ID) params.set("channel", TRACKING_ID);
    s.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  });
  return window.__gmapsInitPromise;
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    await loadGoogleMaps();
    const g = window.google;
    if (!g?.maps) return null;
    const geocoder = new g.maps.Geocoder();
    const res = await geocoder.geocode({ location: { lat, lng } });
    return res.results?.[0]?.formatted_address ?? null;
  } catch {
    return null;
  }
}

export function LocalLocator() {
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number; acc?: number } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setError("Geolocation not supported on this device");
      toast.error("Geolocation not supported");
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng, acc: pos.coords.accuracy });
        const addr = await reverseGeocode(lat, lng);
        setAddress(addr);
        setLoading(false);
        toast.success("Location captured");
      },
      (err) => {
        setLoading(false);
        setError(err.message);
        toast.error(err.message);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };

  // Auto-locate once on mount if permission already granted
  useEffect(() => {
    if (typeof navigator === "undefined" || !("permissions" in navigator)) return;
    (navigator as any).permissions
      ?.query({ name: "geolocation" })
      .then((res: PermissionStatus) => {
        if (res.state === "granted") locate();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mapHref = coords ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}` : "#";

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <MapPin className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">You are here</div>
            {loading ? (
              <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Locating…
              </div>
            ) : address ? (
              <div className="text-sm font-medium mt-1 break-words">{address}</div>
            ) : coords ? (
              <div className="text-sm font-medium mt-1">
                {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </div>
            ) : error ? (
              <div className="text-sm text-destructive mt-1">{error}</div>
            ) : (
              <div className="text-sm text-muted-foreground mt-1">Tap locate to see your address</div>
            )}
            {coords && (
              <div className="text-[11px] text-muted-foreground mt-1">
                {coords.acc ? `± ${Math.round(coords.acc)} m accuracy • ` : ""}
                <a href={mapHref} target="_blank" rel="noreferrer" className="text-primary underline">
                  Open in Maps
                </a>
              </div>
            )}
          </div>
        </div>
        <Button type="button" size="icon" variant="outline" onClick={locate} disabled={loading} title="Locate me">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
