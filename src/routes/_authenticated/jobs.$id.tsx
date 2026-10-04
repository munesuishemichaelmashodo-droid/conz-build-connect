import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, Section } from "@/components/ui-bits";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Loader2, MapPin, Calendar, Star, CheckCircle2, MessageSquare, MessageCircle, Share2, Trash2, Camera, Image as ImageIcon, PackageCheck, Flag, FileText, Truck, PackageOpen, Circle, Wallet, Receipt, Phone } from "lucide-react";
import { materialLabel, money, statusInfo, levelInfo } from "@/lib/domain";
import { SITE_URL } from "@/lib/site";
import { isNativePlatform } from "@/lib/native-push";
import { useState, useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { DriverShareLocation, CustomerTrackMap, DriverRouteView } from "@/components/JobTracker";
import { RadarSearch } from "@/components/RadarSearch";
import { NextLoadsCard } from "@/components/NextLoadsCard";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { uploadJobEvidence, signedEvidenceUrl } from "@/lib/upload-evidence";
import { useServerFn } from "@tanstack/react-start";
import { initiateEscrowPayment, reconcilePendingPaynowPayments } from "@/lib/paynow.functions";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { SpotlightCallout } from "@/components/SpotlightCallout";
import { previewCapacityMatch } from "@/lib/capacityMatch";
import {
  CzScreen,
  CzHeader,
  CzCard,
  CzButton,
  BottomSheet,
  StepProgress,
  StatusPill,
  PriceStepper,
  MoneyRow,
  HintBox,
  IconButton,
  InitialsAvatar,
  MaterialBadge,
  RouteStops,
  czButtonClass,
  usd,
  usd2,
  areaOf,
  jobRef,
  straightKm,
} from "@/components/redesign";
import { OfferCard } from "@/components/redesign/OfferCard";
import { driverMarkArrived, jobOfferSummary, withdrawBid, raiseJobBudget, useBidderLocations, useSecondsLeft, mmss } from "@/components/redesign/rpc";
import { PinMap } from "@/components/redesign/PinMap";
import { DriverBottomNav, DRIVER_NAV_SPACE } from "@/components/redesign/DriverBottomNav";
import { DriverNavigationButtons } from "@/components/DriverNavigationButtons";
import type { RouteResult } from "@/components/RouteMap";
import type { TrackStatus } from "@/components/JobTracker";
import { ChevronDown, ChevronRight, Clock, Info, Navigation2, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/jobs/$id")({
  component: JobDetail,
});

// Plain tap-to-dial link — opens the phone's own dialer. Deliberately not a
// masked/in-app call: it's simple, free, and needs no calling provider, at
// the cost of showing each party the other's real phone number.
const telLink = (phone: string | null | undefined) => {
  if (!phone) return null;
  let p = phone.replace(/[^\d+]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0")) p = "263" + p.slice(1);
  if (p.length < 9) return null;
  return `tel:+${p}`;
};

// Live-tracking share panel — lets either party hand off a login-free
// tracking link to someone outside Con Z (e.g. a foreman waiting on site).
// Direct WhatsApp contact/messaging was removed by product decision: it
// pulled conversations off-platform, out of Con Z chat's dispute-evidence
// trail. Only the Call button (native dialer) and the tracking-link share
// remain — the share uses the device's native share sheet, not WhatsApp
// specifically, so it works with whatever the person actually has.
// The other party's name/phone + the tracking-link share, shared by the
// legacy contact panel and the redesigned contact cards. (Moved out of
// WhatsAppPanel unchanged: same query key, same select, same fallbacks.)
function useJobContact(job: any, isOwner: boolean) {
  const otherId = isOwner ? job.driver_id : job.customer_id;
  const material = materialLabel(job.material as any, job.custom_material);
  const ref = String(job.id).slice(0, 8);

  const { data: other } = useQuery({
    queryKey: ["wa-contact", job.id, otherId],
    enabled: !!otherId,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,phone")
        .eq("id", otherId)
        .maybeSingle();
      // If the phone column or RLS blocks this read, degrade gracefully.
      if (error) return null;
      return data;
    },
  });

  const name = other?.full_name ?? (isOwner ? "your driver" : "the customer");

  const summary =
    `ConZ delivery ${ref}: ${material}, ${Number(job.quantity_m3)} m³, ` +
    `to ${job.delivery_address}. Status: ${job.status.replace("_", " ")}.` +
    (job.final_price ? ` Agreed price: ${money(Number(job.final_price))}.` : "") +
    (isOwner && other?.full_name ? ` Driver: ${other.full_name}.` : "");

  const call = telLink(other?.phone);

  // Public live-tracking link: shareable without a Con Z account.
  const trackUrl = job.tracking_token ? `${SITE_URL}/track/${job.tracking_token}` : null;
  const shareText = trackUrl ? `${summary} Track live: ${trackUrl}` : summary;

  const shareTrackLink = async () => {
    if (!trackUrl) return;

    // navigator.share() support inside Android's WebView is inconsistent
    // across devices/versions — it can be missing entirely, or present but
    // silently fail, which matches exactly "nothing happens" when tapped.
    // The native Capacitor Share plugin always opens the real OS share
    // sheet reliably on native, regardless of WebView quirks.
    if (isNativePlatform()) {
      try {
        const { Share } = await import("@capacitor/share");
        await Share.share({ text: shareText, url: trackUrl, dialogTitle: "Share tracking link" });
        return;
      } catch {
        // user cancelled the native share sheet, or it genuinely failed —
        // fall through to copy either way, same as the web path below
      }
    } else if (navigator.share) {
      try {
        await navigator.share({ text: shareText, url: trackUrl });
        return;
      } catch {
        // user cancelled the native share sheet — fall through to copy instead
      }
    }
    try {
      await navigator.clipboard.writeText(trackUrl);
      toast.success("Tracking link copied");
    } catch {
      toast.error(`Couldn't copy — the link is: ${trackUrl}`);
    }
  };

  return { other, name, call, trackUrl, shareTrackLink };
}

function WhatsAppPanel({ job, isOwner }: { job: any; isOwner: boolean }) {
  const { name, call, trackUrl, shareTrackLink } = useJobContact(job, isOwner);

  return (
    <div className="rounded-2xl bg-card border p-4 space-y-3">
      <div className="font-display font-bold uppercase text-sm tracking-wide flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-success" /> Contact {name}
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        Con Z chat can be used as evidence if there's a dispute — calls can't.
      </p>

      {call ? (
        <Button asChild variant="outline" className="w-full">
          <a href={call}>
            <Phone className="w-4 h-4 mr-2" />
            Call {name}
          </a>
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          No phone number on their profile yet — use in-app chat above.
        </p>
      )}

      {trackUrl && (
        <Button type="button" variant="secondary" className="w-full" onClick={shareTrackLink}>
          <Share2 className="w-4 h-4 mr-2" />
          Share live tracking link
        </Button>
      )}
      <p className="text-[11px] text-muted-foreground">
        Share this link with anyone — no Con Z account needed for them to watch the truck.
      </p>
    </div>
  );
}

