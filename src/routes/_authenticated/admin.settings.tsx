import { createFileRoute, redirect } from "@tanstack/react-router";
import { PriceAccuracyCard } from "@/components/admin/PriceAccuracyCard";
import { LaunchSwitchesCard } from "@/components/admin/LaunchSwitchesCard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Percent, Save, ShieldAlert, Fuel, Package, Truck } from "lucide-react";
import {
  DIESEL_FALLBACK_PER_LITRE,
  FUEL_RANGE,
  MARKUP_RANGE,
  resolveDiesel,
  resolveFuel,
  resolveMarkup,
} from "@/lib/pricing-assumptions";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AddressPicker } from "@/components/AddressPicker";
import { isMfaRequiredError, readableRpcError, STEP_UP_ACTION_LABEL, startStepUp } from "@/lib/mfa";

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

  // What the pricing engine actually uses (0127): the saved value if valid, else its default.
  const { data: engineSettings } = useQuery({
    queryKey: ["diesel-price"],
    queryFn: async () => {
      const { data } = await supabase
        .from("system_settings")
        .select("key,value")
        .in("key", ["diesel_price_per_liter", "fuel_l_per_100km", "long_haul_markup"]);
      const raw = (k: string): unknown =>
        (data ?? []).find((r: { key: string }) => r.key === k)?.value ?? null;
      return {
        diesel: resolveDiesel(raw("diesel_price_per_liter")),
        fuel: resolveFuel(raw("fuel_l_per_100km")),
        markup: resolveMarkup(raw("long_haul_markup")),
      };
    },
  });
  const diesel = engineSettings?.diesel;

  const [dieselValue, setDieselValue] = useState("");
  useEffect(() => {
    if (diesel?.source === "setting") setDieselValue(String(diesel.value));
  }, [diesel?.source, diesel?.value]);
  const [fuelValue, setFuelValue] = useState("");
  const [markupValue, setMarkupValue] = useState("");
  useEffect(() => {
    if (engineSettings) {
      setFuelValue(String(engineSettings.fuel.value));
      setMarkupValue(String(engineSettings.markup.value));
    }
  }, [engineSettings]);

  const { data: materials } = useQuery({
    queryKey: ["admin-material-prices-full"],
    queryFn: async () => {
      const { data } = await (supabase.rpc as unknown as (f: string) => Promise<{ data: unknown }>)("admin_material_prices");
      return (data ?? []) as Array<{
        material: string;
        label: string;
        min_price: number | null;
        max_price: number | null;
        multiplier: number | null;
        enforced: boolean;
        unit: string;
        pickup_lat: number | null;
        pickup_lng: number | null;
        pickup_label: string | null;
      }>;
    },
  });

  const { data: buckets } = useQuery({
    queryKey: ["admin-material-price-buckets"],
    queryFn: async () => {
      const { data } = await (supabase.rpc as unknown as (f: string) => Promise<{ data: unknown }>)(
        "admin_material_price_buckets",
      );
      return (data ?? []) as Array<{
        material: string;
        label: string;
        bucket_m3: number;
        min_price: number;
        max_price: number;
      }>;
    },
  });

  const [multiplierValue, setMultiplierValue] = useState("");
  useEffect(() => {
    if (!materials?.length) return;
    const current = materials.find((m) => m.enforced)?.multiplier;
    if (current != null) setMultiplierValue(String(current));
  }, [materials]);

  const { data: superCount } = useQuery({
    queryKey: ["super-count"],
    queryFn: async () => {
      const { count } = await supabase.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "super_admin");
      return count ?? 0;
    },
  });

  // Price changes need a super admin AND a fresh second factor (database-enforced, 0103).
  const failWithStepUp = (error: { message?: string }) => {
    if (isMfaRequiredError(error)) {
      return toast.error(readableRpcError(error), {
        action: { label: STEP_UP_ACTION_LABEL, onClick: () => void startStepUp() },
      });
    }
    return toast.error(readableRpcError(error));
  };

  const saveDiesel = async () => {
    const v = Number(dieselValue);
    if (isNaN(v) || v <= 0 || v > 100) return toast.error("Diesel price must be between 0 and 100");
    const { error } = await supabase.rpc("admin_set_diesel_price", { _price: v });
    if (error) return failWithStepUp(error);
    toast.success(`Diesel price set to $${v.toFixed(2)}/liter`);
    qc.invalidateQueries({ queryKey: ["diesel-price"] });
  };

  const saveFuelAssumptions = async () => {
    const fuel = Number(fuelValue);
    const markup = Number(markupValue);
    if (!Number.isFinite(fuel) || fuel < FUEL_RANGE.min || fuel > FUEL_RANGE.max)
      return toast.error(`Fuel use must be between ${FUEL_RANGE.min} and ${FUEL_RANGE.max} L per 100 km`);
    if (!Number.isFinite(markup) || markup < MARKUP_RANGE.min || markup > MARKUP_RANGE.max)
      return toast.error(`The long-haul allowance must be between ${MARKUP_RANGE.min} and ${MARKUP_RANGE.max}`);
    const reason =
      window.prompt('Why are the fuel figures changing? e.g. "measured 34 L/100 km on loaded HOWO tippers" (recorded in the audit log)') ??
      undefined;
    if (!reason?.trim() || reason.trim().length < 5) return toast.error("Give a reason (at least 5 characters)");
    // 0127's RPC is not in the generated types yet.
    const { error } = await (supabase.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => PromiseLike<{ error: { message: string } | null }>)("admin_set_fuel_assumptions", {
      _fuel_l_per_100km: fuel,
      _long_haul_markup: markup,
      _reason: reason.trim(),
    });
    if (error) return failWithStepUp(error);
    toast.success(`Fuel use ${fuel} L/100 km, long-haul allowance ${markup} saved`);
    qc.invalidateQueries({ queryKey: ["diesel-price"] });
  };

  const saveMultiplier = async () => {
    const v = Number(multiplierValue);
    if (isNaN(v) || v <= 0 || v > 3.0) return toast.error("Multiplier must be between 0 and 3.0");
    const reason = window.prompt('Why is the price multiplier changing? e.g. "material costs up 8%" (recorded in the audit log)') ?? undefined;
    if (!reason?.trim() || reason.trim().length < 5) return toast.error("Give a reason (at least 5 characters)");
    const { error } = await supabase.rpc("admin_set_demand_multiplier", {
      _multiplier: v,
      _reason: reason.trim(),
    });
    if (error) return failWithStepUp(error);
    toast.success(`Price multiplier set to ${v.toFixed(2)}`);
    qc.invalidateQueries({ queryKey: ["admin-material-prices-full"] });
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
          <Fuel className="w-5 h-5 text-cz-amber-text" />
          <h3 className="font-display font-bold text-lg">Diesel price</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Price per liter, used to calculate long-distance transport cost.
        </p>
        {diesel && (
          <p className="text-sm">
            {diesel.source === "setting"
              ? `Pricing uses the saved price, $${diesel.value.toFixed(2)}/L.`
              : `No valid price is saved, so pricing uses the standard figure of $${DIESEL_FALLBACK_PER_LITRE.toFixed(2)}/L.`}
          </p>
        )}
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-2xl text-muted-foreground">$</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            value={dieselValue}
            onChange={(e) => setDieselValue(e.target.value)}
            disabled={!isSuper}
            aria-label="Diesel price per litre (USD)"
            className="flex-1 px-3 py-2.5 rounded-xl border bg-background text-lg font-display font-bold disabled:opacity-50"
          />
          <span className="text-sm text-muted-foreground">/ liter</span>
        </div>
        <button
          onClick={saveDiesel}
          disabled={!isSuper}
          className="w-full min-h-12 rounded-xl border-[1.5px] border-input bg-card text-foreground font-semibold hover:bg-muted disabled:opacity-50"
        >
          <Save className="w-4 h-4 inline mr-1" /> Save diesel price
        </button>
        {!isSuper && (
          <p className="text-xs text-muted-foreground text-center">Only super admins can change the diesel price.</p>
        )}
      </div>

      <LaunchSwitchesCard isSuper={isSuper} />

      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5 text-cz-amber-text" />
          <h3 className="font-display font-bold text-lg">Fuel use and long trips</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Used for deliveries over 50 km and for drivers' fuel estimates. The long-haul allowance covers driving
          back empty (2.0 = the full return trip).
        </p>
        {engineSettings && (
          <p className="text-sm">
            Pricing uses {engineSettings.fuel.value} L per 100 km
            {engineSettings.fuel.source === "default" ? " (standard figure)" : ""} and an allowance of{" "}
            {engineSettings.markup.value}
            {engineSettings.markup.source === "default" ? " (standard figure)" : ""}.
          </p>
        )}
        <label className="block text-sm font-medium">
          Fuel use (litres per 100 km, {FUEL_RANGE.min}–{FUEL_RANGE.max})
          <input
            type="number"
            min={FUEL_RANGE.min}
            max={FUEL_RANGE.max}
            step={0.5}
            value={fuelValue}
            onChange={(e) => setFuelValue(e.target.value)}
            disabled={!isSuper}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border bg-background text-lg font-display font-bold disabled:opacity-50"
          />
        </label>
        <label className="block text-sm font-medium">
          Long-haul allowance ({MARKUP_RANGE.min}–{MARKUP_RANGE.max})
          <input
            type="number"
            min={MARKUP_RANGE.min}
            max={MARKUP_RANGE.max}
            step={0.01}
            value={markupValue}
            onChange={(e) => setMarkupValue(e.target.value)}
            disabled={!isSuper}
            className="mt-1 w-full px-3 py-2.5 rounded-xl border bg-background text-lg font-display font-bold disabled:opacity-50"
          />
        </label>
        <button
          onClick={saveFuelAssumptions}
          disabled={!isSuper}
          className="w-full min-h-12 rounded-xl border-[1.5px] border-input bg-card text-foreground font-semibold hover:bg-muted disabled:opacity-50"
        >
          <Save className="w-4 h-4 inline mr-1" /> Save fuel figures
        </button>
        {!isSuper && (
          <p className="text-xs text-muted-foreground text-center">Only super admins can change these.</p>
        )}
      </div>

      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Percent className="w-5 h-5 text-cz-amber-text" />
          <h3 className="font-display font-bold text-lg">Price multiplier</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Moves every enforced material's cost at once, separate from diesel price. 1.00 = no change, 1.08 = +8%.
        </p>
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-2xl text-muted-foreground">×</span>
          <input
            type="number"
            min={0.1}
            max={3.0}
            step={0.01}
            value={multiplierValue}
            onChange={(e) => setMultiplierValue(e.target.value)}
            disabled={!isSuper}
            aria-label="Price multiplier"
            className="flex-1 px-3 py-2.5 rounded-xl border bg-background text-lg font-display font-bold disabled:opacity-50"
          />
        </div>
        <button
          onClick={saveMultiplier}
          disabled={!isSuper}
          className="w-full min-h-12 rounded-xl border-[1.5px] border-input bg-card text-foreground font-semibold hover:bg-muted disabled:opacity-50"
        >
          <Save className="w-4 h-4 inline mr-1" /> Apply multiplier
        </button>
        {!isSuper && (
          <p className="text-xs text-muted-foreground text-center">Only super admins can change the price multiplier.</p>
        )}
      </div>

      <PriceAccuracyCard />

      <div className="rounded-2xl border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-cz-amber-text" />
          <h3 className="font-display font-bold text-lg">Material prices</h3>
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
              buckets={(buckets ?? []).filter((b) => b.material === m.material)}
              isSuper={isSuper}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ["admin-material-prices-full"] });
                qc.invalidateQueries({ queryKey: ["admin-material-prices"] });
                qc.invalidateQueries({ queryKey: ["admin-material-price-buckets"] });
              }}
            />
          ))}
        </div>
      </div>

      {!isSuper && superCount === 0 && (
        <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-warning" />
            <h3 className="font-display font-bold">No super admin yet</h3>
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
  buckets,
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
  buckets: Array<{ bucket_m3: number; min_price: number; max_price: number }>;
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
    if (error) {
      // 0124: price changes need a super admin with a recent Google sign-in.
      return isMfaRequiredError(error)
        ? toast.error(readableRpcError(error), {
            action: { label: STEP_UP_ACTION_LABEL, onClick: () => void startStepUp() },
          })
        : toast.error(readableRpcError(error));
    }
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
            className="min-h-11 w-full rounded-lg bg-primary text-primary-foreground font-semibold py-2 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>

          <div className="pt-3 mt-1 border-t space-y-2">
            <div className="text-xs text-muted-foreground font-semibold">
              Price by load size for {material.label}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Separate min/max per truck load size. This is what actually drives job pricing and budget
              enforcement — the range above is a fallback only.
            </p>
            <div className="space-y-2">
              {[10, 12, 15, 20].map((bucketM3) => {
                const existing = buckets.find((b) => b.bucket_m3 === bucketM3);
                return (
                  <BucketPriceRow
                    key={bucketM3}
                    materialId={material.material}
                    materialLabel={material.label}
                    bucketM3={bucketM3}
                    minPrice={existing?.min_price ?? null}
                    maxPrice={existing?.max_price ?? null}
                    isSuper={isSuper}
                    onSaved={onSaved}
                  />
                );
              })}
            </div>
          </div>

          <div className="pt-3 mt-1 border-t space-y-2">
            <div className="text-xs text-muted-foreground font-semibold">
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
              className="min-h-11 w-full rounded-lg border font-semibold py-2 text-sm disabled:opacity-50"
            >
              {savingPickup ? "Saving…" : "Save pickup location"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BucketPriceRow({
  materialId,
  materialLabel,
  bucketM3,
  minPrice,
  maxPrice,
  isSuper,
  onSaved,
}: {
  materialId: string;
  materialLabel: string;
  bucketM3: number;
  minPrice: number | null;
  maxPrice: number | null;
  isSuper: boolean;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [min, setMin] = useState(String(minPrice ?? ""));
  const [max, setMax] = useState(String(maxPrice ?? ""));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMin(String(minPrice ?? ""));
    setMax(String(maxPrice ?? ""));
  }, [minPrice, maxPrice]);

  const save = async () => {
    const minV = Number(min);
    const maxV = Number(max);
    if (isNaN(minV) || isNaN(maxV) || minV < 0 || maxV < minV) {
      return toast.error("Min must be ≥ 0, max must be ≥ min.");
    }
    if (reason.trim().length < 5) {
      return toast.error("Give a reason (at least 5 characters) — it is recorded in the admin audit log.");
    }
    setSaving(true);
    const { error } = await (supabase.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>)("admin_set_material_bucket_price", {
      _material: materialId,
      _bucket_m3: bucketM3,
      _min_price: minV,
      _max_price: maxV,
      _reason: reason.trim(),
    });
    setSaving(false);
    if (error) {
      // 0124: price changes need a super admin with a recent Google sign-in.
      return isMfaRequiredError(error)
        ? toast.error(readableRpcError(error), {
            action: { label: STEP_UP_ACTION_LABEL, onClick: () => void startStepUp() },
          })
        : toast.error(readableRpcError(error));
    }
    toast.success(`${materialLabel} — ${bucketM3}m³ price updated`);
    setReason("");
    setOpen(false);
    onSaved();
  };

  const hasPrice = minPrice != null && maxPrice != null;

  return (
    <div className="rounded-lg border bg-background/50 p-2 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <span className="text-xs font-semibold">{bucketM3} m³ load</span>
        <span className="text-xs text-muted-foreground font-mono">
          {hasPrice ? `$${Number(minPrice).toFixed(0)}–$${Number(maxPrice).toFixed(0)}` : "Not set"}
        </span>
      </button>
      {open && (
        <div className="space-y-2 pt-2 border-t">
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
            className="min-h-11 w-full rounded-lg bg-primary text-primary-foreground font-semibold py-2 text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : `Save ${bucketM3}m³ price`}
          </button>
        </div>
      )}
    </div>
  );
}
