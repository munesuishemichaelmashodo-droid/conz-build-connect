import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/domain";
import { payoutStatusLabel, type PayoutStatus } from "@/lib/payout-status";

type Payout = {
  id: string;
  job_id: string;
  amount: number;
  status: PayoutStatus;
  ecocash_number: string | null;
  failure_message: string | null;
  created_at: string;
};

// Loosely typed: these columns and the RPC arrive with 0121 (types.ts is regenerated from live).
type Db = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (
        k: string,
        v: string,
      ) => {
        maybeSingle: () => PromiseLike<{ data: Record<string, unknown> | null }>;
        order: (
          c: string,
          o: { ascending: boolean },
        ) => { limit: (n: number) => PromiseLike<{ data: Payout[] | null; error: unknown }> };
      };
    };
  };
  rpc: (
    f: string,
    a: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
const db = supabase as unknown as Db;

const last4 = (n: string | null | undefined) => (n ? `•••• ${n.slice(-4)}` : null);

/**
 * Con Z Pay earnings are sent to the driver's EcoCash automatically when the customer confirms
 * delivery (0121). Here the driver sets the number and sees each payout.
 */
export function DriverPayoutsCard({ userId, hasPin }: { userId: string; hasPin: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState("");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: current } = useQuery({
    queryKey: ["payout-number", userId],
    queryFn: async () => {
      const { data } = await db
        .from("driver_profiles")
        .select("payout_ecocash_number")
        .eq("user_id", userId)
        .maybeSingle();
      return (data?.payout_ecocash_number as string | null | undefined) ?? null;
    },
  });
  const { data: payouts } = useQuery({
    queryKey: ["driver-payouts", userId],
    queryFn: async () => {
      const { data, error } = await db
        .from("driver_payouts")
        .select("id,job_id,amount,status,ecocash_number,failure_message,created_at")
        .eq("driver_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);
      return error ? [] : (data ?? []);
    },
    refetchInterval: (q) =>
      (q.state.data ?? []).some((p) => ["queued", "sending", "sent"].includes(p.status))
        ? 15_000
        : false,
  });

  const save = async () => {
    setSaving(true);
    const { data, error } = await db.rpc("set_payout_ecocash_number", {
      _number: number,
      _pin: hasPin ? pin : null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    if (data === "wrong_pin") return toast.error("Wrong withdrawal PIN.");
    if (data === "pin_locked") return toast.error("Too many wrong PIN attempts. Try again later.");
    toast.success("Payout number saved.");
    setOpen(false);
    setPin("");
    void qc.invalidateQueries({ queryKey: ["payout-number", userId] });
    void qc.invalidateQueries({ queryKey: ["driver-payouts", userId] });
    void qc.invalidateQueries({ queryKey: ["wallet"] });
  };

  return (
    <section className="mt-5 rounded-2xl border bg-card p-4" aria-labelledby="payouts-title">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="payouts-title" className="font-semibold">
            Con Z Pay earnings
          </h2>
          <p className="text-sm text-muted-foreground">
            {current
              ? `Sent automatically to EcoCash ${last4(current)} when the customer confirms delivery.`
              : "Add your EcoCash number and we'll send your Con Z Pay earnings automatically when the customer confirms delivery."}
          </p>
        </div>
        <Button
          size="sm"
          variant={current ? "outline" : "default"}
          onClick={() => {
            setNumber(current ? `0${current}` : "");
            setOpen(true);
          }}
        >
          {current ? "Change" : "Add number"}
        </Button>
      </div>

      {(payouts ?? []).length > 0 && (
        <ul className="mt-4 divide-y text-sm">
          {(payouts ?? []).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block font-medium">{payoutStatusLabel(p.status)}</span>
                <span className="block text-xs text-muted-foreground">
                  {new Date(p.created_at).toLocaleString()}
                  {p.ecocash_number ? ` · ${last4(p.ecocash_number)}` : ""}
                  {p.status === "returned" && p.failure_message ? ` · ${p.failure_message}` : ""}
                </span>
              </span>
              <span className="font-display font-bold">{money(Number(p.amount))}</span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>EcoCash payout number</DialogTitle>
            <DialogDescription>
              Your Con Z Pay earnings go to this number. Check it carefully: money sent to a wrong
              number can't be pulled back by ConZ.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="payout-number">EcoCash number</Label>
              <Input
                id="payout-number"
                inputMode="tel"
                autoComplete="tel"
                placeholder="0771 234 567"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
            {hasPin && (
              <div>
                <Label htmlFor="payout-pin">Withdrawal PIN</Label>
                <Input
                  id="payout-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={save}
              disabled={saving || number.trim().length < 9 || (hasPin && !pin)}
            >
              {saving ? "Saving…" : "Save number"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
