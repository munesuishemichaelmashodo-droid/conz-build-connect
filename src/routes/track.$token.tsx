import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { supabase } from "@/integrations/supabase/client";
import { materialLabel, statusInfo, type MaterialCategory } from "@/lib/domain";
import { StatusBadge } from "@/components/ui-bits";
import { RouteMap } from "@/components/RouteMap";
import { Calendar, CheckCircle2, Loader2, MapPin, Navigation2, Package } from "lucide-react";

// Public, login-free live tracking page.
// Access is gated by the job's unguessable tracking_token (the URL itself is the key).
// Polls the token-gated RPC every 15s — anonymous users don't get Realtime,
// and we never open RLS on jobs/driver_locations for this.

export const Route = createFileRoute("/track/$token")({
  ssr: false,
  component: PublicTrackPage,
});

type TrackPayload = {
  status: string;
  material: MaterialCategory;
  custom_material: string | null;
  quantity_m3: number;
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  preferred_date: string | null;
  driver_name: string | null;
  live: { lat: number; lng: number; updated_at: string } | null;
};

const truckIcon = L.divIcon({
  className: "",
  html: `<div style="background:hsl(var(--primary));color:hsl(var(--primary-foreground));width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:16px">🚚</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const destIcon = L.divIcon({
  className: "",
  html: `<div style="background:#16a34a;color:white;width:26px;height:26px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><span style="transform:rotate(45deg);font-size:12px">📍</span></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 26],
});

// Pans the map to follow the truck without remounting it —
// avoids the tile-reload flash on every 15s poll.
function Follow({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng]);
  }, [lat, lng, map]);
  return null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-screen-sm px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <img src="/conz-logo.png" alt="Con Z" className="h-8 w-auto" />
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Live delivery tracking
          </span>
        </div>
        {children}
        <p className="text-center text-[11px] text-muted-foreground pt-4">
          Powered by Con Z — Zimbabwe's construction marketplace
        </p>
      </div>
    </div>
  );
}

function PublicTrackPage() {
  const { token } = Route.useParams();

  const { data, isLoading } = useQuery({
    queryKey: ["public-track", token],
    refetchInterval: 15000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_public_tracking", { _token: token });
      if (error) throw error;
      return (data ?? null) as TrackPayload | null;
    },
  });

  if (isLoading) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading tracking…
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <div className="rounded-2xl bg-card border p-6 text-center space-y-2">
          <MapPin className="w-6 h-6 text-muted-foreground mx-auto" />
          <div className="font-display font-bold">Tracking link not found</div>
          <p className="text-xs text-muted-foreground">
            This tracking link is invalid or the job was removed. Ask the sender to share a fresh link.
          </p>
        </div>
      </Shell>
    );
  }

  const s = statusInfo(data.status);
  const driverFirst = data.driver_name?.trim().split(" ")[0] ?? null;
  const destination =
    data.delivery_lat != null && data.delivery_lng != null
      ? { lat: Number(data.delivery_lat), lng: Number(data.delivery_lng) }
      : null;
  const live = data.live;

  return (
    <Shell>
      {/* Delivery summary */}
      <div className="rounded-2xl bg-card border p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display font-bold text-xl">
            {materialLabel(data.material as any, data.custom_material)}
          </h1>
          <StatusBadge label={s.label} className={s.className} />
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-muted-foreground" />
            <span>{Number(data.quantity_m3)} m³</span>
          </div>
          {data.preferred_date && (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span>{data.preferred_date}</span>
            </div>
          )}
        </div>
        {data.delivery_address && (
          <div className="flex items-start gap-2 text-sm border-t pt-3">
            <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
            <span>{data.delivery_address}</span>
          </div>
        )}
        {driverFirst && (
          <p className="text-xs text-muted-foreground">Driver: {driverFirst}</p>
        )}
      </div>

      {data.status === "completed" ? (
        <div className="rounded-2xl border border-success/40 bg-success/10 p-4 flex items-center gap-2 text-sm">
          <CheckCircle2 className="w-5 h-5 text-success" />
          <span><strong>Delivered.</strong> This delivery is complete.</span>
        </div>
      ) : (
        <>
          {/* Live map */}
          <div className="rounded-2xl bg-card border overflow-hidden">
            <div className="flex items-center gap-2 px-4 pt-4 pb-2 font-display font-bold uppercase text-sm tracking-wide">
              <Navigation2 className="w-4 h-4 text-primary" /> Live driver location
            </div>
            {live ? (
              <>
                <div className="h-64 w-full">
                  <MapContainer
                    center={[live.lat, live.lng]}
                    zoom={15}
                    scrollWheelZoom={false}
                    style={{ height: "100%", width: "100%" }}
                  >
                    <Follow lat={live.lat} lng={live.lng} />
                    <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <Marker position={[live.lat, live.lng]} icon={truckIcon}>
                      <Popup>Updated {new Date(live.updated_at).toLocaleTimeString()}</Popup>
                    </Marker>
                    {destination && (
                      <Marker position={[destination.lat, destination.lng]} icon={destIcon} />
                    )}
                  </MapContainer>
                </div>
                <div className="px-4 py-2 text-[11px] text-muted-foreground flex justify-between">
                  <span>Live — refreshes every 15 seconds</span>
                  <span>Updated {new Date(live.updated_at).toLocaleTimeString()}</span>
                </div>
              </>
            ) : (
              <p className="px-4 pb-4 text-xs text-muted-foreground">
                {driverFirst ?? "The driver"} hasn't started sharing live location yet — this page
                refreshes automatically and the truck will appear here once they're moving.
              </p>
            )}
          </div>

          {live && destination && (
            <RouteMap
              driverLocation={{ lat: live.lat, lng: live.lng }}
              initialDestination={destination}
            />
          )}
        </>
      )}
    </Shell>
  );
}
