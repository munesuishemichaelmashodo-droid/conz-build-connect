/**
 * The Supabase project reference the /mcp endpoint trusts as its OAuth issuer.
 * It is read from the SAME URL the app talks to (VITE_SUPABASE_URL), so the issuer can never name a different
 * project from the database the tools query. The separate project-id variable is only a fallback: a mismatch
 * between the two (a staging id left in a production build) once pointed production's /mcp at the staging project.
 */
export function supabaseProjectRef(env: {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PROJECT_ID?: string;
}): string {
  const url = env.VITE_SUPABASE_URL;
  if (url) {
    try {
      const host = new URL(url).hostname;
      const m = host.match(/^([a-z0-9]{20})\.supabase\.co$/);
      if (m) return m[1];
    } catch {
      // fall through to the fallback
    }
  }
  return env.VITE_SUPABASE_PROJECT_ID || "project-ref-unset";
}
