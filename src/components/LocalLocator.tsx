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

function isInsecureContext() {
  return typeof window !== "undefined" && !window.isSecureContext;
}

function isIframedWithoutPermission() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function LocalLocator() {
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number; acc?: number } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setError("Geolocation is not supported on this device.");
      toast.error("Geolocation not supported");
      return;
    }
    if (isInsecureContext()) {
      setError("Location requires a secure (HTTPS) connection.");
      toast.error("Insecure connection — HTTPS required");
      return;
    }

    setLoading(true);
    setError(null);
    setDenied(false);

    // Call synchronously inside the click handler to preserve the user gesture.
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng, acc: pos.coords.accuracy });
        try {
          const addr = await reverseGeocode(lat, lng);
          setAddress(addr);
        } catch {
          /* keep coords even if reverse geocode fails */
        }
        setLoading(false);
        toast.success("Location captured");
      },
      (err) => {
        setLoading(false);
        let msg = err.message || "Could not get your location";
        if (err.code === err.PERMISSION_DENIED) {
          setDenied(true);
          msg = isIframedWithoutPermission()
            ? "Location blocked in this embedded preview. Open the app in a new tab or enable location in your browser site settings."
            : "Location permission denied. Enable it in your browser site settings and tap Locate again.";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          msg = "Location unavailable right now. Try again in a moment or move to an open area.";
        } else if (err.code === err.TIMEOUT) {
          msg = "Location request timed out. Tap Locate to try again.";
        }
        setError(msg);
        toast.error(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  };

  // Auto-locate once on mount ONLY if permission is already granted
  // (avoids triggering a prompt without user gesture, which some browsers auto-deny).
  useEffect(() => {
    if (typeof navigator === "undefined" || !("permissions" in navigator)) return;
    (navigator as any).permissions
      ?.query({ name: "geolocation" })
      .then((res: PermissionStatus) => {
        if (res.state === "granted") locate();
        if (res.state === "denied") setDenied(true);
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
            {denied && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                Blocked? In your browser: tap the lock icon in the address bar → Site settings → Location → Allow, then reload.
                {isIframedWithoutPermission() && (
                  <>
                    {" "}
                    Or{" "}
                    <a
                      href={typeof window !== "undefined" ? window.location.href : "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline"
                    >
                      open in a new tab
                    </a>
                    .
                  </>
                )}
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
