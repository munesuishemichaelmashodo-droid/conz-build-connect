import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, LocateFixed, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { reverseGeocode, searchAddress, type GeocodeResult } from "@/lib/osm-geocode";

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="background:hsl(var(--primary));color:hsl(var(--primary-foreground));width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><span style="transform:rotate(45deg);font-size:14px">📍</span></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function Recenter({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], zoom ?? map.getZoom());
  }, [lat, lng, zoom, map]);
  return null;
}

function DraggableMarker({
  position,
  onDragEnd,
}: {
  position: { lat: number; lng: number };
  onDragEnd: (lat: number, lng: number) => void;
}) {
  const ref = useRef<L.Marker | null>(null);
  return (
    <Marker
      draggable
      position={[position.lat, position.lng]}
      icon={pinIcon}
      ref={(m) => {
        ref.current = m;
      }}
      eventHandlers={{
        dragend: () => {
          const m = ref.current;
          if (!m) return;
          const p = m.getLatLng();
          onDragEnd(p.lat, p.lng);
        },
      }}
    />
  );
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
  const [coords, setCoords] = useState<{ lat: number; lng: number }>({ lat: -17.8252, lng: 31.0335 });
  const [hasPin, setHasPin] = useState(false);
  const [zoom, setZoom] = useState(12);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => setQuery(value), [value]);

  // Debounced address search
  useEffect(() => {
    if (!query || query.length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchAddress(query);
      setResults(r);
      setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const applyCoords = async (lat: number, lng: number, addressHint?: string) => {
    setCoords({ lat, lng });
    setHasPin(true);
    setZoom(16);
    const addr = addressHint ?? (await reverseGeocode(lat, lng));
    const finalAddr = addr ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    setQuery(finalAddr);
    onChange(finalAddr, { lat, lng });
  };

  const pickResult = (r: GeocodeResult) => {
    setOpen(false);
    setResults([]);
    void applyCoords(r.lat, r.lng, r.label);
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { locateOnce } = await import("@/lib/geolocate");
      const c = await locateOnce({ onUpdate: (better) => void applyCoords(better.lat, better.lng) });
      await applyCoords(c.lat, c.lng);
      toast.success("Location captured");
    } catch (e: any) {
      toast.error(e.message ?? "Could not get location");
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="addr-picker">{label}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <input
            id="addr-picker"
            value={query}
            placeholder="Search address…"
            className="flex h-10 w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              onChange(e.target.value, hasPin ? coords : undefined);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          {open && (results.length > 0 || searching) && (
            <div className="absolute z-20 left-0 right-0 top-11 rounded-md border bg-popover shadow-lg max-h-64 overflow-auto">
              {searching && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickResult(r)}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button type="button" variant="outline" size="icon" onClick={useMyLocation} disabled={locating} title="Use my current location">
          {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <LocateFixed className="w-4 h-4" />}
        </Button>
      </div>
      <div className="w-full h-56 rounded-xl border overflow-hidden bg-muted">
        <MapContainer
          center={[coords.lat, coords.lng]}
          zoom={zoom}
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Recenter lat={coords.lat} lng={coords.lng} zoom={zoom} />
          {hasPin && (
            <DraggableMarker
              position={coords}
              onDragEnd={(lat, lng) => void applyCoords(lat, lng)}
            />
          )}
        </MapContainer>
      </div>
      {hasPin && (
        <p className="text-[11px] text-muted-foreground">
          Pin: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} — drag the pin to fine-tune.
        </p>
      )}
    </div>
  );
}
