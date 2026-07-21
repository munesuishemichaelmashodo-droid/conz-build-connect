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
import { Loader2, ShieldCheck, Truck, KeyRound, Camera } from "lucide-react";
import { LocationPrivacyCard } from "@/components/LocationPrivacyCard";

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
    const { error } = await supabase.from("user_roles").insert({ user_id: userId!, role: "driver" });
    if (error) return toast.error(error.message);
    await supabase.from("driver_profiles").upsert({ user_id: userId! }, { onConflict: "user_id" });
    await supabase.from("wallets").upsert({ user_id: userId!, balance: 0 }, { onConflict: "user_id" });
    toast.success("You're now a driver. Complete verification to start bidding.");
    refresh();
    qc.invalidateQueries();
  };

  const becomeCustomer = async () => {
    const { error } = await supabase.from("user_roles").insert({ user_id: userId!, role: "customer" });
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
          <section className="rounded-2xl bg-card border p-4 shadow-soft space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold uppercase tracking-wide">Driver verification</h2>
              <StatusBadge label={driver?.verification_status ?? "pending"} className={driver?.verification_status === "verified" ? "bg-success/15 text-success border-success/30" : driver?.verification_status === "rejected" ? "bg-destructive/15 text-destructive border-destructive/30" : "bg-warning/15 text-warning border-warning/30"} />
            </div>
            <p className="text-xs text-muted-foreground">Take each photo with your phone camera. Make sure your face and documents are clearly visible.</p>
            <DocUpload field="selfie_url" label="Selfie (face photo)" hint="Front camera • Look at the camera in good light" cameraFacing="user" userId={userId!} current={driver?.selfie_url} refresh={() => qc.invalidateQueries({ queryKey: ["driver-profile", userId] })} />
            <DocUpload field="license_url" label="Driver's licence" hint="Back camera • Full licence card, all corners visible" cameraFacing="environment" userId={userId!} current={driver?.license_url} refresh={() => qc.invalidateQueries({ queryKey: ["driver-profile", userId] })} />
            <DocUpload field="tipper_photo_url" label="Tipper truck photo" hint="Back camera • Whole truck with number plate visible" cameraFacing="environment" userId={userId!} current={driver?.tipper_photo_url} refresh={() => qc.invalidateQueries({ queryKey: ["driver-profile", userId] })} />
            <DocUpload field="national_id_url" label="National ID" hint="Back camera • Front side of your ID card" cameraFacing="environment" userId={userId!} current={driver?.national_id_url} refresh={() => qc.invalidateQueries({ queryKey: ["driver-profile", userId] })} />
            {driver?.verification_notes && <p className="text-xs text-muted-foreground bg-muted p-2 rounded">Admin note: {driver.verification_notes}</p>}

            <div className="border-t pt-3 mt-3">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2"><Truck className="w-4 h-4" />My trucks</div>
              {trucks?.map((t) => (
                <div key={t.id} className="text-sm border rounded p-2 mb-1">{t.registration} • {Number(t.capacity_m3)} m³</div>
              ))}
              <AddTruckForm userId={userId!} onSaved={() => qc.invalidateQueries({ queryKey: ["trucks", userId] })} />
            </div>
          </section>
        )}

        {activeRole === "driver" && is("driver") && driver?.verification_status === "verified" && (
          <div className="rounded-xl bg-success/10 border border-success/30 p-3 flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-success" />
            <div className="text-sm"><div className="font-semibold">You're verified</div><div className="text-muted-foreground text-xs">You can bid on any open job.</div></div>
          </div>
        )}

        {activeRole === "customer" && is("customer") && (
          <section className="rounded-2xl bg-card border p-4 shadow-soft space-y-2">
            <h2 className="font-display font-bold uppercase tracking-wide">Customer account</h2>
            <p className="text-sm text-muted-foreground">Post jobs, review bids, and track deliveries live on the map.</p>
          </section>
        )}

        {activeRole === "driver" && is("driver") && <WithdrawalPinCard />}

        <SetPasswordCard />

        <LocationPrivacyCard />
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
    const { error: uerr } = await supabase.storage.from("driver-docs").upload(path, file, { upsert: true });
    if (uerr) { setUploading(false); return toast.error(uerr.message); }
    const patch = { [field]: path, verification_status: "pending" as const };
    const { error } = await supabase.from("driver_profiles").update(patch as never).eq("user_id", userId);
    setUploading(false);
    if (error) return toast.error(error.message);
    toast.success(`${label} uploaded`);
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

function AddTruckForm({ userId, onSaved }: { userId: string; onSaved: () => void }) {
  const [reg, setReg] = useState(""); const [cap, setCap] = useState(""); const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reg.trim() || !parseFloat(cap)) return toast.error("Enter registration and capacity");
    setSaving(true);
    const { error } = await supabase.from("trucks").insert({ driver_id: userId, registration: reg.trim(), capacity_m3: parseFloat(cap) });
    setSaving(false);
    if (error) return toast.error(error.message);
    setReg(""); setCap("");
    toast.success("Truck added");
    onSaved();
  };
  return (
    <form onSubmit={submit} className="grid grid-cols-3 gap-2 mt-2">
      <Input placeholder="Reg." value={reg} onChange={(e) => setReg(e.target.value)} maxLength={20} />
      <Input placeholder="m³" type="number" inputMode="decimal" min={1} value={cap} onChange={(e) => setCap(e.target.value)} />
      <Button type="submit" disabled={saving} size="sm">{saving ? "…" : "Add"}</Button>
    </form>
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
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!/^\d{4,8}$/.test(pin)) return toast.error("PIN must be 4-8 digits");
    if (pin !== confirm) return toast.error("PINs do not match");
    setSaving(true);
    const { error } = await (supabase as any).rpc("set_withdrawal_pin", { _pin: pin });
    setSaving(false);
    if (error) return toast.error(error.message);
    setPin(""); setConfirm("");
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

