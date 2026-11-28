import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DOC_LABEL, needsExpiry, type ComplianceDocType } from "@/lib/compliance";

type Doc = {
  id: string;
  driver_id: string;
  doc_type: ComplianceDocType;
  storage_path: string;
  expires_on: string | null;
  licence_class: string | null;
  insurance_type: string | null;
  number_last4: string | null;
  submitted_at: string;
};
type Rpc = (
  f: string,
  a?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Documents waiting for an admin check (0191). An admin opens the file, confirms the facts, then checks or rejects. */
export function AdminComplianceReview() {
  const qc = useQueryClient();
  const { data: docs, isError } = useQuery({
    queryKey: ["admin-compliance-pending"],
    queryFn: async () => {
      const { data, error } = await (
        supabase.from as unknown as (t: string) => {
          select: (c: string) => {
            eq: (
              k: string,
              v: string,
            ) => {
              order: (
                k: string,
                o: { ascending: boolean },
              ) => Promise<{ data: Doc[] | null; error: unknown }>;
            };
          };
        }
      )("driver_compliance_documents")
        .select("*")
        .eq("status", "submitted")
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
  if (isError || !docs) return null;
  return (
    <section className="rounded-xl border bg-card p-4 space-y-3" aria-label="Documents to check">
      <h3 className="font-semibold text-sm">Documents to check ({docs.length})</h3>
      {!docs.length && <p className="text-xs text-muted-foreground">Nothing waiting.</p>}
      {docs.map((d) => (
        <DocRow
          key={d.id}
          doc={d}
          onDone={() => qc.invalidateQueries({ queryKey: ["admin-compliance-pending"] })}
        />
      ))}
    </section>
  );
}

function DocRow({ doc, onDone }: { doc: Doc; onDone: () => void }) {
  const [expires, setExpires] = useState(doc.expires_on ?? "");
  const [cls, setCls] = useState(doc.licence_class ?? "");
  const [busy, setBusy] = useState(false);
  const open = async () => {
    const { data } = await supabase.storage
      .from("driver-docs")
      .createSignedUrl(doc.storage_path, 600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };
  const review = async (decision: "checked" | "rejected") => {
    const reason =
      decision === "rejected"
        ? window.prompt("Why is this document not accepted? (the driver sees this)")
        : (window.prompt("Optional note on what you checked (e.g. name matches ID)") ?? "");
    if (decision === "rejected" && !reason?.trim()) return;
    setBusy(true);
    const { error } = await (supabase.rpc as unknown as Rpc)("admin_review_compliance_document", {
      _doc: doc.id,
      _decision: decision,
      _reason: reason || null,
      _expires_on: expires || null,
      _licence_class: cls || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(
      decision === "checked" ? "Marked as checked" : "Rejected; the driver was told why",
    );
    onDone();
  };
  return (
    <div className="rounded-lg border p-3 space-y-2 text-xs" data-testid="compliance-review-row">
      <div className="flex justify-between gap-2">
        <span className="font-semibold">{DOC_LABEL[doc.doc_type]}</span>
        <span className="text-muted-foreground">
          {new Date(doc.submitted_at).toLocaleDateString("en-GB")}
        </span>
      </div>
      <p className="text-muted-foreground">
        Driver {doc.driver_id.slice(0, 8)}
        {doc.number_last4 ? ` · number ends ${doc.number_last4}` : ""}
        {doc.insurance_type ? ` · ${doc.insurance_type.replace(/_/g, " ")}` : ""}
      </p>
      <Button size="sm" variant="outline" onClick={open}>
        Open the document
      </Button>
      {needsExpiry(doc.doc_type) && (
        <label className="block">
          Expiry date as shown on the document
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </label>
      )}
      {doc.doc_type === "driving_licence" && (
        <label className="block">
          Licence class as shown
          <Input value={cls} maxLength={20} onChange={(e) => setCls(e.target.value)} />
        </label>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => review("checked")}>
          Checked
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => review("rejected")}>
          Reject
        </Button>
      </div>
    </div>
  );
}
