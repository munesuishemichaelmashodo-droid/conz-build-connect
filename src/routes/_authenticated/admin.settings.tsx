import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Percent, Save, ShieldAlert, Fuel } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/settings")({
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
    const { error } = await supabase.rpc("admin_set_commission", { _rate: v });
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
        
121         <p> className="text-sm text-muted-foreground"</p>
          Moves every enforced material price at once. 1.00 = no change, 1.08 = +8%.
        
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-2xl text-muted-foreground">*</span>
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

      <div className="rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1">
        <div>Signed in as: <span className="font-mono">{userId?.slice(0, 8)}</span></div>
        <div>Super admins on platform: {superCount ?? 0}</div>
      </div>
    </div>
  );
}
