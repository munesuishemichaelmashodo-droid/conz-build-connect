import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_wallet",
  title: "Get my wallet",
  description:
    "Get the signed-in Con Z user's wallet balance, pending balance, and last 10 wallet transactions.",
  inputSchema: {},
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    const uid = ctx.getUserId();
    const [wallet, txns] = await Promise.all([
      sb.from("wallets").select("*").eq("user_id", uid).maybeSingle(),
      sb
        .from("wallet_transactions")
        .select("id, amount, type, status, description, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (wallet.error) return { content: [{ type: "text", text: wallet.error.message }], isError: true };
    const payload = { wallet: wallet.data, recent_transactions: txns.data ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  },
});
