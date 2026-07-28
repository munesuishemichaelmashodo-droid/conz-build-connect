import { f as Outlet, g as Link, l as useRouterState } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as cn } from "./utils-C_uf36nf.mjs";
import { J as LayoutDashboard, Q as Gavel, S as Settings, T as ScrollText, b as ShieldCheck, c as TrendingUp, i as Users, z as MessageSquareWarning } from "../_libs/lucide-react.mjs";
import { n as useAuth } from "./auth-Dij6GkaO.mjs";
import { t as AppShell } from "./AppShell-n1riXnH5.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin-DD4ygatF.js
var import_jsx_runtime = require_jsx_runtime();
var TABS = [
	{
		to: "/admin",
		label: "Dashboard",
		icon: LayoutDashboard,
		exact: true
	},
	{
		to: "/admin/revenue",
		label: "Revenue",
		icon: TrendingUp,
		superOnly: true
	},
	{
		to: "/admin/users",
		label: "Users",
		icon: Users
	},
	{
		to: "/admin/verifications",
		label: "Verify",
		icon: ShieldCheck
	},
	{
		to: "/admin/disputes",
		label: "Disputes",
		icon: Gavel
	},
	{
		to: "/admin/reports",
		label: "Reports",
		icon: MessageSquareWarning
	},
	{
		to: "/admin/audit",
		label: "Audit",
		icon: ScrollText,
		superOnly: true
	},
	{
		to: "/admin/settings",
		label: "Settings",
		icon: Settings
	}
];
function AdminLayout() {
	const path = useRouterState({ select: (s) => s.location.pathname });
	const { is } = useAuth();
	const isSuper = is("super_admin");
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(AppShell, {
		title: "Con Z Control",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "-mx-4 px-4 overflow-x-auto mb-4",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex gap-2 min-w-max pb-1",
				children: TABS.filter((t) => !t.superOnly || isSuper).map((t) => {
					const active = t.exact ? path === t.to : path.startsWith(t.to);
					const Icon = t.icon;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
						to: t.to,
						className: cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors", active ? "bg-primary text-primary-foreground border-primary shadow-lift" : "bg-card text-muted-foreground hover:text-foreground"),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { className: "w-3.5 h-3.5" }), t.label]
					}, t.to);
				})
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {})]
	});
}
//#endregion
export { AdminLayout as component };
