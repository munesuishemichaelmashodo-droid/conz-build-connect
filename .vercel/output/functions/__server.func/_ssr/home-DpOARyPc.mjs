import { _ as Navigate, g as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { n as useAuth } from "./auth-CKNZvOvp.mjs";
import { n as useViewMode } from "./view-mode-BA6qxzLc.mjs";
import { t as AppShell } from "./AppShell-1W_lsY73.mjs";
import { r as StatusBadge } from "./ui-bits-DE9HqP-8.mjs";
import { a as statusInfo, i as money, r as materialLabel } from "./domain-CYaPqfcD.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/home-DpOARyPc.js
var import_jsx_runtime = require_jsx_runtime();
function HomePage() {
	const { loading, is } = useAuth();
	const { activeRole } = useViewMode();
	if (loading) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "text-center text-muted-foreground py-10",
		children: "Loading…"
	}) });
	if (activeRole === "driver") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Navigate, {
		to: "/driver",
		replace: true
	});
	if (activeRole === "customer") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Navigate, {
		to: "/customer",
		replace: true
	});
	const hasAny = is("driver") || is("customer");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {
		title: "Con Z",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "space-y-4 py-6 text-center",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "font-display font-bold text-xl",
					children: "Welcome to Con Z"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted-foreground",
					children: hasAny ? "Open the side menu to pick your view." : "Set up your account to get started."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					asChild: true,
					className: "w-full",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/profile",
						children: "Go to profile"
					})
				})
			]
		})
	});
}
function JobCard({ j }) {
	const s = statusInfo(j.status);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
		to: "/jobs/$id",
		params: { id: j.id },
		className: "block rounded-xl bg-card border p-4 shadow-soft hover:border-primary transition",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex items-start justify-between gap-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "min-w-0",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "font-display font-bold text-base truncate",
					children: materialLabel(j.material, j.custom_material)
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "text-xs text-muted-foreground truncate",
					children: j.delivery_address
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
				label: s.label,
				className: s.className
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mt-3 flex items-center justify-between text-sm",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "text-muted-foreground",
				children: [Number(j.quantity_m3), " m³"]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "font-display font-bold text-primary text-lg",
				children: money(Number(j.budget))
			})]
		})]
	});
}
//#endregion
export { JobCard, HomePage as component };
