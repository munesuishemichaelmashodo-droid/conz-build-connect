import { fetchOpenJobs } from "@/lib/open-jobs";
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
    // Area-only open jobs (0133): exact addresses are never listed to a tool caller.
    let all: Record<string, unknown>[];
    try {
      all = await fetchOpenJobs<Record<string, unknown>>(sb as never, limit ?? 20);
    } catch (e) {
      return { content: [{ type: "text", text: (e as Error).message }], isError: true };
    }
    const data = all
      .filter((j) => !material || j.material === material)
      .map((j: Record<string, unknown>) => ({
        id: j.id,
        material: j.material,
        quantity_m3: j.quantity_m3,
        delivery_address: j.delivery_address,
        budget: j.budget,
        preferred_date: j.preferred_date,
        created_at: j.created_at,
      }));
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      // JSON-safe copy: the fields come from an untyped row, so the SDK's strict JSON type needs a plain value.
      structuredContent: { jobs: JSON.parse(JSON.stringify(data ?? [])) },
    };
  },
});
