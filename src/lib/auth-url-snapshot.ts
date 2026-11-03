// Records what the first page load's URL said about an auth redirect, before
// the Supabase client reads and clears it. Only derived flags are kept (see
// parseAuthRedirect): no tokens, codes or provider text.
//
// Must be imported before anything touches the Supabase client. __root.tsx
// imports it first; the client itself is created lazily on first use.

import { parseAuthRedirect, type AuthRedirect } from "@/lib/auth-flow";

const EMPTY: AuthRedirect = {
  pathname: "",
  type: null,
  hasCode: false,
  hasTokens: false,
  error: null,
};

const initial: AuthRedirect =
  typeof window === "undefined"
    ? EMPTY
    : parseAuthRedirect({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      });

export function initialAuthRedirect(): AuthRedirect {
  return initial;
}
