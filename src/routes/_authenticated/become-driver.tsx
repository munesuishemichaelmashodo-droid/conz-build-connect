import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Camera,
  Image as ImageIcon,
  Check,
  Loader2,
  ShieldCheck,
  Clock,
  Smartphone,
  XCircle,
  Truck as TruckIcon,
} from "lucide-react";
import { COUNTRY_CODES } from "@/lib/country-codes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AddTruckForm } from "@/components/AddTruckForm";
import {
  DOC_LABELS,
  OPTIONAL_DOCS,
  OTP_LENGTH,
  RESEND_SECONDS,
  STAGES,
  detailsComplete,
  hasSubmitted,
  isOtpFormatValid,
  mapOtpError,
  missingRequired,
  normalisePhone,
  statusView,
  validateDocFile,
  type DocKey,
  type DocMap,
} from "@/lib/driver-onboarding";

export const Route = createFileRoute("/_authenticated/become-driver")({
  component: BecomeDriverPage,
});

// Sign-up SMS goes out through the Send SMS hook, which only allows +263 by default.
const DIAL_CODE = "+263";

type ProfileRow = DocMap & {
  nationality: string | null;
  verification_status: "pending" | "verified" | "rejected";
  verification_notes: string | null;
};

const PROFILE_COLUMNS =
  "selfie_url,national_id_url,license_url,tipper_photo_url,tipper_photo_side_url,tipper_photo_back_url,operator_license_url,certificate_of_fitness_url,git_insurance_url,zinara_url,nationality,verification_status,verification_notes";

