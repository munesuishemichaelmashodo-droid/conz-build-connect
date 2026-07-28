import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BKwn9D3n.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { _ as ShieldX, b as ShieldCheck, it as ExternalLink, v as ShieldQuestionMark } from "../_libs/lucide-react.mjs";
import { r as useQueryClient, t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { r as StatusBadge, t as EmptyState } from "./ui-bits-DE9HqP-8.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin.verifications-DD5f1jJA.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function AdminVerifications() {
	const [filter, setFilter] = (0, import_react.useState)("pending");
	const qc = useQueryClient();
	const { data } = useQuery({
		queryKey: ["admin-verifications", filter],
		queryFn: async () => {
			const { data: drivers } = await supabase.from("driver_profiles").select("user_id,national_id,national_id_url,selfie_url,license_url,tipper_photo_url,nationality,verification_status,verification_notes,created_at").eq("verification_status", filter).order("created_at", { ascending: false });
			const ids = (drivers ?? []).map((d) => d.user_id);
			if (!ids.length) return [];
			const { data: profiles } = await supabase.from("profiles").select("id,full_name,email,phone").in("id", ids);
			const pmap = new Map(profiles?.map((p) => [p.id, p]) ?? []);
			return (drivers ?? []).map((d) => ({
				...d,
				profile: pmap.get(d.user_id)
			}));
		}
	});
	const signedUrl = async (path) => {
		if (!path) return null;
		const { data } = await supabase.storage.from("driver-docs").createSignedUrl(path, 600);
		return data?.signedUrl ?? null;
	};
	const view = async (path) => {
		const url = await signedUrl(path);
		if (url) window.open(url, "_blank");
		else toast.error("File not available");
	};
	const setStatus = async (user_id, status, note) => {
		const { error } = await supabase.from("driver_profiles").update({
			verification_status: status,
			verification_notes: note ?? null
		}).eq("user_id", user_id);
		if (error) return toast.error(error.message);
		toast.success(status === "verified" ? "Driver verified" : "Driver rejected");
		qc.invalidateQueries({ queryKey: ["admin-verifications"] });
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "flex gap-2",
			children: [
				"pending",
				"verified",
				"rejected"
			].map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				onClick: () => setFilter(f),
				className: `flex-1 rounded-lg border py-2 text-xs font-semibold uppercase ${filter === f ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground"}`,
				children: f
			}, f))
		}), !data?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
			icon: ShieldQuestionMark,
			title: `No ${filter} drivers`,
			hint: "Driver verification requests will appear here."
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "space-y-3",
			children: data.map((d) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-xl border bg-card p-4 space-y-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-start justify-between gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "min-w-0",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-semibold truncate",
								children: d.profile?.full_name ?? "Unnamed"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-[11px] text-muted-foreground truncate",
								children: d.profile?.email ?? d.profile?.phone
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
							label: d.verification_status,
							className: d.verification_status === "verified" ? "bg-success/15 text-success border-success/30" : d.verification_status === "rejected" ? "bg-destructive/15 text-destructive border-destructive/30" : "bg-warning/15 text-warning border-warning/30"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-muted-foreground",
							children: "National ID: "
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-mono",
							children: d.national_id ?? "—"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-muted-foreground",
							children: "Nationality: "
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: d.nationality ?? "—" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "grid grid-cols-2 gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => view(d.national_id_url),
								disabled: !d.national_id_url,
								className: "rounded-lg border py-2 text-xs font-semibold disabled:opacity-40",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExternalLink, { className: "w-3.5 h-3.5 inline mr-1" }), " National ID"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => view(d.selfie_url),
								disabled: !d.selfie_url,
								className: "rounded-lg border py-2 text-xs font-semibold disabled:opacity-40",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExternalLink, { className: "w-3.5 h-3.5 inline mr-1" }), " Selfie"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => view(d.license_url),
								disabled: !d.license_url,
								className: "rounded-lg border py-2 text-xs font-semibold disabled:opacity-40",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExternalLink, { className: "w-3.5 h-3.5 inline mr-1" }), " Licence"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => view(d.tipper_photo_url),
								disabled: !d.tipper_photo_url,
								className: "rounded-lg border py-2 text-xs font-semibold disabled:opacity-40",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ExternalLink, { className: "w-3.5 h-3.5 inline mr-1" }), " Tipper"]
							})
						]
					}),
					filter === "pending" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "grid grid-cols-2 gap-2 pt-1",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							onClick: () => setStatus(d.user_id, "verified"),
							className: "rounded-lg bg-success text-success-foreground font-semibold py-2 text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldCheck, { className: "w-4 h-4 inline mr-1" }), " Approve"]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							onClick: () => {
								const reason = window.prompt("Reason for rejection (optional)") ?? void 0;
								setStatus(d.user_id, "rejected", reason);
							},
							className: "rounded-lg bg-destructive text-destructive-foreground font-semibold py-2 text-sm",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldX, { className: "w-4 h-4 inline mr-1" }), " Reject"]
						})]
					}),
					d.verification_notes && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-xs text-muted-foreground italic",
						children: ["Note: ", d.verification_notes]
					})
				]
			}, d.user_id))
		})]
	});
}
//#endregion
export { AdminVerifications as component };
