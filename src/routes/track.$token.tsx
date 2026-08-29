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
import { OpenInAppBanner } from "@/components/OpenInAppBanner";
import { Calendar, CheckCircle2, Loader2, MapPin, Navigation2, Package, Receipt } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getPublicPod, type PodResult } from "@/lib/pod.functions";
import { money } from "@/lib/domain";
import { useState } from "react";
import jsPDF from "jspdf";

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function downloadReceiptPdf(pod: NonNullable<PodResult>) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = 595;
  const marginX = 48;
  const rightX = pageW - marginX;
  let y = 56;

  // Header: logo (if it loads) + company identity, receipt number + issue
  // date on the right — the layout a real business receipt/invoice uses,
  // not just a plain title.
  const logoDataUrl = await toDataUrl("/conz-logo.png");
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", marginX, y - 14, 32, 32);
    } catch {
      /* skip logo if it can't be embedded, rest of the receipt still renders */
    }
  }
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Con Z", marginX + (logoDataUrl ? 40 : 0), y + 8);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120);
  doc.text("Zimbabwe's Construction Marketplace", marginX + (logoDataUrl ? 40 : 0), y + 20);

  doc.setFontSize(9);
  doc.setTextColor(0);
  doc.setFont("helvetica", "bold");
  doc.text("DELIVERY RECEIPT", rightX, y, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  doc.text(`Receipt No: ${pod.receiptNo}`, rightX, y + 14, { align: "right" });
  doc.text(`Issued: ${new Date().toLocaleDateString()}`, rightX, y + 26, { align: "right" });
  doc.setTextColor(0);

  y += 50;
  doc.setDrawColor(220);
  doc.line(marginX, y, rightX, y);
  y += 20;

  doc.setFontSize(8);
  doc.setTextColor(140);
  doc.text("All amounts in USD", marginX, y);
  doc.setTextColor(0);
  y += 20;

  const row = (label: string, value: string) => {
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(label, marginX, y);
    doc.setTextColor(0);
    doc.setFont("helvetica", "bold");
    doc.text(value, rightX, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 20;
  };

  const materialLabelText = pod.customMaterial || pod.material.replace("_", " ");
  row("Material", `${materialLabelText} — ${pod.quantityM3} m³`);
  if (pod.deliveryAddress) row("Delivered to", pod.deliveryAddress);
  if (pod.driverName) row("Driver", pod.driverName);
  row("Payment method", pod.paymentMethod === "escrow" ? "Con Z Pay (held & released on confirmation)" : "Paid directly to driver");
  if (pod.completedAt) row("Completed", new Date(pod.completedAt).toLocaleString());
  y += 8;
  doc.line(marginX, y, rightX, y);
  y += 8;

  if (pod.finalPrice != null) {
    y += 16;
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(marginX, y - 20, rightX - marginX, 32, 4, 4, "F");
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Total paid", marginX + 12, y);
    doc.text(money(pod.finalPrice), rightX - 12, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += 32;
  }

  const photos = [pod.pickupPhotos[0], pod.deliveryPhotos[0]].filter(Boolean) as { url: string }[];
  const labels = ["Pickup", "Delivered"];
  if (photos.length > 0) {
    y += 12;
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text("Photo evidence", marginX, y);
    doc.setTextColor(0);
    y += 12;
    const imgSize = 220;
    let x = marginX;
    for (let i = 0; i < photos.length; i++) {
      const dataUrl = await toDataUrl(photos[i].url);
      if (dataUrl) {
        try {
          doc.addImage(dataUrl, "JPEG", x, y, imgSize, imgSize, undefined, "FAST");
        } catch {
          /* skip if the image can't be embedded */
        }
      }
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(labels[i], x, y + imgSize + 12);
      doc.setTextColor(0);
      x += imgSize + 24;
    }
    y += imgSize + 32;
  }

  doc.setDrawColor(230);
  doc.line(marginX, 760, rightX, 760);
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text("Con Z Connect (Pvt) Ltd  ·  conz.co.zw  ·  support@conz.co.zw", marginX, 774);
  doc.text("This is a computer-generated receipt and requires no signature.", marginX, 786);

  doc.save(`${pod.receiptNo}.pdf`);
}


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
        <OpenInAppBanner />
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
  const runGetPod = useServerFn(getPublicPod);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

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

  const { data: pod } = useQuery({
    queryKey: ["public-pod", token],
    enabled: data?.status === "completed",
    queryFn: async () => runGetPod({ data: { token } }),
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
        <div className="rounded-2xl border border-success/40 bg-success/10 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
            <span><strong>Delivered.</strong> This delivery is complete.</span>
          </div>
          {pod && (
            <div className="rounded-xl bg-card border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-display font-bold uppercase text-sm tracking-wide">
                  <Receipt className="w-4 h-4 text-primary" /> Receipt
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">{pod.receiptNo}</span>
              </div>
              <div className="grid grid-cols-2 gap-y-2 text-xs">
                {pod.finalPrice != null && (
                  <>
                    <span className="text-muted-foreground">Total paid (USD)</span>
                    <span className="font-semibold text-right">{money(pod.finalPrice)}</span>
                  </>
                )}
                <span className="text-muted-foreground">Payment method</span>
                <span className="text-right">{pod.paymentMethod === "escrow" ? "Con Z Pay" : "Direct to driver"}</span>
                {pod.completedAt && (
                  <>
                    <span className="text-muted-foreground">Completed</span>
                    <span className="text-right">{new Date(pod.completedAt).toLocaleString()}</span>
                  </>
                )}
                {pod.driverName && (
                  <>
                    <span className="text-muted-foreground">Driver</span>
                    <span className="text-right">{pod.driverName}</span>
                  </>
                )}
              </div>
              {(pod.pickupPhotos.length > 0 || pod.deliveryPhotos.length > 0) && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {pod.pickupPhotos.length > 0 && (
                    <figure className="space-y-1">
                      <img src={pod.pickupPhotos[0].url} alt="Load confirmed" className="w-full aspect-square object-cover rounded-lg border" />
                      <figcaption className="text-[10px] text-muted-foreground text-center">Pickup</figcaption>
                    </figure>
                  )}
                  {pod.deliveryPhotos.length > 0 && (
                    <figure className="space-y-1">
                      <img src={pod.deliveryPhotos[0].url} alt="Delivery confirmed" className="w-full aspect-square object-cover rounded-lg border" />
                      <figcaption className="text-[10px] text-muted-foreground text-center">Delivered</figcaption>
                    </figure>
                  )}
                </div>
              )}
              <button
                type="button"
                disabled={downloadingPdf}
                onClick={async () => {
                  setDownloadingPdf(true);
                  try {
                    await downloadReceiptPdf(pod);
                  } catch {
                    // if photo embedding fails partway, the text-only receipt still saves
                  } finally {
                    setDownloadingPdf(false);
                  }
                }}
                className="w-full flex items-center justify-center gap-2 rounded-lg border font-semibold text-sm py-2 disabled:opacity-60"
              >
                {downloadingPdf ? "Preparing…" : "Download PDF receipt"}
              </button>
              <p className="text-[10px] text-muted-foreground pt-1 border-t">
                This receipt is permanently available at this link — save or share it for your records.
              </p>
            </div>
          )}
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
                    <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                    subdomains="abcd"
                    maxZoom={20}
                  />
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
