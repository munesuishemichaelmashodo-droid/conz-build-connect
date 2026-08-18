import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Camera, Image as ImageIcon, Check, Loader2, ShieldCheck, Clock } from "lucide-react";
import { COUNTRY_CODES } from "@/lib/country-codes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/become-driver")({
  component: BecomeDriverPage,
});

type DocField =
  | "selfie_url"
  | "national_id_url"
  | "license_url"
  | "tipper_photo_url"
  | "tipper_photo_side_url"
  | "tipper_photo_back_url"
  | "operator_license_url"
  | "certificate_of_fitness_url"
  | "git_insurance_url"
  | "zinara_url";

const STEPS = [
  { key: "identity", title: "Your details" },
  { key: "selfie", title: "Selfie photo" },
  { key: "national_id", title: "National ID" },
  { key: "license", title: "Driver's licence" },
  { key: "truck", title: "Your truck" },
  { key: "compliance", title: "Transport documents" },
  { key: "nationality", title: "Nationality" },
] as const;

function BecomeDriverPage() {
  const { userId, profile, email, refresh } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.full_name ?? "");
  const [emailInput, setEmailInput] = useState(email ?? "");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [nationalId, setNationalId] = useState<string | null>(null);
  const [license, setLicense] = useState<string | null>(null);
  const [truckPhoto, setTruckPhoto] = useState<string | null>(null);
  const [truckPhotoSide, setTruckPhotoSide] = useState<string | null>(null);
  const [truckPhotoBack, setTruckPhotoBack] = useState<string | null>(null);
  const [operatorLicense, setOperatorLicense] = useState<string | null>(null);
  const [certOfFitness, setCertOfFitness] = useState<string | null>(null);
  const [gitInsurance, setGitInsurance] = useState<string | null>(null);
  const [zinara, setZinara] = useState<string | null>(null);
  const [nationality, setNationality] = useState<string>("Zimbabwe");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!userId) return;
    // Ensure a driver_profiles row exists so uploads have a target.
    (async () => {
      await supabase.from("driver_profiles").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
      const { data } = await supabase
        .from("driver_profiles")
        .select("selfie_url,national_id_url,license_url,tipper_photo_url,tipper_photo_side_url,tipper_photo_back_url,operator_license_url,certificate_of_fitness_url,git_insurance_url,zinara_url,nationality,verification_status")
        .eq("user_id", userId)
        .maybeSingle();
      if (data) {
        setSelfie(data.selfie_url ?? null);
        setNationalId((data as any).national_id_url ?? null);
        setLicense(data.license_url ?? null);
        setTruckPhoto(data.tipper_photo_url ?? null);
        setTruckPhotoSide((data as any).tipper_photo_side_url ?? null);
        setTruckPhotoBack((data as any).tipper_photo_back_url ?? null);
        setOperatorLicense((data as any).operator_license_url ?? null);
        setCertOfFitness((data as any).certificate_of_fitness_url ?? null);
        setGitInsurance((data as any).git_insurance_url ?? null);
        setZinara((data as any).zinara_url ?? null);
        if (data.nationality) setNationality(data.nationality);
        if (
          data.verification_status === "pending" &&
          data.selfie_url &&
          (data as any).national_id_url &&
          data.license_url &&
          data.tipper_photo_url &&
          (data as any).tipper_photo_side_url &&
          (data as any).tipper_photo_back_url &&
          data.nationality
        ) {
          setDone(true);
        }
      }
    })();
  }, [userId]);

  const canNext = () => {
    if (step === 0) return name.trim().length > 1 && !!emailInput.trim();
    if (step === 1) return !!selfie;
    if (step === 2) return !!nationalId;
    if (step === 3) return !!license;
    if (step === 4) return !!truckPhoto && !!truckPhotoSide && !!truckPhotoBack;
    if (step === 5) return true; // compliance docs are recommended, not blocking
    if (step === 6) return !!nationality;
    return false;
  };

  const submit = async () => {
    if (!userId) return;
    setSubmitting(true);
    try {
      // Save name to profile.
      if (name.trim() && name.trim() !== profile?.full_name) {
        await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", userId);
      }
      // Note: the driver role is granted server-side when an admin
      // approves verification (see admin_set_driver_verification RPC),
      // not here — RLS only allows super_admins to insert into
      // user_roles, so a self-insert from the applicant's own session
      // would silently fail. Granting it at verification time also
      // means an unverified applicant never shows up with driver-side
      // access before they're actually cleared to accept jobs.
      // Persist nationality, ensure pending status (explicit here since truck-photo
      // uploads below use ComplianceDocRow, which doesn't flip status like PhotoStep
      // does — this matters for a driver resubmitting after a rejection).
      await supabase
        .from("driver_profiles")
        .update({ nationality, verification_status: "pending" })
        .eq("user_id", userId);
      // Ensure wallet exists.
      await supabase.from("wallets").upsert({ user_id: userId, balance: 0 }, { onConflict: "user_id", ignoreDuplicates: true });
      await refresh();
      qc.invalidateQueries();
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <AppShell title="Driver signup">
        <div className="max-w-md mx-auto text-center space-y-5 py-10">
          <div className="w-20 h-20 rounded-full bg-warning/15 border border-warning/40 mx-auto flex items-center justify-center">
            <Clock className="w-10 h-10 text-warning" />
          </div>
          <div>
            <h1 className="font-display font-bold text-2xl">Pending verification</h1>
            <p className="text-sm text-muted-foreground mt-2">
              Thanks! We've received your documents. Our team usually reviews new drivers within <b>24 hours</b>.
              You'll get a notification once you're approved to start bidding.
            </p>
          </div>
          <div className="rounded-xl border bg-muted/30 p-4 text-left text-xs text-muted-foreground flex gap-2">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <span>Your ID, licence, and truck photos are only visible to you and Con Z admins.</span>
          </div>
          <div className="flex flex-col gap-2">
            <Button onClick={() => nav({ to: "/home" })}>Go to home</Button>
            <Button variant="ghost" onClick={() => nav({ to: "/profile" })}>View profile</Button>
          </div>
        </div>
      </AppShell>
    );
  }

  const isLast = step === STEPS.length - 1;
  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <AppShell title="Become a driver">
      <div className="max-w-md mx-auto space-y-5">
        <div>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
            <span>Step {step + 1} of {STEPS.length}</span>
            <span>{STEPS[step].title}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-soft min-h-[280px]">
          {step === 0 && (
            <div className="space-y-3">
              <h2 className="font-display font-bold text-xl">Tell us who you are</h2>
              <p className="text-sm text-muted-foreground">We'll display this to customers when you bid on jobs.</p>
              <div><Label htmlFor="fn">Full name</Label><Input id="fn" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
              <div><Label htmlFor="em">Email</Label><Input id="em" type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} disabled /></div>
              <p className="text-[11px] text-muted-foreground">Email is taken from your Con Z account. Change it in your profile if needed.</p>
            </div>
          )}
          {step === 1 && (
            <PhotoStep title="Take a clear selfie" hint="Front camera • Face centered, good lighting." field="selfie_url" cameraFacing="user" userId={userId!} current={selfie} onDone={setSelfie} />
          )}
          {step === 2 && (
            <PhotoStep title="Photo of your National ID" hint="Back camera • Whole card, all four corners visible." field="national_id_url" cameraFacing="environment" userId={userId!} current={nationalId} onDone={setNationalId} />
          )}
          {step === 3 && (
            <PhotoStep title="Photo of your driver's licence" hint="Back camera • Whole card, all four corners visible." field="license_url" cameraFacing="environment" userId={userId!} current={license} onDone={setLicense} />
          )}
          {step === 4 && (
            <div className="space-y-3">
              <h2 className="font-display font-bold text-xl">Photos of your tipper truck</h2>
              <p className="text-sm text-muted-foreground">All three angles are required — this is how admins confirm it's a real, roadworthy tipper.</p>
              <ComplianceDocRow label="Front (with number plate)" userId={userId!} field="tipper_photo_url" current={truckPhoto} onDone={setTruckPhoto} />
              <ComplianceDocRow label="Side" userId={userId!} field="tipper_photo_side_url" current={truckPhotoSide} onDone={setTruckPhotoSide} />
              <ComplianceDocRow label="Back (with tipper bin visible)" userId={userId!} field="tipper_photo_back_url" current={truckPhotoBack} onDone={setTruckPhotoBack} />
            </div>
          )}
          {step === 5 && (
            <div className="space-y-3">
              <h2 className="font-display font-bold text-xl">Transport compliance documents</h2>
              <p className="text-sm text-muted-foreground">
                Recommended, not required to submit — but drivers with these on file get priority for jobs and are
                protected if a customer or authority ever asks for proof.
              </p>
              <ComplianceDocRow label="Operator's Licence / Route Permit" userId={userId!} field="operator_license_url" current={operatorLicense} onDone={setOperatorLicense} />
              <ComplianceDocRow label="VID Certificate of Fitness" userId={userId!} field="certificate_of_fitness_url" current={certOfFitness} onDone={setCertOfFitness} />
              <ComplianceDocRow label="Goods-in-Transit insurance" userId={userId!} field="git_insurance_url" current={gitInsurance} onDone={setGitInsurance} />
              <ComplianceDocRow label="ZINARA registration" userId={userId!} field="zinara_url" current={zinara} onDone={setZinara} />
            </div>
          )}
          {step === 6 && (
            <div className="space-y-3">
              <h2 className="font-display font-bold text-xl">Your nationality</h2>
              <p className="text-sm text-muted-foreground">Where is your citizenship from?</p>
              <NationalitySelect value={nationality} onChange={setNationality} />
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="flex-1">
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          {isLast ? (
            <Button onClick={submit} disabled={!canNext() || submitting} className="flex-1">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Submit <Check className="w-4 h-4 ml-1" /></>}
            </Button>
          ) : (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext()} className="flex-1">
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function ComplianceDocRow({
  label, field, userId, current, onDone,
}: {
  label: string; field: DocField; userId: string; current: string | null; onDone: (path: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    const path = `${userId}/${field}-${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
    const { error: uerr } = await supabase.storage.from("driver-docs").upload(path, file, { upsert: true });
    if (uerr) { setUploading(false); return toast.error(uerr.message); }
    const patch = { [field]: path };
    const { error } = await supabase.from("driver_profiles").update(patch as never).eq("user_id", userId);
    setUploading(false);
    if (error) return toast.error(error.message);
    toast.success("Uploaded");
    onDone(path);
  };
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
      <div className="flex items-center gap-2 min-w-0">
        {current ? <Check className="w-4 h-4 text-success shrink-0" /> : <div className="w-4 h-4 rounded-full border shrink-0" />}
        <span className="text-sm truncate">{label}</span>
      </div>
      <label className="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer hover:bg-muted">
        {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : current ? "Replace" : "Upload"}
        <input type="file" accept="image/*,.pdf" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="hidden" />
      </label>
    </div>
  );
}

function PhotoStep({
  title, hint, field, cameraFacing, userId, current, onDone,
}: {
  title: string; hint: string; field: DocField; cameraFacing: "user" | "environment"; userId: string; current: string | null; onDone: (path: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    const path = `${userId}/${field}-${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
    const { error: uerr } = await supabase.storage.from("driver-docs").upload(path, file, { upsert: true });
    if (uerr) { setUploading(false); return toast.error(uerr.message); }
    const patch = { [field]: path, verification_status: "pending" as const };
    const { error } = await supabase.from("driver_profiles").update(patch as never).eq("user_id", userId);
    setUploading(false);
    if (error) return toast.error(error.message);
    toast.success("Uploaded");
    onDone(path);
  };
  return (
    <div className="space-y-3">
      <h2 className="font-display font-bold text-xl">{title}</h2>
      <p className="text-sm text-muted-foreground">{hint}</p>
      {current && (
        <div className="rounded-lg bg-success/10 border border-success/30 p-3 flex items-center gap-2 text-xs">
          <Check className="w-4 h-4 text-success" />
          <span>Photo uploaded. You can retake it if you want.</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col items-center gap-1 rounded-xl border-2 border-dashed bg-muted/30 hover:bg-muted p-5 cursor-pointer transition">
          <Camera className="w-6 h-6 text-primary" />
          <span className="text-xs font-semibold">{uploading ? "Uploading…" : "Take photo"}</span>
          <input type="file" accept="image/*" capture={cameraFacing} disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="hidden" />
        </label>
        <label className="flex flex-col items-center gap-1 rounded-xl border-2 border-dashed bg-muted/30 hover:bg-muted p-5 cursor-pointer transition">
          <ImageIcon className="w-6 h-6 text-primary" />
          <span className="text-xs font-semibold">{uploading ? "Uploading…" : "From gallery"}</span>
          <input type="file" accept="image/*" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="hidden" />
        </label>
      </div>
    </div>
  );
}

function NationalitySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between">
          {value || "Select country"}
          <ChevronRight className={cn("w-4 h-4 opacity-50 transition-transform", open && "rotate-90")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command>
          <CommandInput placeholder="Search country…" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRY_CODES.map((c) => (
                <CommandItem key={c.code} value={c.name} onSelect={() => { onChange(c.name); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === c.name ? "opacity-100" : "opacity-0")} />
                  {c.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
