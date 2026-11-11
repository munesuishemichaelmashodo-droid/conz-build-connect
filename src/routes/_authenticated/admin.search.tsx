import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { EmptyState, StatusBadge } from "@/components/ui-bits";
import { useAuth } from "@/lib/auth";
import {
  SEARCH_KINDS,
  SEARCH_MIN_CHARS,
  adminSearch,
  hitDestination,
  pageCount,
  searchReady,
  type SearchHit,
  type SearchKind,
} from "@/lib/admin-ops";

export const Route = createFileRoute("/_authenticated/admin/search")({
  component: AdminSearch,
});

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  customers: "Customer",
  drivers: "Driver",
  jobs: "Job",
  payments: "Payment",
  transactions: "Transaction",
  reports: "Report",
};

function AdminSearch() {
  const { is } = useAuth();
  const isSuper = is("super_admin");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<SearchKind>("all");
  const [page, setPage] = useState(0);

  // Search 300 ms after typing stops, and start again from the first page.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(text.trim());
      setPage(0);
    }, 300);
    return () => window.clearTimeout(t);
  }, [text]);

  const ready = searchReady(q);
  const { data, isFetching, error } = useQuery({
    queryKey: ["admin-search", q, kind, page],
    enabled: ready,
    queryFn: async () => {
      const res = await adminSearch(q, kind, page);
      if (res.error) throw new Error(res.error.message);
      return res.data ?? [];
    },
  });
  const rows = data ?? [];
  const total = Number(rows[0]?.total_count ?? 0);
  const pages = pageCount(total);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Search</h1>
        <p className="text-sm text-muted-foreground">
          Customers, drivers, jobs, payments, transactions and support reports, searched on the
          server.
        </p>
      </div>

      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Name, phone, email, job id, address, reference…"
          aria-label="Search"
          maxLength={80}
          className="h-12 w-full rounded-lg border bg-card pl-9 pr-3 text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Search type">
        {SEARCH_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            aria-pressed={kind === k.value}
            onClick={() => {
              setKind(k.value);
              setPage(0);
            }}
            className={`min-h-11 rounded-lg border px-3 text-xs font-semibold ${
              kind === k.value
                ? "border-foreground bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--cz-text)]"
                : "bg-card text-muted-foreground"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>
      {!isSuper && (kind === "transactions" || kind === "all") && (
        <p className="text-xs text-muted-foreground">
          As an admin you see today&apos;s wallet transactions only. Super admins see them all.
        </p>
      )}

      {!ready ? (
        <EmptyState
          icon={SearchIcon}
          title="Search Con Z"
          hint={`Type at least ${SEARCH_MIN_CHARS} characters.`}
        />
      ) : error ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {(error as Error).message}
        </p>
      ) : rows.length === 0 && !isFetching ? (
        <EmptyState
          icon={SearchIcon}
          title="No matches"
          hint="Try a different spelling or another type."
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {isFetching ? "Searching…" : `${total} match${total === 1 ? "" : "es"}`}
          </p>
          <ul className="divide-y rounded-xl border bg-card">
            {rows.map((h) => (
              <li key={`${h.kind}-${h.id}`}>
                <Hit hit={h} />
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={page === 0 || isFetching}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="min-h-11 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-xs text-muted-foreground">
                Page {page + 1} of {pages}
              </span>
              <button
                type="button"
                disabled={page + 1 >= pages || isFetching}
                onClick={() => setPage((p) => p + 1)}
                className="min-h-11 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Hit({ hit }: { hit: SearchHit }) {
  const dest = hitDestination(hit);
  const body = (
    <div className="flex items-start justify-between gap-3 p-3">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-muted-foreground">
          {KIND_LABEL[hit.kind]}
        </div>
        <div className="truncate font-semibold">{hit.title || "(no name)"}</div>
        {hit.subtitle && (
          <div className="truncate text-xs text-muted-foreground">{hit.subtitle}</div>
        )}
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {new Date(hit.created_at).toLocaleString()}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {hit.status && (
          <StatusBadge
            label={hit.status.replace(/_/g, " ")}
            className="border-transparent bg-muted text-muted-foreground"
          />
        )}
        {hit.amount != null && (
          <span className="text-sm font-semibold tabular-nums">
            ${Number(hit.amount).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
  if (!dest) return body;
  return (
    <Link
      to={dest.to as "/admin"}
      params={dest.params as never}
      className="block hover:bg-muted/50"
    >
      {body}
    </Link>
  );
}
