import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parsePolicy } from "@/lib/admin-authenticator";
import {
  hasVerifiedAuthenticator,
  isMfaRequiredError,
  readableRpcError,
  STEP_UP_ACTION_LABEL,
  startStepUp,
} from "@/lib/mfa";

type Row = {
  user_id: string;
  full_name: string;
  is_owner: boolean;
  has_authenticator: boolean;
  since: string | null;
};
type Rpc = (
  f: string,
  a?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
// 0166/0169 functions are newer than the generated types. Called through `supabase.rpc(...)` in place
// (never a detached reference) so the client keeps its `this`.
const rpc: Rpc = (f, a) => (supabase.rpc as unknown as Rpc)(f, a);

/**
 * Optional authenticator app for an admin account (0166). Set up: money and role actions on
 * this account then need the app's code. Owners also see who is protected and can reset
 * another admin's authenticator when a phone is lost. Everything is enforced in the database.
 */
export function AuthenticatorCard({
  isSuper,
  userId,
}: {
  isSuper: boolean;
  userId: string | null;
}) {
  const qc = useQueryClient();
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const mine = useQuery({
    queryKey: ["my-authenticator"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return hasVerifiedAuthenticator(data as { totp?: { status?: string }[] });
    },
  });

  const overview = useQuery({
    queryKey: ["admin-authenticator-overview"],
    enabled: isSuper,
    queryFn: async () => {
      const { data, error } = await rpc("admin_authenticator_overview");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  const policy = useQuery({
    queryKey: ["admin-authenticator-policy"],
    retry: false,
    queryFn: async () => {
      const { data, error } = await rpc("admin_authenticator_policy");
      if (error) return null;
      return parsePolicy(data);
    },
  });
  const required = policy.data?.required === true;

  const setRequired = async (next: boolean) => {
    if (reason.trim().length < 5)
      return void toast.error("Write a short reason (5 letters or more)");
    setBusy(true);
    const { error } = await rpc("admin_set_authenticator_required", {
      _required: next,
      _reason: reason.trim(),
    });
    setBusy(false);
    if (error) {
      return void toast.error(
        readableRpcError(error),
        isMfaRequiredError(error)
          ? { action: { label: STEP_UP_ACTION_LABEL, onClick: () => void startStepUp() } }
          : undefined,
      );
    }
    toast.success(
      next ? "Authenticator is now required for money and role changes" : "Switched off",
    );
    setReason("");
    void qc.invalidateQueries({ queryKey: ["admin-authenticator-policy"] });
  };

  const reset = async (target: string) => {
    if (reason.trim().length < 5)
      return void toast.error("Write a short reason (5 letters or more)");
    setBusy(true);
    const { error } = await rpc("owner_reset_authenticator", {
      _target: target,
      _reason: reason.trim(),
    });
    setBusy(false);
    if (error) {
      return void toast.error(
        readableRpcError(error),
        isMfaRequiredError(error)
          ? { action: { label: STEP_UP_ACTION_LABEL, onClick: () => void startStepUp() } }
          : undefined,
      );
    }
    toast.success("Authenticator reset. They can set it up again.");
    setResetFor(null);
    setReason("");
    void qc.invalidateQueries({ queryKey: ["admin-authenticator-overview"] });
  };

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3" aria-labelledby="authenticator-h">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-cz-amber-text" aria-hidden="true" />
        <h3 id="authenticator-h" className="font-semibold">
          Authenticator app
        </h3>
      </div>

      {mine.isLoading ? (
        <p className="text-sm text-muted-foreground">Checking…</p>
      ) : mine.isError ? (
        <p className="text-sm text-muted-foreground">
          Could not check your authenticator. Try again later.
        </p>
      ) : mine.data ? (
        <p className="text-sm">
          <span className="font-medium">On for your account.</span>{" "}
          <span className="text-muted-foreground">
            Money and role actions ask for a fresh code from your app each time, and the app is
            checked at least every 30 days. Lost your phone? Ask the other owner to reset it here.
          </span>
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Money and role actions on your account then need a fresh code from an app on your phone,
            and the app is checked at least every 30 days. Signing in with Google alone will no
            longer be enough for your account.
          </p>
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <a href="/mfa?next=%2Fadmin%2Fsettings">Set up authenticator app</a>
          </Button>
        </div>
      )}

      {isSuper && policy.data && (
        <div className="pt-2 border-t space-y-2">
          <p className="text-sm">
            <span className="font-medium">
              {required ? "Required for every admin." : "Not required yet."}
            </span>{" "}
            <span className="text-muted-foreground">
              {required
                ? "Money and role changes are refused without an authenticator code, even after a Google sign-in."
                : "Switch it on once every admin who handles money has set up their app. You need your own app set up first."}
            </span>
          </p>
          <label htmlFor="auth-required-reason" className="text-xs text-muted-foreground">
            Reason for changing this
          </label>
          <Input
            id="auth-required-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
          />
          <Button
            type="button"
            size="sm"
            variant={required ? "outline" : "default"}
            className="min-h-11"
            disabled={busy || (!required && !mine.data)}
            onClick={() => void setRequired(!required)}
          >
            {required ? "Switch off" : "Require authenticator for all admins"}
          </Button>
        </div>
      )}

      {isSuper && overview.data && overview.data.length > 0 && (
        <div className="pt-2 border-t space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Admins</p>
          <ul className="space-y-2">
            {overview.data.map((r) => (
              <li key={r.user_id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span>
                    {r.full_name}
                    {r.is_owner ? " (owner)" : ""}:{" "}
                    <span className={r.has_authenticator ? "font-medium" : "text-muted-foreground"}>
                      {r.has_authenticator ? "authenticator on" : "Google sign-in only"}
                    </span>
                  </span>
                  {r.has_authenticator && r.user_id !== userId && resetFor !== r.user_id && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      onClick={() => {
                        setResetFor(r.user_id);
                        setReason("");
                      }}
                    >
                      Reset
                    </Button>
                  )}
                </div>
                {resetFor === r.user_id && (
                  <div className="mt-2 space-y-2">
                    <label
                      htmlFor={`reset-reason-${r.user_id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Why are you resetting it? (for example: lost phone)
                    </label>
                    <Input
                      id={`reset-reason-${r.user_id}`}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={200}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="min-h-11"
                        disabled={busy}
                        onClick={() => void reset(r.user_id)}
                      >
                        Reset authenticator
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-11"
                        onClick={() => setResetFor(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
