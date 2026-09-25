import { useEffect, useRef, useState, type ReactNode } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CheckCircle2, Loader2, LocateFixed, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { truckMarkerIcon, type TruckMarker } from "@/components/redesign/PinMap";
import { reverseGeocode, searchAddress, type BoundingBox, type GeocodeResult } from "@/lib/osm-geocode";
import { CARTO_VOYAGER_TILES } from "@/lib/map-tiles";

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="background:hsl(var(--primary));color:hsl(var(--primary-foreground));width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><span style="transform:rotate(45deg);font-size:14px">📍</span></div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

// Redesign pin: amber, pulsing ring, inline SVG (no emoji).
const czPinIcon = L.divIcon({
  className: "",
  html: `<div style="position:relative;width:44px;height:50px"><span class="cz-pulse-ring" style="position:absolute;left:2px;top:8px;width:40px;height:40px;border-radius:50%;background:rgba(245,165,36,.28)"></span><svg width="44" height="50" viewBox="0 0 24 26" style="position:relative;display:block"><path d="M12 1C7 1 3 5 3 10c0 6.5 9 15 9 15s9-8.5 9-15c0-5-4-9-9-9z" fill="#F5A524" stroke="#1A1204" stroke-width=".6"/><circle cx="12" cy="10" r="3.5" fill="#1A1204"/></svg></div>`,
  iconSize: [44, 50],
  iconAnchor: [22, 48],
});

function Recenter({ lat, lng, zoom }: { lat: number; lng: number; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], zoom ?? map.getZoom());
  }, [lat, lng, zoom, map]);
  return null;
}

// When a search result has a bounding box (suburbs, landmarks, roads),
// frame the whole area instead of zooming to a single point.
// Declared AFTER <Recenter> in the tree so this view wins when both fire.
function FitBounds({ bbox }: { bbox: BoundingBox | null }) {
  const map = useMap();
  useEffect(() => {
    if (!bbox) return;
    map.fitBounds(
      [
        [bbox[0], bbox[2]], // [south, west]
        [bbox[1], bbox[3]], // [north, east]
      ],
      { padding: [30, 30], maxZoom: 17 },
    );
  }, [bbox, map]);
  return null;
}

// Clicking the map drops/moves the pin.
function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

