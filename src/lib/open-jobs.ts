// Area-only access to open jobs for drivers (migration 0133).
// The functions below return masked rows (area name, rounded coordinates, no contacts). While 0133 is not
// applied on a database they do not exist; then we fall back to the previous table read so a deploy that
// comes before the migration does not leave drivers with an empty list. After 0133 the table read is
// refused by the database anyway, so the fallback can never expose anything the database does not allow.
import type { SupabaseClient } from "@supabase/supabase-js";

type Anyish = SupabaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type RpcError = { code?: string; message?: string } | null;

export function isMissingFunction(error: RpcError): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function|does not exist/i.test(error.message ?? "")
  );
}

export async function fetchOpenJobs<T = Record<string, unknown>>(
  supabase: Anyish,
  limit = 50,
): Promise<T[]> {
  const { data, error } = await supabase.rpc("driver_open_jobs", { _limit: limit });
  if (!error) return (data ?? []) as T[];
  if (!isMissingFunction(error)) throw new Error(error.message);
  const { data: legacy, error: e2 } = await supabase
    .from("jobs")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (e2) throw new Error(e2.message);
  return (legacy ?? []) as T[];
}

export async function fetchOpenJob<T = Record<string, unknown>>(
  supabase: Anyish,
  id: string,
): Promise<T | null> {
  const { data, error } = await supabase.rpc("driver_open_job", { _id: id });
  if (!error) return ((Array.isArray(data) ? data[0] : data) ?? null) as T | null;
  if (!isMissingFunction(error)) return null;
  const { data: legacy } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("status", "open")
    .maybeSingle();
  return (legacy ?? null) as T | null;
}