function JobDetail() {
  const { id } = Route.useParams();
  const { userId, is } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();

  const { data: job, isLoading } = useQuery({
    queryKey: ["job", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Without this, a driver who had this page open when their bid got
  // accepted (or a customer watching a job change status) kept seeing the
  // stale "open" job -- bid form and all -- until they navigated away and
  // back to force a refetch. Subscribe so status/price changes on this job
  // apply instantly to whoever's looking at it.
  useEffect(() => {
    const channel = supabase
      .channel(`job-detail:${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "jobs", filter: `id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["job", id] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, qc]);

  // Realtime on top of the poll below: the 15s poll alone was the visible
  // "delay" -- a driver's new bid or a customer's counter-offer could take
  // up to 15s to appear on the other side. This makes it instant while the
  // poll stays as a safety net if a realtime event is ever missed.
  useEffect(() => {
    const channel = supabase
      .channel(`job-bids:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bids", filter: `job_id=eq.${id}` },
        () => qc.invalidateQueries({ queryKey: ["bids", id] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, qc]);

  const { data: bids } = useQuery({
    queryKey: ["bids", id],
    enabled: !!job,
    // While the job is open, poll for new bids so the customer sees offers
    // appear live instead of having to refresh the page.
    refetchInterval: job?.status === "open" ? 15000 : false,
    queryFn: async () => {
      const { data: bids } = await supabase.from("bids").select("*").eq("job_id", id).order("price");
      if (!bids?.length) return [] as any[];
      const driverIds = [...new Set(bids.map((b) => b.driver_id))];
      const truckIds = [...new Set(bids.map((b: any) => b.truck_id).filter(Boolean))];
      const [{ data: profs }, { data: drvs }, { data: trucksData }] = await Promise.all([
        supabase.from("profiles").select("id,full_name,avatar_url").in("id", driverIds),
        supabase
          .from("driver_public_profiles")
          .select("user_id,rating_avg,rating_count,level,jobs_completed,verification_status")
          .in("user_id", driverIds),
        truckIds.length
          ? supabase.from("trucks").select("id,registration").in("id", truckIds)
          : Promise.resolve({ data: [] as { id: string; registration: string }[] }),
      ]);
      return bids.map((b: any) => ({
        ...b,
        profile: profs?.find((p) => p.id === b.driver_id),
        driver: drvs?.find((d) => d.user_id === b.driver_id),
        truck_reg: trucksData?.find((t) => t.id === b.truck_id)?.registration,
      }));
    },
  });

  // C1: the delivery PIN is never on the jobs row anymore (a driver could
  // read it there). The customer fetches their own code through a
  // customer-only RPC (get_my_delivery_pin); the driver can never read it.
  const { data: deliveryPin } = useQuery({
    queryKey: ["delivery-pin", id],
    enabled: !!job && isOwner && isEscrow && ["accepted", "in_progress"].includes(job?.status ?? ""),
    queryFn: async () => {
      const { data } = await (supabase.rpc as unknown as (
        f: string, a: Record<string, unknown>,
      ) => Promise<{ data: string | null }>)("get_my_delivery_pin", { _job_id: id });
      return (data as string | null) ?? null;
    },
  });

  const showRadar = !!job && job.customer_id === userId && job.status === "open" && (bids?.length ?? 0) === 0;

  // Both rating tables have a unique constraint per job — without this check
  // the form re-renders on every visit to a completed job and a second
  // submit throws a raw "duplicate key" database error instead of anything
  // useful. Fetch whether a rating already exists so we can show a summary
  // instead of a live form the second time.
  const { data: myRating } = useQuery({
    queryKey: ["my-rating", id, userId],
    enabled: !!job && job.status === "completed" && !!userId,
    queryFn: async () => {
      if (job!.customer_id === userId) {
        const { data } = await supabase
          .from("ratings")
          .select("quality,communication,reliability,delivery_time,comment")
          .eq("job_id", id)
          .maybeSingle();
        return data;
      }
      if (job!.driver_id === userId) {
        const { data } = await (supabase.from("customer_ratings") as any)
          .select("punctuality,communication,payment,overall,comment")
          .eq("job_id", id)
          .eq("driver_id", userId)
          .maybeSingle();
        return data;
      }
      return null;
    },
  });

  const { data: nearbyDrivers } = useQuery({
    queryKey: ["nearby-drivers", id],
    enabled: showRadar,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("count_available_verified_drivers", { _job_id: id });
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },
  });

  // Unread-message badge on the "Open chat" button — without this the
  // button looks identical whether a reply is waiting or not, and the
  // customer/driver has to remember to check chat on their own.
  const { data: unreadCount } = useQuery({
    queryKey: ["chat-unread", id, userId],
    enabled: !!job && !!userId && job.status !== "open",
    refetchInterval: 15000,
    queryFn: async () => {
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("job_id", id)
        .is("read_at", null)
        .neq("sender_id", userId!);
      return count ?? 0;
    },
  });

  const runEscrowPayment = useServerFn(initiateEscrowPayment);
  const runReconcile = useServerFn(reconcilePendingPaynowPayments);
  const [payingEscrow, setPayingEscrow] = useState(false);

  const isEscrow = job?.payment_method === "escrow";
  const { data: escrowPayment } = useQuery({
    queryKey: ["escrow-payment", id],
    enabled: !!job && isEscrow,
    queryFn: async () => {
      // Prefer a settled payment over the newest attempt: a customer who
      // paid, then opened Paynow again without finishing, must still show as
      // paid — otherwise they'd be invited to pay a second time.
      const { data } = await supabase
        .from("payments")
        .select("id,status,amount")
        .eq("job_id", id)
        .eq("type", "escrow")
        .order("created_at", { ascending: false })
        .limit(10);
      const rows = (data ?? []) as { id: string; status: string; amount: number }[];
      return rows.find((r) => r.status === "paid" || r.status === "released") ?? rows[0] ?? null;
    },
  });
  const escrowPaid = escrowPayment?.status === "paid" || escrowPayment?.status === "released";

  // Returning from Paynow lands back on this page — reconcile any pending
  // escrow payment via the poll URL rather than only relying on the webhook.
  useEffect(() => {
    if (!job || !isEscrow || !userId) return;
    runReconcile()
      .then((res) => {
        if (res.credited > 0) {
          qc.invalidateQueries({ queryKey: ["escrow-payment", id] });
          toast.success("Payment confirmed — held safely until delivery is confirmed.");
        }
      })
      .catch(() => {});
  }, [job, isEscrow, userId]);

  if (isLoading || !job)
    return (
      <AppShell>
        <div className="text-center text-muted-foreground py-10">Loading…</div>
      </AppShell>
    );

  const isOwner = job.customer_id === userId;
  const isAssignedDriver = job.driver_id === userId;
  const s = statusInfo(job.status);
  const myBid = bids?.find((b: any) => b.driver_id === userId);

  const payEscrow = async () => {
    setPayingEscrow(true);
    try {
      const res = await runEscrowPayment({ data: { jobId: id } });
      if (!res.ok) {
        setPayingEscrow(false);
        if (res.error === "already_paid") {
          qc.invalidateQueries({ queryKey: ["escrow-payment", id] });
          return toast.success("This job is already paid for.");
        }
        if (res.error === "job_not_payable") {
          return toast.error("This job can't be paid for right now — it needs an assigned driver and must not be completed or cancelled.");
        }
        return toast.error(res.error || "Could not start payment");
      }
      window.location.href = res.redirectUrl;
    } catch (err) {
      setPayingEscrow(false);
      toast.error(err instanceof Error ? err.message : "Could not start payment");
    }
  };

  const acceptBid = async (bidId: string) => {
    const { error } = await supabase.rpc("accept_bid", { _bid_id: bidId });
    if (error) {
      if (/insufficient wallet balance/i.test(error.message)) {
        return toast.error("This driver can no longer accept — ask them to top up, or accept another bid.");
      }
      return toast.error(error.message);
    }
    toast.success("Bid accepted!");
    qc.invalidateQueries({ queryKey: ["job", id] });
    qc.invalidateQueries({ queryKey: ["bids", id] });
  };

  const counterBid = async (bidId: string, price: number) => {
    const { error } = await supabase.rpc("counter_bid", { _bid_id: bidId, _price: price });
    if (error) return toast.error(error.message);
    toast.success("Counter-offer sent to the driver");
    qc.invalidateQueries({ queryKey: ["bids", id] });
  };

  const acceptCounter = async (bidId: string) => {
    const { error } = await supabase.rpc("accept_counter", { _bid_id: bidId });
    if (error) {
      if (/insufficient wallet balance/i.test(error.message)) {
        return toast.error("You can no longer accept — top up your wallet first.");
      }
      return toast.error(error.message);
    }
    toast.success("Price agreed — job is yours!");
    qc.invalidateQueries({ queryKey: ["job", id] });
    qc.invalidateQueries({ queryKey: ["bids", id] });
  };

  const rejectCounter = async (bidId: string) => {
    const { error } = await supabase.rpc("reject_counter", { _bid_id: bidId });
    if (error) return toast.error(error.message);
    toast.success("Counter-offer declined");
    qc.invalidateQueries({ queryKey: ["bids", id] });
  };

  const completeJob = async () => {
    const { error } = await supabase.rpc("complete_job", { _job_id: id });
    if (error) { toast.error(error.message); return; }
    toast.success("Delivery confirmed.");
    qc.invalidateQueries({ queryKey: ["job", id] });
  };

  const showEscrowBanner = isEscrow && ["accepted", "in_progress"].includes(job.status);
  const showBidForm = is("driver") && !isOwner && job.status === "open";
  const showCounterResponse = showBidForm && myBid?.counter_status === "countered";
  const showPickupUpload = isAssignedDriver && job.status === "accepted" && !job.pickup_photo_url;
  const showDeliveryUpload = isAssignedDriver && (job.status === "accepted" || job.status === "in_progress") && !!job.pickup_photo_url && !job.delivery_photo_url;
  const showDeliveryPinDisplay = isOwner && isEscrow && ["accepted", "in_progress"].includes(job.status);
  const showCompleteButton = isOwner && !isEscrow && (job.status === "accepted" || job.status === "in_progress");
  const showDeliveryPinEntry = isAssignedDriver && isEscrow && (job.status === "accepted" || job.status === "in_progress") && !!job.delivery_photo_url;
  const showCancel = isOwner && (job.status === "open" || job.status === "accepted" || job.status === "in_progress");
  const showActionSection = showRadar || showEscrowBanner || showBidForm || showPickupUpload || showDeliveryUpload || showDeliveryPinDisplay || showCompleteButton || showDeliveryPinEntry || showCancel;

  const showProofPhotos = !!(job.pickup_photo_url || job.delivery_photo_url);
  const showDriverRoute = isAssignedDriver && (job.status === "accepted" || job.status === "in_progress");
  const showCustomerMap = isOwner && (job.status === "accepted" || job.status === "in_progress");
  const showTrackingSection = showProofPhotos || showDriverRoute || showCustomerMap;

  const showChat = (isOwner || isAssignedDriver) && job.status !== "open";
  const showDispute = (isOwner || isAssignedDriver) && ["accepted", "in_progress", "completed"].includes(job.status);
  const showNextLoads = isAssignedDriver && ["in_progress", "completed"].includes(job.status);
  const showWhatsapp = (isOwner || isAssignedDriver) && job.status !== "open";
  const showCommsSection = showChat || showDispute || showWhatsapp;

  const showRatingOwner = isOwner && job.status === "completed";
  const showRatingDriver = isAssignedDriver && job.status === "completed";
  const showReceipt = isOwner && job.status === "completed" && !!job.tracking_token;
  const showBookAgain = isOwner && job.status === "completed" && !!job.driver_id;
  const showWrapSection = showRatingOwner || showRatingDriver || showReceipt || showBookAgain;

  // Driver / customer mode redesign. Same data, flags and handlers as the
  // layout below; the customer (owner) and the driver (assigned, or bidding
  // on an open job) get the new step-by-step screens. Anyone else who can
  // see the job (admins) keeps the full legacy layout.
  const ctx: JobScreenCtx = {
    id,
    job,
    bids,
    myBid,
    userId,
    isOwner,
    isAssignedDriver,
    isEscrow,
    escrowPaid,
    payingEscrow,
    payEscrow,
    acceptBid,
    counterBid,
    acceptCounter,
    rejectCounter,
    completeJob,
    unreadCount,
    nearbyDrivers,
    myRating,
    showRadar,
    showCounterResponse,
    showCancel,
    showDispute,
    showNextLoads,
    showBookAgain,
    showReceipt,
    showCompleteButton,
    showDeliveryPinDisplay,
    deliveryPin: deliveryPin ?? null,
    invalidateJob: () => qc.invalidateQueries({ queryKey: ["job", id] }),
    invalidateBids: () => qc.invalidateQueries({ queryKey: ["bids", id] }),
    invalidateRating: () => qc.invalidateQueries({ queryKey: ["my-rating", id, userId] }),
    onCancelled: () => nav({ to: "/jobs" }),
  };
  if (isOwner) return <CustomerJobScreen ctx={ctx} />;
  if (!isOwner && (isAssignedDriver || (is("driver") && (job.status === "open" || !!myBid)))) {
    return <DriverJobScreen ctx={ctx} />;
  }

  return (
    <AppShell title="Job">
      <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>

      <div className="space-y-5">
        <div className="space-y-4">
          <JobTimeline job={job} />

          <div id="tour-job-header" className="rounded-2xl bg-card border p-5 shadow-soft">
            <div className="flex items-start justify-between gap-3">
              <h1 className="font-display font-bold text-2xl">
                {materialLabel(job.material as any, job.custom_material)}
              </h1>
              <StatusBadge label={s.label} className={s.className} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[11px] uppercase text-muted-foreground tracking-widest">Quantity</div>
                <div className="font-semibold">{Number(job.quantity_m3)} m³</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-muted-foreground tracking-widest">
                  {isOwner ? "Your offer" : "Offer"}
                </div>
                <div className="font-display font-bold text-primary text-lg">{money(Number(job.budget))}</div>
              </div>
            </div>

            <div className="mt-3 flex items-start gap-2 text-sm">
              <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
              <span>{job.delivery_address}</span>
            </div>

            {job.preferred_date && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span>{job.preferred_date}</span>
              </div>
            )}

            {job.notes && <p className="mt-3 text-sm text-muted-foreground border-t pt-3">{job.notes}</p>}

            {job.final_price && (
              <div className="mt-3 pt-3 border-t text-sm flex justify-between">
                <span className="text-muted-foreground">Agreed price</span>
                <span className="font-display font-bold text-primary">{money(Number(job.final_price))}</span>
              </div>
            )}
          </div>
        </div>

        {showActionSection && (
          <Section id="tour-next-steps" title="What's next">
            <div className="space-y-4">
              {showRadar && <RadarSearch etaMinutes={5} nearbyDrivers={nearbyDrivers} />}

              {showEscrowBanner && (
                <div className={cn(
                  "rounded-2xl border p-4 space-y-2",
                  escrowPaid ? "border-success/40 bg-success/10" : "border-primary/40 bg-primary/5",
                )}>
                  <div className="flex items-center gap-2 font-display font-bold uppercase text-sm tracking-wide">
                    <ShieldCheck className={cn("w-4 h-4", escrowPaid ? "text-success" : "text-primary")} />
                    Con Z Pay
                  </div>
                  {escrowPaid ? (
                    <p className="text-sm text-muted-foreground">
                      {isOwner
                        ? "Payment received and held safely. It'll be released to the driver once you confirm delivery."
                        : "The customer has paid. Funds are held and will be released to your wallet once delivery is confirmed — or automatically after 72 hours."}
                    </p>
                  ) : isOwner ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        This job is set up to pay through Con Z Pay. Pay now — we'll hold the money until you confirm delivery.
                      </p>
                      <Button onClick={payEscrow} disabled={payingEscrow} className="w-full">
                        {payingEscrow ? <Loader2 className="w-4 h-4 animate-spin" /> : `Pay ${money(Number(job.final_price ?? job.budget))} now`}
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Waiting for the customer to pay through Con Z Pay before you're guaranteed payment on delivery.
                    </p>
                  )}
                </div>
              )}

              {showBidForm && !showCounterResponse && (
                <div id="tour-place-bid">
                  <SpotlightCallout
                    id="driver-bidding"
                    title="Bid your own price"
                    body="Enter what you'd charge for this delivery. If the customer likes it, they'll accept — or they might propose a different price back to you."
                  />
                  <BidForm jobId={id} quantityM3={Number(job.quantity_m3)} existing={myBid} onSaved={() => qc.invalidateQueries({ queryKey: ["bids", id] })} />
                </div>
              )}

              {showCounterResponse && (
                <div className="rounded-2xl bg-primary/5 border border-primary/30 p-4 space-y-3">
                  <div className="font-display font-bold uppercase text-sm tracking-wide text-primary">
                    Customer proposed a new price
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-display font-bold">{money(Number(myBid.customer_counter_price))}</span>
                    <span className="text-xs text-muted-foreground line-through">{money(Number(myBid.price))}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button onClick={() => acceptCounter(myBid.id)} className="w-full">
                      Accept
                    </Button>
                    <Button variant="outline" onClick={() => rejectCounter(myBid.id)} className="w-full">
                      Decline
                    </Button>
                  </div>
                </div>
              )}

              {showPickupUpload && (
                <ProofUpload
                  jobId={id}
                  kind="pickup"
                  label="Confirm Pickup"
                  hint="Take a photo of the loaded truck to start the trip."
                  onUploaded={async () => {
                  const { error } = await supabase.rpc("start_trip", { _job_id: id });
                  if (error) { toast.error(error.message); return; }
                  qc.invalidateQueries({ queryKey: ["job", id] });
                  }}
                />
              )}

              {showDeliveryUpload && (
                <ProofUpload
                  jobId={id}
                  kind="delivery"
                  label="Confirm Delivery"
                  hint="Take a photo at the delivery point. The customer can then confirm."
                  onUploaded={async () => {
                    qc.invalidateQueries({ queryKey: ["job", id] });
                  }}
                />
              )}

              {showDeliveryPinDisplay && (
                <div className="rounded-2xl border border-primary/40 bg-primary/5 p-4 space-y-2 text-center">
                  <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Delivery confirmation code
                  </div>
                  <div className="font-display font-bold text-4xl tracking-[0.2em]">{deliveryPin ?? "······"}</div>
                  <p className="text-xs text-muted-foreground">
                    Give this code to your driver when they arrive with your delivery. They'll enter it to confirm and release payment — don't share it before then.
                  </p>
                </div>
              )}

              {showCompleteButton && (
                <Button
                  id="tour-confirm-delivery"
                  onClick={completeJob}
                  disabled={!job.delivery_photo_url}
                  className="w-full bg-success text-success-foreground hover:bg-success/90"
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  {job.delivery_photo_url ? "Confirm delivery" : "Waiting for driver's delivery photo"}
                </Button>
              )}

              {showDeliveryPinEntry && (
                <div id="tour-delivery-pin-entry">
                  <DeliveryPinEntry jobId={id} onConfirmed={() => qc.invalidateQueries({ queryKey: ["job", id] })} />
                </div>
              )}

              {showCancel && (
                <CancelJobDialog jobId={id} status={job.status} onCancelled={() => nav({ to: "/jobs" })} />
              )}
            </div>
          </Section>
        )}

        {showTrackingSection && (
          <Section id="tour-tracking" title="Tracking">
            <div className="space-y-4">
              {showProofPhotos && (
                <div className="rounded-2xl bg-card border p-4 space-y-3">
                  <div className="font-display font-bold uppercase text-sm tracking-wide">Proof of delivery</div>
                  <div className="grid grid-cols-2 gap-3">
                    {job.pickup_photo_url && (
                      <figure className="space-y-1">
                        <SignedProofPhoto path={job.pickup_photo_url} alt="Load confirmed" />
                        <figcaption className="text-xs font-semibold text-success flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Load confirmed
                        </figcaption>
                      </figure>
                    )}
                    {job.delivery_photo_url && (
                      <figure className="space-y-1">
                        <SignedProofPhoto path={job.delivery_photo_url} alt="Delivery confirmed" />
                        <figcaption className="text-xs font-semibold text-success flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Delivery confirmed
                        </figcaption>
                      </figure>
                    )}
                  </div>
                </div>
              )}

              {showDriverRoute && (
                <>
                  <DriverRouteView jobId={id} />
                  <DriverShareLocation jobId={id} driverId={userId!} />
                </>
              )}

              {showCustomerMap && <CustomerTrackMap jobId={id} />}
            </div>
          </Section>
        )}

        {showCommsSection && (
          <Section title="Communication">
            <div className="space-y-3">
              {showChat && (
                <Button id="tour-chat-link" asChild variant="outline" className="w-full relative">
                  <Link to="/chat/$jobId" params={{ jobId: id }}>
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Open chat
                    {!!unreadCount && (
                      <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-semibold">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </Link>
                </Button>
              )}

              {showWhatsapp && <WhatsAppPanel job={job} isOwner={isOwner} />}

              {showNextLoads && <NextLoadsCard driverId={userId!} currentJobId={id} />}

              {showDispute && (
                <div id="tour-dispute">
                  <RaiseDisputeDialog
                    jobId={id}
                    against={isOwner ? job.driver_id : job.customer_id}
                  />
                </div>
              )}
            </div>
          </Section>
        )}

        {(isOwner || is("admin") || is("super_admin")) && (
          <Section
            id="tour-bids-received"
            title={
              job.status === "open"
                ? `Bids (${bids?.length ?? 0})`
                : "Bid"
            }
          >
            {!bids?.length ? (
              <p className="text-sm text-muted-foreground">No bids yet. Drivers are checking your request.</p>
            ) : (
              <div className="space-y-2">
                {(job.status === "open" ? bids : bids.filter((b: any) => b.status === "accepted")).map((b: any, bIdx: number) => (
                  <div key={b.id} className="rounded-xl bg-card border p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-3 min-w-0">
                        <Avatar className="w-11 h-11 shrink-0 border">
                          <AvatarImage
                            src={b.profile?.avatar_url ?? undefined}
                            alt={b.profile?.full_name ?? "Driver"}
                          />
                          <AvatarFallback className="bg-primary/10 text-primary font-bold">
                            {(b.profile?.full_name ?? "D").trim().slice(0, 1).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{b.profile?.full_name ?? "Driver"}</div>
                          <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                            {b.driver?.verification_status === "verified" && (
                              <span className="inline-flex items-center gap-0.5 text-success font-semibold">
                                <ShieldCheck className="w-3 h-3" /> Verified
                              </span>
                            )}
                            {b.driver && (
                              <>
                                <StatusBadge
                                  label={levelInfo(b.driver.level).label}
                                  className={levelInfo(b.driver.level).className}
                                />
                                <span className="flex items-center gap-0.5">
                                  <Star className="w-3 h-3 fill-warning text-warning" />
                                  {Number(b.driver.rating_avg || 0).toFixed(1)}{" "}
                                  <span className="text-muted-foreground/70">({b.driver.rating_count ?? 0})</span>
                                </span>
                                <span>• {b.driver.jobs_completed ?? 0} rides completed</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-display font-bold text-primary text-xl">{money(Number(b.price))}</div>
                        {b.delivery_date && <div className="text-[11px] text-muted-foreground">{b.delivery_date}</div>}
                      </div>
                    </div>
                    {b.message && <p className="text-sm text-muted-foreground mt-2">{b.message}</p>}

                    {b.truck_reg && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap text-xs">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Truck className="w-3.5 h-3.5" />
                          {b.truck_reg} · {b.capacity_m3_snapshot} m³ truck
                        </span>
                        {b.capacity_match_tier && (
                          <StatusBadge
                            label={MATCH_TIER_LABEL[b.capacity_match_tier]?.label ?? b.capacity_match_tier}
                            className={MATCH_TIER_LABEL[b.capacity_match_tier]?.className ?? ""}
                          />
                        )}
                        {b.estimated_trips > 1 && (
                          <span className="text-muted-foreground">{b.estimated_trips} trips</span>
                        )}
                      </div>
                    )}

                    {b.counter_status === "countered" && (
                      <div className="mt-2 rounded-lg bg-primary/5 border border-primary/30 p-2.5 text-xs space-y-1">
                        <div className="font-semibold text-primary">
                          Your counter-offer: {money(Number(b.customer_counter_price))}
                        </div>
                        <div className="text-muted-foreground">Waiting for the driver to respond.</div>
                      </div>
                    )}
                    {b.counter_status === "driver_rejected" && (
                      <p className="mt-2 text-xs text-muted-foreground italic">
                        Driver declined your counter of {money(Number(b.customer_counter_price))} — their original price still stands.
                      </p>
                    )}

                    {isOwner && job.status === "open" && b.status === "pending" && (
                      <div className="mt-3 space-y-2">
                        <Button id={bIdx === 0 ? "tour-accept-bid" : undefined} size="sm" onClick={() => acceptBid(b.id)} className="w-full">
                          Accept this bid
                        </Button>
                        {b.counter_status !== "countered" && (
                          <CounterOfferRow bidPrice={Number(b.price)} onSubmit={(price) => counterBid(b.id, price)} />
                        )}
                      </div>
                    )}
                    {b.status === "accepted" && (
                      <StatusBadge label="Accepted" className="bg-success/15 text-success border-success/30 mt-2" />
                    )}
                  </div>
                ))}
                {job.status !== "open" && bids.filter((b: any) => b.status === "rejected").length > 0 && (
                  <p className="text-xs text-muted-foreground italic px-1">
                    {bids.filter((b: any) => b.status === "rejected").length === 1
                      ? "1 other bid was not selected."
                      : `${bids.filter((b: any) => b.status === "rejected").length} other bids were not selected.`}
                  </p>
                )}
              </div>
            )}
          </Section>
        )}

        {showWrapSection && (
          <Section id="tour-wrap-up" title="Wrap up">
            <div className="space-y-3">
              {showRatingOwner && (
                myRating ? (
                  <RatingSummary
                    title="Your rating for this driver"
                    stars={((myRating as any).quality + (myRating as any).communication + (myRating as any).reliability + (myRating as any).delivery_time) / 4}
                    comment={(myRating as any).comment}
                  />
                ) : (
                  <RateForm jobId={id} driverId={job.driver_id!} onSaved={() => qc.invalidateQueries({ queryKey: ["my-rating", id, userId] })} />
                )
              )}

              {showRatingDriver && (
                myRating ? (
                  <RatingSummary
                    title="Your rating for this customer"
                    stars={(myRating as any).overall}
                    comment={(myRating as any).comment}
                  />
                ) : (
                  <RateCustomerForm jobId={id} customerId={job.customer_id} onSaved={() => qc.invalidateQueries({ queryKey: ["my-rating", id, userId] })} />
                )
              )}

              {showReceipt && (
                <>
                  <SpotlightCallout
                    id="receipt-button"
                    title="Your receipt is one tap away"
                    body="Every completed delivery gets a receipt with price, photos, and a downloadable PDF for your records — find it here anytime."
                  />
                  <a
                    id="tour-receipt-link"
                    href={`${SITE_URL}/track/${job.tracking_token}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 w-full text-center rounded-xl border font-semibold py-3 text-sm"
                  >
                    <Receipt className="w-4 h-4" /> View your receipt
                  </a>
                </>
              )}

              {showBookAgain && (
                <Link
                  to="/customer/book"
                  search={{
                    material: job.material,
                    quantity: job.quantity_m3,
                    address: job.delivery_address,
                    lat: job.delivery_lat ?? undefined,
                    lng: job.delivery_lng ?? undefined,
                    driverId: job.driver_id!,
                  }}
                  className="block w-full text-center rounded-xl bg-primary text-primary-foreground font-display font-bold uppercase tracking-wide py-3"
                >
                  Book this driver again
                </Link>
              )}
            </div>
          </Section>
        )}
      </div>
    </AppShell>
  );
}

function CounterOfferRow({ bidPrice, onSubmit }: { bidPrice: number; onSubmit: (price: number) => void }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(String(Math.max(1, Math.round(bidPrice * 0.9))));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full min-h-11 text-center text-xs font-semibold text-primary underline underline-offset-2">
        Propose a different price
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <Input
          type="number"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="pl-6"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          const v = Number(price);
          if (!v || v <= 0) return;
          onSubmit(v);
          setOpen(false);
        }}
      >
        Send offer
      </Button>
    </div>
  );
}

