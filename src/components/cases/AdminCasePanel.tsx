import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { CaseDetails } from "@/components/cases/CaseDetails";

type Rpc = (
  f: string,
  a?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const call = (f: string, a?: Record<string, unknown>) => (supabase.rpc as unknown as Rpc)(f, a);

/** Admin actions on one case (0192). The database refuses actions by anyone involved in the case. */
export function AdminCasePanel({ reportId }: { reportId: string }) {
  const qc = useQueryClient();
  const { userId } = useAuth();
  const [busy, setBusy] = useState(false);
  const run = async (f: string, a: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await call(f, a);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(ok);
    qc.invalidateQueries({ queryKey: ["case", reportId] });
  };
  const ask = (q: string) => window.prompt(q)?.trim() || null;
  return (
    <div className="space-y-2" data-testid="admin-case-panel">
      <CaseDetails reportId={reportId} />
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            run(
              "admin_case_action",
              { _report: reportId, _action: "assign", _assignee: userId },
              "Assigned to you",
            )
          }
        >
          Take the case
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            const s = ask("Severity: critical, high, medium or low");
            const r = s && ask("Why?");
            if (s && r)
              void run(
                "admin_case_action",
                { _report: reportId, _action: "severity", _severity: s, _text: r },
                "Severity changed",
              );
          }}
        >
          Severity
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            const t = ask("Protective action taken (both parties are told):");
            if (t)
              void run(
                "admin_case_action",
                { _report: reportId, _action: "protective_action", _text: t },
                "Recorded",
              );
          }}
        >
          Protective action
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            const t = ask("Internal note (admins only):");
            if (t)
              void run(
                "admin_case_action",
                { _report: reportId, _action: "note", _text: t },
                "Note added",
              );
          }}
        >
          Note
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            const d = ask("Decision:");
            const r = d && ask("Reason (both parties see it):");
            const p = r && ask("Policy applied:");
            if (d && r && p)
              void run(
                "admin_decide_case",
                { _report: reportId, _decision: d, _reason: r, _policy: p },
                "Decided",
              );
          }}
        >
          Decide
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            const o = ask("Appeal outcome: upheld or changed");
            const r = o && ask("Reason:");
            if (o && r)
              void run(
                "admin_decide_appeal",
                { _report: reportId, _outcome: o, _reason: r },
                "Appeal decided",
              );
          }}
        >
          Decide appeal
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            const r = ask("Why close it now?");
            if (r) void run("admin_close_case", { _report: reportId, _reason: r }, "Closed");
          }}
        >
          Close
        </Button>
      </div>
    </div>
  );
}
