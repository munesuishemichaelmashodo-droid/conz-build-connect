import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BKwn9D3n.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { $ as Fuel, E as Save, k as Percent, x as ShieldAlert } from "../_libs/lucide-react.mjs";
import { r as useQueryClient, t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-CKNZvOvp.mjs";
import { n as toast } from "../_libs/sonner.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin.settings-DCBeOm8H.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function AdminSettings() {
	const { is, userId } = useAuth();
	const isSuper = is("super_admin");
	const qc = useQueryClient();
	const { data: rate } = useQuery({
		queryKey: ["commission-rate"],
		queryFn: async () => {
			const { data } = await supabase.from("system_settings").select("value").eq("key", "commission_rate").maybeSingle();
			return Number(data?.value ?? 7);
		}
	});
	const [value, setValue] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		if (rate != null) setValue(String(rate));
	}, [rate]);
	const { data: diesel } = useQuery({
		queryKey: ["diesel-price"],
		queryFn: async () => {
			const { data } = await supabase.from("system_settings").select("value").eq("key", "diesel_price_per_liter").maybeSingle();
			return Number(data?.value ?? 1.87);
		}
	});
	const [dieselValue, setDieselValue] = (0, import_react.useState)("");
	(0, import_react.useEffect)(() => {
		if (diesel != null) setDieselValue(String(diesel));
	}, [diesel]);
	const { data: superCount } = useQuery({
		queryKey: ["super-count"],
		queryFn: async () => {
			const { count } = await supabase.from("user_roles").select("user_id", {
				count: "exact",
				head: true
			}).eq("role", "super_admin");
			return count ?? 0;
		}
	});
	const save = async () => {
		const v = Number(value);
		if (isNaN(v) || v < 0 || v > 100) return toast.error("Rate must be 0-100");
		const { error } = await supabase.rpc("admin_set_commission", { _rate: v });
		if (error) return toast.error(error.message);
		toast.success(`Commission set to ${v}%`);
		qc.invalidateQueries({ queryKey: ["commission-rate"] });
		qc.invalidateQueries({ queryKey: ["admin-dash"] });
	};
	const saveDiesel = async () => {
		const v = Number(dieselValue);
		if (isNaN(v) || v <= 0 || v > 100) return toast.error("Price must be between 0 and 100");
		const { error } = await supabase.rpc("admin_set_diesel_price", { _price: v });
		if (error) return toast.error(error.message);
		toast.success(`Diesel price set to $${v.toFixed(2)}/L`);
		qc.invalidateQueries({ queryKey: ["diesel-price"] });
	};
	const claim = async () => {
		const { error } = await supabase.rpc("claim_super_admin");
		if (error) return toast.error(error.message);
		toast.success("You are now super admin. Sign out and back in to refresh roles.");
		qc.invalidateQueries();
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-2xl border bg-card p-5 space-y-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Percent, { className: "w-5 h-5 text-primary" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "font-display font-bold text-lg uppercase tracking-wide",
							children: "Commission rate"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted-foreground",
						children: "Percentage deducted from a driver's wallet each time a job is completed."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "number",
							min: 0,
							max: 100,
							step: .5,
							value,
							onChange: (e) => setValue(e.target.value),
							disabled: !isSuper,
							className: "flex-1 px-3 py-2.5 rounded-xl border bg-background text-lg font-display font-bold disabled:opacity-50"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-display font-bold text-2xl text-muted-foreground",
							children: "%"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						onClick: save,
						disabled: !isSuper,
						className: "w-full rounded-xl bg-primary text-primary-foreground font-semibold py-3 disabled:opacity-50",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Save, { className: "w-4 h-4 inline mr-1" }), " Save commission"]
					}),
					!isSuper && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-muted-foreground text-center",
						children: "Only super admins can change the commission rate."
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-2xl border bg-card p-5 space-y-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Fuel, { className: "w-5 h-5 text-primary" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "font-display font-bold text-lg uppercase tracking-wide",
							children: "Diesel price"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted-foreground",
						children: "Current diesel price per litre (USD). Used to estimate fuel cost in the customer price suggestion."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-display font-bold text-2xl text-muted-foreground",
								children: "$"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "number",
								min: 0,
								max: 100,
								step: .01,
								value: dieselValue,
								onChange: (e) => setDieselValue(e.target.value),
								disabled: !isSuper,
								className: "flex-1 px-3 py-2.5 rounded-xl border bg-background text-lg font-display font-bold disabled:opacity-50"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-display font-bold text-sm text-muted-foreground",
								children: "/ L"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						onClick: saveDiesel,
						disabled: !isSuper,
						className: "w-full rounded-xl bg-primary text-primary-foreground font-semibold py-3 disabled:opacity-50",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Save, { className: "w-4 h-4 inline mr-1" }), " Save diesel price"]
					}),
					!isSuper && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-muted-foreground text-center",
						children: "Only super admins can change the diesel price."
					})
				]
			}),
			!isSuper && superCount === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-2xl border border-warning/40 bg-warning/10 p-5 space-y-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldAlert, { className: "w-5 h-5 text-warning" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "font-display font-bold uppercase tracking-wide",
							children: "No super admin yet"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm",
						children: "There is no super admin on this platform. Claim the role now to manage commission and roles."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						onClick: claim,
						className: "w-full rounded-xl bg-warning text-warning-foreground font-semibold py-3",
						children: "Claim super admin"
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-xl border bg-muted/30 p-4 text-xs text-muted-foreground space-y-1",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: ["Signed in as: ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "font-mono",
					children: userId?.slice(0, 8)
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: ["Super admins on platform: ", superCount ?? 0] })]
			})
		]
	});
}
//#endregion
export { AdminSettings as component };
