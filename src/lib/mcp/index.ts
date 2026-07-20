import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listMyJobs from "./tools/list_my_jobs";
import getWallet from "./tools/get_wallet";
import listOpenJobs from "./tools/list_open_jobs";
import getPriceGuide from "./tools/get_price_guide";

// Direct Supabase issuer — the runtime SUPABASE_URL becomes the .lovable.cloud
// proxy on publish, which mcp-js rejects (RFC 8414 issuer mismatch).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "conz-mcp",
  title: "Con Z",
  version: "0.1.0",
  instructions:
    "Con Z is a Zimbabwe construction marketplace connecting customers with tipper truck drivers. " +
    "Use `list_my_jobs` to see the signed-in user's jobs (customer's posted jobs or driver's assigned jobs), " +
    "`list_open_jobs` to browse jobs available to bid on, `get_wallet` to check the user's balance and recent transactions, " +
    "and `get_price_guide` for fair-price ranges per material (10–15 m³ tipper load).",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listMyJobs, listOpenJobs, getWallet, getPriceGuide],
});