function BecomeDriverPage() {
  const { userId, profile, email, refresh } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();

  const [stage, setStage] = useState(0);
  const [ready, setReady] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [name, setName] = useState(profile?.full_name ?? "");
  const [nationality, setNationality] = useState<string>("Zimbabwe");
  const [docs, setDocs] = useState<DocMap>({});
  const [submitting, setSubmitting] = useState(false);

  const { data: trucks } = useQuery({
    queryKey: ["trucks", userId],
    enabled: !!userId,
    queryFn: async () =>
      (await supabase.from("trucks").select("*").eq("driver_id", userId!)).data ?? [],
  });
  const hasTruck = (trucks?.length ?? 0) > 0;

  // The account status always comes from the database; stage 4 re-reads it.
  const { data: row, refetch: refetchRow } = useQuery({
    queryKey: ["driver-onboarding", userId],
    enabled: !!userId,
    refetchInterval: stage === 3 ? 30_000 : false,
    queryFn: async () => {
      const { data } = await supabase
        .from("driver_profiles")
        .select(PROFILE_COLUMNS)
        .eq("user_id", userId!)
        .maybeSingle();
      return (data as unknown as ProfileRow | null) ?? null;
    },
  });

  // First load: make sure a driver_profiles row exists, learn whether the phone is
  // already confirmed, and jump to the first unfinished stage.
  useEffect(() => {
    if (!userId) return;
    (async () => {
      await supabase
        .from("driver_profiles")
        .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
      const [{ data: auth }, { data: p }] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from("driver_profiles")
          .select(PROFILE_COLUMNS)
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      const confirmed = !!auth.user?.phone && !!auth.user?.phone_confirmed_at;
      setPhoneVerified(confirmed);
      const r = p as unknown as ProfileRow | null;
      if (r) {
        setDocs(r);
        if (r.nationality) setNationality(r.nationality);
      }
      const { data: t } = await supabase.from("trucks").select("id").eq("driver_id", userId);
      const submitted =
        !!r && hasSubmitted(r.verification_status, r, (t?.length ?? 0) > 0, r.nationality);
      setStage(
        submitted
          ? 3
          : confirmed
            ? r && missingRequired(r, (t?.length ?? 0) > 0).length < 7
              ? 2
              : 1
            : 0,
      );
      setReady(true);
    })();
  }, [userId]);

  const missing = missingRequired(docs, hasTruck);

  const canContinue = () => {
    if (stage === 0) return phoneVerified;
    if (stage === 1) return detailsComplete(name, nationality);
    if (stage === 2) return missing.length === 0;
    return false;
  };

  const submit = async () => {
    if (!userId) return;
    setSubmitting(true);
    try {
      if (name.trim() && name.trim() !== profile?.full_name) {
        await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", userId);
      }
      // The driver role is granted server-side only when an admin approves the
      // application (admin_set_driver_verification); nothing here grants access.
      const { error } = await supabase
        .from("driver_profiles")
        .update({ nationality, verification_status: "pending" })
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      await refresh();
      await refetchRow();
      qc.invalidateQueries();
      setStage(3);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <AppShell title="Become a driver">
        <div className="py-20 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    );
  }

  const progress = ((stage + 1) / STAGES.length) * 100;

  return (
    <AppShell title="Become a driver">
      <div className="max-w-md mx-auto space-y-5">
        <div>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1">
            <span>
              Step {stage + 1} of {STAGES.length}
            </span>
            <span>{STAGES[stage].title}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-5 shadow-soft min-h-[280px]">
          {stage === 0 && (
            <PhoneStage
              verified={phoneVerified}
              onVerified={() => setPhoneVerified(true)}
              userId={userId!}
            />
          )}

          {stage === 1 && (
            <div className="space-y-3">
              <h2 className="font-display font-bold text-xl">Tell us who you are</h2>
              <p className="text-sm text-muted-foreground">
                Customers see your name when you bid on jobs.
              </p>
              <div>
                <Label htmlFor="fn">Full name</Label>
                <Input
                  id="fn"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                />
              </div>
              <div>
                <Label htmlFor="em">Email</Label>
                <Input id="em" type="email" value={email ?? ""} disabled />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Email comes from your Con Z account. Change it in your profile if needed.
              </p>
              <div>
                <Label>Nationality</Label>
                <NationalitySelect value={nationality} onChange={setNationality} />
              </div>
            </div>
          )}

          {stage === 2 && (
            <DocumentsStage
              userId={userId!}
              docs={docs}
              setDocs={setDocs}
              trucks={(trucks ?? []) as { id: string; registration: string; capacity_m3: number }[]}
              onTruckSaved={() => qc.invalidateQueries({ queryKey: ["trucks", userId] })}
              missing={missing}
              rejectionNote={
                row?.verification_status === "rejected" ? row.verification_notes : null
              }
            />
          )}

          {stage === 3 && (
            <StatusStage
              status={row?.verification_status}
              notes={row?.verification_notes}
              onFix={() => setStage(2)}
              onRefresh={() => refetchRow()}
              onOpenDriverMode={() => nav({ to: "/home" })}
              onHome={() => nav({ to: "/home" })}
            />
          )}
        </div>

        {stage < 3 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setStage((s) => Math.max(0, s - 1))}
              disabled={stage === 0}
              className="flex-1"
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Back
            </Button>
            {stage === 2 ? (
              <Button onClick={submit} disabled={!canContinue() || submitting} className="flex-1">
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Submit for review <Check className="w-4 h-4 ml-1" />
                  </>
                )}
              </Button>
            ) : (
              <Button
                onClick={() => setStage((s) => s + 1)}
                disabled={!canContinue()}
                className="flex-1"
              >
                Continue <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Stage 1 — real SMS verification through Supabase Auth (phone_change OTP).
// There is no simulated mode: if the project has no SMS provider the error says so.
// ---------------------------------------------------------------------------
function PhoneStage({
  verified,
  onVerified,
  userId,
}: {
  verified: boolean;
  onVerified: () => void;
  userId: string;
}) {
  const [local, setLocal] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const e164 = normalisePhone(DIAL_CODE, local);

  const sendCode = async () => {
    if (!e164) return setError("Enter a valid Zimbabwe mobile number, for example 077 123 4567.");
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.updateUser({ phone: e164 });
    setBusy(false);
    if (err) return setError(mapOtpError(err.message).message);
    setSentTo(e164);
    setCode("");
    setCooldown(RESEND_SECONDS);
  };

  const verify = async () => {
    if (!sentTo || !isOtpFormatValid(code)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      phone: sentTo,
      token: code,
      type: "phone_change",
    });
    if (err) {
      setBusy(false);
      setCode("");
      return setError(mapOtpError(err.message).message);
    }
    // Keep the profile phone in step with the confirmed number (best effort).
    await supabase.from("profiles").update({ phone: sentTo }).eq("id", userId);
    setBusy(false);
    toast.success("Phone verified");
    onVerified();
  };

  if (verified) {
    return (
      <div className="space-y-3 text-center py-6">
        <div className="w-14 h-14 rounded-full bg-success/15 border border-success/40 mx-auto flex items-center justify-center">
          <Check className="w-7 h-7 text-success" />
        </div>
        <h2 className="font-display font-bold text-xl">Phone verified</h2>
        <p className="text-sm text-muted-foreground">Press Continue to enter your details.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Smartphone className="w-5 h-5 text-primary" />
        <h2 className="font-display font-bold text-xl">Verify your phone</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        We text a {OTP_LENGTH}-digit code to your mobile. Customers and Con Z use this number to
        reach you about jobs.
      </p>

      {!sentTo ? (
        <>
          <Label htmlFor="ph">Mobile number</Label>
          <div className="flex gap-2">
            <div className="flex items-center rounded-md border px-3 text-sm text-muted-foreground">
              {DIAL_CODE}
            </div>
            <Input
              id="ph"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="77 123 4567"
              value={local}
              onChange={(e) => setLocal(e.target.value.replace(/[^\d\s]/g, ""))}
              maxLength={14}
            />
          </div>
          <Button onClick={sendCode} disabled={busy || !e164} className="w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send code"}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm">
            Code sent to <b>{sentTo}</b>.
          </p>
          <div className="flex justify-center">
            <InputOTP maxLength={OTP_LENGTH} value={code} onChange={setCode} inputMode="numeric">
              <InputOTPGroup>
                {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                  <InputOTPSlot key={i} index={i} />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>
          <Button onClick={verify} disabled={busy || !isOtpFormatValid(code)} className="w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify"}
          </Button>
          <div className="flex items-center justify-between text-xs">
            <button
              className="underline text-muted-foreground"
              onClick={() => {
                setSentTo(null);
                setCode("");
                setError(null);
              }}
            >
              Change number
            </button>
            <button
              className="underline disabled:no-underline disabled:opacity-50"
              disabled={cooldown > 0 || busy}
              onClick={sendCode}
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage 3 — truck and every document on one screen. Uploading only stores the
// file and its path; it never marks anything verified (an admin does that).
// ---------------------------------------------------------------------------
function DocumentsStage({
  userId,
  docs,
  setDocs,
  trucks,
  onTruckSaved,
  missing,
  rejectionNote,
}: {
  userId: string;
  docs: DocMap;
  setDocs: (fn: (d: DocMap) => DocMap) => void;
  trucks: { id: string; registration: string; capacity_m3: number }[];
  onTruckSaved: () => void;
  missing: string[];
  rejectionNote: string | null | undefined;
}) {
  const done = (field: DocKey) => (path: string) => setDocs((d) => ({ ...d, [field]: path }));
  const row = (field: DocKey, camera?: "user" | "environment") => (
    <DocRow
      key={field}
      label={DOC_LABELS[field]}
      field={field}
      userId={userId}
      current={docs[field] ?? null}
      onDone={done(field)}
      camera={camera}
    />
  );
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display font-bold text-xl">Your truck and documents</h2>
        <p className="text-sm text-muted-foreground">
          Photos or PDFs up to 10 MB. Uploading does not approve you; our team reviews every
          document.
        </p>
      </div>

      {rejectionNote && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs"
        >
          <b>Last review:</b> {rejectionNote}
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          You
        </h3>
        {row("selfie_url", "user")}
        {row("national_id_url", "environment")}
        {row("license_url", "environment")}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Truck
        </h3>
        {row("tipper_photo_url", "environment")}
        {row("tipper_photo_side_url", "environment")}
        {row("tipper_photo_back_url", "environment")}
        <div className="rounded-xl border p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TruckIcon className="w-4 h-4" /> Registration and capacity
          </div>
          {trucks.length > 0 ? (
            trucks.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-lg bg-success/10 border border-success/30 px-3 py-2 text-xs"
              >
                <span className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-success" />
                  {t.registration}
                </span>
                <span className="text-muted-foreground">{t.capacity_m3} m³</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">
              Enter your plate and load capacity. You cannot bid until a truck is registered.
            </p>
          )}
          <AddTruckForm userId={userId} onSaved={onTruckSaved} />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Transport papers (recommended)
        </h3>
        {OPTIONAL_DOCS.map((f) => row(f))}
      </section>

      {missing.length > 0 ? (
        <p className="text-xs text-muted-foreground">Still needed: {missing.join(", ")}.</p>
      ) : (
        <p className="text-xs text-success">
          Everything required is on file. Submit for review when ready.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage 4 — what the database says about the application.
// ---------------------------------------------------------------------------
function StatusStage({
  status,
  notes,
  onFix,
  onRefresh,
  onOpenDriverMode,
  onHome,
}: {
  status: "pending" | "verified" | "rejected" | null | undefined;
  notes: string | null | undefined;
  onFix: () => void;
  onRefresh: () => void;
  onOpenDriverMode: () => void;
  onHome: () => void;
}) {
  const v = statusView(status, notes);
  const Icon = v.kind === "approved" ? ShieldCheck : v.kind === "rejected" ? XCircle : Clock;
  // Full class names (not built from a variable) so Tailwind keeps them.
  const tone =
    v.kind === "approved"
      ? { ring: "bg-success/15 border-success/40", icon: "text-success" }
      : v.kind === "rejected"
        ? { ring: "bg-destructive/15 border-destructive/40", icon: "text-destructive" }
        : { ring: "bg-warning/15 border-warning/40", icon: "text-warning" };
  return (
    <div className="text-center space-y-4 py-4">
      <div
        className={cn(
          "w-20 h-20 rounded-full mx-auto flex items-center justify-center border",
          tone.ring,
        )}
      >
        <Icon className={cn("w-10 h-10", tone.icon)} />
      </div>
      <div>
        <h2 className="font-display font-bold text-2xl">{v.title}</h2>
        <p className="text-sm text-muted-foreground mt-2">{v.body}</p>
      </div>
      <div className="rounded-xl border bg-muted/30 p-3 text-left text-xs text-muted-foreground flex gap-2">
        <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <span>Your ID, licence and truck photos are only visible to you and Con Z admins.</span>
      </div>
      <div className="flex flex-col gap-2">
        {v.canEnterDriverMode && <Button onClick={onOpenDriverMode}>Open Driver Mode</Button>}
        {v.kind === "rejected" && <Button onClick={onFix}>Fix documents and resubmit</Button>}
        {v.kind === "review" && (
          <Button variant="outline" onClick={onRefresh}>
            Check status
          </Button>
        )}
        <Button variant="ghost" onClick={onHome}>
          Go to home
        </Button>
      </div>
    </div>
  );
}

function DocRow({
  label,
  field,
  userId,
  current,
  onDone,
  camera,
}: {
  label: string;
  field: DocKey;
  userId: string;
  current: string | null;
  onDone: (path: string) => void;
  camera?: "user" | "environment";
}) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    const problem = validateDocFile(file);
    if (problem) return toast.error(problem);
    setUploading(true);
    const path = `${userId}/${field}-${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
    const { error: uerr } = await supabase.storage
      .from("driver-docs")
      .upload(path, file, { upsert: false });
    if (uerr) {
      setUploading(false);
      return toast.error(uerr.message);
    }
    // Only the file path is saved and the application is (re)marked pending; nothing is marked verified.
    const { error } = await supabase
      .from("driver_profiles")
      .update({ [field]: path, verification_status: "pending" } as never)
      .eq("user_id", userId);
    setUploading(false);
    if (error) return toast.error(error.message);
    toast.success("Uploaded");
    onDone(path);
  };
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) void upload(f);
  };
  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {current ? (
            <Check className="w-4 h-4 text-success shrink-0" />
          ) : (
            <div className="w-4 h-4 rounded-full border shrink-0" />
          )}
          <span className="text-sm truncate">{label}</span>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">
          {uploading ? "Uploading…" : current ? "Uploaded · awaiting review" : "Missing"}
        </span>
      </div>
      <div className="flex gap-2">
        {camera && (
          <label className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer hover:bg-muted">
            <Camera className="w-3.5 h-3.5" /> Take photo
            <input
              type="file"
              accept="image/*"
              capture={camera}
              disabled={uploading}
              onChange={pick}
              className="hidden"
            />
          </label>
        )}
        <label className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer hover:bg-muted">
          {uploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ImageIcon className="w-3.5 h-3.5" />
          )}
          {current ? "Replace" : camera ? "From gallery" : "Upload"}
          <input
            type="file"
            accept="image/*,.pdf"
            disabled={uploading}
            onChange={pick}
            className="hidden"
          />
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
          <ChevronRight
            className={cn("w-4 h-4 opacity-50 transition-transform", open && "rotate-90")}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command>
          <CommandInput placeholder="Search country…" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRY_CODES.map((c) => (
                <CommandItem
                  key={c.code}
                  value={c.name}
                  onSelect={() => {
                    onChange(c.name);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", value === c.name ? "opacity-100" : "opacity-0")}
                  />
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
