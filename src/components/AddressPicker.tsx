import { useEffect, useRef, useState } from "react";
import { Loader2, LocateFixed, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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
  if (window.google?.maps?.places) return Promise.resolve();
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

export function AddressPicker({
  value,
  onChange,
  label = "Delivery address",
}: {
  value: string;
  onChange: (address: string, coords?: { lat: number; lng: number }) => void;
  label?: string;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mapObj = useRef<any>(null);
  const marker = useRef<any>(null);
  const autocomplete = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled) return;
        const g = window.google;
        if (!g || !mapRef.current || !inputRef.current) return;

        mapObj.current = new g.maps.Map(mapRef.current, {
          center: { lat: -17.8252, lng: 31.0335 }, // Harare fallback
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
        });
        marker.current = new g.maps.Marker({ map: mapObj.current, draggable: true });

        autocomplete.current = new g.maps.places.Autocomplete(inputRef.current, {
          fields: ["formatted_address", "geometry", "name"],
        });
        autocomplete.current.addListener("place_changed", () => {
          const p = autocomplete.current.getPlace();
          if (!p?.geometry?.location) return;
          const lat = p.geometry.location.lat();
          const lng = p.geometry.location.lng();
          const address = p.formatted_address ?? p.name ?? "";
          setCoords({ lat, lng });
          mapObj.current.setCenter({ lat, lng });
          mapObj.current.setZoom(16);
          marker.current.setPosition({ lat, lng });
          onChange(address, { lat, lng });
        });

        marker.current.addListener("dragend", async () => {
          const pos = marker.current.getPosition();
          const lat = pos.lat();
          const lng = pos.lng();
          setCoords({ lat, lng });
          const addr = await reverseGeocode(lat, lng);
          if (addr && inputRef.current) inputRef.current.value = addr;
          onChange(addr ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`, { lat, lng });
        });

        setReady(true);
      })
      .catch((e) => toast.error(e.message ?? "Failed to load map"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) return toast.error("Geolocation not supported");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setCoords({ lat, lng });
        if (mapObj.current) {
          mapObj.current.setCenter({ lat, lng });
          mapObj.current.setZoom(17);
          marker.current?.setPosition({ lat, lng });
        }
        const addr = await reverseGeocode(lat, lng);
        if (addr && inputRef.current) inputRef.current.value = addr;
        onChange(addr ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`, { lat, lng });
        setLocating(false);
        toast.success("Location captured");
      },
      (err) => {
        setLocating(false);
        toast.error(err.message);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="addr-picker">{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            id="addr-picker"
            defaultValue={value}
            placeholder="Search address…"
            className="flex h-10 w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(e) => onChange(e.target.value, coords ?? undefined)}
          />
        </div>
        <Button type="button" variant="outline" size="icon" onClick={useMyLocation} disabled={!ready || locating} title="Use my current location">
          {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
        </Button>
      </div>
      <div ref={mapRef} className="w-full h-56 rounded-xl border overflow-hidden bg-muted" />
      {coords && (
        <p className="text-[11px] text-muted-foreground">
          Pin: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} — drag the pin to fine-tune.
        </p>
      )}
      {!BROWSER_KEY && <p className="text-xs text-destructive">Google Maps key not configured.</p>}
    </div>
  );
}

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const g = window.google;
    if (!g?.maps) return null;
    const geocoder = new g.maps.Geocoder();
    const res = await geocoder.geocode({ location: { lat, lng } });
    return res.results?.[0]?.formatted_address ?? null;
  } catch {
    return null;
  }
}
