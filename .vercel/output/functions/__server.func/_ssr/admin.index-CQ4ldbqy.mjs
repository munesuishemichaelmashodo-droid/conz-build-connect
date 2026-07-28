import { t as supabase } from "./client-BKwn9D3n.mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { N as OctagonAlert, at as DollarSign, b as ShieldCheck, i as Users, o as Truck, vt as Briefcase } from "../_libs/lucide-react.mjs";
import { t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { i as money } from "./domain-CYaPqfcD.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin.index-CQ4ldbqy.js
var import_jsx_runtime = require_jsx_runtime();
function Stat({ icon: Icon, label, value, sub }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-2xl border bg-card p-4 shadow-card",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-between",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "text-[11px] uppercase tracking-wider text-muted-foreground font-semibold",
					children: label
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { className: "w-4 h-4 text-primary" })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "font-display font-bold text-2xl mt-1",
				children: value
			}),
			sub && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "text-[11px] text-muted-foreground mt-0.5",
				children: sub
			})
		]
	});
}
function AdminDashboard() {
	const { data } = useQuery({
		queryKey: ["admin-dash"],
		queryFn: async () => {
			const [users, drivers, jobsOpen, jobsDone, pendingV, disputes, commissionRows, rate] = await Promise.all([
				supabase.from("profiles").select("id", {
					count: "exact",
					head: true
				}),
				supabase.from("user_roles").select("user_id", {
					count: "exact",
					head: true
				}).eq("role", "driver"),
				supabase.from("jobs").select("id", {
					count: "exact",
					head: true
				}).eq("status", "open"),
				supabase.from("jobs").select("id", {
					count: "exact",
					head: true
				}).eq("status", "completed"),
				supabase.from("driver_profiles").select("user_id", {
					count: "exact",
					head: true
				}).eq("verification_status", "pending"),
				supabase.from("disputes").select("id", {
					count: "exact",
					head: true
				}).in("status", ["open", "investigating"]),
				supabase.from("wallet_transactions").select("amount").eq("type", "commission"),
				supabase.from("system_settings").select("value").eq("key", "commission_rate").maybeSingle()
			]);
			const totalCommission = (commissionRows.data ?? []).reduce((a, r) => a + Math.abs(Number(r.amount)), 0);
			return {
				users: users.count ?? 0,
				drivers: drivers.count ?? 0,
				jobsOpen: jobsOpen.count ?? 0,
				jobsDone: jobsDone.count ?? 0,
				pendingV: pendingV.count ?? 0,
				disputes: disputes.count ?? 0,
				totalCommission,
				rate: Number(rate.data?.value ?? 7)
			};
		}
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid grid-cols-2 gap-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						icon: Users,
						label: "Users",
						value: String(data?.users ?? 0),
						sub: `${data?.drivers ?? 0} drivers`
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						icon: Briefcase,
						label: "Open jobs",
						value: String(data?.jobsOpen ?? 0),
						sub: `${data?.jobsDone ?? 0} completed`
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						icon: ShieldCheck,
						label: "Pending verify",
						value: String(data?.pendingV ?? 0)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Stat, {
						icon: OctagonAlert,
						label: "Open disputes",
						value: String(data?.disputes ?? 0)
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-2xl bg-gradient-dark text-white p-5 shadow-lift",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2 text-white/70 text-[11px] uppercase tracking-widest",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DollarSign, { className: "w-3.5 h-3.5" }), " Platform revenue"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "font-display font-bold text-4xl text-primary mt-1",
						children: money(data?.totalCommission ?? 0)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-xs text-white/60 mt-1",
						children: [
							"Total commission collected at ",
							data?.rate ?? 7,
							"%"
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground flex items-start gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Truck, { className: "w-4 h-4 mt-0.5 text-primary" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Use the tabs above to manage users, approve drivers, settle disputes, and adjust the platform commission." })]
			})
		]
	});
}
//#endregion
export { AdminDashboard as component };
