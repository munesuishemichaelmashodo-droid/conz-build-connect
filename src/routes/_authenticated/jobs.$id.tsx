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
import { ArrowLeft, Loader2, MapPin, Calendar, Star, CheckCircle2, MessageSquare, Trash2, Camera, Image as ImageIcon, PackageCheck } from "lucide-react";
import { materialLabel, money, statusInfo, levelInfo } from "@/lib/domain";
import { useState } from "react";
import { toast } from "sonner";
import { DriverShareLocation, CustomerTrackMap } from "@/components/JobTracker";
import { RadarSearch } from "@/components/RadarSearch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";


export const Route = createFileRoute("/_authenticated/jobs/$id")({
  component: JobDetail,
});

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

  const acceptBid = async (bidId: string) => {
    const { error } = await supabase.rpc("accept_bid", { _bid_id: bidId });
    if (error) return toast.error(error.message);
    toast.success("Bid accepted!");
    qc.invalidateQueries({ queryKey: ["job", id] });
    qc.invalidateQueries({ queryKey: ["bids", id] });
  };

  const completeJob = async () => {
    const { error } = await supabase.rpc("complete_job", { _job_id: id });
    if (error) return toast.error(error.message);
    toast.success("Delivery confirmed.");
    qc.invalidateQueries({ queryKey: ["job", id] });
  };




  return (
    <AppShell title="Job">
      <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>

      <div className="space-y-4">
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

        {(job.pickup_photo_url || job.delivery_photo_url) && (
          <div className="rounded-2xl bg-card border p-4 space-y-3">
            <div className="font-display font-bold uppercase text-sm tracking-wide">Proof of delivery</div>
            <div className="grid grid-cols-2 gap-3">
              {job.pickup_photo_url && (
                <figure className="space-y-1">
                  <img src={job.pickup_photo_url} alt="Load confirmed" className="w-full aspect-square object-cover rounded-lg border" />
                  <figcaption className="text-xs font-semibold text-success flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Load confirmed
                  </figcaption>
                </figure>
              )}
              {job.delivery_photo_url && (
                <figure className="space-y-1">
                  <img src={job.delivery_photo_url} alt="Delivery confirmed" className="w-full aspect-square object-cover rounded-lg border" />
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
              await supabase.from("jobs").update({ status: "in_progress" }).eq("id", id);
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
            disabled={!job.delivery_photo_url}
            className="w-full bg-success text-success-foreground hover:bg-success/90"
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            {job.delivery_photo_url ? "Confirm delivery" : "Waiting for driver's delivery photo"}
          </Button>
        )}

        {isAssignedDriver && (job.status === "accepted" || job.status === "in_progress") && (
          <DriverShareLocation jobId={id} driverId={userId!} />
        )}

        {isOwner && (job.status === "accepted" || job.status === "in_progress") && <CustomerTrackMap jobId={id} />}


        {is("driver") && !isOwner && job.status === "open" && (
          <BidForm jobId={id} existing={myBid} onSaved={() => qc.invalidateQueries({ queryKey: ["bids", id] })} />
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
                    {isOwner && job.status === "open" && (
                      <Button size="sm" onClick={() => acceptBid(b.id)} className="w-full mt-3">
                        Accept this bid
                      </Button>
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
          <RateForm jobId={id} driverId={job.driver_id!} onSaved={() => nav({ to: "/jobs" })} />
        )}
        {isAssignedDriver && job.status === "completed" && (
          <RateCustomerForm jobId={id} customerId={job.customer_id} onSaved={() => nav({ to: "/jobs" })} />
        )}
      </div>
    </AppShell>
  );
}

function BidForm({ jobId, existing, onSaved }: { jobId: string; existing?: any; onSaved: () => void }) {
  const { userId } = useAuth();
  const [price, setPrice] = useState(existing?.price?.toString() ?? "");
  const [date, setDate] = useState(existing?.delivery_date ?? "");
  const [message, setMessage] = useState(existing?.message ?? "");
  const [loading, setLoading] = useState(false);

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
    if (error) return toast.error(error.message);
    toast.success(existing ? "Bid updated" : "Bid submitted");
    onSaved();
  };

  return (
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
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : existing ? "Update bid" : "Submit bid"}
      </Button>
    </form>
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
    if (error) return toast.error(error.message);
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
    if (error) return toast.error(error.message);
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

function ProofUpload({ jobId, kind, label, hint, onUploaded }: { jobId: string; kind: "pickup" | "delivery"; label: string; hint?: string; onUploaded: () => void | Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    const path = `${jobId}/${kind}.jpg`;
    const { error: uerr } = await supabase.storage
      .from("job-proof-photos")
      .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
    if (uerr) { setUploading(false); return toast.error(uerr.message); }
    const { data: pub } = supabase.storage.from("job-proof-photos").getPublicUrl(path);
    const url = `${pub.publicUrl}?t=${Date.now()}`;
    const patch = kind === "pickup" ? { pickup_photo_url: url } : { delivery_photo_url: url };
    const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
    setUploading(false);
    if (error) return toast.error(error.message);
    toast.success(`${label} photo uploaded`);
    await onUploaded();
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
    if (error) return toast.error(error.message);
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

