import { o as __toESM } from "./_runtime.mjs";
import { u as require_react } from "./_libs/@floating-ui/react-dom+[...].mjs";
import { c as require_jsx_runtime } from "./_libs/@radix-ui/react-arrow+[...].mjs";
import { n as oauth, t as Route } from "./_._lovable.oauth.consent-DTMDPvGZ.mjs";
import { t as Button } from "./_ssr/button-Bq5vK6RO.mjs";
import { K as LoaderCircle } from "./_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/_._lovable.oauth.consent-BDf5Xjp1.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function Consent() {
	const details = Route.useLoaderData();
	const { authorization_id } = Route.useSearch();
	const [busy, setBusy] = (0, import_react.useState)(null);
	const [error, setError] = (0, import_react.useState)(null);
	async function decide(approve) {
		setBusy(approve ? "approve" : "deny");
		setError(null);
		const { data, error } = approve ? await oauth().approveAuthorization(authorization_id) : await oauth().denyAuthorization(authorization_id);
		if (error) {
			setBusy(null);
			setError(error.message);
			return;
		}
		const target = data?.redirect_url ?? data?.redirect_to;
		if (!target) {
			setBusy(null);
			setError("No redirect returned by the authorization server.");
			return;
		}
		window.location.href = target;
	}
	const clientName = details?.client?.name ?? "an app";
	const redirectUri = details?.client?.redirect_uri;
	const scopes = details?.requested_scopes ?? details?.scopes ?? [];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "min-h-screen flex items-center justify-center p-6 bg-background",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "w-full max-w-md rounded-2xl border bg-card p-6 shadow-lift space-y-5",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
						src: "/conz-logo.png",
						alt: "Con Z",
						className: "w-10 h-10 rounded-lg"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "text-[10px] uppercase tracking-widest text-muted-foreground",
						children: "Con Z"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", {
						className: "font-display font-bold text-lg leading-tight",
						children: [
							"Connect ",
							clientName,
							" to your account"
						]
					})] })]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "text-sm text-muted-foreground",
					children: [clientName, " will be able to call Con Z tools as you while you're signed in. This does not bypass Con Z's permissions or backend policies."]
				}),
				redirectUri && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "text-xs",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "uppercase tracking-widest text-muted-foreground",
						children: "Redirects to"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "break-all",
						children: redirectUri
					})]
				}),
				scopes.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
					className: "text-xs space-y-1",
					children: scopes.map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-muted-foreground",
							children: "Requested:"
						}),
						" ",
						s
					] }, s))
				}),
				error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					role: "alert",
					className: "rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs",
					children: error
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "grid grid-cols-2 gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "outline",
						disabled: busy !== null,
						onClick: () => decide(false),
						children: busy === "deny" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Cancel"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						disabled: busy !== null,
						onClick: () => decide(true),
						children: busy === "approve" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Approve"
					})]
				})
			]
		})
	});
}
//#endregion
export { Consent as component };
