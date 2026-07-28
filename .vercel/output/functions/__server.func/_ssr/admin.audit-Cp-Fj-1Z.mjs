import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BEr3FmPh.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as cva } from "../_libs/class-variance-authority+clsx.mjs";
import { t as cn } from "./utils-C_uf36nf.mjs";
import { T as ScrollText, a as User } from "../_libs/lucide-react.mjs";
import { t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { t as formatDistanceToNow } from "../_libs/date-fns.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin.audit-Cp-Fj-1Z.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var Card = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
	ref,
	className: cn("rounded-xl border bg-card text-card-foreground shadow", className),
	...props
}));
Card.displayName = "Card";
var CardHeader = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
	ref,
	className: cn("flex flex-col space-y-1.5 p-6", className),
	...props
}));
CardHeader.displayName = "CardHeader";
var CardTitle = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
	ref,
	className: cn("font-semibold leading-none tracking-tight", className),
	...props
}));
CardTitle.displayName = "CardTitle";
var CardDescription = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
	ref,
	className: cn("text-sm text-muted-foreground", className),
	...props
}));
CardDescription.displayName = "CardDescription";
var CardContent = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
	ref,
	className: cn("p-6 pt-0", className),
	...props
}));
CardContent.displayName = "CardContent";
var CardFooter = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
	ref,
	className: cn("flex items-center p-6 pt-0", className),
	...props
}));
CardFooter.displayName = "CardFooter";
var badgeVariants = cva("inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", {
	variants: { variant: {
		default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
		secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
		destructive: "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
		outline: "text-foreground"
	} },
	defaultVariants: { variant: "default" }
});
function Badge({ className, variant, ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: cn(badgeVariants({ variant }), className),
		...props
	});
}
var ACTION_STYLE = {
	role_granted: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
	role_revoked: "bg-rose-500/15 text-rose-500 border-rose-500/30",
	commission_changed: "bg-amber-500/15 text-amber-500 border-amber-500/30",
	user_status_changed: "bg-sky-500/15 text-sky-500 border-sky-500/30",
	driver_verification_changed: "bg-primary/15 text-primary border-primary/30",
	dispute_status_changed: "bg-violet-500/15 text-violet-500 border-violet-500/30"
};
function AuditLogPage() {
	const { data, isLoading } = useQuery({
		queryKey: ["admin-audit-log"],
		queryFn: async () => {
			const { data, error } = await supabase.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(200);
			if (error) throw error;
			return data;
		},
		refetchInterval: 15e3
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, {
			className: "p-4 flex items-center gap-3",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "p-2 rounded-lg bg-primary/15 text-primary",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScrollText, { className: "w-5 h-5" })
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-bold text-lg",
				children: "Admin Audit Log"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted-foreground",
				children: "Every sensitive admin action is recorded here (last 200 entries)."
			})] })]
		}), isLoading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
			className: "text-sm text-muted-foreground",
			children: "Loading…"
		}) : !data || data.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Card, {
			className: "p-8 text-center text-sm text-muted-foreground",
			children: "No admin actions recorded yet."
		}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "space-y-2",
			children: data.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Card, {
				className: "p-3 space-y-1.5",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center justify-between gap-2 flex-wrap",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
							variant: "outline",
							className: ACTION_STYLE[row.action] ?? "bg-muted",
							children: row.action.replaceAll("_", " ")
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-[10px] text-muted-foreground",
							children: formatDistanceToNow(new Date(row.created_at), { addSuffix: true })
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-xs text-muted-foreground flex items-center gap-1.5",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(User, { className: "w-3 h-3" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "font-mono",
								children: ["actor: ", row.actor_id?.slice(0, 8) ?? "system"]
							}),
							row.target_user_id && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "font-mono",
								children: ["→ target: ", row.target_user_id.slice(0, 8)]
							})
						]
					}),
					Object.keys(row.meta ?? {}).length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", {
						className: "text-[11px] bg-muted rounded p-2 overflow-x-auto",
						children: JSON.stringify(row.meta, null, 2)
					}),
					row.reason && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
						className: "text-xs italic text-muted-foreground",
						children: [
							"\"",
							row.reason,
							"\""
						]
					})
				]
			}, row.id))
		})]
	});
}
//#endregion
export { AuditLogPage as component };
