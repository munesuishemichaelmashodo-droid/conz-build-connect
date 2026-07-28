import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BKwn9D3n.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { Q as Gavel, dt as CircleCheck, ut as CircleX, w as Search } from "../_libs/lucide-react.mjs";
import { r as useQueryClient, t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { r as StatusBadge, t as EmptyState } from "./ui-bits-DE9HqP-8.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin.disputes-BmDcJk7Y.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function AdminDisputes() {
	const [filter, setFilter] = (0, import_react.useState)("open");
	const qc = useQueryClient();
	const { data } = useQuery({
		queryKey: ["admin-disputes", filter],
		queryFn: async () => {
			const { data: disputes } = await supabase.from("disputes").select("id,job_id,raised_by,against,reason,status,resolution,created_at,resolved_at").eq("status", filter).order("created_at", { ascending: false });
			const userIds = Array.from(new Set((disputes ?? []).flatMap((d) => [d.raised_by, d.against].filter(Boolean))));
			const { data: profiles } = userIds.length ? await supabase.from("profiles").select("id,full_name").in("id", userIds) : { data: [] };
			const pmap = new Map(profiles?.map((p) => [p.id, p.full_name]) ?? []);
			return (disputes ?? []).map((d) => ({
				...d,
				raised_by_name: pmap.get(d.raised_by) ?? "—",
				against_name: d.against ? pmap.get(d.against) ?? "—" : "—"
			}));
		}
	});
	const resolve = async (id, status) => {
		let resolution = null;
		if (status !== "investigating") resolution = window.prompt("Resolution notes") ?? "";
		const { error } = await supabase.from("disputes").update({
			status,
			resolution,
			resolved_at: status === "investigating" ? null : (/* @__PURE__ */ new Date()).toISOString()
		}).eq("id", id);
		if (error) return toast.error(error.message);
		toast.success("Dispute updated");
		qc.invalidateQueries({ queryKey: ["admin-disputes"] });
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "grid grid-cols-4 gap-2",
			children: [
				"open",
				"investigating",
				"resolved",
				"rejected"
			].map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				onClick: () => setFilter(f),
				className: `rounded-lg border py-2 text-[11px] font-semibold uppercase ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground"}`,
				children: f
			}, f))
		}), !data?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
			icon: Gavel,
			title: `No ${filter} disputes`
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "space-y-3",
			children: data.map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-xl border bg-card p-4 space-y-2",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-start justify-between gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-xs",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "font-semibold",
								children: [
									d.raised_by_name,
									" ",
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-muted-foreground",
										children: "vs"
									}),
									" ",
									d.against_name
								]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "text-[10px] text-muted-foreground mt-0.5",
								children: [
									"Job ",
									d.job_id.slice(0, 8),
									" · ",
									new Date(d.created_at).toLocaleString()
								]
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
							label: d.status,
							className: d.status === "open" || d.status === "investigating" ? "bg-warning/15 text-warning border-warning/30" : d.status === "resolved" ? "bg-success/15 text-success border-success/30" : "bg-muted text-muted-foreground border-border"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm",
						children: d.reason
					}),
					d.resolution && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs italic text-muted-foreground border-l-2 border-primary/50 pl-2",
						children: d.resolution
					}),
					(filter === "open" || filter === "investigating") && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "grid grid-cols-3 gap-2 pt-1",
						children: [
							filter === "open" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => resolve(d.id, "investigating"),
								className: "rounded-lg border py-2 text-xs font-semibold hover:bg-warning/10",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, { className: "w-3.5 h-3.5 inline mr-1" }), " Investigate"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => resolve(d.id, "resolved"),
								className: `rounded-lg bg-success text-success-foreground font-semibold py-2 text-xs ${filter === "open" ? "" : "col-span-2"}`,
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleCheck, { className: "w-3.5 h-3.5 inline mr-1" }), " Resolve"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => resolve(d.id, "rejected"),
								className: "rounded-lg bg-destructive text-destructive-foreground font-semibold py-2 text-xs",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CircleX, { className: "w-3.5 h-3.5 inline mr-1" }), " Reject"]
							})
						]
					})
				]
			}, d.id))
		})]
	});
}
//#endregion
export { AdminDisputes as component };