function DraggableMarker({
  position,
  onDragEnd,
  icon = pinIcon,
}: {
  position: { lat: number; lng: number };
  onDragEnd: (lat: number, lng: number) => void;
  icon?: L.DivIcon;
}) {
  const ref = useRef<L.Marker | null>(null);
  return (
    <Marker
      draggable
      position={[position.lat, position.lng]}
      icon={icon}
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
  variant = "default",
  leading,
  trailing,
  controlsBottom = 360,
  initialCoords,
  trucks = [],
}: {
  value: string;
  onChange: (address: string, coords?: { lat: number; lng: number }) => void;
  label?: string;
  /** "fullscreen": redesign layout — the map fills its (positioned) parent,
   *  with the address field floating on top. Same search / GPS / pin /
   *  confirm logic as the default layout. */
  variant?: "default" | "fullscreen";
  /** fullscreen only: element before the address field (menu button). */
  leading?: ReactNode;
  /** fullscreen only: element after the address field (notifications). */
  trailing?: ReactNode;
  /** fullscreen only: px from the bottom for the locate/confirm controls
   *  (keeps them above the booking sheet). */
  controlsBottom?: number;
  /** Pre-confirmed point (e.g. "Book this driver again"), shown as the pin. */
  initialCoords?: { lat: number; lng: number } | null;
  /** fullscreen only: approximate Online trucks nearby (migration 0062). */
  trucks?: TruckMarker[];
}) {
  const [coords, setCoords] = useState<{ lat: number; lng: number }>(initialCoords ?? { lat: -17.8252, lng: 31.0335 });
  const [hasPin, setHasPin] = useState(!!initialCoords);
  const [confirmed, setConfirmed] = useState(!!initialCoords);
  const [zoom, setZoom] = useState(initialCoords ? 16 : 12);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [bbox, setBbox] = useState<BoundingBox | null>(null);

  useEffect(() => setQuery(value), [value]);

  // Debounced address search (powers the dropdown suggestions)
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
  // Pass a bbox when the source is a search result for an area (suburb, road,
  // landmark) so the map frames the area instead of a single point.
  const setPin = async (lat: number, lng: number, addressHint?: string, box?: BoundingBox) => {
    setCoords({ lat, lng });
    setHasPin(true);
    setConfirmed(false);
    setBbox(box ?? null);
    if (!box) setZoom(16);
    const addr = addressHint ?? (await reverseGeocode(lat, lng));
    const finalAddr = addr ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    setQuery(finalAddr);
    onChange(finalAddr, undefined);
  };

  const pickResult = (r: GeocodeResult) => {
    setOpen(false);
    setResults([]);
    void setPin(r.lat, r.lng, r.label, r.bbox);
  };

  // Pressing Enter in the search box: geocode the typed text and jump
  // straight to the best match — no dropdown click required.
  const searchAndJump = async () => {
    const q = query.trim();
    if (q.length < 3) return;
    setSearching(true);
    const r = await searchAddress(q);
    setSearching(false);
    setResults(r);
    if (r.length === 0) {
      toast.error("Couldn't find that place in Zimbabwe — try a suburb or landmark name");
      return;
    }
    pickResult(r[0]);
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
      toast.success("Location captured — tap Confirm to use it", { id: "address-picker-locate" });
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

  if (variant === "fullscreen") {
    return (
      <div className="absolute inset-0">
        <div className="absolute inset-x-0 top-0" style={{ bottom: controlsBottom - 40 }}>
          <MapContainer
            center={[coords.lat, coords.lng]}
            zoom={zoom}
            scrollWheelZoom={false}
            zoomControl={false}
            style={{ height: "100%", width: "100%", background: "#1a1c20" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url={CARTO_VOYAGER_TILES}
              subdomains="abcd"
              maxZoom={20}
            />
            <Recenter lat={coords.lat} lng={coords.lng} zoom={zoom} />
            <FitBounds bbox={bbox} />
            <ClickToPlace onPick={(lat, lng) => void setPin(lat, lng)} />
            {hasPin && <DraggableMarker position={coords} icon={czPinIcon} onDragEnd={(lat, lng) => void setPin(lat, lng)} />}
            {trucks.map((t, i) => (
              <Marker key={`${t.lat},${t.lng},${i}`} position={[t.lat, t.lng]} icon={truckMarkerIcon()} interactive={false} />
            ))}
          </MapContainer>
        </div>

        <div className="absolute inset-x-4 top-4 z-30 space-y-2">
          <div className="flex items-center gap-2.5">
            {leading}
            <div className="relative flex-1 min-w-0">
              <label
                htmlFor="addr-picker"
                className="flex h-[50px] items-center gap-2.5 rounded-[14px] bg-cz-bg px-3.5 shadow-[0_4px_14px_rgba(0,0,0,0.4)]"
              >
                <MapPin className="w-[18px] h-[18px] text-cz-amber shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[11px] leading-tight text-cz-muted">{label}</span>
                  <input
                    id="addr-picker"
                    value={query}
                    placeholder="Search address, suburb or landmark…"
                    className="min-w-0 border-0 bg-transparent p-0 text-[15px] font-semibold text-cz-text placeholder:font-normal placeholder:text-cz-faint outline-none"
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setOpen(true);
                      setConfirmed(false);
                      onChange(e.target.value, undefined);
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void searchAndJump();
                      }
                    }}
                    onBlur={() => {
                      // Delay long enough to outlast the 350ms debounce + fetch round-trip,
                      // and skip closing entirely while a search is still in flight.
                      setTimeout(() => {
                        if (!searching) setOpen(false);
                      }, 1200);
                    }}
                  />
                </span>
                {searching && <Loader2 className="w-4 h-4 animate-spin text-cz-muted shrink-0" />}
              </label>
              {open && query.trim().length >= 3 && (results.length > 0 || searching || results.length === 0) && (
                <div className="absolute z-40 left-0 right-0 top-[56px] rounded-[14px] border border-cz-border bg-cz-surface shadow-lg max-h-64 overflow-auto">
                  {searching && <div className="px-3.5 py-3 text-sm text-cz-muted">Searching…</div>}
                  {!searching && results.length === 0 && (
                    <div className="px-3.5 py-3 text-sm text-cz-muted">No results found — try a different spelling.</div>
                  )}
                  {results.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickResult(r)}
                      className="block w-full min-h-11 text-left px-3.5 py-2.5 text-sm hover:bg-cz-surface-2 border-b border-cz-border last:border-b-0"
                    >
                      {r.label}
                    </button>
                  ))}
                  {results.length > 0 && (
                    <div className="px-3.5 py-1.5 text-[10px] text-cz-muted text-right">
                      <a href="https://locationiq.com" target="_blank" rel="noreferrer" className="hover:underline">
                        Search by LocationIQ.com
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
            {trailing}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setManualMode((v) => !v)}
              className="min-h-9 whitespace-nowrap rounded-full bg-cz-bg/90 px-3 text-xs font-semibold text-cz-muted shadow"
            >
              {manualMode ? "Hide" : "Coordinates"}
            </button>
            {trucks.length > 0 && (
              <span className="inline-flex min-h-9 items-center whitespace-nowrap rounded-full bg-cz-bg/90 px-3 text-xs font-semibold text-cz-amber-text shadow">
                {trucks.length} truck{trucks.length === 1 ? "" : "s"} nearby
              </span>
            )}
            {hasPin && confirmed && (
              <span className="inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-cz-green-border bg-cz-green-tint px-3 text-xs font-semibold text-cz-green-text">
                <CheckCircle2 className="w-3.5 h-3.5" /> Confirmed
              </span>
            )}
          </div>

          {manualMode && (
            <div className="flex gap-2 rounded-[14px] bg-cz-bg p-2 shadow-lg">
              <input
                type="number"
                step="any"
                inputMode="decimal"
                placeholder="Lat e.g. -17.8252"
                aria-label="Latitude"
                value={manualLat}
                onChange={(e) => setManualLat(e.target.value)}
                className="h-11 w-full flex-1 min-w-0 rounded-xl border border-cz-border bg-cz-surface px-3 text-sm"
              />
              <input
                type="number"
                step="any"
                inputMode="decimal"
                placeholder="Lng e.g. 31.0335"
                aria-label="Longitude"
                value={manualLng}
                onChange={(e) => setManualLng(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    lockManualCoords();
                  }
                }}
                className="h-11 w-full flex-1 min-w-0 rounded-xl border border-cz-border bg-cz-surface px-3 text-sm"
              />
              <button type="button" onClick={lockManualCoords} className="h-11 shrink-0 rounded-xl bg-cz-surface-2 px-3.5 text-sm font-semibold">
                Lock
              </button>
            </div>
          )}
        </div>

        <div className="absolute inset-x-4 z-30 flex items-end justify-between gap-3" style={{ bottom: controlsBottom }}>
          {hasPin && !confirmed ? (
            <button
              type="button"
              onClick={confirmLocation}
              className="min-h-12 flex-1 inline-flex items-center justify-center gap-2 rounded-[14px] bg-cz-amber px-4 font-bold text-cz-amber-ink shadow-[0_4px_14px_rgba(0,0,0,0.4)]"
            >
              <CheckCircle2 className="w-5 h-5" /> Deliver here — confirm pin
            </button>
          ) : (
            <span className="text-[11px] text-[#3a3c42] bg-white/70 rounded px-1.5 py-0.5">
              {hasPin ? "Drag the pin to fine-tune" : "Tap the map to drop a pin"}
            </span>
          )}
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            aria-label="Use my current location"
            className="w-[50px] h-[50px] shrink-0 rounded-full bg-cz-bg text-cz-amber flex items-center justify-center shadow-[0_4px_14px_rgba(0,0,0,0.4)]"
          >
            {locating ? <Loader2 className="w-5 h-5 animate-spin" /> : <LocateFixed className="w-[22px] h-[22px]" />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="addr-picker">{label}</Label>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <MapPin className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none z-10" />
          <input
            id="addr-picker"
            value={query}
            placeholder="Search address, suburb or landmark…"
            className="flex h-10 w-full rounded-md border border-input bg-background pl-8 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              setConfirmed(false);
              onChange(e.target.value, undefined);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void searchAndJump();
              }
            }}
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
              {results.length > 0 && (
                <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground text-right">
                  <a href="https://locationiq.com" target="_blank" rel="noreferrer" className="hover:underline">
                    Search by LocationIQ.com
                  </a>
                </div>
              )}
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
          <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url={CARTO_VOYAGER_TILES}
                    subdomains="abcd"
                    maxZoom={20}
                  />
          <Recenter lat={coords.lat} lng={coords.lng} zoom={zoom} />
          <FitBounds bbox={bbox} />
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
