import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, Info } from "lucide-react";
import { MATERIALS, type MaterialCategory, money } from "@/lib/domain";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type Price = { material: MaterialCategory; label: string; min_price: number; max_price: number; unit: string; enforced: boolean };

export const Route = createFileRoute("/_authenticated/jobs/new")({
  component: NewJob,
});

function NewJob() {
  const { userId, is } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [material, setMaterial] = useState<MaterialCategory>("river_sand");
  const [customMaterial, setCustomMaterial] = useState("");
  const [quantity, setQuantity] = useState("");
  const [address, setAddress] = useState("");
  const [budget, setBudget] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: prices } = useQuery({
    queryKey: ["material-prices"],
    queryFn: async () => {
      const { data } = await (supabase.from("material_prices") as any).select("*").order("label");
      return (data ?? []) as Price[];
    },
  });

  const current = useMemo(() => prices?.find((p) => p.material === material), [prices, material]);
  const showRange = current && current.enforced;

  if (!is("customer")) {
    return <AppShell title="Post a job"><div className="text-center py-10 space-y-3"><p className="text-muted-foreground">Only customer accounts can post jobs.</p><Button asChild variant="outline"><Link to="/profile">Go to profile</Link></Button></div></AppShell>;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(quantity);
    const bgt = parseFloat(budget);
    if (!qty || qty <= 0) return toast.error("Enter a valid quantity");
    if (!bgt || bgt <= 0) return toast.error("Enter a valid budget");
    if (!address.trim()) return toast.error("Enter delivery address");
    if (material === "custom" && !customMaterial.trim()) return toast.error("Describe the custom material");
    if (showRange && (bgt < current!.min_price || bgt > current!.max_price)) {
      return toast.error(`Budget must be between ${money(current!.min_price)} and ${money(current!.max_price)} for ${current!.label}`);
    }

    setLoading(true);
    const { data, error } = await supabase.from("jobs").insert({
      customer_id: userId!,
      material,
      custom_material: material === "custom" ? customMaterial.trim() : null,
      quantity_m3: qty,
      delivery_address: address.trim(),
      budget: bgt,
      preferred_date: date || null,
      notes: notes.trim() || null,
    }).select().single();
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Job posted! Drivers will start bidding.");
    qc.invalidateQueries({ queryKey: ["jobs-list"] });
    qc.invalidateQueries({ queryKey: ["home-jobs"] });
    nav({ to: "/jobs/$id", params: { id: data.id } });
  };

  return (
    <AppShell title="Post a job">
      <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4"><ArrowLeft className="w-4 h-4" /> Back</Link>

      {prices && prices.some((p) => p.enforced) && (
        <div className="rounded-2xl border bg-muted/30 p-4 mb-4">
          <div className="flex items-center gap-2 font-display font-bold uppercase text-xs tracking-wide mb-2">
            <Info className="w-3.5 h-3.5 text-primary" /> Price guide · {prices.find((p) => p.enforced)?.unit}
          </div>
          <div className="space-y-1 text-xs">
            {prices.filter((p) => p.enforced).map((p) => (
              <div key={p.material} className="flex justify-between">
                <span className="text-muted-foreground">{p.label}</span>
                <span className="font-semibold">{money(p.min_price)} – {money(p.max_price)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <Label>Material</Label>
          <Select value={material} onValueChange={(v) => setMaterial(v as MaterialCategory)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MATERIALS.map((m) => <SelectItem key={m.value} value={m.value}>{m.group} — {m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {material === "custom" && (
          <div>
            <Label htmlFor="cm">Describe material</Label>
            <Input id="cm" value={customMaterial} onChange={(e) => setCustomMaterial(e.target.value)} maxLength={120} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="qty">Quantity (m³)</Label>
            <Input id="qty" type="number" inputMode="decimal" min={0.1} step={0.1} value={quantity} onChange={(e) => setQuantity(e.target.value)} required placeholder="10 – 15" />
          </div>
          <div>
            <Label htmlFor="bgt">Budget ($)</Label>
            <Input
              id="bgt"
              type="number"
              inputMode="decimal"
              min={showRange ? current!.min_price : 1}
              max={showRange ? current!.max_price : undefined}
              step={1}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              required
              placeholder={showRange ? `${current!.min_price} – ${current!.max_price}` : undefined}
            />
            {showRange && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Allowed: {money(current!.min_price)} – {money(current!.max_price)}
              </p>
            )}
          </div>
        </div>
        <div>
          <Label htmlFor="addr">Delivery address</Label>
          <Input id="addr" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} required placeholder="e.g. 12 Sam Levy Dr, Borrowdale" />
        </div>
        <div>
          <Label htmlFor="date">Preferred delivery date</Label>
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} maxLength={500} />
        </div>
        <Button type="submit" disabled={loading} className="w-full h-11 font-display uppercase tracking-wide">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Post job"}
        </Button>
      </form>
    </AppShell>
  );
}
