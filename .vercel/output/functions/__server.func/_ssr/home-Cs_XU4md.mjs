import { g as Link, m as createFileRoute, p as lazyRouteComponent } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { r as StatusBadge } from "./ui-bits-DE9HqP-8.mjs";
import { a as statusInfo, i as money, r as materialLabel } from "./domain-CYaPqfcD.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/home-Cs_XU4md.js
var import_jsx_runtime = require_jsx_runtime();
var $$splitComponentImporter = () => import("./home-DpOARyPc.mjs");
var Route = createFileRoute("/_authenticated/home")({ component: lazyRouteComponent($$splitComponentImporter, "component") });
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
export { Route as n, JobCard as t };
