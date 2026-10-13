import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, PackageSearch } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { money } from "@/lib/domain";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/customer/sourcing")({
  component: MySourcingRequests,
});

type Req = {
  id: string;
  material: string;
  custom_material: string | null;
  quantity_m3: number;
  delivery_address: string;
  status: "requested" | "sourcing" | "quote_ready" | "declined" | "expired" | "converted";
  quoted_total: number | null;
  quote_valid_until: string | null;
  terms: string | null;
  decline_reason: string | null;
  converted_job_id: string | null;
  created_at: string;
};

// What each status means for the customer, in plain words. A provisional state
// is never presented as a price or a booking.
const STATUS: Record<Req["status"], { label: string; text: string; tone: string }> = {
  requested: {
    label: "Request received",
    text: "We've recorded your request. No supplier has been confirmed and nothing is booked or charged.",
    tone: "bg-muted text-muted-foreground",
  },
  sourcing: {
    label: "Finding a supplier",
    text: "Our team is checking verified suppliers for this order. We'll notify you when there's a confirmed quote.",
    tone: "bg-warning/15 text-warning",
  },
  quote_ready: {
    label: "Quote ready",
    text: "A verified supplier is confirmed. Review the quote and book before it expires — you aren't charged until you do.",
    tone: "bg-success/15 text-success",
  },
  declined: {
    label: "Closed",
    text: "This request was closed. You're welcome to try again later.",
    tone: "bg-muted text-muted-foreground",
  },
  expired: {
    label: "Expired",
    text: "This request or its quote has expired. You can submit a new request.",
    tone: "bg-muted text-muted-foreground",
  },
  converted: {
    label: "Booked",
    text: "You booked this delivery.",
    tone: "bg-success/15 text-success",
  },
};

const OPEN = new Set(["requested", "sourcing", "quote_ready"]);

function History({ id }: { id: string }) {
  const { data } = useQuery({
    queryKey: ["sourcing-history", id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not in generated types until 0088 is applied
      const { data, error } = await (supabase as any).rpc("my_sourcing_history", {
        p_request_id: id,
      });
      if (error) throw error;
      return (data ?? []) as {
        from_status: string | null;
        to_status: string;
        created_at: string;
      }[];
    },
  });
  if (!data?.length) return null;
  return (
    <ol className="mt-2 space-y-1 border-l pl-3 text-xs text-muted-foreground">
      {data.map((h, i) => (
        <li key={i}>
          {STATUS[h.to_status as Req["status"]]?.label ?? h.to_status} ·{" "}
          {new Date(h.created_at).toLocaleString()}
        </li>
      ))}
    </ol>
  );
}

function MySourcingRequests() {
  const { is } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-sourcing-requests"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- not in generated types until 0088 is applied
      const { data, error } = await (supabase as any)
        .from("material_sourcing_requests")
        .select(
          "id, material, custom_material, quantity_m3, delivery_address, status, quoted_total, quote_valid_until, terms, decline_reason, converted_job_id, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Req[];
    },
    refetchInterval: 30_000,
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc("decline_sourcing_request", {
        p_request_id: id,
        p_reason: "cancelled_by_customer",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Request cancelled");
      qc.invalidateQueries({ queryKey: ["my-sourcing-requests"] });
    },
    onError: () => toast.error("Couldn't cancel that request. Please try again."),
  });

  if (!is("customer")) {
    return (
      <AppShell title="Sourcing requests">
        <p className="py-10 text-center text-muted-foreground">
          Only customer accounts have sourcing requests.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Sourcing requests">
      <div className="space-y-3">
        {isLoading && (
          <div className="flex justify-center py-10" role="status" aria-label="Loading">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {isError && (
          <div role="alert" className="space-y-2 py-6 text-center">
            <p className="text-sm text-destructive">Couldn't load your requests.</p>
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        )}
        {data && data.length === 0 && (
          <div className="space-y-3 py-10 text-center">
            <PackageSearch className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No sourcing requests yet. When we don't have a verified supplier for an order, we keep
              it here for you.
            </p>
            <Button asChild>
              <Link to="/customer/book">Book a delivery</Link>
            </Button>
          </div>
        )}
        {data?.map((r) => {
          const s = STATUS[r.status];
          const quoteLive =
            r.status === "quote_ready" &&
            r.quote_valid_until &&
            new Date(r.quote_valid_until) > new Date();
          return (
            <div key={r.id} className="space-y-2 rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-display font-bold">
                    {r.quantity_m3} m³{" "}
                    {r.material === "custom" ? r.custom_material : r.material.replace("_", " ")}
                  </div>
                  <div className="text-xs text-muted-foreground">{r.delivery_address}</div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${s.tone}`}>
                  {s.label}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{s.text}</p>
              {r.status === "quote_ready" && r.quoted_total != null && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <div className="font-semibold">Quoted: {money(r.quoted_total)}</div>
                  {r.terms && <div className="text-xs text-muted-foreground">{r.terms}</div>}
                  {r.quote_valid_until && (
                    <div className="text-xs text-muted-foreground">
                      {quoteLive ? "Valid until" : "Expired"}{" "}
                      {new Date(r.quote_valid_until).toLocaleString()}
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                {quoteLive && (
                  <Button
                    size="sm"
                    onClick={() =>
                      nav({ to: "/customer/book", search: { sourcingRequestId: r.id } })
                    }
                  >
                    Review &amp; book
                  </Button>
                )}
                {r.converted_job_id && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/jobs/$id" params={{ id: r.converted_job_id }}>
                      View job
                    </Link>
                  </Button>
                )}
                {OPEN.has(r.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(r.id)}
                  >
                    Cancel request
                  </Button>
                )}
              </div>
              <History id={r.id} />
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