const MATCH_TIER_LABEL: Record<string, { label: string; className: string }> = {
  excellent: { label: "Excellent match", className: "bg-success/15 text-success border-success/30" },
  good: { label: "Good match", className: "bg-primary/10 text-primary border-primary/30" },
  oversized: { label: "Oversized", className: "bg-muted text-muted-foreground border-border" },
  multiple_trips: { label: "Multiple trips", className: "bg-warning/15 text-warning border-warning/30" },
};

function BidForm({
  jobId,
  quantityM3,
  existing,
  onSaved,
  job,
}: {
  jobId: string;
  quantityM3: number;
  existing?: any;
  onSaved: () => void;
  /** Redesign: the job, for the summary card and the customer-price chips. */
  job?: any;
}) {
  const { userId } = useAuth();
  // Starts at the driver's existing bid, else the customer's offer (the
  // quickest way to get picked) — the driver adjusts from there.
  const [price, setPrice] = useState(existing?.price?.toString() ?? (job?.budget != null ? String(Number(job.budget)) : ""));
  const [date, setDate] = useState(existing?.delivery_date ?? "");
  const [message, setMessage] = useState(existing?.message ?? "");
  const [truckId, setTruckId] = useState<string>(existing?.truck_id ?? "");
  // Migration 0060: optional "I can reach pickup in" (minutes).
  const [etaMinutes, setEtaMinutes] = useState<number | null>(existing?.eta_minutes ?? null);
  const [loading, setLoading] = useState(false);

  const { data: trucks } = useQuery({
    queryKey: ["my-trucks", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trucks")
        .select("id,registration,capacity_m3")
        .eq("driver_id", userId!)
        .order("capacity_m3");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    // Default to the driver's single truck, or their best-matched truck if
    // they have several and haven't bid on this job yet.
    if (truckId || !trucks?.length) return;
    if (trucks.length === 1) {
      setTruckId(trucks[0].id);
      return;
    }
    const best = [...trucks].sort((a, b) => {
      const pa = previewCapacityMatch(Number(a.capacity_m3), quantityM3);
      const pb = previewCapacityMatch(Number(b.capacity_m3), quantityM3);
      return (pa?.trips ?? 99) - (pb?.trips ?? 99) || Number(a.capacity_m3) - Number(b.capacity_m3);
    })[0];
    if (best) setTruckId(best.id);
  }, [trucks, truckId, quantityM3]);

  const selectedTruck = trucks?.find((t) => t.id === truckId);
  const preview = selectedTruck ? previewCapacityMatch(Number(selectedTruck.capacity_m3), quantityM3) : null;

  // Upfront commission-funds check so the driver learns about a shortfall
  // before bidding, not when the customer's acceptance fails.
  const { data: funds } = useQuery({
    queryKey: ["can-accept-for", jobId, userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("driver_can_accept_for", {
        _job_id: jobId,
        _driver_id: userId,
      });
      if (error) throw error;
      return data as {
        ok: boolean;
        required?: number;
        available?: number;
        shortfall?: number;
        free?: boolean;
        reason?: string;
      };
    },
  });

  const shortfall = Number(funds?.shortfall ?? 0);
  const showFundsWarning = !!funds && funds.ok === false && !funds.free && shortfall > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = parseFloat(price);
    if (!p || p <= 0) return toast.error("Enter a valid price");
    if (!truckId) return toast.error("Select which truck you're bidding with");
    setLoading(true);
    const { error } = await supabase.from("bids").upsert(
      {
        job_id: jobId,
        driver_id: userId!,
        price: p,
        delivery_date: date || null,
        message: message.trim() || null,
        truck_id: truckId,
        eta_minutes: etaMinutes,
      } as any,
      { onConflict: "job_id,driver_id" },
    );
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success(existing ? "Bid updated" : "Bid submitted");
    onSaved();
  };

  // --- Redesign (D2) presentation helpers. Display-only: the bid itself is
  // still exactly the upsert in submit() above. ---
  // Same query + cache key as the booking screen's commission-rate read
  // (system_settings.commission_rate is readable by any signed-in user).
  const { data: commissionRate } = useQuery({
    queryKey: ["commission-rate"],
    queryFn: async () => {
      const { data } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "commission_rate")
        .maybeSingle();

      return Number(data?.value ?? 7);
    },
  });
  // Same query + cache key as the driver dashboard's profile read.
  const { data: driverProfile } = useQuery({
    queryKey: ["driver-profile", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("driver_profiles").select("*").eq("user_id", userId!).maybeSingle();
      return data;
    },
  });

  const budget = Number(job?.budget ?? 0);
  const priceNum = Math.max(0, Number(price) || 0);
  const setPriceNum = (n: number) => setPrice(String(Math.max(5, Math.round(n * 100) / 100)));
  const discountPct = driverProfile ? levelInfo(driverProfile.level).discountPct : 0;
  const firstJobFree = driverProfile ? driverProfile.first_job_free_used === false : false;
  const effectivePct = commissionRate != null ? commissionRate * (1 - discountPct / 100) : null;
  const fee = effectivePct != null ? (firstJobFree ? 0 : Math.round(priceNum * effectivePct) / 100) : null;
  const pctLabel = effectivePct != null ? `${Number(effectivePct.toFixed(2))}%` : "";
  const chips = budget > 0 ? [budget, budget + 10, budget + 20, budget + 30] : [];
  // Server-computed at posting time by tg_validate_job_budget (same
  // compute_material_offer bounds the customer's quote used).
  const pb = job?.pricing_breakdown as { low?: number; high?: number } | null | undefined;
  const range = pb && Number(pb.low) > 0 && Number(pb.high) >= Number(pb.low) ? { low: Number(pb.low), high: Number(pb.high) } : null;
  const km = job ? straightKm({ lat: job.pickup_lat, lng: job.pickup_lng }, { lat: job.delivery_lat, lng: job.delivery_lng }) : null;

  return (
    <form onSubmit={submit} className="flex flex-1 flex-col">
      <div className="flex-1 space-y-4 px-5 pb-6">
        {job && (
          <CzCard id="tour-job-header" className="space-y-1.5 py-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                {materialLabel(job.material as any, job.custom_material)} · {Number(job.quantity_m3)} m³
              </span>
              {preview && (
                <span className="text-sm text-cz-muted shrink-0">{preview.trips > 1 ? `${preview.trips} trips` : "1 trip"}</span>
              )}
            </div>
            <div className="text-sm text-cz-muted">
              {(job.pickup_address || "Supplier pickup point") + " → " + job.delivery_address}
              {km != null ? ` · about ${Math.round(km)} km` : ""}
            </div>
            <div className="text-sm text-[#d6d4cf]">
              Customer offered <strong className="text-cz-text">{usd(budget)}</strong>
              {job.preferred_date ? <span className="text-cz-muted"> · wanted {job.preferred_date}</span> : null}
            </div>
            {job.notes && <p className="border-t border-cz-border pt-2 text-sm text-cz-muted">{job.notes}</p>}
          </CzCard>
        )}

        {trucks && trucks.length === 0 && (
          <HintBox tone="warn" icon={<Truck className="w-4 h-4" />}>
            Register a truck on your profile before bidding — customers see which truck will do the job.{" "}
            <Link to="/profile" className="font-semibold underline">Add a truck</Link>
          </HintBox>
        )}
        {showFundsWarning && (
          <div className="rounded-[14px] bg-cz-warn-tint p-3.5 text-cz-warn-text space-y-2">
            <div className="flex items-start gap-2">
              <Wallet className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-sm">
                <div className="font-bold">Top up to take this job</div>
                <p className="mt-1 opacity-90">
                  You need {money(shortfall)} more in your wallet to take jobs like this — commission is reserved when a
                  bid is accepted.
                </p>
                <p className="mt-1 text-xs opacity-80">
                  Commission required {money(Number(funds?.required ?? 0))} · Available{" "}
                  {money(Number(funds?.available ?? 0))}
                </p>
              </div>
            </div>
            <Link to="/wallet" className={czButtonClass("ghost", "sm")}>Top up wallet</Link>
          </div>
        )}

        <div className="pt-3">
          <PriceStepper
            value={priceNum}
            onDec={() => setPriceNum(priceNum - 5)}
            onInc={() => setPriceNum(priceNum + 5)}
            decDisabled={priceNum <= 5}
            decLabel="Lower by $5"
            incLabel="Raise by $5"
            caption={existing ? `your price · was ${usd(Number(existing.price))}` : "your price"}
          />
        </div>

        {chips.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {chips.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setPriceNum(v)}
                aria-pressed={priceNum === v}
                className={cn(
                  "min-h-12 rounded-xl text-[15px] font-semibold tabular-nums",
                  priceNum === v ? "bg-cz-amber text-cz-amber-ink font-bold" : "border border-cz-border-strong bg-cz-surface",
                )}
              >
                {usd(v)}
              </button>
            ))}
          </div>
        )}

        {budget > 0 && priceNum > 0 && (
          priceNum === budget ? (
            <HintBox tone="green" icon={<CheckCircle2 className="w-4 h-4" />}>
              You match the customer's price — the quickest way to get picked.
            </HintBox>
          ) : range && priceNum > range.high ? (
            <HintBox tone="warn" icon={<Info className="w-4 h-4" />}>
              Above the usual {usd(range.low)}–{usd(range.high)} for this trip. Customers pick higher offers less often.
            </HintBox>
          ) : range && priceNum < range.low ? (
            <HintBox tone="info" icon={<Info className="w-4 h-4" />}>
              Below Con Z's usual range of {usd(range.low)}–{usd(range.high)} for this trip.
            </HintBox>
          ) : range ? (
            <HintBox tone="info" icon={<Info className="w-4 h-4" />}>
              Fair price. Con Z's usual range for this trip is {usd(range.low)}–{usd(range.high)}.
            </HintBox>
          ) : priceNum > budget ? (
            <HintBox tone="warn" icon={<Info className="w-4 h-4" />}>
              {usd(priceNum - budget)} above the customer's offer of {usd(budget)}. They can accept, send you a counter-offer, or pick another driver.
            </HintBox>
          ) : (
            <HintBox tone="info" icon={<Info className="w-4 h-4" />}>
              {usd(budget - priceNum)} below the customer's offer of {usd(budget)}.
            </HintBox>
          )
        )}

        <div className="space-y-2">
          <div className="text-sm font-semibold text-cz-muted">I can reach pickup in</div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { v: 15, label: "15 min" },
              { v: 30, label: "30 min" },
              { v: 60, label: "1 hr" },
              { v: null, label: "Later" },
            ].map((o) => (
              <button
                key={String(o.v)}
                type="button"
                onClick={() => setEtaMinutes(o.v)}
                aria-pressed={etaMinutes === o.v}
                className={cn(
                  "min-h-12 rounded-xl text-[15px] font-semibold",
                  etaMinutes === o.v ? "bg-cz-amber text-cz-amber-ink font-bold" : "border border-cz-border-strong bg-cz-surface",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {trucks && trucks.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="bt" className="text-sm text-cz-muted">Bidding with</Label>
            <select
              id="bt"
              value={truckId}
              onChange={(e) => setTruckId(e.target.value)}
              className="w-full min-h-12 rounded-xl border border-cz-border bg-cz-surface px-3 text-[15px]"
              required
            >
              <option value="" disabled>Select a truck</option>
              {trucks.map((t) => {
                const p = previewCapacityMatch(Number(t.capacity_m3), quantityM3);
                return (
                  <option key={t.id} value={t.id}>
                    {t.registration} — {t.capacity_m3} m³{p ? ` (${MATCH_TIER_LABEL[p.tier].label}${p.trips > 1 ? `, ${p.trips} trips` : ""})` : ""}
                  </option>
                );
              })}
            </select>
            {preview && (
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge label={MATCH_TIER_LABEL[preview.tier].label} className={MATCH_TIER_LABEL[preview.tier].className} />
                <span className="text-xs text-cz-muted">
                  {preview.trips > 1 ? `Estimated ${preview.trips} trips for this order` : "1 trip"}
                </span>
              </div>
            )}
          </div>
        )}

        <details className="group rounded-[14px] border border-cz-border bg-cz-surface">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[15px] font-semibold">
            Delivery date & message <span className="text-cz-muted font-normal text-sm">(optional)</span>
            <ChevronDown className="w-4 h-4 text-cz-muted transition group-open:rotate-180" />
          </summary>
          <div className="space-y-3 px-4 pb-4">
            <div>
              <Label htmlFor="bd">Delivery date</Label>
              <Input id="bd" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11" />
            </div>
            <div>
              <Label htmlFor="bm">Message</Label>
              <Textarea
                id="bm"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="e.g. Can deliver tomorrow morning"
              />
            </div>
          </div>
        </details>

        {job && (
          <details className="group rounded-[14px] border border-cz-border bg-cz-surface">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[15px] font-semibold">
              <span className="flex items-center gap-2"><Navigation2 className="w-4 h-4 text-cz-amber" /> Check the route</span>
              <ChevronDown className="w-4 h-4 text-cz-muted transition group-open:rotate-180" />
            </summary>
            <div className="px-4 pb-4 -mt-2">
              <DriverNavigationButtons
                pickup={{ lat: job.pickup_lat ?? -17.8292, lng: job.pickup_lng ?? 31.0522 }}
                dropoff={{ lat: job.delivery_lat, lng: job.delivery_lng }}
                pickupLabel={job.pickup_address ?? "Harare CBD supplier pickup point"}
                dropoffLabel={job.delivery_address ?? "Drop-off"}
              />
            </div>
          </details>
        )}
      </div>

      <footer className="sticky bottom-0 z-20 space-y-3 border-t border-cz-border bg-cz-surface px-5 pt-4 pb-[calc(20px+env(safe-area-inset-bottom))]">
        {fee != null && priceNum > 0 && (
          <>
            <MoneyRow
              label={firstJobFree ? "Con Z fee (first job free)" : `Con Z fee (${pctLabel})`}
              value={`−${usd2(fee)}`}
              valueClassName="text-cz-muted"
            />
            <MoneyRow strong label="You earn" value={usd2(priceNum - fee)} valueClassName="text-cz-green-text" />
          </>
        )}
        <button type="submit" disabled={loading || showFundsWarning || !trucks?.length} className={czButtonClass("primary")}>
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : existing ? `Update offer · ${usd(priceNum)}` : `Send offer · ${usd(priceNum)}`}
        </button>
      </footer>
    </form>
  );
}

