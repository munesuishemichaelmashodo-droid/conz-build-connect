// Parsing of the native OAuth redirect (com.conz.app://oauth-callback...).
//
// Custom URL schemes can be registered by any Android app, so whatever
// arrives here may also have been delivered to another app (audit H8). The
// native sign-in therefore uses the PKCE flow: the redirect carries only a
// one-time authorization `code`, which is useless without the code verifier
// that never leaves this WebView. A redirect that carries raw tokens
// (implicit flow) is refused rather than forwarded.

export const CUSTOM_SCHEME_PREFIX = "com.conz.app://oauth-callback";

export type NativeOAuthCallback =
  | { kind: "code"; code: string }
  | { kind: "error"; message: string }
  | { kind: "tokens_refused" }
  | { kind: "ignored" };

export function parseNativeOAuthCallback(url: string): NativeOAuthCallback {
  if (!url.startsWith(CUSTOM_SCHEME_PREFIX)) return { kind: "ignored" };
  const rest = url.slice(CUSTOM_SCHEME_PREFIX.length);
  const queryIndex = rest.indexOf("?");
  const hashIndex = rest.indexOf("#");
  const query =
    queryIndex >= 0
      ? rest.slice(queryIndex + 1, hashIndex > queryIndex ? hashIndex : undefined)
      : "";
  const fragment = hashIndex >= 0 ? rest.slice(hashIndex + 1) : "";
  const q = new URLSearchParams(query);
  const f = new URLSearchParams(fragment);

  if (
    f.has("access_token") ||
    f.has("refresh_token") ||
    q.has("access_token") ||
    q.has("refresh_token")
  ) {
    return { kind: "tokens_refused" };
  }
  const error =
    q.get("error_description") ?? q.get("error") ?? f.get("error_description") ?? f.get("error");
  if (error) return { kind: "error", message: error };
  const code = q.get("code");
  if (code && /^[A-Za-z0-9-_.]{8,512}$/.test(code)) return { kind: "code", code };
  return { kind: "ignored" };
}
