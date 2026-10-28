import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { materialLabel, type MaterialCategory } from "@/lib/domain";
import {
  DocketPanel,
  DocketRow,
  JobStamp,
  LogoLockup,
  Milestones,
  Notice,
  StatusStamp,
} from "@/components/ds";
import { czButtonClass } from "@/components/redesign";
import { PUBLIC_STEPS, publicStepsDone } from "@/lib/status-stamp";
import { LiveDeliveryMap } from "@/components/tracking/LiveDeliveryMap";
import { Clock, Loader2, MapPin, Navigation2, Receipt } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getPublicPod, type PodResult } from "@/lib/pod.functions";
import { money } from "@/lib/domain";
import { useState } from "react";
import { locationDisplay, locationState, publicTrackSignal } from "@/lib/delivery-docket";
import { useNow } from "@/hooks/use-now";

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
  // Loaded on demand: the PDF library is large and only needed for this button.
  const { default: jsPDF } = await import("jspdf");
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
  row(
    "Payment method",
    pod.paymentMethod === "escrow"
      ? "Con Z Pay (held & released on confirmation)"
      : "Paid directly to driver",
  );
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
  doc.text(
    "Navysky Innovations (Private) Limited, trading as Con Z  ·  conz.co.zw  ·  navyskyinnovations@gmail.com",
    marginX,
    774,
  );
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
  live: { lat: number; lng: number; updated_at: string; heading?: number | null } | null;
  /** 0126: step times and the line driven since loading (absent before 0126). */
  times?: { loaded_at: string | null; arrived_at: string | null; delivered_at: string | null };
  trail?: [number, number][] | null;
};

const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="cz-screen min-h-[100dvh] w-full bg-cz-bg text-cz-text">
      <div className="mx-auto w-full max-w-[560px] px-4 pb-10">
        <header className="flex items-center justify-between gap-2 py-3">
          <LogoLockup />
          <span className="text-sm font-semibold text-cz-muted">Delivery tracking</span>
        </header>
        <main className="space-y-4">{children}</main>
        <p className="pt-8 text-center text-xs text-cz-muted">
          Powered by Con Z, Zimbabwe&apos;s construction marketplace
        </p>
      </div>
    </div>
  );
}

