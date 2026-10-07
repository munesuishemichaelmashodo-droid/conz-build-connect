import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { EmptyState, StatusBadge } from "@/components/ui-bits";
import { ShieldCheck, Undo2, HandCoins } from "lucide-react";
import { toast } from "sonner";
import { money } from "@/lib/domain";
import { useAuth } from "@/lib/auth";
import { isMfaRequiredError, mfaVerifyHref, readableRpcError } from "@/lib/mfa";

// Super-admin work queues for money that needs a human (audit F2 / F5):
//  * escrow refunds: paid Con Z Pay escrow on cancelled / expired / refunded
//    jobs. Refund in the Paynow merchant portal first, then confirm here.
//  * wallet credits above the second-approval threshold, requested by
//    another super admin.
// Every action is enforced server-side (super_admin + MFA + no self-dealing).

export const Route = createFileRoute("/_authenticated/admin/approvals")({
  component: AdminApprovals,
});

type RefundRow = {
  id: string;
  payment_id: string;
  job_id: string | null;
  user_id: string;
  amount: number;
  reason: string;
  status: string;
  created_at: string;
  paynow_refund_reference: string | null;
};

type CreditRequestRow = {
  id: string;
  requested_by: string;
  target_user_id: string;
  amount: number;
  category: string;
  reason: string;
  status: string;
  created_at: string;
  expires_at: string;
};

function onMoneyError(error: { message?: string }) {
  if (isMfaRequiredError(error)) {
    toast.error(readableRpcError(error), {
      action: { label: "Verify", onClick: () => window.location.assign(mfaVerifyHref()) },
    });
    return;
  }
  toast.error(readableRpcError(error));
}

function AdminApprovals() {
  const qc = useQueryClient();
  const { userId, is } = useAuth();
  const isSuper = is("super_admin");
  const db = supabase as any;

  const { data: refunds } = useQuery({
    queryKey: ["admin-escrow-refunds"],
    enabled: isSuper,
    queryFn: async () => {
      const { data } = await db
        .from("escrow_refunds")
        .select("id,payment_id,job_id,user_id,amount,reason,status,created_at,paynow_refund_reference")
        .order("created_at", { ascending: false })
        .limit(100);
      return (data ?? []) as RefundRow[];
    },
  });

  const { data: requests } = useQuery({
    queryKey: ["admin-credit-requests"],
    enabled: isSuper,
    queryFn: async () => {
      const { data } = await db
        .from("admin_credit_requests")
        .select("id,requested_by,target_user_id,amount,category,reason,status,created_at,expires_at")
        .order("created_at", { ascending: false })
        .limit(100);
      return (data ?? []) as CreditRequestRow[];
    },
  });

  const ids = Array.from(
    new Set([
      ...(refunds ?? []).map((r) => r.user_id),
      ...(requests ?? []).flatMap((r) => [r.requested_by, r.target_user_id]),
    ]),
  );
  const { data: names } = useQuery({
    queryKey: ["admin-approval-names", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id,full_name").in("id", ids);
      return new Map((data ?? []).map((p) => [p.id, p.full_name]));
    },
  });
  const nameOf = (id: string) => names?.get(id) ?? id.slice(0, 8);

  const markRefunded = async (r: RefundRow) => {
    const ref = window.prompt(
      `Confirm you have refunded ${money(Number(r.amount))} to ${nameOf(r.user_id)} in the Paynow merchant portal.\n\nPaynow refund reference:`,
    );
    if (!ref?.trim()) return;
    const { error } = await db.rpc("admin_mark_escrow_refunded", {
      _payment_id: r.payment_id,
      _paynow_refund_reference: ref.trim(),
      _note: null,
    });
    if (error) return onMoneyError(error);
    toast.success("Refund recorded — the customer has been notified");
    qc.invalidateQueries({ queryKey: ["admin-escrow-refunds"] });
  };

  const decide = async (r: CreditRequestRow, approve: boolean) => {
    const note = window.prompt(approve ? "Approval note (optional):" : "Why are you rejecting this request?") ?? "";
    if (!approve && !note.trim()) return;
    const { error } = await db.rpc("admin_decide_wallet_credit", {
      _request_id: r.id,
      _approve: approve,
      _note: note.trim() || null,
    });
    if (error) return onMoneyError(error);
    toast.success(approve ? "Credit approved and applied" : "Credit request rejected");
    qc.invalidateQueries({ queryKey: ["admin-credit-requests"] });
  };

  if (!isSuper) {
    return <EmptyState icon={ShieldCheck} title="Super admins only" hint="Money approvals need a super admin." />;
  }

  const dueRefunds = (refunds ?? []).filter((r) => r.status === "due");
  const pendingRequests = (requests ?? []).filter((r) => r.status === "pending");

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-display font-bold uppercase tracking-wide text-sm flex items-center gap-2">
          <Undo2 className="w-4 h-4" /> Escrow refunds due ({dueRefunds.length})
        </h2>
        <p className="text-xs text-muted-foreground">
          Refund each payment in the Paynow merchant portal first, then record the Paynow refund reference here.
          Nothing is credited to in-app wallets.
        </p>
        {(refunds ?? []).length === 0 ? (
          <EmptyState icon={Undo2} title="No refunds" hint="Paid escrow on cancelled or refunded jobs appears here." />
        ) : (
          <div className="space-y-2">
            {(refunds ?? []).map((r) => (
              <div key={r.id} className="rounded-xl border bg-card p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {money(Number(r.amount))} · {nameOf(r.user_id)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.reason.replace(/_/g, " ")} · {new Date(r.created_at).toLocaleString()}
                    {r.paynow_refund_reference ? ` · ref ${r.paynow_refund_reference}` : ""}
                  </div>
                </div>
                {r.status === "due" ? (
                  <Button size="sm" onClick={() => markRefunded(r)}>
                    Mark refunded
                  </Button>
                ) : (
                  <StatusBadge label={r.status} />
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display font-bold uppercase tracking-wide text-sm flex items-center gap-2">
          <HandCoins className="w-4 h-4" /> Wallet credits awaiting a second super admin ({pendingRequests.length})
        </h2>
        {(requests ?? []).length === 0 ? (
          <EmptyState icon={HandCoins} title="No credit requests" hint="Large wallet credits need two super admins." />
        ) : (
          <div className="space-y-2">
            {(requests ?? []).map((r) => {
              const mine = r.requested_by === userId || r.target_user_id === userId;
              return (
                <div key={r.id} className="rounded-xl border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">
                        {money(Number(r.amount))} → {nameOf(r.target_user_id)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Requested by {nameOf(r.requested_by)} · {r.category.replace(/_/g, " ")} · {r.reason}
                      </div>
                    </div>
                    <StatusBadge label={r.status} />
                  </div>
                  {r.status === "pending" && (
                    mine ? (
                      <p className="text-xs text-muted-foreground">Another super admin must decide this request.</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" onClick={() => decide(r, true)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => decide(r, false)}>
                          Reject
                        </Button>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
