import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BEr3FmPh.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { g as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as cn } from "./utils-C_uf36nf.mjs";
import { Ct as ArrowUpRight, E as Save, Et as ArrowDownLeft, _t as Calendar, at as Download, c as TrendingUp, ct as Clock, ht as Check, i as Users, k as Percent, n as X, ot as DollarSign } from "../_libs/lucide-react.mjs";
import { r as useQueryClient, t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-Dij6GkaO.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { i as money } from "./domain-CYaPqfcD.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/admin.revenue-BOAfe19f.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function RevenueDashboard() {
	const qc = useQueryClient();
	const { is } = useAuth();
	const isSuper = is("super_admin");
	const [range, setRange] = (0, import_react.useState)("30");
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
	const { data: txs } = useQuery({
		queryKey: ["commission-txs"],
		queryFn: async () => {
			const { data } = await supabase.from("wallet_transactions").select("id,user_id,amount,job_id,note,created_at").eq("type", "commission").order("created_at", { ascending: false }).limit(5e3);
			return data ?? [];
		}
	});
	const { data: profiles } = useQuery({
		queryKey: ["driver-profiles-min"],
		queryFn: async () => {
			const { data } = await supabase.from("profiles").select("id,full_name,email");
			const m = /* @__PURE__ */ new Map();
			(data ?? []).forEach((p) => m.set(p.id, {
				name: p.full_name,
				email: p.email
			}));
			return m;
		}
	});
	const stats = (0, import_react.useMemo)(() => {
		const all = txs ?? [];
		const now = Date.now();
		const day = 864e5;
		const inRange = (d, days) => now - new Date(d).getTime() <= days * day;
		const sum = (arr) => arr.reduce((a, t) => a + Math.abs(Number(t.amount)), 0);
		return {
			today: sum(all.filter((t) => inRange(t.created_at, 1))),
			d7: sum(all.filter((t) => inRange(t.created_at, 7))),
			d30: sum(all.filter((t) => inRange(t.created_at, 30))),
			total: sum(all),
			jobs: all.length
		};
	}, [txs]);
	const filtered = (0, import_react.useMemo)(() => {
		const all = txs ?? [];
		if (range === "all") return all;
		const days = Number(range);
		const cutoff = Date.now() - days * 864e5;
		return all.filter((t) => new Date(t.created_at).getTime() >= cutoff);
	}, [txs, range]);
	const byDriver = (0, import_react.useMemo)(() => {
		const m = /* @__PURE__ */ new Map();
		filtered.forEach((t) => {
			const cur = m.get(t.user_id) ?? {
				total: 0,
				count: 0
			};
			cur.total += Math.abs(Number(t.amount));
			cur.count += 1;
			m.set(t.user_id, cur);
		});
		return Array.from(m.entries()).map(([uid, v]) => ({
			uid,
			...v
		})).sort((a, b) => b.total - a.total);
	}, [filtered]);
	const saveRate = async () => {
		const v = Number(value);
		if (isNaN(v) || v < 0 || v > 100) return toast.error("Rate must be 0-100");
		const { error } = await supabase.rpc("admin_set_commission", { _rate: v });
		if (error) return toast.error(error.message);
		toast.success(`Commission set to ${v}%`);
		qc.invalidateQueries({ queryKey: ["commission-rate"] });
		qc.invalidateQueries({ queryKey: ["admin-dash"] });
	};
	const exportCsv = () => {
		const csv = [[
			"Date",
			"Driver",
			"Email",
			"Job ID",
			"Commission (USD)",
			"Note"
		], ...filtered.map((t) => {
			const p = profiles?.get(t.user_id);
			return [
				new Date(t.created_at).toISOString(),
				p?.name ?? t.user_id,
				p?.email ?? "",
				t.job_id ?? "",
				Math.abs(Number(t.amount)).toFixed(2),
				(t.note ?? "").replace(/"/g, "\"\"")
			];
		})].map((r) => r.map((c) => `"${String(c)}"`).join(",")).join("\n");
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `commission-revenue-${range}d-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		toast.success("Report downloaded");
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-4",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-2xl bg-gradient-dark text-white p-5 shadow-lift",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2 text-white/70 text-[11px] uppercase tracking-widest",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DollarSign, { className: "w-3.5 h-3.5" }), " All-time platform revenue"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "font-display font-bold text-4xl text-primary mt-1",
						children: money(stats.total)
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-xs text-white/60 mt-1",
						children: [
							stats.jobs,
							" commission events at ",
							rate ?? 7,
							"% rate"
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid grid-cols-3 gap-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-2xl border bg-card p-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Calendar, { className: "w-3 h-3" }), " Today"]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-display font-bold text-lg mt-1",
							children: money(stats.today)
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-2xl border bg-card p-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TrendingUp, { className: "w-3 h-3" }), " 7d"]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-display font-bold text-lg mt-1",
							children: money(stats.d7)
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-2xl border bg-card p-3",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TrendingUp, { className: "w-3 h-3" }), " 30d"]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-display font-bold text-lg mt-1",
							children: money(stats.d30)
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-2xl border bg-card p-5 space-y-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Percent, { className: "w-5 h-5 text-primary" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "font-display font-bold uppercase tracking-wide",
							children: "Global commission rate"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-muted-foreground",
						children: "Deducted from a driver's wallet on every completed job. Changes apply immediately to future completions."
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center gap-2",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "number",
								min: 0,
								max: 100,
								step: .5,
								value,
								onChange: (e) => setValue(e.target.value),
								disabled: !isSuper,
								className: "flex-1 px-3 py-2.5 rounded-xl border bg-background text-lg font-display font-bold disabled:opacity-50"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-display font-bold text-2xl text-muted-foreground",
								children: "%"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: saveRate,
								disabled: !isSuper,
								className: "rounded-xl bg-primary text-primary-foreground font-semibold px-4 py-2.5 disabled:opacity-50",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Save, { className: "w-4 h-4 inline mr-1" }), " Save"]
							})
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-2xl border bg-card p-4 space-y-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center justify-between gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
							className: "font-display font-bold uppercase tracking-wide text-sm",
							children: "Revenue report"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							onClick: exportCsv,
							className: "rounded-lg bg-success text-success-foreground font-semibold px-3 py-1.5 text-xs",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Download, { className: "w-3.5 h-3.5 inline mr-1" }), " Export CSV"]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "flex gap-2",
						children: [
							"7",
							"30",
							"90",
							"all"
						].map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							onClick: () => setRange(r),
							className: `flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold uppercase ${range === r ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`,
							children: r === "all" ? "All time" : `${r}d`
						}, r))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-xs text-muted-foreground",
						children: [
							filtered.length,
							" events · ",
							money(filtered.reduce((a, t) => a + Math.abs(Number(t.amount)), 0)),
							" collected"
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ApprovalsSection, { profiles })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-2xl border bg-card p-4 space-y-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Users, { className: "w-4 h-4 text-primary" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
						className: "font-display font-bold uppercase tracking-wide text-sm",
						children: "Top drivers by commission"
					})]
				}), !byDriver.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "text-xs text-muted-foreground py-4 text-center",
					children: "No commission events in this period."
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "divide-y",
					children: byDriver.slice(0, 20).map((d) => {
						const p = profiles?.get(d.uid);
						return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center justify-between py-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "min-w-0",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "font-semibold text-sm truncate",
									children: p?.name ?? d.uid.slice(0, 8)
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "text-[11px] text-muted-foreground truncate",
									children: [
										p?.email ?? "",
										" · ",
										d.count,
										" jobs"
									]
								})]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-display font-bold text-sm",
								children: money(d.total)
							})]
						}, d.uid);
					})
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
				to: "/admin",
				className: "block text-center text-xs text-muted-foreground underline py-2",
				children: "Back to admin dashboard"
			})
		]
	});
}
function ApprovalsSection({ profiles }) {
	const qc = useQueryClient();
	const [tab, setTab] = (0, import_react.useState)("topups");
	const { data: topups } = useQuery({
		queryKey: ["admin-topups"],
		queryFn: async () => {
			const { data } = await supabase.from("wallet_topup_requests").select("*").order("created_at", { ascending: false }).limit(200);
			return data ?? [];
		}
	});
	const { data: wds } = useQuery({
		queryKey: ["admin-withdrawals"],
		queryFn: async () => {
			const { data } = await supabase.from("wallet_withdrawal_requests").select("*").order("created_at", { ascending: false }).limit(200);
			return data ?? [];
		}
	});
	(0, import_react.useEffect)(() => {
		const ch = supabase.channel("admin-wallet-reqs").on("postgres_changes", {
			event: "*",
			schema: "public",
			table: "wallet_topup_requests"
		}, () => qc.invalidateQueries({ queryKey: ["admin-topups"] })).on("postgres_changes", {
			event: "*",
			schema: "public",
			table: "wallet_withdrawal_requests"
		}, () => qc.invalidateQueries({ queryKey: ["admin-withdrawals"] })).subscribe();
		return () => {
			supabase.removeChannel(ch);
		};
	}, [qc]);
	const approve = async (kind, id) => {
		const rpc = kind === "topup" ? "admin_approve_topup" : "admin_approve_withdrawal";
		const { error } = await supabase.rpc(rpc, { _id: id });
		if (error) return toast.error(error.message);
		toast.success("Approved & wallet credited");
	};
	const reject = async (kind, id) => {
		const reason = window.prompt("Reason for rejection?") ?? "";
		if (!reason.trim()) return;
		const rpc = kind === "topup" ? "admin_reject_topup" : "admin_reject_withdrawal";
		const { error } = await supabase.rpc(rpc, {
			_id: id,
			_reason: reason
		});
		if (error) return toast.error(error.message);
		toast.success("Rejected");
	};
	const pendingTopups = (topups ?? []).filter((r) => r.status === "pending");
	const pendingWds = (wds ?? []).filter((r) => r.status === "pending");
	const list = tab === "topups" ? topups ?? [] : wds ?? [];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-2xl border bg-card p-4 space-y-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "flex items-center justify-between",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", {
					className: "font-display font-bold uppercase tracking-wide text-sm",
					children: "Wallet approvals"
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex gap-1 rounded-xl bg-muted p-1",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					onClick: () => setTab("topups"),
					className: cn("flex-1 h-9 rounded-lg text-xs font-display uppercase tracking-wide relative", tab === "topups" ? "bg-background shadow-sm" : "text-muted-foreground"),
					children: ["Top-ups", pendingTopups.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold",
						children: pendingTopups.length
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					onClick: () => setTab("withdrawals"),
					className: cn("flex-1 h-9 rounded-lg text-xs font-display uppercase tracking-wide relative", tab === "withdrawals" ? "bg-background shadow-sm" : "text-muted-foreground"),
					children: ["Withdrawals", pendingWds.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold",
						children: pendingWds.length
					})]
				})]
			}),
			list.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "text-xs text-muted-foreground py-6 text-center",
				children: "No requests yet."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "space-y-2",
				children: list.map((r) => {
					const isTopup = tab === "topups";
					const p = profiles?.get(r.user_id);
					const positive = isTopup;
					const dest = isTopup ? r.reference : r.destination;
					return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "rounded-xl border p-3",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-start gap-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: cn("w-9 h-9 rounded-full flex items-center justify-center shrink-0", positive ? "bg-success/15 text-success" : "bg-primary/15 text-primary"),
								children: positive ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowDownLeft, { className: "w-4 h-4" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowUpRight, { className: "w-4 h-4" })
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex-1 min-w-0",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "flex items-center justify-between gap-2",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											className: "text-sm font-semibold truncate",
											children: p?.name ?? r.user_id.slice(0, 8)
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: cn("font-display font-bold text-sm", positive ? "text-success" : "text-primary"),
											children: [positive ? "+" : "-", money(Number(r.amount))]
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "text-[11px] text-muted-foreground truncate",
										children: [
											r.method.toUpperCase(),
											" · ",
											dest || "—",
											" · ",
											new Date(r.created_at).toLocaleString()
										]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "mt-2 flex items-center justify-between gap-2",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
											className: cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", {
												pending: "bg-warning/15 text-warning border-warning/30",
												approved: "bg-success/15 text-success border-success/30",
												rejected: "bg-destructive/15 text-destructive border-destructive/30",
												cancelled: "bg-muted text-muted-foreground border-border"
											}[r.status]),
											children: [
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Clock, { className: "w-3 h-3" }),
												" ",
												r.status
											]
										}), r.status === "pending" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "flex gap-1.5",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
												onClick: () => reject(isTopup ? "topup" : "withdrawal", r.id),
												className: "rounded-lg border border-destructive/40 text-destructive px-2.5 py-1 text-xs font-semibold inline-flex items-center gap-1",
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "w-3 h-3" }), " Reject"]
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
												onClick: () => approve(isTopup ? "topup" : "withdrawal", r.id),
												className: "rounded-lg bg-success text-success-foreground px-2.5 py-1 text-xs font-semibold inline-flex items-center gap-1",
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, { className: "w-3 h-3" }), " Approve"]
											})]
										})]
									})
								]
							})]
						})
					}, r.id);
				})
			})
		]
	});
}
//#endregion
export { RevenueDashboard as component };
