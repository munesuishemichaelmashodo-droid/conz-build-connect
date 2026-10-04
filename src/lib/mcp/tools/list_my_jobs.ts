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
  name: "list_my_jobs",
  title: "List my jobs",
  description:
    "List Con Z delivery jobs for the signed-in user. Customers see jobs they posted; drivers see jobs assigned to them. Returns up to 50 most recent jobs.",
  inputSchema: {
    status: z
      .enum(["open", "accepted", "in_progress", "completed", "cancelled", "any"])
      .optional()
      .describe("Filter by job status. Defaults to any."),
    limit: z.number().int().min(1).max(50).optional().describe("Max rows to return (1-50)."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const uid = ctx.getUserId();
    let q = sb
      .from("jobs")
      .select("id, status, material, quantity_m3, delivery_address, budget, preferred_date, created_at, customer_id, driver_id")
      .or(`customer_id.eq.${uid},driver_id.eq.${uid}`)
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (status && status !== "any") q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { jobs: data ?? [] },
    };
  },
});
