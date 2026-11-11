import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TRUCK_BODY_TYPES } from "@/lib/truck-facts";

export function AddTruckForm({ userId, onSaved }: { userId: string; onSaved: () => void }) {
  const [reg, setReg] = useState("");
  const [cap, setCap] = useState("");
  const [body, setBody] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [colour, setColour] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reg.trim() || !parseFloat(cap)) return toast.error("Enter registration and capacity");
    setSaving(true);
    const { error } = await supabase.from("trucks").insert({
      driver_id: userId,
      registration: reg.trim(),
      capacity_m3: parseFloat(cap),
      // Declared facts (migration 0152); optional, shown to customers as "declared by driver".
      ...({
        body_type: body || null,
        make: make.trim() || null,
        model: model.trim() || null,
        colour: colour.trim() || null,
      } as Record<string, string | null>),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setReg("");
    setCap("");
    setBody("");
    setMake("");
    setModel("");
    setColour("");
    toast.success("Truck added");
    onSaved();
  };
  return (
    <>
      <form onSubmit={submit} className="grid grid-cols-3 gap-2 mt-2">
        <Input
          placeholder="Reg."
          value={reg}
          onChange={(e) => setReg(e.target.value)}
          maxLength={20}
        />
        <Input
          placeholder="m³"
          type="number"
          inputMode="decimal"
          min={1}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
        />
        <select
          aria-label="Truck type"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="col-span-3 h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Truck type (optional)</option>
          {TRUCK_BODY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <Input
          placeholder="Make"
          aria-label="Make"
          value={make}
          onChange={(e) => setMake(e.target.value)}
          maxLength={40}
        />
        <Input
          placeholder="Model"
          aria-label="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          maxLength={40}
        />
        <Input
          placeholder="Colour"
          aria-label="Colour"
          value={colour}
          onChange={(e) => setColour(e.target.value)}
          maxLength={30}
        />
        <Button type="submit" disabled={saving} size="sm" className="col-span-3">
          {saving ? "…" : "Add truck"}
        </Button>
      </form>
      <p className="text-[11px] text-muted-foreground mt-1">
        Truck type, make, model and colour are optional. Customers see them marked "declared by
        driver", so only enter what is true. If you are already approved, adding a truck sends your
        account back for a quick review before you can take more jobs.
      </p>
    </>
  );
}
