import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function AddTruckForm({ userId, onSaved }: { userId: string; onSaved: () => void }) {
  const [reg, setReg] = useState("");
  const [cap, setCap] = useState("");
  const [saving, setSaving] = useState(false);
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
