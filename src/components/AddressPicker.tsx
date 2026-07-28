import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CheckCircle2, Loader2, LocateFixed, MapPin } from "lucide-react";
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

// Optional: clicking the map drops/moves the pin. Delete this component and
// its usage inside <MapContainer> if you don't want click-to-place.
function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
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
  const [confirmed, setConfirmed] = useState(false);
  const [zoom, setZoom] = useState(12);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");

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

  // Set/update the pin locally without committing coords upstream.
  const setPin = async (lat: number, lng: number, addressHint?: string) => {
    setCoords({ lat, lng });
    setHasPin(true);
    setConfirmed(false);
    setZoom(16);
    const addr = addressHint ?? (await reverseGeocode(lat, lng));
    const finalAddr = addr ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    setQuery(finalAddr);
    // Update address text upstream, but don't attach coords until user confirms.
    onChange(finalAddr, undefined);
  };

  const pickResult = (r: GeocodeResult) => {
    setOpen(false);
    setResults([]);
    void setPin(r.lat, r.lng, r.label);
  };

  const confirmLocation = () => {
    if (!hasPin) return;
    setConfirmed(true);
    onChange(query, coords);
    toast.success("Location confirmed");
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { locateOnce } = await import("@/lib/geolocate");
      const c = await locateOnce({ onUpdate: (better) => void setPin(better.lat, better.lng) });
      await setPin(c.lat, c.lng);
      toast.success("Location captured — tap Confirm to use it");
    } catch (e: any) {
      toast.error(e.message ?? "Could not get location");
    } finally {
      setLocating(false);
    }
  };

  // Manual lat/lng entry: validate, sanity-check against Zimbabwe's bounds,
  // then run through the exact same setPin pipeline as search/GPS/map clicks.
  // Commit still happens via the single "Confirm this location" button.
  const lockManualCoords = () => {
    const latText = manualLat.trim();
    const lngText = manualLng.trim();
    const lat = Number(latText);
    const lng = Number(lngText);

    if (!latText || !lngText || Number.isNaN(lat) || Number.isNaN(lng)) {
      toast.error("Enter valid numbers for latitude and longitude");
      return;
    }
    if (lat < -22.5 || lat > -15.5 || lng < 25 || lng > 33.5) {
      toast.error("Those coordinates look outside Zimbabwe — double-check them");
      return;
    }

    setManualMode(false);
    void setPin(lat, lng);
    toast.success("Coordinates set — tap Confirm to use them");
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
              setConfirmed(false);
              onChange(e.target.value, undefined);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Delay long enough to outlast the 350ms debounce + fetch round-trip,
              // and skip closing entirely while a search is still in flight.
              setTimeout(() => {
                if (!searching) setOpen(false);
              }, 1200);
            }}
          />
          {open && query.trim().length >= 3 && (results.length > 0 || searching || results.length === 0) && (
            <div className="absolute z-20 left-0 right-0 top-11 rounded-md border bg-popover shadow-lg max-h-64 overflow-auto">
              {searching && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
              {!searching && results.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No results found — try a different spelling.
                </div>
              )}
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

      <button
        type="button"
        onClick={() => setManualMode((v) => !v)}
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {manualMode ? "Hide coordinate entry" : "Enter coordinates manually"}
      </button>

      {manualMode && (
        <div className="flex gap-2">
          <input
            type="number"
            step="any"
            inputMode="decimal"
            placeholder="Lat e.g. -17.8252"
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
            className="flex h-10 w-full flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="number"
            step="any"
            inputMode="decimal"
            placeholder="Lng e.g. 31.0335"
            value={manualLng}
            onChange={(e) => setManualLng(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                lockManualCoords();
              }
            }}
            className="flex h-10 w-full flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="button" variant="secondary" onClick={lockManualCoords}>
            Lock
          </Button>
        </div>
      )}

      <div className="w-full h-56 rounded-xl border overflow-hidden bg-muted">
        <MapContainer
          center={[coords.lat, coords.lng]}
          zoom={zoom}
          scrollWheelZoom={false}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Recenter lat={coords.lat} lng={coords.lng} zoom={zoom} />
          <ClickToPlace onPick={(lat, lng) => void setPin(lat, lng)} />
          {hasPin && (
            <DraggableMarker
              position={coords}
              onDragEnd={(lat, lng) => void setPin(lat, lng)}
            />
          )}
        </MapContainer>
      </div>

      {hasPin && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Pin: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} — drag the pin to fine-tune.
          </p>
          <Button
            type="button"
            onClick={confirmLocation}
            variant={confirmed ? "outline" : "default"}
            className="w-full"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {confirmed ? "Location confirmed — tap to update" : "Confirm this location"}
          </Button>
        </div>
      )}
    </div>
  );
}
