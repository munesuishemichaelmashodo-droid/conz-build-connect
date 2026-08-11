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
import { ArrowLeft, Loader2, MapPin, Calendar, Star, CheckCircle2, MessageSquare, MessageCircle, Share2, Trash2, Camera, Image as ImageIcon, PackageCheck, Flag, FileText, Truck, PackageOpen, Circle, Wallet } from "lucide-react";
import { materialLabel, money, statusInfo, levelInfo } from "@/lib/domain";
import { SITE_URL } from "@/lib/site";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { DriverShareLocation, CustomerTrackMap, DriverRouteView } from "@/components/JobTracker";
import { RadarSearch } from "@/components/RadarSearch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { uploadJobEvidence, signedEvidenceUrl } from "@/lib/upload-evidence";
import { useServerFn } from "@tanstack/react-start";
import { initiateEscrowPayment, reconcilePendingPaynowPayments } from "@/lib/paynow.functions";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/jobs/$id")({
  component: JobDetail,
});

// Build a wa.me deep link with a pre-filled message.
// Normalizes ZW numbers: 0772123456 -> 263772123456.
const waLink = (phone: string | null | undefined, text: string) => {
  if (!phone) return null;
  let p = phone.replace(/[^\d+]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0")) p = "263" + p.slice(1);
  if (p.length < 9) return null;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
};

// WhatsApp panel: direct contact with the other party + shareable delivery summary.
// "Share" needs no phone number — it forwards a formatted summary to any
// WhatsApp contact or group (e.g. the foreman waiting on site).
function WhatsAppPanel({ job, isOwner }: { job: any; isOwner: boolean }) {
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

  const directText = isOwner
    ? `Hi ${name}, about my ConZ delivery ${ref} (${material}).`
    : `Hi ${name}, I'm your ConZ driver for delivery ${ref} (${material}).`;

  const direct = waLink(other?.phone, directText);
  const arrivedPickup = waLink(other?.phone, `${summary} I've arrived at the pickup point and I'm loading now.`);
  const outsideNow = waLink(other?.phone, `${summary} I'm outside with your delivery — please send someone to receive it.`);

  // Public live-tracking link (Batch 6): included in the WhatsApp share message
  // so the recipient can watch the truck without a Con Z account.
  const trackUrl = job.tracking_token ? `${SITE_URL}/track/${job.tracking_token}` : null;
  const shareText = trackUrl ? `${summary} Track live: ${trackUrl}` : summary;
  const share = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  const copyTrackLink = async () => {
    if (!trackUrl) return;
    try {
      await navigator.clipboard.writeText(trackUrl);
      toast.success("Tracking link copied");
    } catch {
      toast.error(`Couldn't copy — the link is: ${trackUrl}`);
    }
  };

  return (
    <div className="rounded-2xl bg-card border p-4 space-y-3">
      <div className="font-display font-bold uppercase text-sm tracking-wide flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-success" /> WhatsApp
      </div>

      {direct ? (
        <div className="space-y-2">
          <Button asChild variant="outline" className="w-full">
            <a href={direct} target="_blank" rel="noreferrer">
              <MessageCircle className="w-4 h-4 mr-2" />
              Message {name} on WhatsApp
            </a>
          </Button>
          {!isOwner && job.status === "accepted" && arrivedPickup && (
            <Button asChild className="w-full bg-success text-success-foreground hover:bg-success/90">
              <a href={arrivedPickup} target="_blank" rel="noreferrer">
                I've arrived at pickup
              </a>
            </Button>
          )}
          {!isOwner && job.status === "in_progress" && outsideNow && (
            <Button asChild className="w-full bg-success text-success-foreground hover:bg-success/90">
              <a href={outsideNow} target="_blank" rel="noreferrer">
                I'm outside with the delivery
              </a>
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No WhatsApp number on their profile yet — use in-app chat below.
        </p>
      )}

      <Button asChild variant="secondary" className="w-full">
        <a href={share} target="_blank" rel="noreferrer">
          <Share2 className="w-4 h-4 mr-2" />
          Share this delivery on WhatsApp
        </a>
      </Button>
      {trackUrl && (
        <button
          type="button"
          onClick={copyTrackLink}
          className="w-full text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Copy live tracking link
        </button>
      )}
      <p className="text-[11px] text-muted-foreground">
        Share forwards a delivery summary and live tracking link to any WhatsApp contact or group — no Con Z account needed to watch the truck.
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
      const [{ data: profs }, { data: drvs }] = await Promise.all([
        supabase.from("profiles").select("id,full_name,avatar_url").in("id", driverIds),
        supabase
          .from("driver_public_profiles")
          .select("user_id,rating_avg,rating_count,level,jobs_completed")
          .in("user_id", driverIds),
      ]);
      return bids.map((b) => ({
        ...b,
        profile: profs?.find((p) => p.id === b.driver_id),
        driver: drvs?.find((d) => d.user_id === b.driver_id),
      }));
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

  const runEscrowPayment = useServerFn(initiateEscrowPayment);
  const runReconcile = useServerFn(reconcilePendingPaynowPayments);
  const [payingEscrow, setPayingEscrow] = useState(false);

  const isEscrow = job.payment_method === "escrow";
  const { data: escrowPayment } = useQuery({
    queryKey: ["escrow-payment", id],
    enabled: isEscrow,
    queryFn: async () => {
      const { data } = await supabase
        .from("payments")
        .select("id,status,amount")
        .eq("job_id", id)
        .eq("type", "escrow")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { id: string; status: string; amount: number } | null;
    },
  });
  const escrowPaid = escrowPayment?.status === "paid" || escrowPayment?.status === "released";

  // Returning from Paynow lands back on this page — reconcile any pending
  // escrow payment via the poll URL rather than only relying on the webhook.
  useEffect(() => {
    if (!isEscrow || !userId) return;
    runReconcile()
      .then((res) => {
        if (res.credited > 0) {
          qc.invalidateQueries({ queryKey: ["escrow-payment", id] });
          toast.success("Payment confirmed — held safely until delivery is confirmed.");
        }
      })
      .catch(() => {});
  }, [isEscrow, userId]);

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

  return (
    <AppShell title="Job">
      <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>

      <div className="space-y-4">
        <JobTimeline job={job} />

        {isEscrow && ["accepted", "in_progress"].includes(job.status) && (
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

        {isOwner && job.status === "open" && (bids?.length ?? 0) === 0 && <RadarSearch etaMinutes={5} nearbyDrivers={nearbyDrivers} />}

        <div className="rounded-2xl bg-card border p-5 shadow-soft">
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

        {(isOwner || isAssignedDriver) && job.status !== "open" && (
          <Button asChild variant="outline" className="w-full">
            <Link to="/chat/$jobId" params={{ jobId: id }}>
              <MessageSquare className="w-4 h-4 mr-2" />
              Open chat
            </Link>
          </Button>
        )}

        {(isOwner || isAssignedDriver) && ["accepted", "in_progress", "completed"].includes(job.status) && (
          <RaiseDisputeDialog
            jobId={id}
            against={isOwner ? job.driver_id : job.customer_id}
          />
        )}

        {(job.pickup_photo_url || job.delivery_photo_url) && (
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

        {isAssignedDriver && job.status === "accepted" && !job.pickup_photo_url && (
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

        {isAssignedDriver && (job.status === "accepted" || job.status === "in_progress") && job.pickup_photo_url && !job.delivery_photo_url && (
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

        {isOwner && (job.status === "accepted" || job.status === "in_progress") && (
          <Button
            onClick={completeJob}
            disabled={!job.delivery_photo_url || (isEscrow && !escrowPaid)}
            className="w-full bg-success text-success-foreground hover:bg-success/90"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {isEscrow && !escrowPaid
              ? "Pay through Con Z Pay above first"
              : job.delivery_photo_url
                ? "Confirm delivery"
                : "Waiting for driver's delivery photo"}
          </Button>
        )}

        {isAssignedDriver && (job.status === "accepted" || job.status === "in_progress") && (
          <>
            <DriverRouteView jobId={id} />
            <DriverShareLocation jobId={id} driverId={userId!} />
          </>
        )}

        {isOwner && (job.status === "accepted" || job.status === "in_progress") && <CustomerTrackMap jobId={id} />}

        {is("driver") && !isOwner && job.status === "open" && (
          <BidForm jobId={id} existing={myBid} onSaved={() => qc.invalidateQueries({ queryKey: ["bids", id] })} />
        )}

        {is("driver") && !isOwner && job.status === "open" && myBid?.counter_status === "countered" && (
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

        {isOwner && (job.status === "open" || job.status === "accepted" || job.status === "in_progress") && (
          <CancelJobDialog jobId={id} status={job.status} onCancelled={() => nav({ to: "/jobs" })} />
        )}

        {(isOwner || is("admin") || is("super_admin")) && (
          <Section title={`Bids (${bids?.length ?? 0})`}>
            {!bids?.length ? (
              <p className="text-sm text-muted-foreground">No bids yet. Drivers are checking your request.</p>
            ) : (
              <div className="space-y-2">
                {bids.map((b: any) => (
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
                        <Button size="sm" onClick={() => acceptBid(b.id)} className="w-full">
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
              </div>
            )}
          </Section>
        )}

        {isOwner && job.status === "completed" && (
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

        {isAssignedDriver && job.status === "completed" && (
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

        {isOwner && job.status === "completed" && job.driver_id && (
          <Link
            to="/customer/book"
            search={{
              material: job.material,
              quantity: job.quantity_m3,
              address: job.delivery_address,
              lat: job.delivery_lat ?? undefined,
              lng: job.delivery_lng ?? undefined,
              driverId: job.driver_id,
            }}
            className="block w-full text-center rounded-xl bg-primary text-primary-foreground font-display font-bold uppercase tracking-wide py-3"
          >
            Book this driver again
          </Link>
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
      <button type="button" onClick={() => setOpen(true)} className="w-full text-center text-xs font-semibold text-primary underline underline-offset-2">
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

function BidForm({ jobId, existing, onSaved }: { jobId: string; existing?: any; onSaved: () => void }) {
  const { userId } = useAuth();
  const [price, setPrice] = useState(existing?.price?.toString() ?? "");
  const [date, setDate] = useState(existing?.delivery_date ?? "");
  const [message, setMessage] = useState(existing?.message ?? "");
  const [loading, setLoading] = useState(false);

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
    setLoading(true);
    const { error } = await supabase.from("bids").upsert(
      {
        job_id: jobId,
        driver_id: userId!,
        price: p,
        delivery_date: date || null,
        message: message.trim() || null,
      },
      { onConflict: "job_id,driver_id" },
    );
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success(existing ? "Bid updated" : "Bid submitted");
    onSaved();
  };

  return (
    <div className="space-y-3">
      {showFundsWarning && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 space-y-2">
          <div className="flex items-start gap-2">
            <Wallet className="w-4 h-4 mt-0.5 text-warning shrink-0" />
            <div className="text-sm">
              <div className="font-display font-bold uppercase text-xs tracking-wide text-warning">
                Top up to take this job
              </div>
              <p className="mt-1 text-muted-foreground">
                You need {money(shortfall)} more in your wallet to take jobs like this — commission is reserved when a
                bid is accepted.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Commission required {money(Number(funds?.required ?? 0))} · Available{" "}
                {money(Number(funds?.available ?? 0))}
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline" className="w-full">
            <Link to="/wallet">Top up wallet</Link>
          </Button>
        </div>
      )}
      <form onSubmit={submit} className="rounded-2xl bg-card border p-4 space-y-3">
      <div className="font-display font-bold uppercase text-sm tracking-wide">
        {existing ? "Update your bid" : "Submit a bid"}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="bp">Price ($)</Label>
          <Input
            id="bp"
            type="number"
            inputMode="decimal"
            min={1}
            step={1}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="bd">Delivery date</Label>
          <Input id="bd" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
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
      <Button type="submit" disabled={loading || showFundsWarning} className="w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : existing ? "Update bid" : "Submit bid"}
      </Button>
      </form>
    </div>
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
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button type="button" key={n} onClick={() => onChange(n)}>
            <Star className={`w-5 h-5 ${n <= value ? "fill-warning text-warning" : "text-muted-foreground"}`} />
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
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button type="button" key={n} onClick={() => onChange(n)}>
            <Star className={`w-5 h-5 ${n <= value ? "fill-warning text-warning" : "text-muted-foreground"}`} />
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

function ProofUpload({ jobId, kind, label, hint, onUploaded }: { jobId: string; kind: "pickup" | "delivery"; label: string; hint?: string; onUploaded: () => void | Promise<void> }) {
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      // Uploads to the private bucket, captures GPS, and records a row in
      // job_evidence (used by the dispute investigation view). We then store
      // the storage PATH (not a broken public URL — the bucket is private)
      // on the job row so the rest of this page can gate on it as before.
      const result = await uploadJobEvidence(jobId, kind, file);
      const patch = kind === "pickup" ? { pickup_photo_url: result.path } : { delivery_photo_url: result.path };
      const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
      if (error) throw new Error(error.message);
      toast.success(`${label} photo uploaded`);
      await onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="rounded-2xl border p-4 space-y-3 bg-card">
      <div className="flex items-center gap-2">
        <PackageCheck className="w-5 h-5 text-primary" />
        <div className="font-display font-bold uppercase text-sm tracking-wide">{label}</div>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 hover:bg-muted transition p-3 cursor-pointer">
          <Camera className="w-5 h-5 text-primary shrink-0" />
          <span className="text-xs font-semibold">{uploading ? "Uploading…" : "Take photo"}</span>
          <input type="file" accept="image/*" capture="environment" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="hidden" />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 hover:bg-muted transition p-3 cursor-pointer">
          <ImageIcon className="w-5 h-5 text-primary shrink-0" />
          <span className="text-xs font-semibold">{uploading ? "Uploading…" : "Choose from gallery"}</span>
          <input type="file" accept="image/*" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="hidden" />
        </label>
      </div>
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
        <Button variant="outline" className="w-full text-destructive hover:text-destructive">
          <Trash2 className="w-4 h-4 mr-2" />
          Cancel job
        </Button>
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

function RaiseDisputeDialog({ jobId, against }: { jobId: string; against: string | null }) {
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
        <Button variant="outline" className="w-full">
          <Flag className="w-4 h-4 mr-2" /> Raise a dispute
        </Button>
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

