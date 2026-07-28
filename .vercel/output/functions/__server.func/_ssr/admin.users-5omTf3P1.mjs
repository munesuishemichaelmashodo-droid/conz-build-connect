import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BEr3FmPh.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { St as Ban, b as ShieldCheck, n as X, r as Wallet, w as Search, y as ShieldOff } from "../_libs/lucide-react.mjs";
import { r as useQueryClient, t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-Dij6GkaO.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { r as StatusBadge, t as EmptyState } from "./ui-bits-DE9HqP-8.mjs";
import { i as money } from "./domain-CYaPqfcD.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin.users-5omTf3P1.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function AdminUsers() {
	const [q, setQ] = (0, import_react.useState)("");
	const [active, setActive] = (0, import_react.useState)(null);
	const qc = useQueryClient();
	const { is } = useAuth();
	const isSuper = is("super_admin");
	const { data } = useQuery({
		queryKey: ["admin-users"],
		queryFn: async () => {
			const [profiles, roles, wallets] = await Promise.all([
				supabase.from("profiles").select("id,full_name,email,phone,status").order("created_at", { ascending: false }).limit(500),
				supabase.from("user_roles").select("user_id,role"),
				supabase.from("wallets").select("user_id,balance")
			]);
			const rmap = /* @__PURE__ */ new Map();
			(roles.data ?? []).forEach((r) => {
				const a = rmap.get(r.user_id) ?? [];
				a.push(r.role);
				rmap.set(r.user_id, a);
			});
			const wmap = /* @__PURE__ */ new Map();
			(wallets.data ?? []).forEach((w) => wmap.set(w.user_id, Number(w.balance)));
			return (profiles.data ?? []).map((p) => ({
				...p,
				roles: rmap.get(p.id) ?? [],
				balance: wmap.get(p.id) ?? 0
			}));
		}
	});
	const filtered = (data ?? []).filter((r) => {
		if (!q) return true;
		const s = q.toLowerCase();
		return r.full_name?.toLowerCase().includes(s) || r.email?.toLowerCase().includes(s) || r.phone?.toLowerCase().includes(s);
	});
	const setStatus = async (id, status) => {
		const { error } = await supabase.rpc("admin_set_user_status", {
			_user_id: id,
			_status: status
		});
		if (error) return toast.error(error.message);
		toast.success(`Status set to ${status}`);
		qc.invalidateQueries({ queryKey: ["admin-users"] });
		setActive((a) => a && a.id === id ? {
			...a,
			status
		} : a);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "relative",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Search, { className: "w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: q,
					onChange: (e) => setQ(e.target.value),
					placeholder: "Search by name, email, or phone…",
					className: "w-full pl-9 pr-3 py-2.5 rounded-xl border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
				})]
			}),
			!filtered.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
				icon: Search,
				title: "No users found",
				hint: "Try a different search."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "space-y-2",
				children: filtered.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: () => setActive(r),
					className: "w-full text-left rounded-xl border bg-card p-3 hover:bg-muted/40 transition-colors",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-start justify-between gap-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "min-w-0 flex-1",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "font-semibold truncate",
									children: r.full_name || "Unnamed"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "text-[11px] text-muted-foreground truncate",
									children: r.email ?? r.phone ?? "—"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "flex flex-wrap gap-1 mt-1.5",
									children: r.roles.map((role) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
										label: role,
										className: role === "super_admin" || role === "admin" ? "bg-primary/15 text-primary border-primary/30" : role === "driver" ? "bg-warning/15 text-warning border-warning/30" : "bg-muted text-muted-foreground border-border"
									}, role))
								})
							]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-right shrink-0",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-display font-bold text-sm",
								children: money(r.balance)
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
								label: r.status,
								className: r.status === "active" ? "bg-success/15 text-success border-success/30" : r.status === "suspended" ? "bg-warning/15 text-warning border-warning/30" : "bg-destructive/15 text-destructive border-destructive/30"
							})]
						})]
					})
				}, r.id))
			}),
			active && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(UserSheet, {
				row: active,
				isSuper,
				onClose: () => setActive(null),
				onStatus: (s) => setStatus(active.id, s),
				onChanged: () => qc.invalidateQueries({ queryKey: ["admin-users"] })
			})
		]
	});
}
function UserSheet({ row, isSuper, onClose, onStatus, onChanged }) {
	const [amount, setAmount] = (0, import_react.useState)("");
	const [note, setNote] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const credit = async (sign) => {
		const v = Number(amount);
		if (!v || isNaN(v)) return toast.error("Enter an amount");
		setBusy(true);
		const { error } = await supabase.rpc("admin_credit_wallet", {
			_user_id: row.id,
			_amount: sign * Math.abs(v),
			_note: note || (sign > 0 ? "Top-up" : "Deduction")
		});
		setBusy(false);
		if (error) return toast.error(error.message);
		toast.success("Wallet updated");
		setAmount("");
		setNote("");
		onChanged();
	};
	const toggleRole = async (role) => {
		const has = row.roles.includes(role);
		const rpc = has ? "admin_revoke_role" : "admin_grant_role";
		const { error } = await supabase.rpc(rpc, {
			_user_id: row.id,
			_role: role
		});
		if (error) return toast.error(error.message);
		toast.success(has ? `${role} removed` : `${role} granted`);
		onChanged();
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "fixed inset-0 z-50 bg-black/50 flex items-end",
		onClick: onClose,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "w-full max-w-screen-sm mx-auto bg-card rounded-t-2xl border-t shadow-lift p-5 max-h-[88vh] overflow-y-auto",
			onClick: (e) => e.stopPropagation(),
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-start justify-between",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-display font-bold text-lg",
						children: row.full_name
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-muted-foreground",
						children: row.email ?? row.phone
					})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						onClick: onClose,
						className: "p-1.5 rounded-md hover:bg-muted",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "w-4 h-4" })
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-4 rounded-xl bg-muted/40 p-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "text-[11px] uppercase tracking-wider text-muted-foreground",
						children: "Wallet balance"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "font-display font-bold text-2xl",
						children: money(row.balance)
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-4 space-y-2",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-[11px] uppercase tracking-wider text-muted-foreground font-semibold",
							children: "Wallet top-up / deduct"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "flex gap-2",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "number",
								inputMode: "decimal",
								value: amount,
								onChange: (e) => setAmount(e.target.value),
								placeholder: "Amount (USD)",
								className: "flex-1 px-3 py-2 rounded-lg border bg-background text-sm"
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							value: note,
							onChange: (e) => setNote(e.target.value),
							placeholder: "Note (e.g. EcoCash ref ABC123)",
							className: "w-full px-3 py-2 rounded-lg border bg-background text-sm"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "grid grid-cols-2 gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								disabled: busy,
								onClick: () => credit(1),
								className: "rounded-lg bg-success text-success-foreground font-semibold py-2 text-sm disabled:opacity-50",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Wallet, { className: "w-4 h-4 inline mr-1" }), " Credit"]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								disabled: busy,
								onClick: () => credit(-1),
								className: "rounded-lg bg-destructive text-destructive-foreground font-semibold py-2 text-sm disabled:opacity-50",
								children: "Deduct"
							})]
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-5 space-y-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "text-[11px] uppercase tracking-wider text-muted-foreground font-semibold",
						children: "Account status"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "grid grid-cols-3 gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => onStatus("active"),
								className: "rounded-lg border py-2 text-xs font-semibold hover:bg-success/10",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldCheck, { className: "w-4 h-4 inline mr-1 text-success" }), " Active"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => onStatus("suspended"),
								className: "rounded-lg border py-2 text-xs font-semibold hover:bg-warning/10",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldOff, { className: "w-4 h-4 inline mr-1 text-warning" }), " Suspend"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => onStatus("banned"),
								className: "rounded-lg border py-2 text-xs font-semibold hover:bg-destructive/10",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ban, { className: "w-4 h-4 inline mr-1 text-destructive" }), " Ban"]
							})
						]
					})]
				}),
				isSuper && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-5 space-y-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "text-[11px] uppercase tracking-wider text-muted-foreground font-semibold",
						children: "Roles (super admin)"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "grid grid-cols-3 gap-2",
						children: [
							"customer",
							"driver",
							"admin"
						].map((r) => {
							const has = row.roles.includes(r);
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => toggleRole(r),
								className: `rounded-lg border py-2 text-xs font-semibold capitalize ${has ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`,
								children: [has ? "✓ " : "+ ", r]
							}, r);
						})
					})]
				})
			]
		})
	});
}
//#endregion
export { AdminUsers as component };
