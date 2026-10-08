import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { useViewMode } from "@/lib/view-mode";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui-bits";
import { useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Truck, KeyRound, Camera, Image as ImageIcon, AlertTriangle, Check } from "lucide-react";
import { LocationPrivacyCard } from "@/components/LocationPrivacyCard";
import { AddTruckForm } from "@/components/AddTruckForm";
import { deleteMyAccount } from "@/lib/account-deletion";
import { rpcFailure } from "@/lib/rpc-result";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { userId, profile, roles, is, refresh } = useAuth();
  const { activeRole } = useViewMode();
  const qc = useQueryClient();
  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [saving, setSaving] = useState(false);

  const { data: driver } = useQuery({
    queryKey: ["driver-profile", userId],
    enabled: !!userId && is("driver"),
    queryFn: async () => (await supabase.from("driver_profiles").select("*").eq("user_id", userId!).maybeSingle()).data,
  });

  const { data: trucks } = useQuery({
    queryKey: ["trucks", userId],
    enabled: !!userId && is("driver"),
    queryFn: async () => (await supabase.from("trucks").select("*").eq("driver_id", userId!)).data ?? [],
  });

  const [docsExpanded, setDocsExpanded] = useState(false);
  const isVerified = driver?.verification_status === "verified";
  const reverifyDueAt = driver?.reverify_due_at ? new Date(driver.reverify_due_at as string) : null;
  const daysLeft = reverifyDueAt ? Math.ceil((reverifyDueAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;
  const reverifyDueSoon = daysLeft !== null && daysLeft <= 14;
  const reverifyOverdue = daysLeft !== null && daysLeft <= 0;
  const showFullDocs = !isVerified || reverifyDueSoon || docsExpanded;
  const DOC_ITEMS: { field: DocField; label: string; hint: string; cameraFacing: "user" | "environment" }[] = [
    { field: "selfie_url", label: "Selfie (face photo)", hint: "Front camera • Look at the camera in good light", cameraFacing: "user" },
    { field: "license_url", label: "Driver's licence", hint: "Back camera • Full licence card, all corners visible", cameraFacing: "environment" },
    { field: "tipper_photo_url", label: "Tipper truck photo", hint: "Back camera • Whole truck with number plate visible", cameraFacing: "environment" },
    { field: "national_id_url", label: "National ID", hint: "Back camera • Front side of your ID card", cameraFacing: "environment" },
  ];

  const saveProfile = async () => {
    if (!name.trim()) return toast.error("Name required");
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ full_name: name.trim(), phone: phone.trim() || null }).eq("id", userId!);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Profile saved");
    refresh();
  };

  const becomeDriver = async () => {
    const { error } = await supabase.rpc("self_add_base_role", { _role: "driver" });
    if (error) return toast.error(error.message);
    await supabase.from("driver_profiles").upsert({ user_id: userId! }, { onConflict: "user_id" });
    toast.success("You're now a driver. Complete verification to start bidding.");
    refresh();
    qc.invalidateQueries();
  };

  const becomeCustomer = async () => {
    const { error } = await supabase.rpc("self_add_base_role", { _role: "customer" });
    if (error) return toast.error(error.message);
    toast.success("Customer account active.");
    refresh();
    qc.invalidateQueries();
  };

  return (
    <AppShell title="Profile">
      <div className="space-y-6">
        <section className="rounded-2xl bg-card border p-4 shadow-soft space-y-3">
          <h2 className="font-display font-bold uppercase tracking-wide">Account</h2>
          <div><Label htmlFor="n">Full name</Label><Input id="n" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
          <div><Label htmlFor="p">Phone</Label><Input id="p" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="+263 …" /></div>
          <Button onClick={saveProfile} disabled={saving} className="w-full">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}</Button>
          <div className="flex flex-wrap gap-1 pt-2">
            {roles.map((r) => <StatusBadge key={r} label={r.replace("_", " ")} className="bg-accent text-accent-foreground border-accent" />)}
          </div>
        </section>

        {activeRole === "driver" && !is("driver") && (
          <Button onClick={becomeDriver} variant="outline" className="w-full h-12"><Truck className="w-4 h-4 mr-2" />Become a driver too</Button>
        )}
        {activeRole === "customer" && !is("customer") && (
          <Button onClick={becomeCustomer} variant="outline" className="w-full h-12">Enable customer account</Button>
        )}

        {activeRole === "driver" && is("driver") && (
          <section id="tour-driver-verification-section" className="rounded-2xl bg-card border p-4 shadow-soft space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold uppercase tracking-wide">Driver verification</h2>
              <StatusBadge label={driver?.verification_status ?? "pending"} className={isVerified ? "bg-success/15 text-success border-success/30" : driver?.verification_status === "rejected" ? "bg-destructive/15 text-destructive border-destructive/30" : "bg-warning/15 text-warning border-warning/30"} />
            </div>

            {isVerified && !reverifyDueSoon && (
              <div className="rounded-xl bg-success/10 border border-success/30 p-3 flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-success shrink-0" />
                <div className="text-sm"><div className="font-semibold">You're verified</div><div className="text-muted-foreground text-xs">You can bid on any open job.</div></div>
              </div>
            )}

            {isVerified && reverifyDueSoon && (
              <div className={`rounded-lg border p-3 flex items-start gap-2 text-xs ${reverifyOverdue ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10"}`}>
                <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${reverifyOverdue ? "text-destructive" : "text-warning"}`} />
                <span>
                  {reverifyOverdue
                    ? "Your verification has expired — retake your selfie below to keep bidding on jobs. You won't see new job alerts or be able to bid until you do."
                    : `Time to re-verify — retake your selfie below within ${daysLeft} day${daysLeft === 1 ? "" : "s"} to avoid losing access to bidding.`}
                </span>
              </div>
            )}

            {driver?.verification_status === "pending" && (
              <p className="text-xs text-muted-foreground">Your documents are with our team — most drivers are reviewed within 24 hours.</p>
            )}

            {showFullDocs ? (
              <>
                <p className="text-xs text-muted-foreground">Take each photo with your phone camera. Make sure your face and documents are clearly visible.</p>
                {DOC_ITEMS.map((d) => (
                  <DocUpload
                    key={d.field}
                    field={d.field}
                    label={d.label}
                    hint={d.hint}
                    cameraFacing={d.cameraFacing}
                    userId={userId!}
                    current={driver?.[d.field] as string | undefined}
                    refresh={() => qc.invalidateQueries({ queryKey: ["driver-profile", userId] })}
                  />
                ))}
                {isVerified && !reverifyDueSoon && (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setDocsExpanded(false)}>Hide documents</Button>
                )}
              </>
            ) : (
              <div className="space-y-1.5">
                {DOC_ITEMS.map((d) => (
                  <div key={d.field} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-success shrink-0" />
                    <span>{d.label}</span>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="w-full mt-1" onClick={() => setDocsExpanded(true)}>Update documents</Button>
              </div>
            )}

            {driver?.verification_notes && <p className="text-xs text-muted-foreground bg-muted p-2 rounded">Admin note: {driver.verification_notes}</p>}
          </section>
        )}

        {activeRole === "driver" && is("driver") && (
          <section className="rounded-2xl bg-card border p-4 shadow-soft space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold"><Truck className="w-4 h-4" />My trucks</div>
            {trucks?.map((t) => (
              <div key={t.id} className="text-sm border rounded p-2">{t.registration} • {Number(t.capacity_m3)} m³</div>
            ))}
            <AddTruckForm userId={userId!} onSaved={() => qc.invalidateQueries({ queryKey: ["trucks", userId] })} />
          </section>
        )}

        {activeRole === "driver" && is("driver") && <WithdrawalPinCard />}

        <SetPasswordCard />

        <LocationPrivacyCard />

        <DeleteAccountCard />
      </div>
    </AppShell>
  );
}

function SetPasswordCard() {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (pw.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw !== confirm) return toast.error("Passwords do not match");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setSaving(false);
    if (error) return toast.error(error.message);
    setPw(""); setConfirm("");
    toast.success("Password saved. You can now log in with email + password.");
  };
  return (
    <section className="rounded-2xl bg-card border p-4 shadow-soft space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-primary" />
        <h2 className="font-display font-bold uppercase tracking-wide">Set / change login password</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Set a password so you can log in with email + password — even if you originally signed up with Google.
        Google never shares your Google password with any app, so this is a separate Con Z password you control.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="npw">New password</Label>
          <Input id="npw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} autoComplete="new-password" />
        </div>
        <div>
          <Label htmlFor="npw2">Confirm</Label>
          <Input id="npw2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} autoComplete="new-password" />
        </div>
      </div>
      <Button onClick={save} disabled={saving} className="w-full">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save password"}
      </Button>
    </section>
  );
}

type DocField = "national_id_url" | "selfie_url" | "license_url" | "tipper_photo_url";

function DocUpload({ field, label, hint, cameraFacing = "environment", userId, current, refresh }: { field: DocField; label: string; hint?: string; cameraFacing?: "user" | "environment"; userId: string; current?: string | null; refresh: () => void }) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file: File) => {
    setUploading(true);
    const path = `${userId}/${field}-${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
    const { error: uerr } = await supabase.storage.from("driver-docs").upload(path, file, { upsert: false });
    if (uerr) { setUploading(false); return toast.error(uerr.message); }
    const patch = { [field]: path, verification_status: "pending" as const };
    const { error } = await supabase.from("driver_profiles").update(patch as never).eq("user_id", userId);
    setUploading(false);
    if (error) return toast.error(error.message);
    toast.success(`${label} uploaded — usually reviewed within 24 hours`);
    refresh();
  };
  return (
    <div className="rounded-xl border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="font-semibold">{label}</Label>
        {current && <StatusBadge label="Uploaded" className="bg-success/15 text-success border-success/30" />}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 hover:bg-muted transition p-3 cursor-pointer">
          <Camera className="w-5 h-5 text-primary shrink-0" />
          <span className="text-xs font-semibold">{uploading ? "Uploading…" : "Take photo"}</span>
          <input type="file" accept="image/*" capture={cameraFacing} disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} className="hidden" />
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

function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      const res = await deleteMyAccount();
      if (!res.ok) {
        setLoading(false);
        return toast.error(res.message, { duration: 10000 });
      }
      toast.success("Your account has been deleted.");
      await supabase.auth.signOut();
      window.location.href = "/";
    } catch (err) {
      setLoading(false);
      toast.error(err instanceof Error ? err.message : "Could not delete account");
    }
  };

  return (
    <section className="rounded-2xl bg-card border border-destructive/30 p-4 shadow-soft space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-destructive" />
        <h2 className="font-display font-bold uppercase tracking-wide text-destructive">Delete account</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Permanently removes your personal info (name, phone, email, ID documents) and blocks this account from
        ever logging in again. This cannot be undone.
      </p>
      <Button variant="outline" className="w-full border-destructive text-destructive hover:bg-destructive/10" onClick={() => setOpen(true)}>
        Delete my account
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete your account?</DialogTitle>
            <DialogDescription>
              This permanently deletes your personal information and disables this account. Job and payment
              history tied to completed deliveries is kept for legal/accounting purposes, with your name
              replaced by "Deleted user". Type <b>DELETE</b> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE"
            autoCapitalize="characters"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "DELETE" || loading}
              onClick={submit}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Permanently delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function WithdrawalPinCard() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const { data: driver } = useQuery({
    queryKey: ["driver-pin-profile", userId],
    enabled: !!userId,
    queryFn: async () => (await supabase.from("driver_profiles").select("withdrawal_pin_hash").eq("user_id", userId!).maybeSingle()).data,
  });
  const hasPin = !!driver?.withdrawal_pin_hash;
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!/^\d{4,8}$/.test(pin)) return toast.error("PIN must be 4-8 digits");
    if (pin !== confirm) return toast.error("PINs do not match");
    if (hasPin && !/^\d{4,8}$/.test(currentPin)) return toast.error("Enter your current PIN to change it");
    setSaving(true);
    const { data, error } = await (supabase as any).rpc("set_withdrawal_pin", { _pin: pin, _current_pin: hasPin ? currentPin : null });
    setSaving(false);
    if (error) return toast.error(error.message);
    const failed = rpcFailure(data);
    if (failed) return toast.error(failed.error === "wrong_pin" ? "Your current PIN is incorrect." : failed.message);
    setPin(""); setConfirm(""); setCurrentPin("");
    toast.success("Withdrawal PIN saved");
    qc.invalidateQueries({ queryKey: ["driver-pin-profile", userId] });
    qc.invalidateQueries({ queryKey: ["driver-pin", userId] });
  };
  return (
    <section className="rounded-2xl bg-card border p-4 shadow-soft space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-primary" />
          <h2 className="font-display font-bold uppercase tracking-wide">Withdrawal PIN</h2>
        </div>
        {hasPin && <StatusBadge label="Set" className="bg-success/15 text-success border-success/30" />}
      </div>
      <p className="text-xs text-muted-foreground">
        Required to authorise withdrawals from your wallet. 4–8 digits. Five wrong entries locks withdrawals for 15 minutes.
      </p>
      {hasPin && (
        <div>
          <Label htmlFor="pincur">Current PIN</Label>
          <Input id="pincur" type="password" inputMode="numeric" value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 8))} maxLength={8} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="pin">{hasPin ? "New PIN" : "PIN"}</Label>
          <Input id="pin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} maxLength={8} />
        </div>
        <div>
          <Label htmlFor="pin2">Confirm</Label>
          <Input id="pin2" type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 8))} maxLength={8} />
        </div>
      </div>
      <Button onClick={save} disabled={saving} className="w-full">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : hasPin ? "Update PIN" : "Set PIN"}</Button>
    </section>
  );
}

