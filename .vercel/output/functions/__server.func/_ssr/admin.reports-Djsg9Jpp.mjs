import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BKwn9D3n.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { z as MessageSquareWarning } from "../_libs/lucide-react.mjs";
import { r as useQueryClient, t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { r as StatusBadge, t as EmptyState } from "./ui-bits-DE9HqP-8.mjs";
import { t as Textarea } from "./textarea-kko37XEX.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin.reports-Djsg9Jpp.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function AdminReports() {
	const qc = useQueryClient();
	const [filter, setFilter] = (0, import_react.useState)("open");
	const { data } = useQuery({
		queryKey: ["admin-reports", filter],
		queryFn: async () => {
			let q = supabase.from("reports").select("*").order("created_at", { ascending: false });
			if (filter !== "all") q = q.eq("status", filter);
			const { data: rows } = await q;
			const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
			const { data: profs } = userIds.length ? await supabase.from("profiles").select("id,full_name,email").in("id", userIds) : { data: [] };
			const pmap = new Map((profs ?? []).map((p) => [p.id, p]));
			return (rows ?? []).map((r) => ({
				...r,
				profile: pmap.get(r.user_id)
			}));
		}
	});
	const update = async (id, patch) => {
		const { error } = await supabase.from("reports").update(patch).eq("id", id);
		if (error) return toast.error(error.message);
		toast.success("Report updated");
		qc.invalidateQueries({ queryKey: ["admin-reports"] });
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "flex gap-2",
			children: [
				"open",
				"resolved",
				"all"
			].map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				onClick: () => setFilter(f),
				className: `flex-1 rounded-lg border py-2 text-xs font-semibold uppercase ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground"}`,
				children: f
			}, f))
		}), !data?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
			icon: MessageSquareWarning,
			title: `No ${filter} reports`,
			hint: "User-submitted reports will appear here."
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "space-y-3",
			children: data.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReportCard, {
				r,
				onUpdate: update
			}, r.id))
		})]
	});
}
function ReportCard({ r, onUpdate }) {
	const [note, setNote] = (0, import_react.useState)(r.admin_notes ?? "");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-xl border bg-card p-4 space-y-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-start justify-between gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "min-w-0",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "font-semibold",
						children: r.profile?.full_name ?? "Unknown user"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "text-xs text-muted-foreground truncate",
						children: r.profile?.email
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
					label: r.status,
					className: r.status === "resolved" ? "bg-success/15 text-success border-success/30" : "bg-warning/15 text-warning border-warning/30"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm whitespace-pre-wrap",
				children: r.description
			}),
			r.job_id && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "text-[11px] text-muted-foreground",
				children: ["Related job: ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: r.job_id })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-[11px] text-muted-foreground",
				children: new Date(r.created_at).toLocaleString()
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-2 pt-2 border-t",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Textarea, {
					value: note,
					onChange: (e) => setNote(e.target.value),
					placeholder: "Admin reply / internal note…",
					rows: 2
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid grid-cols-2 gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						variant: "outline",
						onClick: () => onUpdate(r.id, { admin_notes: note }),
						children: "Save note"
					}), r.status === "open" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						onClick: () => onUpdate(r.id, {
							status: "resolved",
							admin_notes: note
						}),
						children: "Mark resolved"
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						size: "sm",
						variant: "outline",
						onClick: () => onUpdate(r.id, {
							status: "open",
							admin_notes: note
						}),
						children: "Reopen"
					})]
				})]
			})
		]
	});
}
//#endregion
export { AdminReports as component };
