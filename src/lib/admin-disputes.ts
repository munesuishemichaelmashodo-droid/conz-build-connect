import { supabase } from "@/integrations/supabase/client";

type RpcError = { code?: string; message: string } | null;
type RpcFn = (f: string, a: Record<string, unknown>) => Promise<{ error: RpcError }>;

/**
 * 0184: dispute decisions go through audited database functions. Before 0184 is applied they do not exist yet,
 * so the caller's fallback (the previous direct update) runs instead; after 0184 that direct update is refused.
 */
export async function callDisputeAction(
  fn: "admin_mark_dispute_investigating" | "admin_reject_dispute",
  args: Record<string, unknown>,
  fallback: () => PromiseLike<{ error: { message: string } | null }>,
): Promise<{ error: { message: string } | null }> {
  const { error } = await (supabase.rpc as unknown as RpcFn)(fn, args);
  if (error && (error.code === "PGRST202" || /could not find the function/i.test(error.message))) {
    return fallback();
  }
  return { error };
}
