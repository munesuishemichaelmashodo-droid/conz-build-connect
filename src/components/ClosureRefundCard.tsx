import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { money } from "@/lib/domain";

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ error: { message: string } | null }>;
type Loose = {
  select: (cols: string) => Loose;
  eq: (col: string, v: string) => Loose;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
};
type Req = {
  id: string;
  status: string;
  purchased_credit_at_request: number;
  promo_forfeited: number;
};

export const CLOSURE_METHODS = [
  ["ecocash", "EcoCash"],
  ["onemoney", "OneMoney"],
  ["innbucks", "InnBucks"],
  ["bank", "Bank account"],
  ["other", "Other"],
] as const;

/**
 * 0194: a driver closing their account can ask for unused PURCHASED Commission Credit back. A super admin sends it
 * outside the app and records the reference; nothing is paid automatically. Promo credit is not refunded.
 * Hidden when there is no purchased credit, or when the database does not have 0194 yet.
 */
export function ClosureRefundCard({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState("ecocash");
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["closure-refund", userId],
    queryFn: async () => {
      const [w, r] = await Promise.all([
        supabase
          .from("wallets")
          .select("balance, promo_balance")
          .eq("user_id", userId)
          .maybeSingle(),
        (supabase as unknown as { from: (t: string) => Loose })
          .from("account_closure_requests")
          .select("id, status, purchased_credit_at_request, promo_forfeited")
          .eq("user_id", userId)
          .eq("status", "requested")
          .maybeSingle(),
      ]);
      if (r.error) return null;
      const wallet = (w.data ?? null) as { balance: number; promo_balance?: number } | null;
      return {
        balance: Number(wallet?.balance ?? 0),
        promo: Number(wallet?.promo_balance ?? 0),
        open: (r.data ?? null) as Req | null,
      };
    },
  });
  const d = q.data;
  if (!d || (d.balance <= 0 && !d.open)) return null;

  const call = async (name: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await (supabase.rpc as unknown as Rpc)(name, args);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(ok);
    qc.invalidateQueries({ queryKey: ["closure-refund", userId] });
  };

  if (d.open) {
    return (
      <div className="rounded-xl border bg-muted/40 p-3 text-xs space-y-2">
        <p>
          You asked to close your account. Con Z will send back your unused purchased Commission
          Credit ({money(d.balance)}) and tell you the transaction reference. Promotional credit is
          not refunded. You cannot send offers until this is finished or cancelled.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            call("cancel_account_closure", { _id: d.open!.id }, "Closure request cancelled")
          }
        >
          Cancel closure request
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-muted/40 p-3 text-xs space-y-2">
      <p>
        You have {money(d.balance)} of unused purchased Commission Credit. If you are closing your
        account, you can ask for it back. Con Z sends it to you outside the app and records the
        reference; after that you can delete your account. Promotional credit
        {d.promo > 0 ? ` (${money(d.promo)})` : ""} has no cash value and is not refunded.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="closure-method" className="text-xs">
            Send it by
          </Label>
          <select
            id="closure-method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm"
          >
            {CLOSURE_METHODS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="closure-dest" className="text-xs">
            Number or account
          </Label>
          <Input
            id="closure-dest"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>
      <Button
        size="sm"
        className="w-full"
        disabled={busy || dest.trim().length < 4}
        onClick={() =>
          call(
            "request_account_closure",
            { _method: method, _destination: dest.trim() },
            "Closure request sent",
          )
        }
      >
        Ask for my unused credit back
      </Button>
    </div>
  );
}
