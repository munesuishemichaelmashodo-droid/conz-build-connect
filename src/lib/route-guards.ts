import { redirect } from "@tanstack/react-router";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { decideGuard, localUserFromStorage, roleVerdict, type GuardUser } from "@/lib/auth-guard";
import { isNetworkFailure } from "@/lib/contact-cache";

/**
 * The signed-in check every protected screen starts with. Only a real answer from the server can send someone to
 * the sign-in screen; a network failure keeps a locally signed-in user in (see lib/auth-guard.ts).
 */
export async function requireUser(): Promise<GuardUser> {
  const { data, error } = await supabase.auth.getUser();
  const localUser =
    error && isAuthRetryableFetchError(error)
      ? ((await supabase.auth.getSession()).data.session?.user ??
        localUserFromStorage(typeof window === "undefined" ? null : window.localStorage))
      : null;
  const guard = decideGuard({
    serverUser: data.user,
    serverError: error,
    localUser,
    isNetworkError: isAuthRetryableFetchError,
  });
  if (guard.kind === "redirect") throw redirect({ to: "/auth" });
  return guard.user;
}

/** Redirects to `elseTo` unless the user holds one of `allowed`; a lookup that failed for lack of signal lets them in. */
export async function requireRole(
  user: GuardUser,
  allowed: string[],
  elseTo: "/home" | "/admin",
): Promise<void> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  const verdict = roleVerdict({
    roles: data ? (data as { role: string }[]).map((r) => r.role) : null,
    error,
    allowed,
    isNetworkError: (e) => isNetworkFailure(e as { message?: string; code?: string }),
  });
  if (verdict === "deny") throw redirect({ to: elseTo });
}