function RatingSummary({ title, stars, comment }: { title: string; stars: number; comment?: string | null }) {
  const rounded = Math.round(stars);
  return (
    <div className="rounded-2xl bg-card border p-4 space-y-2">
      <div className="font-display font-bold uppercase text-sm tracking-wide">{title}</div>
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} className={`w-5 h-5 ${n <= rounded ? "fill-warning text-warning" : "text-muted-foreground"}`} />
          ))}
        </div>
        <span className="text-sm text-muted-foreground">{stars.toFixed(1)}</span>
      </div>
      {comment && <p className="text-sm text-muted-foreground italic">"{comment}"</p>}
    </div>
  );
}

function RateForm({ jobId, driverId, onSaved }: { jobId: string; driverId: string; onSaved: () => void }) {
  const { userId } = useAuth();
  const [q, setQ] = useState(5);
  const [c, setC] = useState(5);
  const [r, setR] = useState(5);
  const [d, setD] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    const { error } = await supabase.from("ratings").insert({
      job_id: jobId,
      customer_id: userId!,
      driver_id: driverId,
      quality: q,
      communication: c,
      reliability: r,
      delivery_time: d,
      comment: comment.trim() || null,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Thanks for the rating!");
    onSaved();
  };

  const Stars = ({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) => (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <div className="flex shrink-0">
        {[1, 2, 3, 4, 5].map((n) => (
          <button type="button" key={n} onClick={() => onChange(n)} aria-label={`${label}: ${n} star${n === 1 ? "" : "s"}`} className="p-1.5">
            <Star className={`w-6 h-6 ${n <= value ? "fill-warning text-warning" : "text-muted-foreground"}`} />
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="rounded-2xl bg-card border p-4 space-y-3">
      <div className="font-display font-bold uppercase text-sm tracking-wide">Rate this driver</div>
      <Stars value={q} onChange={setQ} label="Quality" />
      <Stars value={c} onChange={setC} label="Communication" />
      <Stars value={r} onChange={setR} label="Reliability" />
      <Stars value={d} onChange={setD} label="Delivery time" />
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        maxLength={300}
        placeholder="Optional comment"
      />
      <Button onClick={submit} disabled={loading} className="w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit rating"}
      </Button>
    </div>
  );
}

function RateCustomerForm({ jobId, customerId, onSaved }: { jobId: string; customerId: string; onSaved: () => void }) {
  const { userId } = useAuth();
  const [punctuality, setP] = useState(5);
  const [communication, setC] = useState(5);
  const [payment, setPay] = useState(5);
  const [overall, setO] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setLoading(true);
    const { error } = await (supabase.from("customer_ratings") as any).insert({
      job_id: jobId,
      driver_id: userId!,
      customer_id: customerId,
      punctuality,
      communication,
      payment,
      overall,
      comment: comment.trim() || null,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Thanks for rating the customer!");
    setDone(true);
    onSaved();
  };

  const Stars = ({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) => (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <div className="flex shrink-0">
        {[1, 2, 3, 4, 5].map((n) => (
          <button type="button" key={n} onClick={() => onChange(n)} aria-label={`${label}: ${n} star${n === 1 ? "" : "s"}`} className="p-1.5">
            <Star className={`w-6 h-6 ${n <= value ? "fill-warning text-warning" : "text-muted-foreground"}`} />
          </button>
        ))}
      </div>
    </div>
  );

  if (done) return null;

  return (
    <div className="rounded-2xl bg-card border p-4 space-y-3">
      <div className="font-display font-bold uppercase text-sm tracking-wide">Rate this customer (optional)</div>
      <p className="text-xs text-muted-foreground">Help other drivers by sharing your experience.</p>
      <Stars value={punctuality} onChange={setP} label="Punctuality" />
      <Stars value={communication} onChange={setC} label="Communication" />
      <Stars value={payment} onChange={setPay} label="Payment" />
      <Stars value={overall} onChange={setO} label="Overall" />
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        maxLength={300}
        placeholder="Optional comment"
      />
      <Button onClick={submit} disabled={loading} className="w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit rating"}
      </Button>
    </div>
  );
}

function SignedProofPhoto({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    // Handle both: new storage paths (signed URL) and any older rows that
    // still hold a legacy broken public URL from before this fix.
    if (path.startsWith("http")) {
      setUrl(path);
      return;
    }
    signedEvidenceUrl(path)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [path]);

  if (failed) {
    return (
      <div className="w-full aspect-square rounded-lg border bg-muted flex items-center justify-center text-[10px] text-muted-foreground text-center p-2">
        Photo unavailable
      </div>
    );
  }

  return url ? (
    <img
      src={url}
      alt={alt}
      className="w-full aspect-square object-cover rounded-lg border"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className="w-full aspect-square rounded-lg border bg-muted animate-pulse" />
  );
}

function DeliveryPinEntry({ jobId, onConfirmed }: { jobId: string; onConfirmed: () => void }) {
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (pin.trim().length < 4) return toast.error("Enter the code the customer gave you");
    setSubmitting(true);
    const { error } = await (supabase.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>)("driver_confirm_delivery_pin", {
      _job_id: jobId,
      _pin: pin.trim(),
    });
    setSubmitting(false);
    if (error) {
      if (/incorrect code/i.test(error.message)) return toast.error("That code doesn't match — double check with the customer.");
      if (/no confirmed escrow payment/i.test(error.message)) return toast.error("The customer hasn't paid through Con Z Pay yet.");
      return toast.error(error.message);
    }
    toast.success("Delivery confirmed — payment released to your wallet!");
    setPin("");
    onConfirmed();
  };

  // Redesign: six single-digit boxes. One real (transparent) input sits on
  // top of them so typing, pasting and Android's numeric keyboard all
  // behave exactly like the single field this replaced.
  return (
    <div className="space-y-4">
      <label className="relative block" aria-label="Delivery PIN">
        <div aria-hidden className="grid grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-14 rounded-xl border-[1.5px] bg-cz-surface flex items-center justify-center cz-display font-bold text-2xl",
                i === Math.min(pin.length, 5) ? "border-cz-amber" : "border-cz-border-strong",
              )}
            >
              {pin[i] ?? ""}
            </span>
          ))}
        </div>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="absolute inset-0 w-full h-full opacity-0 cursor-text"
        />
      </label>
      <button type="button" onClick={submit} disabled={submitting || pin.trim().length < 4} className={czButtonClass("primary")}>
        {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Confirm PIN & finish"}
      </button>
    </div>
  );
}

function ProofUpload({ jobId, kind, label, hint, ctaLabel, onUploaded }: { jobId: string; kind: "pickup" | "delivery"; label: string; hint?: string; ctaLabel?: string; onUploaded: () => void | Promise<void> }) {
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      // Uploads to the private bucket, captures GPS, and records a row in
      // job_evidence. record_job_evidence itself sets jobs.pickup_photo_url /
      // delivery_photo_url server-side once the evidence row exists — no
      // separate client write here. (The DB also now rejects any client
      // attempt to set these fields directly unless a matching job_evidence
      // row already exists, so this was redundant and unsafe.)
      await uploadJobEvidence(jobId, kind, file);
      toast.success(`${label} photo uploaded`);
      await onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };


  // Redesign: the camera capture IS the step's one primary button; gallery
  // stays available as a secondary option. Same upload() for both.
  return (
    <div className="space-y-2.5">
      {hint && <p className="text-sm text-cz-muted">{hint}</p>}
      <label className={cn(czButtonClass("primary"), "cursor-pointer focus-within:ring-2 focus-within:ring-cz-amber-text", uploading && "opacity-60 pointer-events-none")}>
        {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
        <span>{uploading ? "Uploading photo…" : (ctaLabel ?? `Take ${label.toLowerCase()} photo`)}</span>
        <input type="file" accept="image/*" capture="environment" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="sr-only" />
      </label>
      <label className={cn(czButtonClass("ghost", "sm"), "cursor-pointer focus-within:ring-2 focus-within:ring-cz-amber-text", uploading && "opacity-60 pointer-events-none")}>
        <ImageIcon className="w-4 h-4" />
        <span>Choose from gallery instead</span>
        <input type="file" accept="image/*" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="sr-only" />
      </label>
    </div>
  );
}

