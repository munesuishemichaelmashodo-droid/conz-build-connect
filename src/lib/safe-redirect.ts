// Post-login / post-verification redirect targets must be paths inside this
// app. The old check (`startsWith("/") && !startsWith("//")`) let
// "/\evil.com" through: browsers normalise the backslash and treat it as
// "//evil.com", i.e. another origin (audit F8 open redirect).

const PROBE_ORIGIN = "https://conz.invalid";

/** Returns a safe same-origin path ("/x?y#z"), or null if `next` is not one. */
export function safeInternalPath(next: string | null | undefined): string | null {
  if (typeof next !== "string") return null;
  const value = next.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // Backslashes and control characters are never needed in our paths and are
  // the usual way to smuggle a second origin past naive checks.
  // eslint-disable-next-line no-control-regex -- matching control characters is the point of this check
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PROBE_ORIGIN) return null;
  return url.pathname + url.search + url.hash;
}
