import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isMfaRequiredError, readableRpcError, STEP_UP_ACTION_LABEL, startStepUp } from "@/lib/mfa";

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ error: { message: string } | null }>;

/**
 * 0185: settle "I joined with X's invitation" (super admin, fresh step-up, reason, audited). Only for a new account
 * whose referral is not recognised yet; the referral then starts again and qualifies through the normal rules.
 * It cannot recognise, qualify or pay anything.
 */
export function ReferralAttributionForm() {
  const qc = useQueryClient();
  const [account, setAccount] = useState("");
  const [code, setCode] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ok =
    /^[0-9a-f-]{36}$/i.test(account.trim()) &&
    code.trim().length >= 4 &&
    reason.trim().length >= 10;

  const submit = async () => {
    setBusy(true);
    const { error } = await (supabase.rpc as unknown as Rpc)("admin_set_referral_attribution", {
      _referred_id: account.trim(),
      _referrer_code: code.trim().toUpperCase(),
      _reason: reason.trim(),
    });
    setBusy(false);
    if (error) {
      if (isMfaRequiredError(error)) {
        return toast.error("Confirm it's you first.", {
          action: { label: STEP_UP_ACTION_LABEL, onClick: () => void startStepUp() },
        });
      }
      return toast.error(readableRpcError(error));
    }
    toast.success("Referral recorded. It qualifies through the normal rules.");
    setAccount("");
    setCode("");
    setReason("");
    qc.invalidateQueries({ queryKey: ["admin-referrals"] });
    qc.invalidateQueries({ queryKey: ["admin-referral-stats"] });
  };

  return (
    <details
      className="rounded-xl border bg-card p-3 text-sm"
      data-testid="referral-attribution-form"
    >
      <summary className="cursor-pointer font-semibold">Correct who invited a new account</summary>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-muted-foreground">
          For a new account (under 14 days, no completed job) whose invitation was missed or
          recorded against the wrong person. A counted referral cannot be moved. The change is
          logged with your reason, and it does not count the referral: it still has to meet the
          normal rules.
        </p>
        <div>
          <Label htmlFor="ref-account" className="text-xs">
            Account ID of the person who joined
          </Label>
          <Input
            id="ref-account"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="ref-code" className="text-xs">
            Invitation code of the person who invited them
          </Label>
          <Input
            id="ref-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="ref-reason" className="text-xs">
            Reason (kept in the audit log; at least 10 characters)
          </Label>
          <Input
            id="ref-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1"
          />
        </div>
        <Button size="sm" disabled={!ok || busy} onClick={submit}>
          Record the invitation
        </Button>
      </div>
    </details>
  );
}
