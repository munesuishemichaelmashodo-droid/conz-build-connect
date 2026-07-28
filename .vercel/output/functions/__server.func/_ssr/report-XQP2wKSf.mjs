import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BEr3FmPh.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { v as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { K as LoaderCircle, z as MessageSquareWarning } from "../_libs/lucide-react.mjs";
import { r as useQueryClient, t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-Dij6GkaO.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { t as AppShell } from "./AppShell-n1riXnH5.mjs";
import { t as Textarea } from "./textarea-kko37XEX.mjs";
import { t as Label } from "./label-DBD1bRRP.mjs";
import { t as Route } from "./report-Bsiu_Mmd.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/report-XQP2wKSf.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function ReportPage() {
	const { userId } = useAuth();
	const { jobId } = Route.useSearch();
	const qc = useQueryClient();
	const nav = useNavigate();
	const [description, setDescription] = (0, import_react.useState)("");
	const [linkedJob, setLinkedJob] = (0, import_react.useState)(jobId ?? "");
	const [submitting, setSubmitting] = (0, import_react.useState)(false);
	const { data: myJobs } = useQuery({
		queryKey: ["report-my-jobs", userId],
		enabled: !!userId,
		queryFn: async () => {
			const { data } = await supabase.from("jobs").select("id,material,status,created_at").or(`customer_id.eq.${userId},driver_id.eq.${userId}`).order("created_at", { ascending: false }).limit(30);
			return data ?? [];
		}
	});
	const { data: mine } = useQuery({
		queryKey: ["my-reports", userId],
		enabled: !!userId,
		queryFn: async () => {
			const { data } = await supabase.from("reports").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20);
			return data ?? [];
		}
	});
	const submit = async () => {
		if (description.trim().length < 5) return toast.error("Please describe the issue in a bit more detail.");
		setSubmitting(true);
		const { error } = await supabase.from("reports").insert({
			user_id: userId,
			description: description.trim(),
			job_id: linkedJob || null
		});
		setSubmitting(false);
		if (error) return toast.error(error.message);
		toast.success("Report submitted. Admins have been notified.");
		setDescription("");
		setLinkedJob("");
		qc.invalidateQueries({ queryKey: ["my-reports", userId] });
		setTimeout(() => nav({ to: "/home" }), 800);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {
		title: "Report an issue",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "max-w-xl mx-auto space-y-6",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "rounded-2xl bg-card border p-5 shadow-soft space-y-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MessageSquareWarning, { className: "w-5 h-5 text-primary" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-display font-bold uppercase tracking-wide",
							children: "Report an issue"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-muted-foreground",
						children: "Tell us what happened. Admins review every report and will follow up if we need more info."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
						htmlFor: "desc",
						children: "What's the issue?"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Textarea, {
						id: "desc",
						value: description,
						onChange: (e) => setDescription(e.target.value),
						rows: 5,
						maxLength: 2e3,
						placeholder: "Describe what happened, when it happened, and anyone involved…"
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
						htmlFor: "job",
						children: "Related job (optional)"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						id: "job",
						value: linkedJob,
						onChange: (e) => setLinkedJob(e.target.value),
						className: "w-full mt-1 rounded-md border bg-background px-3 py-2 text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "",
							children: "— No specific job —"
						}), (myJobs ?? []).map((j) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("option", {
							value: j.id,
							children: [
								j.material,
								" • ",
								j.status,
								" • ",
								new Date(j.created_at).toLocaleDateString()
							]
						}, j.id))]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						onClick: submit,
						disabled: submitting,
						className: "w-full",
						children: submitting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Submit report"
					})
				]
			}), (mine ?? []).length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "space-y-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "font-display font-bold uppercase tracking-wide text-sm",
					children: "Your recent reports"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "space-y-2",
					children: mine.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-xl border bg-card p-3 text-sm",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex justify-between items-center",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-[11px] uppercase font-semibold text-muted-foreground",
									children: r.status
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-[11px] text-muted-foreground",
									children: new Date(r.created_at).toLocaleString()
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-1 whitespace-pre-wrap",
								children: r.description
							}),
							r.admin_notes && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: "mt-2 text-xs bg-muted p-2 rounded",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Admin reply:" }),
									" ",
									r.admin_notes
								]
							})
						]
					}, r.id))
				})]
			})]
		})
	});
}
//#endregion
export { ReportPage as component };
