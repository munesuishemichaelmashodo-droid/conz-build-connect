import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Percent, Save, ShieldAlert, Fuel, Package } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AddressPicker } from "@/components/AddressPicker";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const list = (roles ?? []).map((r: { role: string }) => r.role);
    if (!list.includes("super_admin")) throw redirect({ to: "/admin" });
  },
  component: AdminSettings,
});

function AdminSettings() {
  const { is, userId } = useAuth();
  const isSuper = is("super_admin");
  const qc = useQueryClient();

  const { data: rate } = useQuery({
    queryKey: ["commission-rate"],
    queryFn: async () => {
      const { data } = await supabase.from("system_settings").select("value").eq("key", "commission_rate").maybeSingle();
      return Number(data?.value ?? 7);
    },
  });

  const [value, setValue] = useState("");
  useEffect(() => {
    if (rate != null) setValue(String(rate));
  }, [rate]);

  const { data: diesel } = useQuery({
    queryKey: ["diesel-price"],
    queryFn: async () => {
      const { data } = await supabase.from("system_settings").select("value").eq("key", "diesel_price_per_liter").maybeSingle();
      return Number(data?.value ?? 1.87);
    },
  });

  const [dieselValue, setDieselValue] = useState("");
  useEffect(() => {
    if (diesel != null) setDieselValue(String(diesel));
  }, [diesel]);

  const { data: materials } = useQuery({
    queryKey: ["admin-material-prices-full"],
    queryFn: async () => {
      const { data } = await (supabase.rpc as unknown as (f: string) => Promise<{ data: unknown }>)("admin_material_prices");
      return (data ?? []) as Array<{
        material: string;
        label: string;
        min_price: number | null;
        max_price: number | null;
        enforced: boolean;
        unit: string;
        pickup_lat: number | null;
        pickup_lng: number | null;
        pickup_label: string | null;
      }>;
    },
  });

  const { data: superCount } = useQuery({
    queryKey: ["super-count"],
    queryFn: async () => {
      const { count } = await supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "super_admin");
      return count ?? 0;
    },
  });

  const save = async () => {
    const v = Number(value);
    if (isNaN(v) || v < 0 || v > 100) return toast.error("Rate must be 0-100");
    const reason = window.prompt("Why is the commission rate changing? (recorded in the audit log)") ?? undefined;
    if (!reason?.trim() || reason.trim().length < 5) return toast.error("Give a reason (at least 5 characters)");
    const { error } = await supabase.rpc("admin_set_commission", { _rate: v, _reason: reason.trim() });
    if (error) return toast.error(error.message);
    toast.success(`Commission set to ${v}%`);
    qc.invalidateQueries({ queryKey: ["commission-rate"] });
    qc.invalidateQueries({ queryKey: ["admin-dash"] });
  };

  const saveDiesel = async () => {
    const v = Number(dieselValue);
   if (isNaN(v) || v < 0.5 || v > 2.0) return toast.error("Multiplier must be between 0.50 and 2.00");
    const { error } = await supabase.rpc("admin_set_demand_multiplier", {
  _multiplier: v,
  _reason: "Price adjustment",
});
    if (error) return toast.error(error.message);
toast.success(`Price multiplier set to ${v.toFixed(2)}`);
    qc.invalidateQueries({ queryKey: ["diesel-price"] });
  };

  const claim = async () => {
    const { error } = await supabase.rpc("claim_super_admin");
    if (error) return toast.error(error.message);
    toast.success("You are now super admin. Sign out and back in to refresh roles.");
    qc.invalidateQueries();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Percent className="w-5 h-5 text-primary" />
          <h3 className="font-display font-bold text-lg uppercase tracking-wide">Commission rate</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Percentage deducted from a driver's wallet each time a job is completed.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!isSuper}
            className="flex-1 px-3 py-2.5 rounded-xl border bg-background text-lg font-display font-bold disabled:opacity-50"
          />
          <span className="font-display font-bold text-2xl text-muted-foreground">%</span>
        </div>
        <button
          onClick={save}
          disabled={!isSuper}
          className="w-full rounded-xl bg-primary text-primary-foreground font-semibold py-3 disabled:opacity-50"
        >
          <Save className="w-4 h-4 inline mr-1" /> Save commission
        </button>
        {!isSuper && (
          <p className="text-xs text-muted-foreground text-center">Only super admins can change the commission rate.</p>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Fuel className="w-5 h-5 text-primary" />
          <h3 className="font-display font-bold text-lg uppercase tracking-wide">Price multiplier</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Moves every enforced material price at once. 1.00 = no change, 1.08 = +8%.
        </p>
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-2xl text-muted-foreground">×</span>
          <input
            type="number"
            min={0.5}
            max={2.0}
            step={0.01}
            value={dieselValue}
            onChange={(e) => setDieselValue(e.target.value)}
            disabled={!isSuper}
            className="flex-1 px-3 py-2.5 rounded-xl border bg-background text-lg font-display font-bold disabled:opacity-50"
          />
         
        </div>
        <button
          onClick={saveDiesel}
          disabled={!isSuper}
          className="w-full rounded-xl bg-primary text-primary-foreground font-semibold py-3 disabled:opacity-50"
        >
          <Save className="w-4 h-4 inline mr-1" /> Apply multiplier
        </button>
        {!isSuper && (
          <p className="text-xs text-muted-foreground text-center">Only super admins can change the diesel price.</p>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-primary" />
          <h3 className="font-display font-bold text-lg uppercase tracking-wide">Material prices</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Set the min/max price range per material (per {materials?.[0]?.unit ?? "10-15 m³ load"}). Turning enforcement
          off lets customers name their own price for that material.
        </p>
        <div className="space-y-3">
          {materials?.map((m) => (
            <MaterialPriceRow
              key={m.material}
              material={m}
              isSuper={isSuper}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ["admin-material-prices-full"] });
                qc.invalidateQueries({ queryKey: ["admin-material-prices"] });
              }}
            />
          ))}
        </div>
      </div>

      {!isSuper && superCount === 0 && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-warning" />
            <h3 className="font-display font-bold uppercase tracking-wide">No super admin yet</h3>
          </div>
          <p className="text-sm">
            There is no super admin on this platform. Claim the role now to manage commission and roles.
          </p>
          <button
            onClick={claim}
            className="w-full rounded-xl bg-warning text-warning-foreground font-semibold py-3"
          >
            Claim super admin
          </button>
        </div>
      )}

      {isSuper && (
        <div className="rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
          <div>Signed in as: <span className="font-mono">{userId?.slice(0, 8)}</span></div>
          <div>Super admins on platform: {superCount ?? 0}</div>
        </div>
      )}
    </div>
  );
}

