import { g as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { H as Mail, q as LifeBuoy, z as MessageSquareWarning } from "../_libs/lucide-react.mjs";
import { t as AppShell } from "./AppShell-1W_lsY73.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/help-CdHd4Ppn.js
var import_jsx_runtime = require_jsx_runtime();
var FAQ = [
	{
		q: "How do I post a delivery job?",
		a: "From the customer home screen tap 'Book delivery' and follow the 3 steps: material & quantity, pickup & drop-off, then confirm."
	},
	{
		q: "How does driver matching work?",
		a: "When you post a job, verified drivers nearby get a 10-second offer. The first driver to accept wins the job."
	},
	{
		q: "How do I get paid as a driver?",
		a: "Customers pay you on delivery. Con Z takes a small commission (see wallet). Your first job is commission-free."
	},
	{
		q: "How do I top up my wallet?",
		a: "Open Wallet → Add funds → choose EcoCash / OneMoney / ZIPIT / bank and follow the prompts. Top-ups are instant."
	},
	{
		q: "My verification is taking long — what should I do?",
		a: "Most drivers are approved within 24 hours. If it's been longer, use the Report option in the side menu and we'll follow up."
	},
	{
		q: "How do I cancel a job?",
		a: "Open the job and tap 'Cancel job'. Cancelling after a driver accepts may result in a strike on your account."
	}
];
function HelpPage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {
		title: "Help & support",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "space-y-6 max-w-2xl mx-auto",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "rounded-2xl bg-gradient-dark text-white p-5",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LifeBuoy, { className: "w-8 h-8 text-primary" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
							className: "font-display font-bold text-2xl mt-2",
							children: "Need a hand?"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-sm text-white/70 mt-1",
							children: "Check the FAQ below or reach us directly."
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "space-y-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display font-bold uppercase tracking-wide text-sm",
						children: "Frequently asked"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "divide-y rounded-2xl border bg-card",
						children: FAQ.map((f) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
							className: "p-4 group",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", {
								className: "font-semibold cursor-pointer flex justify-between items-center",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: f.q }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-muted-foreground group-open:rotate-45 transition",
									children: "+"
								})]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "text-sm text-muted-foreground mt-2",
								children: f.a
							})]
						}, f.q))
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "grid gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
						href: "mailto:support@conz.co.zw",
						className: "flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-muted transition",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Mail, { className: "w-5 h-5 text-primary" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-semibold",
							children: "Email support"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-xs text-muted-foreground",
							children: "support@conz.co.zw — we usually reply within a day."
						})] })]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: "/report",
						search: { jobId: void 0 },
						className: "flex items-center gap-3 rounded-2xl border bg-card p-4 hover:bg-muted transition",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(MessageSquareWarning, { className: "w-5 h-5 text-primary" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-semibold",
							children: "Report an issue"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-xs text-muted-foreground",
							children: "Something wrong with a job, driver, or the app? Let admins know."
						})] })]
					})]
				})
			]
		})
	});
}
//#endregion
export { HelpPage as component };
