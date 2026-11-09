import { describe, expect, it } from "vitest";
import { supabaseProjectRef } from "@/lib/mcp/issuer";

const PROD = "ovwrsocjmkpiygipmrdk";
const STAGING = "fpckydgssuefzzxivvig";

describe("supabaseProjectRef", () => {
  it("takes the project from the URL the app talks to", () => {
    expect(supabaseProjectRef({ VITE_SUPABASE_URL: `https://${PROD}.supabase.co` })).toBe(PROD);
  });
  it("ignores a project id that disagrees with the URL (staging id in a production build)", () => {
    expect(
      supabaseProjectRef({
        VITE_SUPABASE_URL: `https://${PROD}.supabase.co`,
        VITE_SUPABASE_PROJECT_ID: STAGING,
      }),
    ).toBe(PROD);
  });
  it("falls back to the project id only when the URL is missing or not a Supabase host", () => {
    expect(supabaseProjectRef({ VITE_SUPABASE_PROJECT_ID: PROD })).toBe(PROD);
    expect(
      supabaseProjectRef({
        VITE_SUPABASE_URL: "http://localhost:54399",
        VITE_SUPABASE_PROJECT_ID: "local-mock",
      }),
    ).toBe("local-mock");
    expect(
      supabaseProjectRef({ VITE_SUPABASE_URL: "not a url", VITE_SUPABASE_PROJECT_ID: PROD }),
    ).toBe(PROD);
  });
  it("never returns an empty issuer", () => {
    expect(supabaseProjectRef({})).toBe("project-ref-unset");
  });
});
