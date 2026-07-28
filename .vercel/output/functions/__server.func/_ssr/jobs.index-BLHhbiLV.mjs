import { t as supabase } from "./client-BKwn9D3n.mjs";
import { g as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { O as Plus, vt as Briefcase } from "../_libs/lucide-react.mjs";
import { t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-CKNZvOvp.mjs";
import { t as AppShell } from "./AppShell-1W_lsY73.mjs";
import { t as EmptyState } from "./ui-bits-DE9HqP-8.mjs";
import { t as JobCard } from "./home-Cs_XU4md.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/jobs.index-BLHhbiLV.js
var import_jsx_runtime = require_jsx_runtime();
function JobsPage() {
	const { userId, is } = useAuth();
	const isDriver = is("driver");
	const isCustomer = is("customer");
	const { data: jobs, isLoading } = useQuery({
		queryKey: [
			"jobs-list",
			userId,
			isDriver,
			isCustomer
		],
		enabled: !!userId,
		refetchInterval: 4e3,
		queryFn: async () => {
			let q = supabase.from("jobs").select("*").order("created_at", { ascending: false });
			if (isCustomer && !isDriver) q = q.eq("customer_id", userId);
			else if (isDriver && !isCustomer) q = q.or(`status.eq.open,driver_id.eq.${userId}`);
			const { data, error } = await q;
			if (error) throw error;
			return data;
		}
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {
		title: "Jobs",
		action: isCustomer ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
			asChild: true,
			size: "sm",
			className: "h-8",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
				to: "/jobs/new",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, { className: "w-4 h-4 mr-1" }), "New"]
			})
		}) : void 0,
		children: isLoading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "text-center text-muted-foreground py-10",
			children: "Loading…"
		}) : (jobs ?? []).length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
			icon: Briefcase,
			title: "No jobs yet",
			hint: isCustomer ? "Post your first delivery request." : "Check back soon for open requests."
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "space-y-2",
			children: jobs.map((j) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(JobCard, { j }, j.id))
		})
	});
}
//#endregion
export { JobsPage as component };