function CancelJobDialog({ jobId, status, onCancelled }: { jobId: string; status: string; onCancelled: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const policy =
    status === "open"
      ? "You can cancel this job for free."
      : status === "accepted"
        ? "This driver has already accepted your job. Cancelling now may result in a fee and a strike on your account."
        : "The driver has already loaded your material. Cancelling now will result in a strike and may affect your account. This should only be used for genuine emergencies.";

  const tone =
    status === "open"
      ? "text-muted-foreground"
      : status === "accepted"
        ? "text-warning"
        : "text-destructive";

  const submit = async () => {
    setLoading(true);
    const { error } = await supabase.rpc("cancel_job", { _job_id: jobId, _reason: reason.trim() || "" });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Job cancelled");
    setOpen(false);
    onCancelled();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={czButtonClass("danger", "md")}>
          <Trash2 className="w-4 h-4" />
          Cancel job
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this job?</DialogTitle>
          <DialogDescription className={tone}>{policy}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cxr">Reason (optional)</Label>
          <Textarea
            id="cxr"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Tell us why you're cancelling"
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
            Keep job
          </Button>
          <Button variant="destructive" onClick={submit} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirm cancellation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const DISPUTE_TYPES: { value: "wrong_quantity" | "damage" | "no_show" | "payment_issue" | "conduct" | "other"; label: string }[] = [
  { value: "wrong_quantity", label: "Wrong quantity delivered" },
  { value: "damage", label: "Damaged material" },
  { value: "no_show", label: "Driver didn't show up" },
  { value: "payment_issue", label: "Payment issue" },
  { value: "conduct", label: "Bad conduct or behavior" },
  { value: "other", label: "Something else" },
];

function RaiseDisputeDialog({ jobId, against, label }: { jobId: string; against: string | null; label?: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<typeof DISPUTE_TYPES[number]["value"]>("wrong_quantity");
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (explanation.trim().length < 5) return toast.error("Please explain what happened.");
    if (!against) return toast.error("Cannot identify the other party yet.");
    setLoading(true);
    const label = DISPUTE_TYPES.find((t) => t.value === category)?.label ?? category;
    const { error } = await supabase.rpc("raise_dispute", {
      _job_id: jobId,
      _against: against,
      _category: category,
      _reason: `${label}: ${explanation.trim()}`,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Dispute submitted. Our team will review it.");
    setOpen(false);
    setExplanation("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className={czButtonClass("danger", "md")}>
          <Flag className="w-4 h-4" /> {label ?? "Report a problem"}
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Raise a dispute</DialogTitle>
          <DialogDescription>
            An admin will review the job details and proof photos before deciding.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="dcat">Type of issue</Label>
            <select
              id="dcat"
              value={category}
              onChange={(e) => setCategory(e.target.value as any)}
              className="w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm"
            >
              {DISPUTE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="dexp">What happened?</Label>
            <Textarea
              id="dexp"
              rows={4}
              maxLength={1000}
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              placeholder="Give a short, clear description."
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
          <Button onClick={submit} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit dispute"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobTimeline({ job }: { job: any }) {
  const cancelled = job.status === "cancelled";
  const posted = true;
  const accepted = ["accepted", "in_progress", "completed"].includes(job.status);
  const enRoute = job.status === "in_progress" || (!!job.pickup_photo_url && job.status !== "completed") || job.status === "completed";
  const delivered = job.status === "completed" || !!job.delivery_photo_url;

  const steps = [
    { key: "posted", label: "Posted", icon: FileText, done: posted, active: !accepted && !cancelled },
    { key: "accepted", label: "Bid accepted", icon: CheckCircle2, done: accepted, active: accepted && !enRoute },
    { key: "enroute", label: "En route", icon: Truck, done: enRoute, active: enRoute && !delivered },
    { key: "delivered", label: "Delivered", icon: PackageOpen, done: delivered, active: delivered },
  ];

  if (cancelled) {
    return (
      <div className="rounded-2xl bg-card border p-4 text-sm text-muted-foreground">
        This job was cancelled.
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-card border p-4">
      <div className="flex items-center justify-between gap-2">
        {steps.map((s, i) => {
          const Icon = s.done ? s.icon : Circle;
          const color = s.active
            ? "text-primary"
            : s.done
              ? "text-success"
              : "text-muted-foreground";
          return (
            <div key={s.key} className="flex-1 flex flex-col items-center gap-1 min-w-0">
              <div className="flex items-center w-full">
                {i > 0 && (
                  <div className={`h-0.5 flex-1 ${steps[i - 1].done ? "bg-success" : "bg-border"}`} />
                )}
                <div
                  className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${
                    s.active
                      ? "border-primary bg-primary/10"
                      : s.done
                        ? "border-success bg-success/10"
                        : "border-border bg-muted"
                  }`}
                >
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                {i < steps.length - 1 && (
                  <div className={`h-0.5 flex-1 ${s.done ? "bg-success" : "bg-border"}`} />
                )}
              </div>
              <div className={`text-[10px] font-semibold uppercase tracking-wide text-center ${color}`}>
                {s.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/* ======================================================================
 * Driver / customer mode redesign (D2–D5, C3–C6).
 *
 * Everything below is presentation. Every action is a handler created in
 * JobDetail (accept_bid, counter_bid, accept_counter, reject_counter,
 * complete_job, the Paynow escrow initiation) or one of the existing
 * components above (BidForm's bids upsert, ProofUpload + start_trip,
 * DeliveryPinEntry's driver_confirm_delivery_pin, CancelJobDialog's
 * cancel_job, RaiseDisputeDialog's raise_dispute, the rating inserts),
 * passed in unchanged. No screen here talks to the backend on its own.
 * ==================================================================== */

type JobScreenCtx = {
  id: string;
  job: any;
  bids: any[] | undefined;
  myBid: any;
  userId: string | null;
  isOwner: boolean;
  isAssignedDriver: boolean;
  isEscrow: boolean;
  escrowPaid: boolean;
  payingEscrow: boolean;
  payEscrow: () => void;
  acceptBid: (bidId: string) => void;
  counterBid: (bidId: string, price: number) => void;
  acceptCounter: (bidId: string) => void;
  rejectCounter: (bidId: string) => void;
  completeJob: () => void;
  unreadCount: number | undefined;
  nearbyDrivers: number | undefined;
  myRating: any;
  showRadar: boolean;
  showCounterResponse: boolean;
  showCancel: boolean;
  showDispute: boolean;
  showNextLoads: boolean;
  showBookAgain: boolean;
  showReceipt: boolean;
  showCompleteButton: boolean;
  showDeliveryPinDisplay: boolean;
  deliveryPin: string | null;
  invalidateJob: () => void;
  invalidateBids: () => void;
  invalidateRating: () => void;
  onCancelled: () => void;
};

/** Per-job UI flag kept for the browser session (e.g. "I've arrived at
 *  pickup" — there is no server-side arrive action, so this only moves the
 *  driver's own view forward). */
function useSessionFlag(key: string): [boolean, (v: boolean) => void] {
  const [v, setV] = useState<boolean>(() => {
    try {
      return typeof window !== "undefined" && window.sessionStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const set = (next: boolean) => {
    setV(next);
    try {
      if (next) window.sessionStorage.setItem(key, "1");
      else window.sessionStorage.removeItem(key);
    } catch {
      /* storage unavailable — the in-memory state still works */
    }
  };
  return [v, set];
}

const googleNav = (lat: number | null | undefined, lng: number | null | undefined) =>
  lat != null && lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving` : null;

function firstName(name: string | null | undefined, fallback: string) {
  const f = (name ?? "").trim().split(/\s+/)[0];
  return f || fallback;
}

/** Round overlay button for use on top of a map. */
function MapBackButton({ to, onClick }: { to?: string; onClick?: () => void }) {
  const cls =
    "pointer-events-auto w-11 h-11 shrink-0 rounded-[14px] bg-cz-bg text-cz-text flex items-center justify-center shadow-[0_4px_14px_rgba(0,0,0,0.4)]";
  return onClick ? (
    <button type="button" onClick={onClick} aria-label="Back" className={cls}>
      <ArrowLeft className="w-5 h-5" />
    </button>
  ) : (
    <Link to={(to ?? "/jobs") as "/jobs"} aria-label="Back" className={cls}>
      <ArrowLeft className="w-5 h-5" />
    </Link>
  );
}

/** Other party card with Chat (existing chat route, unread badge) + Call
 *  (existing tel: link). */
function ContactCard({ ctx, subtitle, role }: { ctx: JobScreenCtx; subtitle: ReactNode; role: "driver" | "customer" }) {
  const { other, name, call } = useJobContact(ctx.job, ctx.isOwner);
  const who = role === "driver" ? "driver" : "customer";
  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-cz-border bg-cz-surface px-3.5 py-3">
      <InitialsAvatar name={other?.full_name ?? name} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{other?.full_name ?? name}</div>
        <div className="text-[13px] text-cz-muted truncate">{subtitle}</div>
      </div>
      <Link
        id="tour-chat-link"
        to="/chat/$jobId"
        params={{ jobId: ctx.id }}
        aria-label={`Chat with ${who}${ctx.unreadCount ? ` (${ctx.unreadCount} unread)` : ""}`}
        className="relative w-11 h-11 shrink-0 rounded-xl border border-cz-border-strong flex items-center justify-center hover:bg-cz-surface-2"
      >
        <MessageSquare className="w-5 h-5" />
        {!!ctx.unreadCount && (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center">
            {ctx.unreadCount > 9 ? "9+" : ctx.unreadCount}
          </span>
        )}
      </Link>
      {call ? (
        <a
          href={call}
          aria-label={`Call ${who}`}
          className="w-11 h-11 shrink-0 rounded-xl border border-cz-border-strong flex items-center justify-center hover:bg-cz-surface-2"
        >
          <Phone className="w-5 h-5" />
        </a>
      ) : (
        <IconButton disabled aria-label="No phone number on their profile yet" title="No phone number on their profile yet">
          <Phone className="w-5 h-5" />
        </IconButton>
      )}
    </div>
  );
}

function ShareTrackingButton({ ctx, className }: { ctx: JobScreenCtx; className?: string }) {
  const { trackUrl, shareTrackLink } = useJobContact(ctx.job, ctx.isOwner);
  if (!trackUrl) return null;
  return (
    <button type="button" onClick={shareTrackLink} className={className ?? czButtonClass("ghost", "sm")}>
      <Share2 className="w-4 h-4" /> Share tracking link
    </button>
  );
}

function ProofPhotos({ job }: { job: any }) {
  if (!job.pickup_photo_url && !job.delivery_photo_url) return null;
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-cz-muted">Proof of delivery</div>
      <div className="grid grid-cols-2 gap-3">
        {job.pickup_photo_url && (
          <figure className="space-y-1">
            <SignedProofPhoto path={job.pickup_photo_url} alt="Load confirmed" />
            <figcaption className="text-xs font-semibold text-cz-green-text flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Load confirmed
            </figcaption>
          </figure>
        )}
        {job.delivery_photo_url && (
          <figure className="space-y-1">
            <SignedProofPhoto path={job.delivery_photo_url} alt="Delivery confirmed" />
            <figcaption className="text-xs font-semibold text-cz-green-text flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Delivery confirmed
            </figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}

function CancelledScreen({ ctx, backTo }: { ctx: JobScreenCtx; backTo: string }) {
  return (
    <CzScreen>
      <CzHeader title="Job cancelled" backTo={backTo} />
      <div className="px-5 space-y-4">
        <CzCard className="space-y-1">
          <div className="font-semibold">
            {materialLabel(ctx.job.material as any, ctx.job.custom_material)} · {Number(ctx.job.quantity_m3)} m³
          </div>
          <div className="text-sm text-cz-muted">{ctx.job.delivery_address}</div>
          <p className="pt-2 text-sm text-cz-muted">This job was cancelled.</p>
          {ctx.job.cancellation_reason && <p className="text-sm text-cz-muted italic">"{ctx.job.cancellation_reason}"</p>}
        </CzCard>
        <Link to={backTo as "/jobs"} className={czButtonClass("primary")}>
          {ctx.isOwner ? "Back to my jobs" : "Find another load"}
        </Link>
      </div>
    </CzScreen>
  );
}

/* ------------------------------ DRIVER ------------------------------ */

function DriverJobScreen({ ctx }: { ctx: JobScreenCtx }) {
  const { job } = ctx;
  if (job.status === "cancelled") return <CancelledScreen ctx={ctx} backTo="/driver" />;
  if (ctx.isAssignedDriver && (job.status === "accepted" || job.status === "in_progress")) return <DriverActiveJob ctx={ctx} />;
  if (ctx.isAssignedDriver && job.status === "completed") return <DriverPaid ctx={ctx} />;
  if (job.status === "open") return <DriverOpenJob ctx={ctx} />;
  // A job this driver bid on that went to someone else (or otherwise left
  // the open state without them).
  return (
    <CzScreen className={DRIVER_NAV_SPACE}>
      <CzHeader title="Load no longer available" backTo="/driver" />
      <div className="px-5 space-y-4">
        <CzCard className="space-y-1">
          <div className="font-semibold">
            {materialLabel(job.material as any, job.custom_material)} · {Number(job.quantity_m3)} m³
          </div>
          <div className="text-sm text-cz-muted">{job.delivery_address}</div>
          <p className="pt-2 text-sm text-cz-muted">
            {ctx.myBid?.status === "rejected" ? "The customer chose another driver for this load." : "This load has been taken."}
          </p>
        </CzCard>
        <Link to="/driver" className={czButtonClass("primary")}>Find next load</Link>
      </div>
      <DriverBottomNav />
    </CzScreen>
  );
}

/** D2 (offer form) / D3 (offer sent, waiting) / counter-offer response. */
function DriverOpenJob({ ctx }: { ctx: JobScreenCtx }) {
  const { job, myBid } = ctx;
  const [editing, setEditing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  // Migration 0060: count + price range of the OTHER offers (never their
  // details), only returned to a driver who has an offer on this job.
  const { data: summary } = useQuery({
    queryKey: ["offer-summary", ctx.id, ctx.userId],
    enabled: !!myBid && job.status === "open",
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await jobOfferSummary(ctx.id);
      if (error) return null;
      return data;
    },
  });
  // Migration 0062: offers are valid for 30 minutes (server-stamped).
  const secondsLeft = useSecondsLeft(myBid?.expires_at);
  const expired = secondsLeft === 0;
  const [resending, setResending] = useState(false);
  // Resending = the driver re-saving their own pending offer; the
  // server restarts the 30-minute clock on any driver edit.
  const resend = async () => {
    if (!myBid) return;
    setResending(true);
    const { error } = await supabase.from("bids").update({ price: Number(myBid.price) } as any).eq("id", myBid.id);
    setResending(false);
    if (error) return toast.error(error.message);
    toast.success(`Offer sent again · ${usd(Number(myBid.price))}`);
    ctx.invalidateBids();
  };
  const withdraw = async () => {
    if (!myBid) return;
    if (!window.confirm("Withdraw your offer? You can send a new one while the job is still open.")) return;
    setWithdrawing(true);
    const { error } = await withdrawBid(myBid.id);
    setWithdrawing(false);
    if (error) return toast.error(error.message);
    toast.success("Offer withdrawn");
    ctx.invalidateBids();
  };

  if (ctx.showCounterResponse) {
    return (
      <CzScreen className={DRIVER_NAV_SPACE}>
        <CzHeader
          title="New price from the customer"
          backTo="/driver"
          right={secondsLeft != null && !expired ? <span className="text-sm text-cz-muted shrink-0">Reply in <strong className="text-cz-text tabular-nums">{mmss(secondsLeft)}</strong></span> : undefined}
        />
        <div id="tour-place-bid" className="px-5 space-y-4">
          <CzCard selected className="space-y-3">
            <div className="text-sm font-semibold text-cz-amber-text">Customer proposed a new price</div>
            <div className="flex items-baseline gap-3">
              <span className="cz-display font-bold text-5xl text-cz-amber">{usd(Number(myBid.customer_counter_price))}</span>
              <span className="text-sm text-cz-muted line-through">{usd(Number(myBid.price))}</span>
            </div>
            <p className="text-sm text-cz-muted">
              Accept and the job is yours at this price. Decline and your original offer of {usd(Number(myBid.price))} still stands.
            </p>
          </CzCard>
          <div className="grid grid-cols-2 gap-2.5">
            <CzButton size="md" onClick={() => ctx.acceptCounter(myBid.id)}>Accept {usd(Number(myBid.customer_counter_price))}</CzButton>
            <CzButton size="md" kind="ghost" onClick={() => ctx.rejectCounter(myBid.id)}>Decline</CzButton>
          </div>
          <JobSummaryCard job={job} />
        </div>
        <DriverBottomNav />
      </CzScreen>
    );
  }

  if (myBid && !editing) {
    return (
      <CzScreen className={DRIVER_NAV_SPACE}>
        <CzHeader
          title={expired ? "Offer expired" : "Offer sent"}
          backTo="/driver"
          right={
            secondsLeft != null && !expired ? (
              <span className="text-sm text-cz-muted shrink-0">
                Expires in <strong className="text-cz-text tabular-nums">{mmss(secondsLeft)}</strong>
              </span>
            ) : undefined
          }
        />
        {expired && (
          <div className="px-5 pt-2 space-y-2.5">
            <HintBox tone="warn" icon={<Clock className="w-4 h-4" />}>
              Your offer expired after 30 minutes without an answer, so the customer can't choose it now. Send it again to
              put it back in front of them.
            </HintBox>
            <CzButton onClick={resend} disabled={resending}>
              {resending ? <Loader2 className="w-5 h-5 animate-spin" /> : `Send again · ${usd(Number(myBid.price))}`}
            </CzButton>
          </div>
        )}
        <div className={cn("flex flex-col items-center gap-3.5 px-5 pt-6 pb-6 text-center", expired && "hidden")}>
          <div className="relative w-[132px] h-[132px] flex items-center justify-center">
            <span aria-hidden className="cz-pulse-ring absolute inset-0 rounded-full border-2 border-cz-amber" />
            <span className="w-[92px] h-[92px] rounded-full bg-cz-amber-tint-2 flex items-center justify-center text-cz-amber">
              <Truck className="w-11 h-11" strokeWidth={1.8} />
            </span>
          </div>
          <div className="cz-display font-bold text-[26px] leading-tight">The customer is choosing a driver</div>
          <p className="text-[15px] text-cz-muted max-w-[290px]">
            You'll get a notification the moment you're picked. You can keep looking at other loads.
          </p>
        </div>

        <div id="tour-place-bid" className="px-5 space-y-2.5">
          <div className="text-sm font-semibold text-cz-muted">Offers on this job</div>
          <div className="flex items-center justify-between gap-3 rounded-[14px] border-[1.5px] border-cz-amber bg-cz-surface px-4 py-3.5">
            <div className="min-w-0">
              <div className="font-bold">Your offer</div>
              <div className="text-[13px] text-cz-muted truncate">
                {[
                  myBid.eta_minutes && `Pickup in ${myBid.eta_minutes >= 60 ? `${Math.round(myBid.eta_minutes / 60)} hr` : `${myBid.eta_minutes} min`}`,
                  myBid.truck_reg && `Truck ${myBid.truck_reg}`,
                  myBid.delivery_date && `Can deliver ${myBid.delivery_date}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Waiting for the customer"}
              </div>
              {myBid.counter_status === "driver_rejected" && (
                <div className="text-[13px] text-cz-muted">You declined the customer's counter of {usd(Number(myBid.customer_counter_price))}.</div>
              )}
            </div>
            <span className="cz-display font-bold text-[28px] text-cz-amber tabular-nums">{usd(Number(myBid.price))}</span>
          </div>
          {summary && (
            <div className="flex items-center justify-between gap-3 rounded-[14px] border border-cz-border bg-cz-surface px-4 py-3.5">
              <div className="min-w-0">
                <div className="font-semibold">
                  {summary.others === 0 ? "No other offers yet" : `${summary.others} other driver${summary.others === 1 ? "" : "s"}`}
                </div>
                <div className="text-[13px] text-cz-muted">
                  {summary.others === 0 ? "You're the first — good chance of being picked." : "Offers between"}
                </div>
              </div>
              {summary.others > 0 && summary.min != null && summary.max != null && (
                <span className="cz-display font-bold text-[22px] text-[#d6d4cf] tabular-nums">
                  {Number(summary.min) === Number(summary.max) ? usd(Number(summary.min)) : `${usd(Number(summary.min))}–${usd(Number(summary.max))}`}
                </span>
              )}
            </div>
          )}
          <JobSummaryCard job={job} />
        </div>

        <div className="grid grid-cols-2 gap-2.5 px-5 pt-5">
          <CzButton size="md" kind="ghost" onClick={() => setEditing(true)}>Change offer</CzButton>
          <CzButton size="md" kind="danger" onClick={withdraw} disabled={withdrawing || myBid.status !== "pending"}>
            {withdrawing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Withdraw"}
          </CzButton>
        </div>
        <div className="px-5 pt-2.5">
          <Link to="/driver" className={czButtonClass("secondary", "md")}>Find more loads</Link>
        </div>
        <DriverBottomNav />
      </CzScreen>
    );
  }

  return (
    <CzScreen>
      <CzHeader title={editing ? "Change your offer" : "Offer your price"} {...(editing ? { onBack: () => setEditing(false) } : { backTo: "/driver" })} />
      <div id="tour-place-bid" className="flex flex-1 flex-col">
        <div className="px-5">
          <SpotlightCallout
            id="driver-bidding"
            title="Bid your own price"
            body="Enter what you'd charge for this delivery. If the customer likes it, they'll accept — or they might propose a different price back to you."
          />
        </div>
        <BidForm
          jobId={ctx.id}
          job={job}
          quantityM3={Number(job.quantity_m3)}
          existing={myBid}
          onSaved={() => {
            setEditing(false);
            ctx.invalidateBids();
          }}
        />
      </div>
    </CzScreen>
  );
}

function JobSummaryCard({ job, id = "tour-job-header" }: { job: any; id?: string }) {
  return (
    <CzCard id={id} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <MaterialBadge>
          {materialLabel(job.material as any, job.custom_material)} · {Number(job.quantity_m3)} m³
        </MaterialBadge>
        <span className="text-[13px] text-cz-muted">Customer offered {usd(Number(job.budget))}</span>
      </div>
      <RouteStops pickupLabel={job.pickup_address || "Supplier pickup point"} dropLabel={job.delivery_address} />
      {(job.preferred_date || job.notes) && (
        <div className="border-t border-cz-border pt-2.5 text-sm text-cz-muted space-y-1">
          {job.preferred_date && (
            <div className="flex items-center gap-2"><Calendar className="w-4 h-4" /> {job.preferred_date}</div>
          )}
          {job.notes && <p>{job.notes}</p>}
        </div>
      )}
    </CzCard>
  );
}

/** D4 · Active job: map on top, one step at a time in the sheet. */
function DriverActiveJob({ ctx }: { ctx: JobScreenCtx }) {
  const { job, id } = ctx;
  const { other } = useJobContact(job, false);
  // Migration 0060: arrival is recorded server-side (driver_mark_arrived),
  // so the customer's step bar shows it too. Realtime on the job row
  // refreshes this screen when it lands.
  const arrivedPickup = !!job.driver_arrived_pickup_at;
  const arrivedDrop = !!job.driver_arrived_dropoff_at;
  const [marking, setMarking] = useState(false);
  const markArrived = async (stage: "pickup" | "dropoff", arrived: boolean) => {
    setMarking(true);
    const { error } = await driverMarkArrived(id, stage, arrived);
    setMarking(false);
    if (error) return toast.error(error.message);
    ctx.invalidateJob();
  };
  const setArrivedPickup = (v: boolean) => markArrived("pickup", v);
  const setArrivedDrop = (v: boolean) => markArrived("dropoff", v);
  const [bannerHidden, setBannerHidden] = useSessionFlag(`cz.got-job-seen.${id}`);
  const [route, setRoute] = useState<RouteResult | null>(null);

  // Steps come from job state only: arrived at pickup → Load; pickup photo
  // → trip started (Deliver); delivery photo → PIN / customer confirmation.
  // The customer's tracking screen derives the same step from the same
  // fields.
  const step = !job.pickup_photo_url ? (arrivedPickup ? 1 : 0) : !job.delivery_photo_url ? 2 : 3;
  const price = Number(job.final_price ?? job.budget);
  const mat = materialLabel(job.material as any, job.custom_material);
  const cust = firstName(other?.full_name, "the customer");
  const pickupNav = googleNav(job.pickup_lat, job.pickup_lng);
  const dropNav = googleNav(job.delivery_lat, job.delivery_lng);

  const title = [
    "Head to pickup",
    `Load ${Number(job.quantity_m3)} m³ ${mat.toLowerCase()}`,
    `Deliver to ${areaOf(job.delivery_address) || "the customer"}`,
    ctx.isEscrow ? "Get the delivery PIN" : "Get paid & finish",
  ][step];
  const sub = [
    job.pickup_address || "Supplier pickup point",
    "Take a photo of the loaded truck before you leave. It protects you if there's a dispute.",
    `${route ? `${route.distanceKm.toFixed(1)} km · about ${Math.round(route.etaMin)} min. ` : `${job.delivery_address}. `}The customer can follow you live.`,
    ctx.isEscrow
      ? `Ask ${cust} for the 6-digit PIN. Entering it releases your ${usd(price)} from Con Z Pay.`
      : `Collect ${usd(price)} from ${cust} directly, then ask them to tap "Load received" in their app to complete the job.`,
  ][step];

  return (
    <CzScreen>
      <div className="relative">
        <DriverRouteView jobId={id} bare height={300} onRoute={setRoute} />
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MapBackButton to="/jobs" />
            <StatusPill className="pointer-events-auto bg-cz-bg">#{id.slice(0, 6).toUpperCase()} · {usd(price)}</StatusPill>
          </div>
          {ctx.isEscrow &&
            (ctx.escrowPaid ? (
              <StatusPill tone="green" icon={<ShieldCheck className="w-3.5 h-3.5" />}>Payment secured</StatusPill>
            ) : (
              <StatusPill tone="amber">Awaiting payment</StatusPill>
            ))}
        </div>
      </div>

      <BottomSheet className="flex-1 space-y-4">
        {step === 0 && job.status === "accepted" && !bannerHidden && (
          <button
            type="button"
            onClick={() => setBannerHidden(true)}
            className="w-full flex items-center gap-3 rounded-2xl border border-cz-green-border bg-cz-green-tint px-4 py-3 text-left"
          >
            <span className="w-10 h-10 shrink-0 rounded-full bg-cz-green text-[#0b2416] flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-bold">You got the job!</span>
              <span className="block text-[13px] text-[#a7ddbe]">
                {cust === "the customer" ? "The customer" : cust} picked your {usd(price)} offer · Tap to start
              </span>
            </span>
          </button>
        )}

        <div id="tour-next-steps" className="space-y-4">
          <StepProgress current={step} />
          <div className="space-y-1.5">
            <h1 className="cz-display font-bold text-[28px] leading-tight">{title}</h1>
            <p className="text-[15px] text-cz-muted leading-snug">{sub}</p>
          </div>

          {ctx.isEscrow && !ctx.escrowPaid && (
            <HintBox tone="warn" icon={<ShieldCheck className="w-4 h-4" />}>
              Waiting for the customer to pay through Con Z Pay before you're guaranteed payment on delivery.
            </HintBox>
          )}

          {step === 0 && (
            <div className="space-y-2.5">
              <CzButton onClick={() => setArrivedPickup(true)} disabled={marking}>
                {marking ? <Loader2 className="w-5 h-5 animate-spin" /> : "I've arrived at pickup"}
              </CzButton>
              {pickupNav && (
                <a href={pickupNav} target="_blank" rel="noreferrer" className={czButtonClass("ghost", "sm")}>
                  <Navigation2 className="w-4 h-4" /> Navigate to pickup
                </a>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-2">
              <ProofUpload
                jobId={id}
                kind="pickup"
                label="Confirm Pickup"
                ctaLabel="Take photo & start trip"
                onUploaded={async () => {
                const { error } = await supabase.rpc("start_trip", { _job_id: id });
                if (error) { toast.error(error.message); return; }
                ctx.invalidateJob();
                }}
              />
              <button type="button" onClick={() => setArrivedPickup(false)} disabled={marking} className="w-full min-h-11 text-sm text-cz-muted">
                Not at pickup yet
              </button>
            </div>
          )}

          {step === 2 &&
            (!arrivedDrop ? (
              <div className="space-y-2.5">
                <CzButton onClick={() => setArrivedDrop(true)} disabled={marking}>
                  {marking ? <Loader2 className="w-5 h-5 animate-spin" /> : "I've arrived at drop-off"}
                </CzButton>
                {dropNav && (
                  <a href={dropNav} target="_blank" rel="noreferrer" className={czButtonClass("ghost", "sm")}>
                    <Navigation2 className="w-4 h-4" /> Navigate to drop-off
                  </a>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <ProofUpload
                  jobId={id}
                  kind="delivery"
                  label="Confirm Delivery"
                  hint="Take a photo at the delivery point once the load is tipped."
                  ctaLabel="Take delivery photo"
                  onUploaded={async () => {
                    ctx.invalidateJob();
                  }}
                />
                <button type="button" onClick={() => setArrivedDrop(false)} disabled={marking} className="w-full min-h-11 text-sm text-cz-muted">
                  Not there yet
                </button>
              </div>
            ))}

          {step === 3 &&
            (ctx.isEscrow ? (
              <div id="tour-delivery-pin-entry">
                <DeliveryPinEntry jobId={id} onConfirmed={ctx.invalidateJob} />
              </div>
            ) : (
              <HintBox tone="info" icon={<Info className="w-4 h-4" />}>
                Waiting for the customer to confirm delivery. This screen updates by itself once they do.
              </HintBox>
            ))}
        </div>

        <ContactCard ctx={ctx} role="customer" subtitle={`${mat} · ${Number(job.quantity_m3)} m³`} />

        <div id="tour-tracking">
          <DriverShareLocation jobId={id} driverId={ctx.userId!} compact />
        </div>

        <ProofPhotos job={job} />

        <details className="group rounded-[14px] border border-cz-border bg-cz-surface">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[15px] font-semibold">
            <span className="flex items-center gap-2"><Navigation2 className="w-4 h-4 text-cz-amber" /> More navigation options</span>
            <ChevronDown className="w-4 h-4 text-cz-muted transition group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4 -mt-2">
            <DriverNavigationButtons
              pickup={{ lat: job.pickup_lat ?? -17.8292, lng: job.pickup_lng ?? 31.0522 }}
              dropoff={{ lat: job.delivery_lat, lng: job.delivery_lng }}
              pickupLabel={job.pickup_address ?? "Harare CBD supplier pickup point"}
              dropoffLabel={job.delivery_address ?? "Drop-off"}
            />
          </div>
        </details>

        {ctx.showNextLoads && <NextLoadsCard driverId={ctx.userId!} currentJobId={id} />}

        <div className="grid grid-cols-1 gap-2.5">
          <ShareTrackingButton ctx={ctx} />
          {ctx.showDispute && (
            <div id="tour-dispute">
              <RaiseDisputeDialog jobId={id} against={job.customer_id} label="Report an issue" />
            </div>
          )}
        </div>
      </BottomSheet>
    </CzScreen>
  );
}

const LEVEL_FLOOR: Record<string, number> = { bronze: 0, silver: 21, gold: 101, platinum: 500 };
const NEXT_LEVEL: Record<string, string> = { bronze: "silver", silver: "gold", gold: "platinum" };

/** D5 · Paid / delivery complete. */
function DriverPaid({ ctx }: { ctx: JobScreenCtx }) {
  const { job, id } = ctx;
  const { other } = useJobContact(job, false);
  // Same query + cache key as the driver dashboard's profile read.
  const { data: driver } = useQuery({
    queryKey: ["driver-profile", ctx.userId],
    enabled: !!ctx.userId,
    queryFn: async () => {
      const { data } = await supabase.from("driver_profiles").select("*").eq("user_id", ctx.userId!).maybeSingle();
      return data;
    },
  });
  const price = Number(job.final_price ?? job.budget);
  const commission = job.commission != null ? Number(job.commission) : null;
  const pct = commission != null && price > 0 ? Math.round((commission / price) * 10000) / 100 : null;
  const cust = firstName(other?.full_name, "the customer");
  const lvl = driver ? levelInfo(driver.level) : null;
  const nextKey = driver ? NEXT_LEVEL[driver.level] : undefined;
  const next = nextKey ? levelInfo(nextKey) : null;
  const floor = driver ? LEVEL_FLOOR[driver.level] ?? 0 : 0;
  const progress =
    driver && lvl?.nextAt != null ? Math.min(100, Math.max(0, ((driver.jobs_completed - floor) / (lvl.nextAt - floor)) * 100)) : 100;

  return (
    <CzScreen className={DRIVER_NAV_SPACE}>
      <div className="flex flex-col items-center gap-3 px-5 pt-12 pb-6 text-center">
        <span className="w-[88px] h-[88px] rounded-full bg-cz-green text-[#0b2416] flex items-center justify-center">
          <CheckCircle2 className="w-12 h-12" strokeWidth={2.2} />
        </span>
        <h1 className="cz-display font-bold text-[30px]">Delivery complete</h1>
        <span className="text-[15px] text-cz-muted">
          {jobRef(id)} · {areaOf(job.delivery_address) || job.delivery_address}
        </span>
      </div>

      <div className="px-5 space-y-3.5">
        <CzCard className="space-y-3 p-[18px]">
          <MoneyRow label="Job price" value={usd2(price)} />
          {commission != null && (
            <>
              <MoneyRow label={`Con Z fee${pct != null ? ` (${pct}%)` : ""}`} value={`−${usd2(commission)}`} />
              <div className="h-px bg-cz-border" />
              <div className="flex items-center justify-between">
                <span className="font-bold text-[17px]">You earned</span>
                <span className="cz-display font-bold text-[32px] text-cz-green-text tabular-nums">{usd2(price - commission)}</span>
              </div>
            </>
          )}
          <p className="text-[13px] text-cz-muted">
            {ctx.isEscrow
              ? "Released from Con Z Pay into your wallet. Withdraw to EcoCash or bank anytime."
              : "Paid to you directly by the customer. The Con Z fee comes off your wallet balance."}
          </p>
          <p className="text-[11px] text-cz-faint">All amounts in USD</p>
        </CzCard>

        {driver && lvl && (
          <CzCard className="space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="font-semibold text-cz-amber">{lvl.label}</span>
              <span className="text-cz-muted">
                {next && lvl.nextAt != null
                  ? `${Math.max(0, lvl.nextAt - driver.jobs_completed)} jobs to ${next.label}`
                  : "Top level"}
              </span>
            </div>
            <div className="h-2 rounded-full bg-cz-upcoming" aria-hidden>
              <div className="h-2 rounded-full bg-cz-amber" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-[13px] text-cz-muted">
              {next ? `${next.label} drivers get ${next.discountPct}% off Con Z fees.` : `You get ${lvl.discountPct}% off Con Z fees.`}
            </p>
          </CzCard>
        )}

        <div id="tour-wrap-up">
          {ctx.myRating ? (
            <RatingSummary title={`Your rating for ${cust}`} stars={(ctx.myRating as any).overall} comment={(ctx.myRating as any).comment} />
          ) : (
            <RateCustomerForm jobId={id} customerId={job.customer_id} onSaved={ctx.invalidateRating} />
          )}
        </div>

        <ProofPhotos job={job} />
        {ctx.showNextLoads && <NextLoadsCard driverId={ctx.userId!} currentJobId={id} />}

        <div className="space-y-2.5 pt-1">
          <Link to="/driver" className={czButtonClass("primary")}>Find next load</Link>
          {job.tracking_token && (
            <a href={`${SITE_URL}/track/${job.tracking_token}`} target="_blank" rel="noreferrer" className={czButtonClass("ghost", "md")}>
              <Receipt className="w-4 h-4" /> View receipt
            </a>
          )}
          <Link id="tour-chat-link" to="/chat/$jobId" params={{ jobId: id }} className={czButtonClass("ghost", "md")}>
            <MessageSquare className="w-4 h-4" /> Open chat
          </Link>
          {ctx.showDispute && (
            <div id="tour-dispute">
              <RaiseDisputeDialog jobId={id} against={job.customer_id} label="Report an issue" />
            </div>
          )}
        </div>
      </div>
      <DriverBottomNav />
    </CzScreen>
  );
}

/* ----------------------------- CUSTOMER ----------------------------- */

function CustomerJobScreen({ ctx }: { ctx: JobScreenCtx }) {
  const { job } = ctx;
  // "View tracking" from the pay screen — Con Z Pay stays optional to look
  // at, exactly like the old page which showed tracking and the pay button
  // together.
  const [skipPay, setSkipPay] = useState(false);
  if (job.status === "cancelled") return <CancelledScreen ctx={ctx} backTo="/jobs" />;
  if (job.status === "open") return <CustomerOffers ctx={ctx} />;
  if (job.status === "completed") return <CustomerDelivered ctx={ctx} />;
  if (ctx.isEscrow && !ctx.escrowPaid && !skipPay) return <CustomerPay ctx={ctx} onViewTracking={() => setSkipPay(true)} />;
  return <CustomerTrack ctx={ctx} onPay={skipPay ? () => setSkipPay(false) : undefined} />;
}

/** C3 · Driver offers. */
function CustomerOffers({ ctx }: { ctx: JobScreenCtx }) {
  const { job, bids, id } = ctx;
  // Re-evaluate which offers are still live as their 30-minute windows
  // (migration 0062) run out.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  const isLive = (b: any) => b.status === "pending" && (!b.expires_at || new Date(b.expires_at).getTime() > now);
  const all = bids ?? [];
  const live = all.filter(isLive);
  const list = [...live, ...all.filter((b: any) => !isLive(b))]; // expired / decided at the bottom
  const bestId = live[0]?.id; // bids query is ordered by price, lowest first
  const hasPoint = job.delivery_lat != null && job.delivery_lng != null;
  // Approximate positions of Online drivers who bid (migration 0062).
  const locations = useBidderLocations(id, all.length > 0);
  const trucks = live
    .filter((b: any) => locations[b.id])
    .map((b: any) => ({ lat: locations[b.id].lat, lng: locations[b.id].lng, label: usd(Number(b.price)) }));

  return (
    <CzScreen>
      <div className="relative h-[300px]">
        {hasPoint ? (
          <PinMap point={{ lat: Number(job.delivery_lat), lng: Number(job.delivery_lng) }} trucks={trucks} className="w-full h-full" />
        ) : (
          <div className="w-full h-full bg-cz-surface" />
        )}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-center justify-between gap-2">
          <MapBackButton to="/customer" />
          <StatusPill tone={live.length ? "neutral" : "amber"} dot blink className="pointer-events-auto bg-cz-bg">
            {live.length ? `${live.length} offer${live.length === 1 ? "" : "s"} in` : "Finding drivers"}
          </StatusPill>
        </div>
      </div>

      <BottomSheet className="flex-1 space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="cz-display font-bold text-[26px] leading-tight">
            {live.length ? `${live.length} driver${live.length === 1 ? "" : "s"} offered` : "Waiting for offers"}
          </h1>
          <span className="text-sm text-cz-muted shrink-0">
            You offered <strong className="text-cz-text">{usd(Number(job.budget))}</strong>
          </span>
        </div>

        {ctx.showRadar && <RadarSearch etaMinutes={5} nearbyDrivers={ctx.nearbyDrivers} />}

        <div id="tour-bids-received" className="space-y-3">
          {list.length === 0 ? (
            <p className="text-sm text-cz-muted">No offers yet. Drivers near you are checking your request — this updates live.</p>
          ) : (
            list.map((b: any) => {
              const canChoose = isLive(b);
              return (
                <OfferCard
                  key={b.id}
                  bid={b}
                  kmToPickup={locations[b.id]?.km_to_pickup ?? null}
                  best={b.id === bestId && live.length > 1}
                  primary={b.id === bestId}
                  chooseId={b.id === bestId ? "tour-accept-bid" : undefined}
                  onChoose={canChoose ? () => ctx.acceptBid(b.id) : undefined}
                >
                  {canChoose && b.counter_status !== "countered" && (
                    <div className="mt-1">
                      <CounterOfferRow bidPrice={Number(b.price)} onSubmit={(price) => ctx.counterBid(b.id, price)} />
                    </div>
                  )}
                </OfferCard>
              );
            })
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold text-cz-muted">Your request</div>
          <CzCard id="tour-job-header" className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <MaterialBadge>
                {materialLabel(job.material as any, job.custom_material)} · {Number(job.quantity_m3)} m³
              </MaterialBadge>
              <span className="text-[13px] text-cz-muted">{ctx.isEscrow ? "Con Z Pay" : "Pay driver directly"}</span>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <MapPin className="w-4 h-4 text-cz-muted mt-0.5 shrink-0" />
              <span>{job.delivery_address}</span>
            </div>
            {job.preferred_date && (
              <div className="flex items-center gap-2 text-sm text-cz-muted">
                <Calendar className="w-4 h-4" /> {job.preferred_date}
              </div>
            )}
            {job.notes && <p className="border-t border-cz-border pt-2 text-sm text-cz-muted">{job.notes}</p>}
          </CzCard>
        </div>

        <RaisePriceCard job={job} onRaised={ctx.invalidateJob} />

        {ctx.showCancel && (
          <div id="tour-next-steps">
            <CancelJobDialog jobId={id} status={job.status} onCancelled={ctx.onCancelled} />
          </div>
        )}
      </BottomSheet>
    </CzScreen>
  );
}

/**
 * "Raise my price" (migration 0062) — inDrive-style: the customer can only
 * go up, in quick steps, capped at the trip's allowed maximum. Drivers'
 * feeds pick the new price up through their existing realtime / polling.
 */
function RaisePriceCard({ job, onRaised }: { job: any; onRaised: () => void }) {
  const current = Number(job.budget);
  const cap = Number((job.pricing_breakdown as { high?: number } | null)?.high) || null;
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<number>(current);
  const [saving, setSaving] = useState(false);
  useEffect(() => setTarget(current), [current]);
  if (cap != null && current >= cap) return null;

  const steps = [5, 10, 20].map((d) => current + d).filter((v) => cap == null || v <= cap);
  const save = async () => {
    if (!(target > current)) return;
    setSaving(true);
    const { error } = await raiseJobBudget(job.id, target);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Offer raised to ${usd(target)} — drivers can see it now`);
    setOpen(false);
    onRaised();
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={czButtonClass("secondary", "md")}>
        <TrendingUp className="w-4 h-4" /> Raise my price
      </button>
    );
  }
  return (
    <CzCard className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-semibold">Raise your offer</div>
        <div className="text-[13px] text-cz-muted">Now {usd(current)}{cap != null ? ` · max ${usd(cap)}` : ""}</div>
      </div>
      <p className="text-[13px] text-cz-muted">A higher offer gets more drivers interested, faster. You can't lower it again.</p>
      <div className="grid grid-cols-3 gap-2">
        {steps.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setTarget(v)}
            aria-pressed={target === v}
            className={cn(
              "min-h-12 rounded-xl text-[15px] font-semibold tabular-nums",
              target === v ? "bg-cz-amber text-cz-amber-ink font-bold" : "border border-cz-border-strong bg-cz-surface",
            )}
          >
            +{usd(v - current)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <CzButton size="md" kind="ghost" onClick={() => setOpen(false)} disabled={saving}>
          Not now
        </CzButton>
        <CzButton size="md" onClick={save} disabled={saving || !(target > current)}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : target > current ? `Offer ${usd(target)}` : "Pick an amount"}
        </CzButton>
      </div>
    </CzCard>
  );
}

function useAcceptedDriver(ctx: JobScreenCtx) {
  const { name, other } = useJobContact(ctx.job, ctx.isOwner);
  const bid = (ctx.bids ?? []).find((b: any) => b.status === "accepted");
  const fullName = other?.full_name ?? bid?.profile?.full_name ?? name;
  return {
    bid,
    fullName,
    first: firstName(fullName, "your driver"),
    verified: bid?.driver?.verification_status === "verified",
  };
}

/** C4 · Confirm & pay (Con Z Pay jobs only, after a driver is chosen). */
function CustomerPay({ ctx, onViewTracking }: { ctx: JobScreenCtx; onViewTracking: () => void }) {
  const { job, id } = ctx;
  const d = useAcceptedDriver(ctx);
  const total = Number(job.final_price ?? job.budget);
  return (
    <CzScreen>
      <CzHeader title="Confirm & pay" backTo="/jobs" />
      <div className="flex-1 px-5 space-y-4 pb-4">
        <CzCard className="flex items-center gap-3">
          <InitialsAvatar name={d.fullName} src={d.bid?.profile?.avatar_url} size={48} />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate flex items-center gap-1.5">
              {d.fullName}
              {d.verified && (
                <span className="inline-flex items-center gap-0.5 text-[13px] text-cz-green-text">
                  <ShieldCheck className="w-3.5 h-3.5" /> Verified
                </span>
              )}
            </div>
            <div className="text-[13px] text-cz-muted truncate">
              {d.bid?.truck_reg ? `Truck ${d.bid.truck_reg}` : "Your driver"}
              {d.bid?.delivery_date ? ` · can deliver ${d.bid.delivery_date}` : ""}
            </div>
          </div>
        </CzCard>

        <CzCard className="space-y-3">
          <MoneyRow
            label={`${materialLabel(job.material as any, job.custom_material)} · ${Number(job.quantity_m3)} m³`}
            value={areaOf(job.delivery_address) || "—"}
            valueClassName="text-cz-muted"
          />
          <div className="h-px bg-cz-border" />
          <div className="flex items-center justify-between">
            <span className="font-bold text-[17px]">Total</span>
            <span className="cz-display font-bold text-[36px] tabular-nums">{usd2(total)}</span>
          </div>
        </CzCard>

        <HintBox tone="green" icon={<ShieldCheck className="w-4 h-4" />}>
          Con Z Pay holds your money — {d.first} is paid only when you give them your delivery PIN. If you don't confirm
          and don't raise a problem, it's released automatically 72 hours after the driver marks it delivered. Something wrong? Report it and
          our team reviews it before any money moves.
        </HintBox>

        <div className="space-y-2">
          <div className="text-sm font-semibold text-cz-muted">Pay with</div>
          <div className="flex items-center gap-3 rounded-[14px] border-[1.5px] border-cz-amber bg-cz-amber-tint px-4 py-3.5">
            <span aria-hidden className="w-5 h-5 rounded-full border-[6px] border-cz-amber bg-cz-bg shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold">Paynow</div>
              <div className="text-[13px] text-cz-muted">Choose EcoCash, card or another method on Paynow's secure page.</div>
            </div>
          </div>
        </div>

        <ContactCard ctx={ctx} role="driver" subtitle={`${materialLabel(job.material as any, job.custom_material)} · ${Number(job.quantity_m3)} m³`} />
      </div>

      <footer className="sticky bottom-0 z-20 space-y-2.5 border-t border-cz-border bg-cz-surface px-5 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
        <div id="tour-next-steps">
          <CzButton onClick={ctx.payEscrow} disabled={ctx.payingEscrow}>
            {ctx.payingEscrow ? <Loader2 className="w-5 h-5 animate-spin" /> : `Pay ${usd2(total)} with Paynow`}
          </CzButton>
        </div>
        <p className="text-center text-xs text-cz-faint">Secured by Paynow · All amounts in USD</p>
        <div className="grid grid-cols-2 gap-2.5">
          <CzButton kind="ghost" size="sm" onClick={onViewTracking}>View tracking</CzButton>
          {ctx.showCancel ? (
            <CancelJobDialog jobId={id} status={job.status} onCancelled={ctx.onCancelled} />
          ) : (
            <span />
          )}
        </div>
      </footer>
    </CzScreen>
  );
}

/** C5 · Track delivery. */
function CustomerTrack({ ctx, onPay }: { ctx: JobScreenCtx; onPay?: () => void }) {
  const { job, id } = ctx;
  const d = useAcceptedDriver(ctx);
  const [track, setTrack] = useState<TrackStatus | null>(null);
  const mat = materialLabel(job.material as any, job.custom_material);
  // Same four steps as the driver's screen, from the same job fields.
  const step = !job.pickup_photo_url ? (job.driver_arrived_pickup_at ? 1 : 0) : !job.delivery_photo_url ? 2 : 3;
  const atDropoff = step === 2 && !!job.driver_arrived_dropoff_at;
  const eta = track?.route?.etaMin;
  const title = [
    `${d.first} is heading to pickup`,
    `Your ${mat.toLowerCase()} is being loaded`,
    atDropoff ? `${d.first} is at your site` : "On the way to you",
    `${d.first} has arrived`,
  ][step];
  const sub = [
    `They'll load your ${mat.toLowerCase()} at ${job.pickup_address || "the supplier"} and send a photo of the loaded truck before leaving.`,
    `${d.first} is at ${job.pickup_address || "the supplier"}. You'll get a photo of the loaded truck before they leave.`,
    atDropoff
      ? "They're tipping the load now and will send a delivery photo."
      : eta != null ? `Arriving in about ${Math.max(1, Math.round(eta))} min.` : track?.live ? "Your driver is sharing their live location." : "Your load is on the way.",
    ctx.isEscrow ? "Check the load, then give your PIN." : "Check the load, then confirm you've received it.",
  ][step];

  return (
    <CzScreen>
      <div id="tour-tracking" className="relative">
        <CustomerTrackMap jobId={id} variant="hero" height={270} onStatus={setTrack} />
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MapBackButton to="/jobs" />
            {track?.live && (
              <StatusPill tone="green" dot blink className="pointer-events-auto">Live</StatusPill>
            )}
          </div>
          <ShareTrackingButton
            ctx={ctx}
            className="pointer-events-auto min-h-11 inline-flex items-center gap-1.5 rounded-[14px] bg-cz-bg px-3.5 text-sm font-semibold shadow-[0_4px_14px_rgba(0,0,0,0.4)]"
          />
        </div>
      </div>

      <BottomSheet className="flex-1 space-y-4">
        <SpotlightCallout
          id="live-tracking"
          title="Watch your driver in real time"
          body="Once your driver starts sharing their location, you'll see them move on this map right up to your delivery point."
        />
        <div id="tour-next-steps" className="space-y-4">
          <StepProgress current={step} />
          <div className="space-y-1.5">
            <h1 className="cz-display font-bold text-[28px] leading-tight">{title}</h1>
            <p className="text-[15px] text-cz-muted leading-snug">{sub}</p>
          </div>

          {onPay && (
            <HintBox tone="warn" icon={<ShieldCheck className="w-4 h-4" />}>
              <div className="space-y-2">
                <div>This job is set up to pay through Con Z Pay. Pay now — we'll hold the money until delivery is confirmed.</div>
                <button type="button" onClick={onPay} className="font-bold underline underline-offset-2">
                  Pay {usd2(Number(job.final_price ?? job.budget))} now
                </button>
              </div>
            </HintBox>
          )}

          {step >= 2 && job.pickup_photo_url && (
            <div className="flex items-center gap-3">
              <div className="w-16 shrink-0">
                <SignedProofPhoto path={job.pickup_photo_url} alt="Loaded truck at pickup" />
              </div>
              <div className="text-[13px] text-cz-muted">
                <span className="font-semibold text-cz-green-text">Loaded</span> — photo taken at pickup
              </div>
            </div>
          )}

          {ctx.showDeliveryPinDisplay && (
            <div className="rounded-2xl bg-cz-amber p-4 text-cz-amber-ink">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-bold">Your delivery PIN</div>
                  <div className="text-[13px] opacity-80">Only share after the load is tipped</div>
                </div>
                <div className="cz-display font-bold text-[40px] leading-none tracking-[0.12em] tabular-nums">{ctx.deliveryPin ?? "······"}</div>
              </div>
            </div>
          )}

          {ctx.showCompleteButton && (
            <CzButton id="tour-confirm-delivery" kind={job.delivery_photo_url ? "primary" : "ghost"} onClick={ctx.completeJob} disabled={!job.delivery_photo_url}>
              <CheckCircle2 className="w-5 h-5" />
              {job.delivery_photo_url ? "Load received — finish" : "Waiting for driver's delivery photo"}
            </CzButton>
          )}
        </div>

        <ContactCard ctx={ctx} role="driver" subtitle={d.bid?.truck_reg ? `Truck ${d.bid.truck_reg} · ${mat}` : mat} />
        <ProofPhotos job={job} />

        <div className="space-y-2.5">
          {ctx.showDispute && (
            <div id="tour-dispute">
              <RaiseDisputeDialog jobId={id} against={job.driver_id} label="Report a problem" />
            </div>
          )}
          {ctx.showCancel && <CancelJobDialog jobId={id} status={job.status} onCancelled={ctx.onCancelled} />}
        </div>
      </BottomSheet>
    </CzScreen>
  );
}

/** C6 · Delivered. */
function CustomerDelivered({ ctx }: { ctx: JobScreenCtx }) {
  const { job, id } = ctx;
  const d = useAcceptedDriver(ctx);
  const mat = materialLabel(job.material as any, job.custom_material);
  const total = Number(job.final_price ?? job.budget);
  return (
    <CzScreen>
      <div className="flex flex-col items-center gap-3 px-5 pt-12 pb-6 text-center">
        <span className="w-[88px] h-[88px] rounded-full bg-cz-green text-[#0b2416] flex items-center justify-center">
          <CheckCircle2 className="w-12 h-12" strokeWidth={2.2} />
        </span>
        <h1 className="cz-display font-bold text-[30px] leading-tight">Your {mat.toLowerCase()} is delivered</h1>
        <span className="text-[15px] text-cz-muted">
          {ctx.isEscrow ? `Payment released to ${d.fullName}` : `Delivered by ${d.fullName}`}
        </span>
      </div>

      <div className="px-5 space-y-3.5 pb-6">
        <CzCard className="space-y-3 p-[18px]">
          <MoneyRow label="Receipt" value={jobRef(id)} valueClassName="font-semibold" />
          <MoneyRow label={`${mat} · ${Number(job.quantity_m3)} m³`} value={areaOf(job.delivery_address) || "—"} />
          <MoneyRow label="Paid with" value={ctx.isEscrow ? "Con Z Pay" : "Directly to driver"} />
          <div className="h-px bg-cz-border" />
          <div className="flex items-center justify-between">
            <span className="font-bold text-[17px]">Total</span>
            <span className="cz-display font-bold text-[32px] tabular-nums">{usd2(total)}</span>
          </div>
          <p className="text-[11px] text-cz-faint">All amounts in USD</p>
        </CzCard>

        <div id="tour-wrap-up">
          {ctx.myRating ? (
            <RatingSummary
              title={`Your rating for ${d.first}`}
              stars={((ctx.myRating as any).quality + (ctx.myRating as any).communication + (ctx.myRating as any).reliability + (ctx.myRating as any).delivery_time) / 4}
              comment={(ctx.myRating as any).comment}
            />
          ) : (
            <RateForm jobId={id} driverId={job.driver_id!} onSaved={ctx.invalidateRating} />
          )}
        </div>

        <ProofPhotos job={job} />

        <div className="space-y-2.5 pt-1">
          <Link to="/customer/book" className={czButtonClass("primary")}>Book another load</Link>
          {ctx.showBookAgain && (
            <Link
              to="/customer/book"
              search={{
                material: job.material,
                quantity: job.quantity_m3,
                address: job.delivery_address,
                lat: job.delivery_lat ?? undefined,
                lng: job.delivery_lng ?? undefined,
                driverId: job.driver_id!,
              }}
              className={czButtonClass("secondary", "md")}
            >
              Book {d.first} again
            </Link>
          )}
          {ctx.showReceipt && (
            <>
              <SpotlightCallout
                id="receipt-button"
                title="Your receipt is one tap away"
                body="Every completed delivery gets a receipt with price, photos, and a downloadable PDF for your records — find it here anytime."
              />
              <a
                id="tour-receipt-link"
                href={`${SITE_URL}/track/${job.tracking_token}`}
                target="_blank"
                rel="noreferrer"
                className={czButtonClass("ghost", "md")}
              >
                <FileText className="w-4 h-4" /> Receipt & PDF download
              </a>
            </>
          )}
          <Link to="/chat/$jobId" params={{ jobId: id }} id="tour-chat-link" className={czButtonClass("ghost", "md")}>
            <MessageSquare className="w-4 h-4" /> Open chat
          </Link>
          {ctx.showDispute && (
            <div id="tour-dispute">
              <RaiseDisputeDialog jobId={id} against={job.driver_id} label="Report a problem" />
            </div>
          )}
        </div>
      </div>
    </CzScreen>
  );
}
