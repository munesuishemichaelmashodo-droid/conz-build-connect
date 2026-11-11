import { supabase } from "@/integrations/supabase/client";

// Admin support reports and admin search (migration 0142). The RPCs are not in the generated types yet, so
// the one cast lives here, the same way src/components/redesign/rpc.ts does it.
type RpcResult<T> = { data: T | null; error: { code?: string; message: string } | null };
const call = <T>(fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<RpcResult<T>>)(
    fn,
    args,
  );

export type AdminReport = {
  id: string;
  user_id: string;
  job_id: string | null;
  description: string;
  status: string;
  admin_notes: string | null;
  admin_reply: string | null;
  admin_reply_at: string | null;
  created_at: string;
  reporter_name: string | null;
  reporter_phone: string | null;
  reporter_email: string | null;
};

export const adminListReports = (status: "open" | "resolved" | null, limit = 50, offset = 0) =>
  call<AdminReport[]>("admin_list_reports", { _status: status, _limit: limit, _offset: offset });

export const adminRespondToReport = (args: {
  reportId: string;
  reply?: string | null;
  note?: string | null;
  status?: "open" | "resolved" | null;
}) =>
  call<{ changed: boolean; status: string }>("admin_respond_to_report", {
    _report_id: args.reportId,
    _reply: args.reply ?? null,
    _note: args.note ?? null,
    _status: args.status ?? null,
  });

export type SearchKind =
  "all" | "customers" | "drivers" | "jobs" | "payments" | "transactions" | "reports";

export const SEARCH_KINDS: { value: SearchKind; label: string; superOnly?: boolean }[] = [
  { value: "all", label: "Everything" },
  { value: "customers", label: "Customers" },
  { value: "drivers", label: "Drivers" },
  { value: "jobs", label: "Jobs" },
  { value: "payments", label: "Payments" },
  { value: "transactions", label: "Transactions" },
  { value: "reports", label: "Reports" },
];

export type SearchHit = {
  kind: Exclude<SearchKind, "all">;
  id: string;
  title: string | null;
  subtitle: string | null;
  status: string | null;
  amount: number | null;
  created_at: string;
  job_id: string | null;
  user_id: string | null;
  total_count: number;
};

export const SEARCH_PAGE_SIZE = 20;
export const SEARCH_MIN_CHARS = 2;

export const adminSearch = (q: string, kind: SearchKind, page: number) =>
  call<SearchHit[]>("admin_search", {
    _q: q,
    _kind: kind,
    _limit: SEARCH_PAGE_SIZE,
    _offset: page * SEARCH_PAGE_SIZE,
  });

/** Only worth sending to the server once there is something to search for. */
export function searchReady(q: string): boolean {
  return q.trim().length >= SEARCH_MIN_CHARS;
}

/** Where a result opens. Customers and drivers open the users list; money rows open their job when they have one. */
export function hitDestination(
  h: Pick<SearchHit, "kind" | "id" | "job_id">,
): { to: string; params?: Record<string, string> } | null {
  switch (h.kind) {
    case "jobs":
      return { to: "/jobs/$id", params: { id: h.id } };
    case "reports":
      return { to: "/admin/reports" };
    case "customers":
    case "drivers":
      return { to: "/admin/users" };
    case "payments":
    case "transactions":
      return h.job_id ? { to: "/jobs/$id", params: { id: h.job_id } } : null;
    default:
      return null;
  }
}

export function pageCount(total: number | null | undefined): number {
  return Math.max(1, Math.ceil(Number(total ?? 0) / SEARCH_PAGE_SIZE));
}

/** The function is missing until 0142 is applied; the screens then fall back to what they did before. */
export function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function|does not exist/i.test(error.message ?? "")
  );
}
