import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { EmptyState, StatusBadge } from "@/components/ui-bits";
import { ShieldCheck, Undo2, HandCoins, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { money } from "@/lib/domain";
import { useAuth } from "@/lib/auth";
import { PayonifyAdminPanel } from "@/components/payments/PayonifyAdminPanel";
import { isMfaRequiredError, readableRpcError, STEP_UP_ACTION_LABEL, startStepUp } from "@/lib/mfa";

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
      action: { label: STEP_UP_ACTION_LABEL, onClick: () => void startStepUp() },
    });
    return;
  }
  toast.error(readableRpcError(error));
}

function AdminApprovals() {
  const qc = useQueryClient();
  const { userId, is } = useAuth();
  const isSuper = is("super_admin");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- escrow_refunds / admin_credit_requests (0074/0076) are not in the generated Supabase types yet
  const db = supabase as any;

  const { data: refunds } = useQuery({
    queryKey: ["admin-escrow-refunds"],
    enabled: isSuper,
    queryFn: async () => {
      const { data } = await db
        .from("escrow_refunds")
        .select(
          "id,payment_id,job_id,user_id,amount,reason,status,created_at,paynow_refund_reference",
        )
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
        .select(
          "id,requested_by,target_user_id,amount,category,reason,status,created_at,expires_at",
        )
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
    const note =
      window.prompt(
        approve ? "Approval note (optional):" : "Why are you rejecting this request?",
      ) ?? "";
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
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Super admins only"
        hint="Money approvals need a super admin."
      />
    );
  }

  const dueRefunds = (refunds ?? []).filter((r) => r.status === "due");
  const pendingRequests = (requests ?? []).filter((r) => r.status === "pending");

  return (
    <div className="space-y-6">
      <PayonifyAdminPanel canSwitch={isSuper} />
      <section className="space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Undo2 className="w-4 h-4" /> Escrow refunds due ({dueRefunds.length})
        </h2>
        <p className="text-xs text-muted-foreground">
          Refund each payment in the Paynow merchant portal first (Payonify test payments: the
          Payonify dashboard), then record the refund reference here. Nothing is credited to in-app
          wallets.
        </p>
        {(refunds ?? []).length === 0 ? (
          <EmptyState
            icon={Undo2}
            title="No refunds"
            hint="Paid escrow on cancelled or refunded jobs appears here."
          />
        ) : (
          <div className="space-y-2">
            {(refunds ?? []).map((r) => (
              <div
                key={r.id}
                className="rounded-xl border bg-card p-3 flex items-center justify-between gap-3"
              >
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
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <HandCoins className="w-4 h-4" /> Wallet credits awaiting a second super admin (
          {pendingRequests.length})
        </h2>
        {(requests ?? []).length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="No credit requests"
            hint="Large wallet credits need two super admins."
          />
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
                        Requested by {nameOf(r.requested_by)} · {r.category.replace(/_/g, " ")} ·{" "}
                        {r.reason}
                      </div>
                    </div>
                    <StatusBadge label={r.status} />
                  </div>
                  {r.status === "pending" &&
                    (mine ? (
                      <p className="text-xs text-muted-foreground">
                        Another super admin must decide this request.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="sm" onClick={() => decide(r, true)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => decide(r, false)}>
                          Reject
                        </Button>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <PinRecoveryQueue enabled={isSuper} />
    </div>
  );
}

type PinRecoveryRow = {
  id: string;
  user_id: string;
  status: string;
  created_at: string;
  expires_at: string;
  verification_note: string | null;
};

// Forgotten withdrawal PINs (0097). The admin verifies the driver OUTSIDE the app, records how, and
// approves with a fresh second factor; the driver then sets a new PIN. Enforced in the database.
function PinRecoveryQueue({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pin_recovery_requests (0097) is not in the generated Supabase types yet
  const db = supabase as any;
  const { data: rows } = useQuery({
    queryKey: ["admin-pin-recovery"],
    enabled,
    queryFn: async () => {
      const { data } = await db
        .from("pin_recovery_requests")
        .select("id,user_id,status,created_at,expires_at,verification_note")
        .in("status", ["pending", "approved"])
        .order("created_at", { ascending: true })
        .limit(100);
      return (data ?? []) as PinRecoveryRow[];
    },
  });
  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: people } = useQuery({
    queryKey: ["admin-pin-recovery-people", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id,full_name,phone").in("id", ids);
      return new Map((data ?? []).map((p) => [p.id, p]));
    },
  });

  const decide = async (r: PinRecoveryRow, approve: boolean) => {
    const note = (
      window.prompt(
        approve
          ? "How did you verify this driver's identity outside the app? (call, video, ID check — recorded in the audit log)"
          : "Why is the request being rejected? (recorded in the audit log)",
      ) ?? ""
    ).trim();
    if (!note) return;
    if (note.length < 10) return void toast.error("Please write at least 10 characters.");
    const { error } = await db.rpc("admin_decide_pin_recovery", {
      _id: r.id,
      _approve: approve,
      _note: note,
    });
    if (error) return onMoneyError(error);
    toast.success(approve ? "Approved. The driver has 24 hours to set a new PIN." : "Rejected");
    qc.invalidateQueries({ queryKey: ["admin-pin-recovery"] });
  };

  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-sm flex items-center gap-2">
        <KeyRound className="w-4 h-4" /> Withdrawal PIN reset requests (
        {(rows ?? []).filter((r) => r.status === "pending").length})
      </h2>
      {(rows ?? []).length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No open PIN reset requests"
          hint="Drivers who forget their withdrawal PIN appear here."
        />
      ) : (
        <div className="space-y-2">
          {(rows ?? []).map((r) => {
            const person = people?.get(r.user_id);
            return (
              <div key={r.id} className="rounded-xl border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {person?.full_name ?? r.user_id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {person?.phone ?? "no phone on file"} · asked{" "}
                      {new Date(r.created_at).toLocaleString()}
                    </div>
                  </div>
                  <StatusBadge label={r.status} />
                </div>
                {r.status === "pending" ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Verify who this is before approving. Approval needs a Google sign-in from the
                      last 12 hours, and withdrawals pause for 24 hours after the reset.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="sm" onClick={() => decide(r, true)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => decide(r, false)}>
                        Reject
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Approved. Waiting for the driver to set a new PIN (until{" "}
                    {new Date(r.expires_at).toLocaleString()}).
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
