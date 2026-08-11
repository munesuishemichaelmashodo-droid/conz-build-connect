import { useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reverseGeocode } from "@/lib/osm-geocode";

export function LocalLocator() {
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number; acc?: number } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoLocatedRef = useRef(false);

  const locate = async () => {
    setLoading(true);
    setError(null);
    try {
      const { locateOnce } = await import("@/lib/geolocate");
      const c = await locateOnce({
        onUpdate: async (better) => {
          setCoords({ lat: better.lat, lng: better.lng, acc: better.accuracy });
          const addr = await reverseGeocode(better.lat, better.lng);
          if (addr) setAddress(addr);
        },
      });
      setCoords({ lat: c.lat, lng: c.lng, acc: c.accuracy });
      const addr = await reverseGeocode(c.lat, c.lng);
      setAddress(addr);
      setLoading(false);
      // Stable id: a second call (e.g. tapping locate again quickly) updates
      // this same toast in place instead of stacking a new one on top —
      // stacked toasts at top-center were covering the wallet card for
      // several seconds with no way to dismiss them.
      toast.success("Location captured", { id: "local-locator" });
    } catch (e: any) {
      setLoading(false);
      setError(e.message);
      toast.error(e.message, { id: "local-locator" });
    }
  };

  // Auto-locate once on mount if permission already granted. Guarded so
  // this can only ever fire once per component instance, even if the
  // effect somehow re-runs.
  useEffect(() => {
    if (autoLocatedRef.current) return;
    if (typeof navigator === "undefined" || !("permissions" in navigator)) return;
    (navigator as any).permissions
      ?.query({ name: "geolocation" })
      .then((res: PermissionStatus) => {
        if (res.state === "granted" && !autoLocatedRef.current) {
          autoLocatedRef.current = true;
          locate();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mapHref = coords ? `https://www.openstreetmap.org/?mlat=${coords.lat}&mlon=${coords.lng}#map=17/${coords.lat}/${coords.lng}` : "#";

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
