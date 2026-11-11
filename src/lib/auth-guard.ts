// The signed-in screens' guard. It used to ask the server "who is this?" and send the person to the sign-in screen
// on ANY error, so a driver who opened a screen with no signal was thrown out to a login page they cannot use.
// Only a real answer from the server (no user, expired or revoked session) may sign someone out of the screen;
// a network failure keeps a locally signed-in user in. Data stays protected by the database rules either way.

export type GuardUser = { id: string; email?: string | null };

export type GuardResult = { kind: "ok"; user: GuardUser; offline: boolean } | { kind: "redirect" };

export function decideGuard<U extends GuardUser>(input: {
  serverUser: U | null;
  serverError: unknown;
  localUser: GuardUser | null;
  isNetworkError: (e: unknown) => boolean;
}): GuardResult {
  if (input.serverUser && !input.serverError) {
    return { kind: "ok", user: input.serverUser, offline: false };
  }
  if (input.serverError && input.isNetworkError(input.serverError) && input.localUser) {
    return { kind: "ok", user: input.localUser, offline: true };
  }
  return { kind: "redirect" };
}

type KeyedStorage = Pick<Storage, "length" | "key" | "getItem">;

/**
 * The user the Supabase client keeps on this phone (`sb-<project>-auth-token`). Used only when the server cannot
 * be reached, including after the short-lived access token has expired, which the client cannot refresh offline.
 */
export function localUserFromStorage(storage: KeyedStorage | null): GuardUser | null {
  try {
    if (!storage) return null;
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
      const parsed = JSON.parse(storage.getItem(k) ?? "null") as {
        user?: { id?: unknown; email?: unknown };
      } | null;
      const id = parsed?.user?.id;
      if (typeof id === "string" && id) {
        const email = parsed?.user?.email;
        return { id, email: typeof email === "string" ? email : null };
      }
    }
  } catch {
    /* unreadable storage or a malformed entry: treat as not signed in */
  }
  return null;
}

/**
 * A read that failed must not erase what the app already knows: a dropped connection is not "this person has no
 * roles" or "no profile". Only a successful read (including an empty one) replaces the previous value.
 */
export function keepIfFailed<T>(
  previous: T,
  result: { data?: unknown; error?: unknown },
  map: (data: unknown) => T,
): T {
  return result.error ? previous : map(result.data ?? null);
}

/**
 * Whether a signed-in person may open a role's screens. A role lookup that failed only because there is no signal
 * must not bounce a driver off their own screen; a real "no, not your role" and a real database error still deny.
 */
export function roleVerdict(input: {
  roles: string[] | null;
  error: unknown;
  allowed: string[];
  isNetworkError: (e: unknown) => boolean;
}): "allow" | "deny" {
  if (input.error) return input.isNetworkError(input.error) ? "allow" : "deny";
  const held = input.roles ?? [];
  return input.allowed.some((r) => held.includes(r)) ? "allow" : "deny";
}
