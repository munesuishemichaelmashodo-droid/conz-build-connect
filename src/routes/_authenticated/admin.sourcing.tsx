import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { adminIssueSourcingQuote } from "@/lib/sourcing.functions";
import { money } from "@/lib/domain";

export const Route = createFileRoute("/_authenticated/admin/sourcing")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    const list = (roles ?? []).map((r: { role: string }) => r.role);
    if (!list.includes("admin") && !list.includes("super_admin")) throw redirect({ to: "/admin" });
  },
  component: SourcingQueue,
});

type Row = {
  id: string;
  customer_id: string;
  material: string;
  custom_material: string | null;
  quantity_m3: number;
  delivery_address: string;
  delivery_lat: number | null;
  delivery_lng: number | null;
  status: string;
  quoted_total: number | null;
  quote_valid_until: string | null;
  supplier_name: string | null;
  supplier_location: string | null;
  admin_notes: string | null;
  created_at: string;
};

type Loc = {
  id: string;
  label: string | null;
  address: string | null;
  available_quantity_m3: number | null;
  suppliers: { name: string } | null;
};

const STATUSES = [
  "requested",
  "sourcing",
  "quote_ready",
  "converted",
  "declined",
  "expired",
] as const;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sourcing RPCs are not in the generated types until 0088 is applied
const rpc = (fn: string, args: Record<string, unknown>) => (supabase as any).rpc(fn, args);

function QuoteForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const issue = useServerFn(adminIssueSourcingQuote);
  const [loc, setLoc] = useState("");
  const [hours, setHours] = useState(48);
  const [terms, setTerms] = useState("");
  const [note, setNote] = useState("");

  const { data: locs, isLoading } = useQuery({
    queryKey: ["sourcing-locations", row.material],
    queryFn: async () => {
      // Only sites that could pass the server's validation are offered; the
      // database re-checks everything on issue regardless of this filter.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("material_supply_locations")
        .select("id, label, address, available_quantity_m3, suppliers(name)")
        .eq("material", row.material)
        .eq("status", "active")
        .eq("verification_status", "verified")
        .eq("location_precision", "exact")
        .gte("available_quantity_m3", row.quantity_m3);
      if (error) throw error;
      return (data ?? []) as Loc[];
    },
  });

  const submit = useMutation({
    mutationFn: () =>
      issue({
        data: {
          requestId: row.id,
          supplyLocationId: loc,
          validHours: hours,
          terms,
          note: note || undefined,
        },
      }),
    onSuccess: (r) => {
      toast.success(`Quote issued (${r.distanceKm.toFixed(0)} km by road)`);
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-3 space-y-2 rounded-lg border p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Issue a quote
      </div>
      <p className="text-xs text-muted-foreground">
        The price comes from the pricing engine using the road distance from the chosen site. You
        don't enter a price.
      </p>
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : locs && locs.length > 0 ? (
        <select
          className="w-full rounded-md border bg-background p-2 text-sm"
          value={loc}
          onChange={(e) => setLoc(e.target.value)}
          aria-label="Supply location"
        >
          <option value="">Choose a verified, in-stock site…</option>
          {locs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.suppliers?.name ?? "Supplier"} — {l.label ?? l.address} ({l.available_quantity_m3}{" "}
              m³ in stock)
            </option>
          ))}
        </select>
      ) : (
        <p className="text-sm text-warning">
          No verified, exact-coordinate site has {row.quantity_m3} m³ of this material in stock. Add
          or verify one in Supply, then return.
        </p>
      )}
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor={`h-${row.id}`}>Quote valid for</label>
        <input
          id={`h-${row.id}`}
          type="number"
          min={1}
          max={168}
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="w-20 rounded-md border bg-background p-1.5"
        />
        <span>hours</span>
      </div>
      <Textarea
        placeholder="Terms shown to the customer (pickup, payment, validity)…"
        value={terms}
        onChange={(e) => setTerms(e.target.value)}
        maxLength={1000}
      />
      <Textarea
        placeholder="Internal note (not shown to the customer)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
      />
      <Button
        size="sm"
        disabled={!loc || terms.trim().length < 3 || hours < 1 || hours > 168 || submit.isPending}
        onClick={() => submit.mutate()}
      >
        {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Issue quote"}
      </Button>
    </div>
  );
}

function SourcingQueue() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUSES)[number] | "open">("open");
  const [quoting, setQuoting] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-sourcing", status],
    queryFn: async () => {
      const { data, error } = await rpc("admin_list_sourcing_requests", {
        p_status: status === "open" ? null : status,
        p_limit: 100,
      });
      if (error) throw error;
      const rows = (data ?? []) as Row[];
      return status === "open"
        ? rows.filter((r) => ["requested", "sourcing", "quote_ready"].includes(r.status))
        : rows;
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-sourcing"] });

  const start = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rpc("admin_start_sourcing", { p_request_id: id, p_note: null });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: () => toast.error("Couldn't start sourcing on that request."),
  });
  const decline = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await rpc("decline_sourcing_request", {
        p_request_id: id,
        p_reason: "No supplier could be found",
      });
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: () => toast.error("Couldn't close that request."),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(["open", ...STATUSES] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${status === s ? "bg-primary text-primary-foreground" : "bg-background"}`}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>
      {isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin" />}
      {isError && (
        <div role="alert" className="text-sm text-destructive">
          Couldn't load the queue.{" "}
          <button className="underline" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      )}
      {data?.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">Nothing in this view.</p>
      )}
      {data?.map((r) => (
        <div key={r.id} className="rounded-2xl border bg-card p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-display font-bold">
                {r.quantity_m3} m³{" "}
                {r.material === "custom" ? r.custom_material : r.material.replace("_", " ")}
              </div>
              <div className="text-xs text-muted-foreground">{r.delivery_address}</div>
              <div className="text-[11px] text-muted-foreground">
                {new Date(r.created_at).toLocaleString()}
              </div>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold">
              {r.status.replace("_", " ")}
            </span>
          </div>
          {r.status === "quote_ready" && (
            <div className="mt-2 text-sm">
              Quoted {r.quoted_total != null ? money(r.quoted_total) : "—"} from {r.supplier_name} (
              {r.supplier_location}) · valid until{" "}
              {r.quote_valid_until ? new Date(r.quote_valid_until).toLocaleString() : "—"}
            </div>
          )}
          {r.delivery_lat == null && r.status !== "converted" && (
            <p className="mt-2 text-xs text-warning">
              No delivery pin was captured, so a road-distance quote can't be issued.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {r.status === "requested" && (
              <Button
                size="sm"
                variant="outline"
                disabled={start.isPending}
                onClick={() => start.mutate(r.id)}
              >
                Start sourcing
              </Button>
            )}
            {["requested", "sourcing"].includes(r.status) &&
              r.material !== "custom" &&
              r.delivery_lat != null && (
                <Button size="sm" onClick={() => setQuoting(quoting === r.id ? null : r.id)}>
                  {quoting === r.id ? "Hide quote form" : "Issue quote"}
                </Button>
              )}
            {["requested", "sourcing", "quote_ready"].includes(r.status) && (
              <Button
                size="sm"
                variant="ghost"
                disabled={decline.isPending}
                onClick={() => decline.mutate(r.id)}
              >
                Close — no supplier
              </Button>
            )}
          </div>
          {quoting === r.id && (
            <QuoteForm
              row={r}
              onDone={() => {
                setQuoting(null);
                refresh();
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
