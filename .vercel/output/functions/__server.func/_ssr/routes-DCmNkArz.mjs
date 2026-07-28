import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BKwn9D3n.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { g as Link, v as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { Ct as ArrowRight, b as ShieldCheck, o as Truck, r as Wallet } from "../_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-DCmNkArz.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function useRedirectWhenSignedIn() {
	const navigate = useNavigate();
	(0, import_react.useEffect)(() => {
		let cancelled = false;
		supabase.auth.getSession().then(({ data }) => {
			if (!cancelled && data.session) navigate({
				to: "/home",
				replace: true
			});
		});
		const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
			if (session) navigate({
				to: "/home",
				replace: true
			});
		});
		return () => {
			cancelled = true;
			sub.subscription.unsubscribe();
		};
	}, [navigate]);
}
function Welcome() {
	useRedirectWhenSignedIn();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "min-h-screen bg-gradient-dark text-white flex flex-col",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mx-auto max-w-screen-sm px-5 pt-12 pb-8 flex-1 flex flex-col",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "flex-1 flex flex-col items-center justify-center",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "w-full max-w-[320px]",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
							src: "/conz-logo.png",
							alt: "CON Z — Move More. Earn More.",
							className: "w-full h-auto",
							width: 320,
							height: 320
						})
					})
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mt-8 grid grid-cols-3 gap-2",
					children: [
						{
							icon: Truck,
							label: "Real drivers"
						},
						{
							icon: ShieldCheck,
							label: "Verified"
						},
						{
							icon: Wallet,
							label: "AI-priced"
						}
					].map(({ icon: I, label }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-xl bg-white/5 border border-white/10 p-3 text-center",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(I, { className: "w-5 h-5 text-primary mx-auto" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-[11px] mt-1 text-white/80",
							children: label
						})]
					}, label))
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-8 rounded-2xl bg-white/5 border border-white/10 p-4",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "font-display font-bold uppercase text-xs tracking-widest text-white/70 mb-3",
						children: "How it works"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
						className: "space-y-3",
						children: [
							{
								n: "1",
								t: "Post a job",
								d: "Tell us what you need delivered and where."
							},
							{
								n: "2",
								t: "Get driver offers",
								d: "Verified drivers nearby send you bids in seconds."
							},
							{
								n: "3",
								t: "Track & pay",
								d: "Follow the truck live and pay when it arrives."
							}
						].map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
							className: "flex gap-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "w-7 h-7 rounded-full bg-primary/20 border border-primary/40 text-primary font-display font-bold flex items-center justify-center shrink-0",
								children: s.n
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-semibold text-sm",
								children: s.t
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-[12px] text-white/60",
								children: s.d
							})] })]
						}, s.n))
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-8 space-y-3",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
							to: "/auth",
							search: { mode: "register" },
							className: "flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-gradient-primary font-display font-bold uppercase tracking-wider shadow-lift",
							children: ["Get started ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowRight, { className: "w-4 h-4" })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
							to: "/auth",
							search: { mode: "login" },
							className: "flex items-center justify-center w-full h-12 rounded-xl bg-white/10 border border-white/15 font-display font-semibold uppercase tracking-wider",
							children: "I already have an account"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-center text-[12px] text-white/70",
							children: [
								"Driver?",
								" ",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
									to: "/auth",
									search: {
										mode: "register",
										role: "driver"
									},
									className: "text-primary font-semibold underline underline-offset-2",
									children: "Sign up here"
								})
							]
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-center text-[11px] text-white/50 mt-6",
					children: "Founded in Zimbabwe • Built for the industry"
				})
			]
		})
	});
}
//#endregion
export { Welcome as component };