function MaterialPriceRow({
  material,
  isSuper,
  onSaved,
}: {
  material: {
    material: string;
    label: string;
    min_price: number | null;
    max_price: number | null;
    enforced: boolean;
    pickup_lat?: number | null;
    pickup_lng?: number | null;
    pickup_label?: string | null;
  };
  isSuper: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [min, setMin] = useState(String(material.min_price ?? 0));
  const [max, setMax] = useState(String(material.max_price ?? 0));
  const [enforced, setEnforced] = useState(material.enforced);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickupLabel, setPickupLabel] = useState(material.pickup_label ?? "");
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(
    material.pickup_lat != null && material.pickup_lng != null
      ? { lat: material.pickup_lat, lng: material.pickup_lng }
      : null,
  );
  const [pickupReason, setPickupReason] = useState("");
  const [savingPickup, setSavingPickup] = useState(false);

  const savePickup = async () => {
    if (!pickupCoords) return toast.error("Pick a location on the map first");
    if (pickupReason.trim().length < 5) {
      return toast.error("Give a reason (at least 5 characters) — it is recorded in the audit log.");
    }
    setSavingPickup(true);
    const { error } = await (supabase.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>)("admin_set_material_pickup", {
      _material: material.material,
      _lat: pickupCoords.lat,
      _lng: pickupCoords.lng,
      _label: pickupLabel.trim() || null,
      _reason: pickupReason.trim(),
    });
    setSavingPickup(false);
    if (error) return toast.error(error.message);
    toast.success(`${material.label} pickup location updated`);
    setPickupReason("");
    onSaved();
  };

  const save = async () => {
    const minV = Number(min);
    const maxV = Number(max);
    if (enforced && (isNaN(minV) || isNaN(maxV) || minV < 0 || maxV <= 0 || minV > maxV)) {
      return toast.error("Min must be ≥ 0, max must be > 0, and min ≤ max.");
    }
    if (reason.trim().length < 5) {
      return toast.error("Give a reason (at least 5 characters) — it is recorded in the admin audit log.");
    }
    setSaving(true);
    const { error } = await (supabase.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>)("admin_set_material_price", {
      _material: material.material,
      _min_price: minV,
      _max_price: maxV,
      _enforced: enforced,
      _reason: reason.trim(),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`${material.label} price updated`);
    setReason("");
    setOpen(false);
    onSaved();
  };

  return (
    <div className="rounded-xl border p-3 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="font-semibold text-sm">{material.label}</span>
        <span className="text-xs text-muted-foreground font-mono">
          {material.enforced
            ? `$${Number(material.min_price ?? 0).toFixed(0)}–$${Number(material.max_price ?? 0).toFixed(0)}`
            : "Not enforced"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 pt-2 border-t">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={enforced}
              onChange={(e) => setEnforced(e.target.checked)}
              disabled={!isSuper}
            />
            Enforce a price range for this material
          </label>
          {enforced && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-muted-foreground">Min ($)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                  disabled={!isSuper}
                  className="w-full px-2 py-1.5 rounded-lg border bg-background text-sm disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Max ($)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                  disabled={!isSuper}
                  className="w-full px-2 py-1.5 rounded-lg border bg-background text-sm disabled:opacity-50"
                />
              </div>
            </div>
          )}
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!isSuper}
            placeholder="Reason (required, recorded in the audit log)"
            className="w-full px-2 py-1.5 rounded-lg border bg-background text-xs disabled:opacity-50"
          />
          <button
            onClick={save}
            disabled={!isSuper || saving}
            className="w-full rounded-lg bg-primary text-primary-foreground font-semibold py-2 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>

          <div className="pt-3 mt-1 border-t space-y-2">
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
              Actual pickup location for {material.label}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Distance/price for this material is calculated from here.{" "}
              {pickupCoords ? "Currently set." : "Not set yet — falls back to the default Harare point."}
            </p>
            <AddressPicker
              value={pickupLabel}
              onChange={(addr, coords) => {
                setPickupLabel(addr);
                if (coords) setPickupCoords(coords);
              }}
            />
            <input
              type="text"
              value={pickupReason}
              onChange={(e) => setPickupReason(e.target.value)}
              disabled={!isSuper}
              placeholder="Reason (required, recorded in the audit log)"
              className="w-full px-2 py-1.5 rounded-lg border bg-background text-xs disabled:opacity-50"
            />
            <button
              onClick={savePickup}
              disabled={!isSuper || savingPickup || !pickupCoords}
              className="w-full rounded-lg border font-semibold py-2 text-sm disabled:opacity-50"
            >
              {savingPickup ? "Saving…" : "Save pickup location"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
