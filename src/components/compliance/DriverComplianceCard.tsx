import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DOC_LABEL,
  DOC_ORDER,
  INSURANCE_TYPES,
  STATE_LABEL,
  VEHICLE_DOCS,
  needsExpiry,
  type ComplianceDocType,
  type ComplianceSummaryRow,
} from "@/lib/compliance";

type Rpc = (
  f: string,
  a?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const call = (f: string, a?: Record<string, unknown>) => (supabase.rpc as unknown as Rpc)(f, a);

/** The driver's documents, one by one (0191). Hidden before 0191 is applied. */
export function DriverComplianceCard({
  userId,
  truckId,
}: {
  userId: string;
  truckId: string | null;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<ComplianceDocType | null>(null);
  const [expires, setExpires] = useState("");
  const [cls, setCls] = useState("");
  const [insType, setInsType] = useState("goods_in_transit");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: rows, isError } = useQuery({
    queryKey: ["driver-compliance", userId],
    queryFn: async () => {
      const { data, error } = await call("driver_compliance_summary");
      if (error) throw error;
      return (data ?? []) as ComplianceSummaryRow[];
    },
  });
  if (isError || !rows) return null;

  const upload = async (file: File) => {
    if (!open) return;
    if (needsExpiry(open) && !expires)
      return toast.error("Enter the expiry date shown on the document.");
    setBusy(true);
    const path = `${userId}/compliance-${open}-${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
    const up = await supabase.storage.from("driver-docs").upload(path, file, { upsert: false });
    if (up.error) {
      setBusy(false);
      return toast.error(up.error.message);
    }
    const { error } = await call("submit_compliance_document", {
      _doc_type: open,
      _storage_path: path,
      _expires_on: expires || null,
      _licence_class: open === "driving_licence" ? cls || null : null,
      _insurance_type: open === "insurance" ? insType : null,
      _truck: VEHICLE_DOCS.includes(open) ? truckId : null,
      _number_last4: last4 || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Submitted. Con Z will check it; uploading alone does not mark it checked.");
    setOpen(null);
    qc.invalidateQueries({ queryKey: ["driver-compliance", userId] });
  };

  return (
    <section className="rounded-2xl border p-4 space-y-3" aria-label="Documents">
      <div>
        <div className="font-semibold">Your documents</div>
        <p className="text-[13px] text-muted-foreground">
          Each document is checked on its own by Con Z. Customers only see documents Con Z has
          checked and that have not expired.
        </p>
      </div>
      <ul className="space-y-2">
        {DOC_ORDER.map((t) => {
          const r = rows.find((x) => x.doc_type === t);
          return (
            <li
              key={t}
              className="rounded-lg border p-2.5 text-[13px] space-y-1"
              data-testid={`compliance-${t}`}
            >
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{DOC_LABEL[t]}</span>
                <span
                  className={
                    r?.state === "checked"
                      ? "text-success"
                      : r?.state === "expired" || r?.state === "rejected"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {STATE_LABEL[r?.state ?? "missing"]}
                </span>
              </div>
              {r?.expires_on && <p className="text-muted-foreground">Expires {r.expires_on}</p>}
              {r?.state === "rejected" && r.review_reason && (
                <p className="text-destructive">Reason: {r.review_reason}</p>
              )}
              {open !== t && (
                <Button size="sm" variant="outline" onClick={() => setOpen(t)}>
                  {r && r.state !== "missing" ? "Submit a new one" : "Submit"}
                </Button>
              )}
              {open === t && (
                <div className="space-y-2 pt-1">
                  {needsExpiry(t) && (
                    <label className="block">
                      Expiry date
                      <Input
                        type="date"
                        value={expires}
                        onChange={(e) => setExpires(e.target.value)}
                      />
                    </label>
                  )}
                  {t === "driving_licence" && (
                    <label className="block">
                      Licence class
                      <Input
                        value={cls}
                        maxLength={20}
                        onChange={(e) => setCls(e.target.value)}
                        placeholder="e.g. C"
                      />
                    </label>
                  )}
                  {t === "insurance" && (
                    <label className="block">
                      Type of insurance
                      <select
                        value={insType}
                        onChange={(e) => setInsType(e.target.value)}
                        className="mt-1 h-10 w-full rounded-md border bg-background px-2"
                      >
                        {INSURANCE_TYPES.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="block">
                    Last 4 characters of the document number (optional)
                    <Input
                      value={last4}
                      maxLength={4}
                      onChange={(e) => setLast4(e.target.value.replace(/[^a-z0-9]/gi, ""))}
                    />
                  </label>
                  <label className="inline-flex cursor-pointer rounded-md border px-3 py-1.5 font-semibold">
                    {busy ? "Uploading…" : "Choose the file"}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="sr-only"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void upload(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(null)} disabled={busy}>
                    Cancel
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
