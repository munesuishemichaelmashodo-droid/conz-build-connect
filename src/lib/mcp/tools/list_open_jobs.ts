import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_open_jobs",
  title: "List open jobs",
  description:
    "Browse currently open (unassigned) Con Z delivery jobs that a driver could bid on. RLS applies — a caller who cannot view open jobs will get an empty list.",
  inputSchema: {
    material: z.string().optional().describe("Optional material filter (e.g. river_sand, gravel)."),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ material, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("jobs")
      .select("id, material, quantity_m3, delivery_address, budget, preferred_date, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (material) q = q.eq("material", material);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { jobs: data ?? [] },
    };
  },
});