function PublicTrackPage() {
  const { token } = Route.useParams();
  const runGetPod = useServerFn(getPublicPod);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  // Same 10-minute rule as the customer's own screen, re-checked every 30 s: the
  // 15 s poll returns identical data when the driver's phone has gone quiet, so
  // it alone would never flip the page to stale.
  const now = useNow(30_000);

  const { data, isLoading, isError } = useQuery({
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
        <div
          role="status"
          className="flex items-center justify-center gap-2 py-16 text-sm text-cz-muted"
        >
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Loading tracking…
        </div>
      </Shell>
    );
  }

  if (isError && !data) {
    return (
      <Shell>
        <Notice tone="danger" title="Couldn't load this delivery">
          Check your connection. This page tries again every 15 seconds.
        </Notice>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <div className="space-y-2 rounded-2xl border border-cz-border bg-cz-surface p-6 text-center">
          <MapPin aria-hidden className="mx-auto h-6 w-6 text-cz-muted" />
          <h1 className="text-lg font-semibold">Tracking link not found</h1>
          <p className="text-sm text-cz-muted">
            This tracking link is invalid or the job was removed. Ask the sender to share a fresh
            link.
          </p>
        </div>
      </Shell>
    );
  }

  if (data.status === "cancelled") {
    return (
      <Shell>
        <Notice tone="info" title="This delivery was cancelled">
          Nothing more will happen on this link.
        </Notice>
      </Shell>
    );
  }

  const driverFirst = data.driver_name?.trim().split(" ")[0] ?? null;
  const loadedAt = clock(data.times?.loaded_at);
  const arrivedAt = clock(data.times?.arrived_at);
  const destination =
    data.delivery_lat != null && data.delivery_lng != null
      ? { lat: Number(data.delivery_lat), lng: Number(data.delivery_lng) }
      : null;
  const live = data.live;
  const location = locationState(publicTrackSignal(live), now);
  const lastUpdate = live?.updated_at
    ? new Date(live.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;
  const shown = locationDisplay(location, lastUpdate);

  return (
    <Shell>
      <DocketPanel
        titleAs="h1"
        title={materialLabel(data.material as any, data.custom_material)}
        reference={`${Number(data.quantity_m3)} m³`}
        stamp={<JobStamp job={{ status: data.status }} />}
      >
        {data.status !== "cancelled" && (
          <div className="px-4 py-4">
            <Milestones
              label="Delivery progress"
              steps={PUBLIC_STEPS}
              done={publicStepsDone(data.status)}
            />
          </div>
        )}
        {data.delivery_address && <DocketRow label="Deliver to">{data.delivery_address}</DocketRow>}
        {data.preferred_date && <DocketRow label="Preferred date">{data.preferred_date}</DocketRow>}
        {driverFirst && <DocketRow label="Driver">{driverFirst}</DocketRow>}
        {loadedAt && <DocketRow label="Loaded">{loadedAt}</DocketRow>}
        {arrivedAt && data.status !== "completed" && (
          <DocketRow label="Arrived at the site">{arrivedAt}</DocketRow>
        )}
      </DocketPanel>

      {data.status === "cancelled" ? (
        <Notice tone="info" title="This delivery was cancelled">
          Nothing more will happen on this link.
        </Notice>
      ) : data.status === "completed" ? (
        <>
          <Notice tone="success" title="Delivered">
            This delivery is complete.
          </Notice>
          {pod && (
            <DocketPanel
              title={
                <span className="inline-flex items-center gap-2">
                  <Receipt aria-hidden className="h-4 w-4 text-cz-muted" /> Receipt
                </span>
              }
              reference={pod.receiptNo}
              footer={
                <p className="text-xs text-cz-muted">
                  This receipt stays available at this link. Save or share it for your records.
                </p>
              }
            >
              {pod.finalPrice != null && (
                <DocketRow label="Total paid (USD)" strong>
                  {money(pod.finalPrice)}
                </DocketRow>
              )}
              <DocketRow label="Payment method">
                {pod.paymentMethod === "escrow" ? "Con Z Pay" : "Direct to driver"}
              </DocketRow>
              {pod.completedAt && (
                <DocketRow label="Completed">
                  {new Date(pod.completedAt).toLocaleString()}
                </DocketRow>
              )}
              {pod.driverName && <DocketRow label="Driver">{pod.driverName}</DocketRow>}
              {(pod.pickupPhotos.length > 0 || pod.deliveryPhotos.length > 0) && (
                <div className="grid grid-cols-2 gap-3 px-4 py-3">
                  {pod.pickupPhotos.length > 0 && (
                    <figure className="space-y-1">
                      <img
                        src={pod.pickupPhotos[0].url}
                        alt="The load at pickup"
                        className="aspect-square w-full rounded-lg border border-cz-border object-cover"
                      />
                      <figcaption className="text-center text-xs text-cz-muted">Pickup</figcaption>
                    </figure>
                  )}
                  {pod.deliveryPhotos.length > 0 && (
                    <figure className="space-y-1">
                      <img
                        src={pod.deliveryPhotos[0].url}
                        alt="The load at delivery"
                        className="aspect-square w-full rounded-lg border border-cz-border object-cover"
                      />
                      <figcaption className="text-center text-xs text-cz-muted">
                        Delivered
                      </figcaption>
                    </figure>
                  )}
                </div>
              )}
              <div className="px-4 py-3">
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
                  className={czButtonClass("secondary", "md")}
                >
                  {downloadingPdf ? (
                    <>
                      <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Preparing…
                    </>
                  ) : (
                    "Download PDF receipt"
                  )}
                </button>
              </div>
            </DocketPanel>
          )}
        </>
      ) : (
        <>
          <DocketPanel
            title={
              <span className="inline-flex items-center gap-2">
                <Navigation2 aria-hidden className="h-4 w-4 text-cz-muted" />
                Where is my delivery?
              </span>
            }
            stamp={
              shown.live ? (
                <StatusStamp tone="success" icon="truck">
                  Live
                </StatusStamp>
              ) : live ? (
                <StatusStamp tone="warning" icon="clock">
                  Not live
                </StatusStamp>
              ) : null
            }
          >
            {(live || destination) && (
              <LiveDeliveryMap
                truck={
                  live
                    ? { lat: Number(live.lat), lng: Number(live.lng), updatedAt: live.updated_at }
                    : null
                }
                live={shown.live}
                destination={destination}
                driverName={driverFirst}
                heading={live?.heading ?? null}
                trail={data.trail ?? null}
              />
            )}
            {live ? (
              shown.live ? (
                <p className="px-4 py-2.5 text-xs text-cz-muted">
                  Updated {lastUpdate}. This page refreshes every 15 seconds. Times are estimates
                  for a loaded truck.
                </p>
              ) : (
                <p
                  role="status"
                  className="flex items-start gap-2 px-4 py-2.5 text-sm text-cz-text"
                >
                  <Clock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-cz-warn-text" />
                  <span>{shown.staleNote}</span>
                </p>
              )
            ) : (
              <p className="px-4 py-3 text-sm text-cz-muted">
                {destination ? "The pin shows the delivery site. " : ""}
                {driverFirst ?? "The driver"} isn&apos;t sharing their live location right now. The
                truck appears on the map when they do.
              </p>
            )}
            {destination && (
              <div className="border-t border-cz-border px-4 py-3">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${destination.lat},${destination.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cz-text underline underline-offset-4"
                >
                  <MapPin aria-hidden className="h-4 w-4" /> Open the delivery site in Google Maps
                </a>
              </div>
            )}
          </DocketPanel>
        </>
      )}
    </Shell>
  );
}
