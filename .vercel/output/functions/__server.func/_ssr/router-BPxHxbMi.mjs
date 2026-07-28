import { o as __toESM } from "../_runtime.mjs";
import { t as createClient } from "../_libs/supabase__supabase-js.mjs";
import { t as supabase } from "./client-BKwn9D3n.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { M as redirect, c as HeadContent, d as createRouter, f as Outlet, g as Link, h as createRootRouteWithContext, m as createFileRoute, p as lazyRouteComponent, s as Scripts, y as useRouter } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as Route$30 } from "../_._lovable.oauth.consent-CPgIe8m7.mjs";
import { t as QueryClient } from "../_libs/tanstack__query-core.mjs";
import { n as QueryClientProvider } from "../_libs/tanstack__react-query.mjs";
import { t as AuthProvider } from "./auth-CKNZvOvp.mjs";
import { t as ViewModeProvider } from "./view-mode-BA6qxzLc.mjs";
import { t as Toaster } from "../_libs/sonner.mjs";
import { et as enumType, rt as stringType, tt as numberType } from "../_libs/@ai-sdk/gateway+[...].mjs";
import { t as Route$31 } from "./auth-AULqSfFa.mjs";
import { t as Route$32 } from "./chat._jobId-8bo9oFEK.mjs";
import { n as Route$33 } from "./home-Cs_XU4md.mjs";
import { t as Route$34 } from "./jobs._id-YouHS9hg.mjs";
import { t as Route$35 } from "./report-DdRlIpX1.mjs";
import { a as createTanStackListToolsHandler, i as createTanStackInvokeToolHandler, n as defineMcp, o as createTanStackMcpHandler, r as defineTool, s as createTanStackOAuthProtectedResourceMetadataHandler, t as auth } from "../_libs/@lovable.dev/mcp-js+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/router-BPxHxbMi.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var styles_default = "/assets/styles-CtZlenSB.css";
function reportLovableError(error, context = {}) {
	if (typeof window === "undefined") return;
	window.__lovableEvents?.captureException?.(error, {
		source: "react_error_boundary",
		route: window.location.pathname,
		...context
	}, {
		mechanism: "react_error_boundary",
		handled: false,
		severity: "error"
	});
}
var Toaster$1 = ({ ...props }) => {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toaster, {
		className: "toaster group",
		toastOptions: { classNames: {
			toast: "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
			description: "group-[.toast]:text-muted-foreground",
			actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
			cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground"
		} },
		...props
	});
};
function NotFoundComponent() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "flex min-h-screen items-center justify-center bg-background px-4",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "max-w-md text-center",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "text-7xl font-display font-bold text-primary",
					children: "404"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "mt-4 text-xl font-semibold",
					children: "Page not found"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted-foreground",
					children: "That page isn't on the map. Let's get you back to base."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-6",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
						to: "/",
						className: "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90",
						children: "Go home"
					})
				})
			]
		})
	});
}
function ErrorComponent({ error, reset }) {
	console.error(error);
	const router = useRouter();
	(0, import_react.useEffect)(() => {
		reportLovableError(error, { boundary: "tanstack_root_error_component" });
	}, [error]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "flex min-h-screen items-center justify-center bg-background px-4",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "max-w-md text-center",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "text-xl font-display font-bold uppercase tracking-wide",
					children: "Something broke on the build site"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-muted-foreground",
					children: "Try again — or head back to the yard."
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-6 flex flex-wrap justify-center gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						onClick: () => {
							router.invalidate();
							reset();
						},
						className: "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90",
						children: "Try again"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
						href: "/",
						className: "inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-accent",
						children: "Go home"
					})]
				})
			]
		})
	});
}
var Route$29 = createRootRouteWithContext()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1, viewport-fit=cover"
			},
			{
				httpEquiv: "Permissions-Policy",
				content: "geolocation=(self)"
			},
			{ title: "Con Z — Construction Made Easy" },
			{
				name: "description",
				content: "Zimbabwe's construction marketplace. Post jobs. Get tipper trucks. Build."
			},
			{
				name: "theme-color",
				content: "#ee6c1a"
			},
			{
				name: "apple-mobile-web-app-capable",
				content: "yes"
			},
			{
				name: "apple-mobile-web-app-status-bar-style",
				content: "black-translucent"
			},
			{
				name: "apple-mobile-web-app-title",
				content: "Con Z"
			},
			{
				property: "og:title",
				content: "Con Z — Construction Made Easy"
			},
			{
				property: "og:description",
				content: "Zimbabwe's construction marketplace. Post jobs. Get tipper trucks. Build."
			},
			{
				property: "og:type",
				content: "website"
			},
			{
				name: "twitter:title",
				content: "Con Z — Construction Made Easy"
			},
			{
				name: "twitter:description",
				content: "Zimbabwe's construction marketplace. Post jobs. Get tipper trucks. Build."
			},
			{
				property: "og:image",
				content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/4d05f15a-7722-42ea-a3c5-3eecd99b318c/id-preview-06f31798--d6171186-9007-4171-9ac3-88faed9a4817.lovable.app-1783595269103.png"
			},
			{
				name: "twitter:image",
				content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/4d05f15a-7722-42ea-a3c5-3eecd99b318c/id-preview-06f31798--d6171186-9007-4171-9ac3-88faed9a4817.lovable.app-1783595269103.png"
			},
			{
				name: "twitter:card",
				content: "summary_large_image"
			}
		],
		links: [
			{
				rel: "stylesheet",
				href: styles_default
			},
			{
				rel: "manifest",
				href: "/manifest.webmanifest"
			},
			{
				rel: "icon",
				href: "/favicon.png",
				type: "image/png"
			},
			{
				rel: "apple-touch-icon",
				href: "/apple-touch-icon.png"
			}
		]
	}),
	shellComponent: RootShell,
	component: RootComponent,
	notFoundComponent: NotFoundComponent,
	errorComponent: ErrorComponent
});
function RootShell({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("html", {
		lang: "en",
		className: "dark",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("head", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(HeadContent, {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("script", { dangerouslySetInnerHTML: { __html: `(function(){try{var t=localStorage.getItem('conz.theme')||'dark';var r=document.documentElement;if(t==='dark'){r.classList.add('dark')}else{r.classList.remove('dark')}}catch(e){}})();` } })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("body", { children: [children, /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scripts, {})] })]
	});
}
function RootComponent() {
	const { queryClient } = Route$29.useRouteContext();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(QueryClientProvider, {
		client: queryClient,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AuthProvider, { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(ViewModeProvider, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Outlet, {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Toaster$1, {
			position: "top-center",
			richColors: true
		})] }) })
	});
}
var $$splitComponentImporter$23 = () => import("./terms-BnuWJLBR.mjs");
var Route$28 = createFileRoute("/terms")({
	head: () => ({ meta: [
		{ title: "Terms and Conditions — Con Z" },
		{
			name: "description",
			content: "Terms and Conditions governing use of the Con Z Connect construction logistics marketplace."
		},
		{
			property: "og:title",
			content: "Terms and Conditions — Con Z"
		},
		{
			property: "og:description",
			content: "Terms and Conditions governing use of the Con Z Connect construction logistics marketplace."
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$23, "component")
});
var $$splitComponentImporter$22 = () => import("./reset-password-CgdKns54.mjs");
var Route$27 = createFileRoute("/reset-password")({
	ssr: false,
	component: lazyRouteComponent($$splitComponentImporter$22, "component")
});
var $$splitComponentImporter$21 = () => import("./privacy-9z6P9ZLd.mjs");
var Route$26 = createFileRoute("/privacy")({
	head: () => ({ meta: [
		{ title: "Privacy Policy — Con Z" },
		{
			name: "description",
			content: "How Con Z Connect collects, uses, and stores your data on the construction logistics marketplace."
		},
		{
			property: "og:title",
			content: "Privacy Policy — Con Z"
		},
		{
			property: "og:description",
			content: "How Con Z Connect collects, uses, and stores your data on the construction logistics marketplace."
		}
	] }),
	component: lazyRouteComponent($$splitComponentImporter$21, "component")
});
var $$splitComponentImporter$20 = () => import("./oauth-callback-DU0sJTm9.mjs");
var Route$25 = createFileRoute("/oauth-callback")({
	ssr: false,
	component: lazyRouteComponent($$splitComponentImporter$20, "component")
});
function supabaseForUser$3(ctx) {
	return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
		global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
		auth: {
			persistSession: false,
			autoRefreshToken: false
		}
	});
}
var list_my_jobs_default = defineTool({
	name: "list_my_jobs",
	title: "List my jobs",
	description: "List Con Z delivery jobs for the signed-in user. Customers see jobs they posted; drivers see jobs assigned to them. Returns up to 50 most recent jobs.",
	inputSchema: {
		status: enumType([
			"open",
			"assigned",
			"in_progress",
			"completed",
			"cancelled",
			"expired",
			"any"
		]).optional().describe("Filter by job status. Defaults to any."),
		limit: numberType().int().min(1).max(50).optional().describe("Max rows to return (1-50).")
	},
	annotations: {
		readOnlyHint: true,
		openWorldHint: false
	},
	handler: async ({ status, limit }, ctx) => {
		if (!ctx.isAuthenticated()) return {
			content: [{
				type: "text",
				text: "Not authenticated"
			}],
			isError: true
		};
		const sb = supabaseForUser$3(ctx);
		const uid = ctx.getUserId();
		let q = sb.from("jobs").select("id, status, material, quantity_m3, delivery_address, budget, preferred_date, created_at, customer_id, driver_id").or(`customer_id.eq.${uid},driver_id.eq.${uid}`).order("created_at", { ascending: false }).limit(limit ?? 20);
		if (status && status !== "any") q = q.eq("status", status);
		const { data, error } = await q;
		if (error) return {
			content: [{
				type: "text",
				text: error.message
			}],
			isError: true
		};
		return {
			content: [{
				type: "text",
				text: JSON.stringify(data ?? [])
			}],
			structuredContent: { jobs: data ?? [] }
		};
	}
});
function supabaseForUser$2(ctx) {
	return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
		global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
		auth: {
			persistSession: false,
			autoRefreshToken: false
		}
	});
}
var get_wallet_default = defineTool({
	name: "get_wallet",
	title: "Get my wallet",
	description: "Get the signed-in Con Z user's wallet balance, pending balance, and last 10 wallet transactions.",
	inputSchema: {},
	annotations: {
		readOnlyHint: true,
		openWorldHint: false
	},
	handler: async (_input, ctx) => {
		if (!ctx.isAuthenticated()) return {
			content: [{
				type: "text",
				text: "Not authenticated"
			}],
			isError: true
		};
		const sb = supabaseForUser$2(ctx);
		const uid = ctx.getUserId();
		const [wallet, txns] = await Promise.all([sb.from("wallets").select("*").eq("user_id", uid).maybeSingle(), sb.from("wallet_transactions").select("id, amount, type, status, description, created_at").eq("user_id", uid).order("created_at", { ascending: false }).limit(10)]);
		if (wallet.error) return {
			content: [{
				type: "text",
				text: wallet.error.message
			}],
			isError: true
		};
		const payload = {
			wallet: wallet.data,
			recent_transactions: txns.data ?? []
		};
		return {
			content: [{
				type: "text",
				text: JSON.stringify(payload)
			}],
			structuredContent: payload
		};
	}
});
function supabaseForUser$1(ctx) {
	return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
		global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
		auth: {
			persistSession: false,
			autoRefreshToken: false
		}
	});
}
var list_open_jobs_default = defineTool({
	name: "list_open_jobs",
	title: "List open jobs",
	description: "Browse currently open (unassigned) Con Z delivery jobs that a driver could bid on. RLS applies — a caller who cannot view open jobs will get an empty list.",
	inputSchema: {
		material: stringType().optional().describe("Optional material filter (e.g. river_sand, gravel)."),
		limit: numberType().int().min(1).max(50).optional()
	},
	annotations: {
		readOnlyHint: true,
		openWorldHint: false
	},
	handler: async ({ material, limit }, ctx) => {
		if (!ctx.isAuthenticated()) return {
			content: [{
				type: "text",
				text: "Not authenticated"
			}],
			isError: true
		};
		let q = supabaseForUser$1(ctx).from("jobs").select("id, material, quantity_m3, delivery_address, budget, preferred_date, created_at").eq("status", "open").order("created_at", { ascending: false }).limit(limit ?? 20);
		if (material) q = q.eq("material", material);
		const { data, error } = await q;
		if (error) return {
			content: [{
				type: "text",
				text: error.message
			}],
			isError: true
		};
		return {
			content: [{
				type: "text",
				text: JSON.stringify(data ?? [])
			}],
			structuredContent: { jobs: data ?? [] }
		};
	}
});
function supabaseForUser(ctx) {
	return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
		global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
		auth: {
			persistSession: false,
			autoRefreshToken: false
		}
	});
}
var get_price_guide_default = defineTool({
	name: "get_price_guide",
	title: "Get material price guide",
	description: "Return the Con Z enforced price ranges per material for a standard 10–15 m³ tipper load (min, max, step, unit).",
	inputSchema: {},
	annotations: {
		readOnlyHint: true,
		idempotentHint: true,
		openWorldHint: false
	},
	handler: async (_input, ctx) => {
		if (!ctx.isAuthenticated()) return {
			content: [{
				type: "text",
				text: "Not authenticated"
			}],
			isError: true
		};
		const { data, error } = await supabaseForUser(ctx).from("material_prices").select("*").order("material");
		if (error) return {
			content: [{
				type: "text",
				text: error.message
			}],
			isError: true
		};
		return {
			content: [{
				type: "text",
				text: JSON.stringify(data ?? [])
			}],
			structuredContent: { prices: data ?? [] }
		};
	}
});
var mcp_default = defineMcp({
	name: "conz-mcp",
	title: "Con Z",
	version: "0.1.0",
	instructions: "Con Z is a Zimbabwe construction marketplace connecting customers with tipper truck drivers. Use `list_my_jobs` to see the signed-in user's jobs (customer's posted jobs or driver's assigned jobs), `list_open_jobs` to browse jobs available to bid on, `get_wallet` to check the user's balance and recent transactions, and `get_price_guide` for fair-price ranges per material (10–15 m³ tipper load).",
	auth: auth.oauth.issuer({
		issuer: `https://nyivrhdpxsrxyfmexxkn.supabase.co/auth/v1`,
		acceptedAudiences: "authenticated"
	}),
	tools: [
		list_my_jobs_default,
		list_open_jobs_default,
		get_wallet_default,
		get_price_guide_default
	]
});
var Route$24 = createFileRoute("/mcp")({ server: { handlers: { ANY: createTanStackMcpHandler(mcp_default, {
	resourcePath: "/mcp",
	metadataPath: "/.well-known/oauth-protected-resource",
	trustForwardedHost: true
}) } } });
var $$splitComponentImporter$19 = () => import("./route-Di7iQBCH.mjs");
var Route$23 = createFileRoute("/_authenticated")({
	ssr: false,
	beforeLoad: async () => {
		const { data, error } = await supabase.auth.getUser();
		if (error || !data.user) throw redirect({ to: "/auth" });
		return { user: data.user };
	},
	component: lazyRouteComponent($$splitComponentImporter$19, "component")
});
var $$splitComponentImporter$18 = () => import("./routes-DCmNkArz.mjs");
var Route$22 = createFileRoute("/")({
	ssr: false,
	beforeLoad: async () => {
		const { data } = await supabase.auth.getSession();
		if (data.session) throw redirect({ to: "/home" });
	},
	component: lazyRouteComponent($$splitComponentImporter$18, "component")
});
var $$splitComponentImporter$17 = () => import("./wallet-jNq2GqMr.mjs");
var Route$21 = createFileRoute("/_authenticated/wallet")({ component: lazyRouteComponent($$splitComponentImporter$17, "component") });
var $$splitComponentImporter$16 = () => import("./profile-F4-S2KdP.mjs");
var Route$20 = createFileRoute("/_authenticated/profile")({ component: lazyRouteComponent($$splitComponentImporter$16, "component") });
var $$splitComponentImporter$15 = () => import("./help-CdHd4Ppn.mjs");
var Route$19 = createFileRoute("/_authenticated/help")({ component: lazyRouteComponent($$splitComponentImporter$15, "component") });
var $$splitComponentImporter$14 = () => import("./driver-Bm8vtWtU.mjs");
var Route$18 = createFileRoute("/_authenticated/driver")({
	beforeLoad: async () => {
		const { data: u } = await supabase.auth.getUser();
		if (!u.user) throw redirect({ to: "/auth" });
		const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
		if (!(roles ?? []).map((r) => r.role).includes("driver")) throw redirect({ to: "/home" });
	},
	component: lazyRouteComponent($$splitComponentImporter$14, "component")
});
var $$splitComponentImporter$13 = () => import("./customer-BQDiTXGU.mjs");
var Route$17 = createFileRoute("/_authenticated/customer")({
	beforeLoad: async () => {
		const { data: u } = await supabase.auth.getUser();
		if (!u.user) throw redirect({ to: "/auth" });
		const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
		if (!(roles ?? []).map((r) => r.role).includes("customer")) throw redirect({ to: "/home" });
	},
	component: lazyRouteComponent($$splitComponentImporter$13, "component")
});
var $$splitComponentImporter$12 = () => import("./become-driver-De8E7KLY.mjs");
var Route$16 = createFileRoute("/_authenticated/become-driver")({ component: lazyRouteComponent($$splitComponentImporter$12, "component") });
var $$splitComponentImporter$11 = () => import("./admin-WtuHP-y9.mjs");
var Route$15 = createFileRoute("/_authenticated/admin")({
	beforeLoad: async () => {
		const { data: u } = await supabase.auth.getUser();
		if (!u.user) throw redirect({ to: "/auth" });
		const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
		const list = (roles ?? []).map((r) => r.role);
		if (!list.includes("admin") && !list.includes("super_admin")) throw redirect({ to: "/home" });
	},
	component: lazyRouteComponent($$splitComponentImporter$11, "component")
});
var Route$14 = createFileRoute("/.well-known/oauth-protected-resource")({ server: { handlers: { ANY: createTanStackOAuthProtectedResourceMetadataHandler(mcp_default, {
	resourcePath: "/mcp",
	metadataPath: "/.well-known/oauth-protected-resource",
	trustForwardedHost: true
}) } } });
var Route$13 = createFileRoute("/.mcp/list-tools")({ server: { handlers: { ANY: createTanStackListToolsHandler(mcp_default, {
	resourcePath: "/mcp",
	metadataPath: "/.well-known/oauth-protected-resource",
	trustForwardedHost: true
}) } } });
var $$splitComponentImporter$10 = () => import("./jobs.index-BLHhbiLV.mjs");
var Route$12 = createFileRoute("/_authenticated/jobs/")({ component: lazyRouteComponent($$splitComponentImporter$10, "component") });
var $$splitComponentImporter$9 = () => import("./customer.index-D8WHZTET.mjs");
var Route$11 = createFileRoute("/_authenticated/customer/")({ component: lazyRouteComponent($$splitComponentImporter$9, "component") });
var $$splitComponentImporter$8 = () => import("./admin.index-CQ4ldbqy.mjs");
var Route$10 = createFileRoute("/_authenticated/admin/")({ component: lazyRouteComponent($$splitComponentImporter$8, "component") });
var Route$9 = createFileRoute("/_authenticated/jobs/new")({ beforeLoad: () => {
	throw redirect({ to: "/customer/book" });
} });
var $$splitComponentImporter$7 = () => import("./customer.book-CP3sCNgN.mjs");
var Route$8 = createFileRoute("/_authenticated/customer/book")({ component: lazyRouteComponent($$splitComponentImporter$7, "component") });
var $$splitComponentImporter$6 = () => import("./admin.verifications-DD5f1jJA.mjs");
var Route$7 = createFileRoute("/_authenticated/admin/verifications")({ component: lazyRouteComponent($$splitComponentImporter$6, "component") });
var $$splitComponentImporter$5 = () => import("./admin.users-Dgwi9n3G.mjs");
var Route$6 = createFileRoute("/_authenticated/admin/users")({ component: lazyRouteComponent($$splitComponentImporter$5, "component") });
var $$splitComponentImporter$4 = () => import("./admin.settings-DCBeOm8H.mjs");
var Route$5 = createFileRoute("/_authenticated/admin/settings")({ component: lazyRouteComponent($$splitComponentImporter$4, "component") });
var $$splitComponentImporter$3 = () => import("./admin.revenue-o-9rdQBG.mjs");
var Route$4 = createFileRoute("/_authenticated/admin/revenue")({
	beforeLoad: async () => {
		const { data: u } = await supabase.auth.getUser();
		if (!u.user) throw redirect({ to: "/auth" });
		const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
		if (!(roles ?? []).map((r) => r.role).includes("super_admin")) throw redirect({ to: "/admin" });
	},
	component: lazyRouteComponent($$splitComponentImporter$3, "component")
});
var $$splitComponentImporter$2 = () => import("./admin.reports-Djsg9Jpp.mjs");
var Route$3 = createFileRoute("/_authenticated/admin/reports")({ component: lazyRouteComponent($$splitComponentImporter$2, "component") });
var $$splitComponentImporter$1 = () => import("./admin.disputes-BmDcJk7Y.mjs");
var Route$2 = createFileRoute("/_authenticated/admin/disputes")({ component: lazyRouteComponent($$splitComponentImporter$1, "component") });
var $$splitComponentImporter = () => import("./admin.audit-BQ38myI7.mjs");
var Route$1 = createFileRoute("/_authenticated/admin/audit")({
	beforeLoad: async () => {
		const { data: u } = await supabase.auth.getUser();
		if (!u.user) throw redirect({ to: "/auth" });
		const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
		if (!(roles ?? []).map((r) => r.role).includes("super_admin")) throw redirect({ to: "/admin" });
	},
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
var Route = createFileRoute("/.mcp/invoke-tool/$tool")({ server: { handlers: { ANY: createTanStackInvokeToolHandler(mcp_default, {
	resourcePath: "/mcp",
	metadataPath: "/.well-known/oauth-protected-resource",
	trustForwardedHost: true
}) } } });
var TermsRoute = Route$28.update({
	id: "/terms",
	path: "/terms",
	getParentRoute: () => Route$29
});
var ResetPasswordRoute = Route$27.update({
	id: "/reset-password",
	path: "/reset-password",
	getParentRoute: () => Route$29
});
var PrivacyRoute = Route$26.update({
	id: "/privacy",
	path: "/privacy",
	getParentRoute: () => Route$29
});
var OauthCallbackRoute = Route$25.update({
	id: "/oauth-callback",
	path: "/oauth-callback",
	getParentRoute: () => Route$29
});
var McpRoute = Route$24.update({
	id: "/mcp",
	path: "/mcp",
	getParentRoute: () => Route$29
});
var AuthRoute = Route$31.update({
	id: "/auth",
	path: "/auth",
	getParentRoute: () => Route$29
});
var AuthenticatedRouteRoute = Route$23.update({
	id: "/_authenticated",
	getParentRoute: () => Route$29
});
var IndexRoute = Route$22.update({
	id: "/",
	path: "/",
	getParentRoute: () => Route$29
});
var AuthenticatedWalletRoute = Route$21.update({
	id: "/wallet",
	path: "/wallet",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedReportRoute = Route$35.update({
	id: "/report",
	path: "/report",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedProfileRoute = Route$20.update({
	id: "/profile",
	path: "/profile",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedHomeRoute = Route$33.update({
	id: "/home",
	path: "/home",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedHelpRoute = Route$19.update({
	id: "/help",
	path: "/help",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedDriverRoute = Route$18.update({
	id: "/driver",
	path: "/driver",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedCustomerRoute = Route$17.update({
	id: "/customer",
	path: "/customer",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedBecomeDriverRoute = Route$16.update({
	id: "/become-driver",
	path: "/become-driver",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedAdminRoute = Route$15.update({
	id: "/admin",
	path: "/admin",
	getParentRoute: () => AuthenticatedRouteRoute
});
var Char91DotwellKnownChar93OauthProtectedResourceRoute = Route$14.update({
	id: "/.well-known/oauth-protected-resource",
	path: "/.well-known/oauth-protected-resource",
	getParentRoute: () => Route$29
});
var Char91DotmcpChar93ListToolsRoute = Route$13.update({
	id: "/.mcp/list-tools",
	path: "/.mcp/list-tools",
	getParentRoute: () => Route$29
});
var AuthenticatedJobsIndexRoute = Route$12.update({
	id: "/jobs/",
	path: "/jobs/",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedCustomerIndexRoute = Route$11.update({
	id: "/",
	path: "/",
	getParentRoute: () => AuthenticatedCustomerRoute
});
var AuthenticatedAdminIndexRoute = Route$10.update({
	id: "/",
	path: "/",
	getParentRoute: () => AuthenticatedAdminRoute
});
var AuthenticatedJobsNewRoute = Route$9.update({
	id: "/jobs/new",
	path: "/jobs/new",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedJobsIdRoute = Route$34.update({
	id: "/jobs/$id",
	path: "/jobs/$id",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedCustomerBookRoute = Route$8.update({
	id: "/book",
	path: "/book",
	getParentRoute: () => AuthenticatedCustomerRoute
});
var AuthenticatedChatJobIdRoute = Route$32.update({
	id: "/chat/$jobId",
	path: "/chat/$jobId",
	getParentRoute: () => AuthenticatedRouteRoute
});
var AuthenticatedAdminVerificationsRoute = Route$7.update({
	id: "/verifications",
	path: "/verifications",
	getParentRoute: () => AuthenticatedAdminRoute
});
var AuthenticatedAdminUsersRoute = Route$6.update({
	id: "/users",
	path: "/users",
	getParentRoute: () => AuthenticatedAdminRoute
});
var AuthenticatedAdminSettingsRoute = Route$5.update({
	id: "/settings",
	path: "/settings",
	getParentRoute: () => AuthenticatedAdminRoute
});
var AuthenticatedAdminRevenueRoute = Route$4.update({
	id: "/revenue",
	path: "/revenue",
	getParentRoute: () => AuthenticatedAdminRoute
});
var AuthenticatedAdminReportsRoute = Route$3.update({
	id: "/reports",
	path: "/reports",
	getParentRoute: () => AuthenticatedAdminRoute
});
var AuthenticatedAdminDisputesRoute = Route$2.update({
	id: "/disputes",
	path: "/disputes",
	getParentRoute: () => AuthenticatedAdminRoute
});
var AuthenticatedAdminAuditRoute = Route$1.update({
	id: "/audit",
	path: "/audit",
	getParentRoute: () => AuthenticatedAdminRoute
});
var Char91DotmcpChar93InvokeToolToolRoute = Route.update({
	id: "/.mcp/invoke-tool/$tool",
	path: "/.mcp/invoke-tool/$tool",
	getParentRoute: () => Route$29
});
var DotlovableOauthConsentRoute = Route$30.update({
	id: "/.lovable/oauth/consent",
	path: "/.lovable/oauth/consent",
	getParentRoute: () => Route$29
});
var AuthenticatedAdminRouteChildren = {
	AuthenticatedAdminAuditRoute,
	AuthenticatedAdminDisputesRoute,
	AuthenticatedAdminReportsRoute,
	AuthenticatedAdminRevenueRoute,
	AuthenticatedAdminSettingsRoute,
	AuthenticatedAdminUsersRoute,
	AuthenticatedAdminVerificationsRoute,
	AuthenticatedAdminIndexRoute
};
var AuthenticatedAdminRouteWithChildren = AuthenticatedAdminRoute._addFileChildren(AuthenticatedAdminRouteChildren);
var AuthenticatedCustomerRouteChildren = {
	AuthenticatedCustomerBookRoute,
	AuthenticatedCustomerIndexRoute
};
var AuthenticatedRouteRouteChildren = {
	AuthenticatedAdminRoute: AuthenticatedAdminRouteWithChildren,
	AuthenticatedBecomeDriverRoute,
	AuthenticatedCustomerRoute: AuthenticatedCustomerRoute._addFileChildren(AuthenticatedCustomerRouteChildren),
	AuthenticatedDriverRoute,
	AuthenticatedHelpRoute,
	AuthenticatedHomeRoute,
	AuthenticatedProfileRoute,
	AuthenticatedReportRoute,
	AuthenticatedWalletRoute,
	AuthenticatedChatJobIdRoute,
	AuthenticatedJobsIdRoute,
	AuthenticatedJobsNewRoute,
	AuthenticatedJobsIndexRoute
};
var rootRouteChildren = {
	IndexRoute,
	AuthenticatedRouteRoute: AuthenticatedRouteRoute._addFileChildren(AuthenticatedRouteRouteChildren),
	AuthRoute,
	McpRoute,
	OauthCallbackRoute,
	PrivacyRoute,
	ResetPasswordRoute,
	TermsRoute,
	Char91DotmcpChar93ListToolsRoute,
	Char91DotwellKnownChar93OauthProtectedResourceRoute,
	DotlovableOauthConsentRoute,
	Char91DotmcpChar93InvokeToolToolRoute
};
var routeTree = Route$29._addFileChildren(rootRouteChildren)._addFileTypes();
var getRouter = () => {
	return createRouter({
		routeTree,
		context: { queryClient: new QueryClient() },
		scrollRestoration: true,
		defaultPreloadStaleTime: 0
	});
};
//#endregion
export { getRouter };
