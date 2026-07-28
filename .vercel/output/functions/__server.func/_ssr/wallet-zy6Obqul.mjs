import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BEr3FmPh.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as cn } from "./utils-C_uf36nf.mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { $ as Fuel, Ct as ArrowUpRight, Et as ArrowDownLeft, K as LoaderCircle, O as Plus, ct as Clock, dt as CircleCheck, g as Shield, h as Smartphone, r as Wallet, s as TriangleAlert, st as CreditCard, t as Zap, vt as Building2, xt as Banknote } from "../_libs/lucide-react.mjs";
import { r as useQueryClient, t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-Dij6GkaO.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { t as AppShell } from "./AppShell-n1riXnH5.mjs";
import { t as EmptyState } from "./ui-bits-DE9HqP-8.mjs";
import { i as money } from "./domain-CYaPqfcD.mjs";
import { t as motion } from "../_libs/framer-motion.mjs";
import { a as DialogHeader, n as DialogContent, o as DialogTitle, r as DialogDescription, t as Dialog } from "./dialog-DIo89e4g.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/wallet-zy6Obqul.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var MIN_BALANCE = 10;
var METHODS = [
	{
		id: "ecocash",
		label: "EcoCash",
		hint: "Instant",
		icon: Smartphone
	},
	{
		id: "onemoney",
		label: "OneMoney",
		hint: "Instant",
		icon: Smartphone
	},
	{
		id: "zipit",
		label: "ZIPIT",
		hint: "Instant",
		icon: CreditCard
	},
	{
		id: "bank",
		label: "Bank Transfer",
		hint: "1–5 min",
		icon: Building2
	}
];
function WalletPage() {
	const { userId, is } = useAuth();
	const qc = useQueryClient();
	const [tab, setTab] = (0, import_react.useState)("summary");
	const [topUpOpen, setTopUpOpen] = (0, import_react.useState)(false);
	const [withdrawOpen, setWithdrawOpen] = (0, import_react.useState)(false);
	const { data: wallet } = useQuery({
		queryKey: ["wallet", userId],
		enabled: !!userId,
		queryFn: async () => (await supabase.from("wallets").select("*").eq("user_id", userId).maybeSingle()).data
	});
	const { data: txs } = useQuery({
		queryKey: ["wallet-tx", userId],
		enabled: !!userId,
		queryFn: async () => (await supabase.from("wallet_transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)).data ?? []
	});
	const { data: topups } = useQuery({
		queryKey: ["topups", userId],
		enabled: !!userId,
		queryFn: async () => {
			const { data } = await supabase.from("wallet_topup_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30);
			return data ?? [];
		}
	});
	const { data: withdrawals } = useQuery({
		queryKey: ["withdrawals", userId],
		enabled: !!userId,
		queryFn: async () => {
			const { data } = await supabase.from("wallet_withdrawal_requests").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30);
			return data ?? [];
		}
	});
	const { data: driver } = useQuery({
		queryKey: ["driver-pin", userId],
		enabled: !!userId,
		queryFn: async () => (await supabase.from("driver_profiles").select("withdrawal_pin_hash").eq("user_id", userId).maybeSingle()).data
	});
	(0, import_react.useEffect)(() => {
		if (!userId) return;
		const ch = supabase.channel(`wallet-${userId}`).on("postgres_changes", {
			event: "*",
			schema: "public",
			table: "wallets",
			filter: `user_id=eq.${userId}`
		}, () => {
			qc.invalidateQueries({ queryKey: ["wallet", userId] });
		}).on("postgres_changes", {
			event: "*",
			schema: "public",
			table: "wallet_transactions",
			filter: `user_id=eq.${userId}`
		}, () => {
			qc.invalidateQueries({ queryKey: ["wallet-tx", userId] });
		}).on("postgres_changes", {
			event: "*",
			schema: "public",
			table: "wallet_topup_requests",
			filter: `user_id=eq.${userId}`
		}, () => {
			qc.invalidateQueries({ queryKey: ["topups", userId] });
		}).on("postgres_changes", {
			event: "*",
			schema: "public",
			table: "wallet_withdrawal_requests",
			filter: `user_id=eq.${userId}`
		}, () => {
			qc.invalidateQueries({ queryKey: ["withdrawals", userId] });
		}).subscribe();
		return () => {
			supabase.removeChannel(ch);
		};
	}, [userId, qc]);
	if (!is("driver")) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {
		title: "Wallet",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
			icon: Wallet,
			title: "Wallet is for drivers",
			hint: "Switch to a driver account from your profile."
		})
	});
	const balance = Number(wallet?.balance ?? 0);
	const low = balance >= MIN_BALANCE && !(balance >= MIN_BALANCE * 3);
	const veryLow = balance < MIN_BALANCE;
	const status = veryLow ? {
		label: "Very Low",
		tone: "text-destructive",
		dot: "bg-destructive",
		ring: "stroke-destructive"
	} : low ? {
		label: "Low Balance",
		tone: "text-warning",
		dot: "bg-warning",
		ring: "stroke-warning"
	} : {
		label: "Healthy Balance",
		tone: "text-success",
		dot: "bg-success",
		ring: "stroke-success"
	};
	const deposits = (txs ?? []).filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
	const commissions = (txs ?? []).filter((t) => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0);
	const jobsCompleted = (txs ?? []).filter((t) => String(t.type).includes("commission")).length;
	const pendingCount = (topups ?? []).filter((t) => t.status === "pending").length + (withdrawals ?? []).filter((t) => t.status === "pending").length;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(AppShell, {
		title: "Driver Wallet",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(motion.div, {
				initial: {
					opacity: 0,
					y: 12
				},
				animate: {
					opacity: 1,
					y: 0
				},
				className: "relative overflow-hidden rounded-3xl bg-gradient-dark text-white p-6 shadow-lift",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "absolute -top-16 -right-16 w-56 h-56 rounded-full bg-primary/20 blur-3xl" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-start justify-between relative",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-[10px] uppercase tracking-[0.2em] text-white/60",
								children: "Available Balance"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "font-display font-bold text-primary text-5xl mt-1 tracking-tight",
								children: money(balance)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: cn("inline-flex items-center gap-1.5 mt-3 text-xs font-semibold", status.tone),
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: cn("w-2 h-2 rounded-full", status.dot) }), status.label]
							})
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Gauge, {
							balance,
							ring: status.ring
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-5 grid grid-cols-2 gap-2 relative",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
							onClick: () => setTopUpOpen(true),
							className: "h-11 rounded-xl font-display uppercase tracking-wide",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, { className: "w-4 h-4 mr-1" }), " Top Up"]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
							onClick: () => setWithdrawOpen(true),
							variant: "secondary",
							className: "h-11 rounded-xl font-display uppercase tracking-wide bg-white/10 text-white hover:bg-white/20 border-white/10",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Banknote, { className: "w-4 h-4 mr-1" }), " Withdraw"]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-[11px] text-white/60 mt-4 relative",
						children: "The 7% commission hold is deducted from this wallet after every completed job."
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-5 flex gap-1 rounded-xl bg-muted p-1",
				children: [
					"summary",
					"requests",
					"history"
				].map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => setTab(t),
					className: cn("flex-1 h-9 rounded-lg text-xs font-display uppercase tracking-wide transition relative", tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"),
					children: [t === "summary" ? "Summary" : t === "requests" ? "Requests" : "History", t === "requests" && pendingCount > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center",
						children: pendingCount
					})]
				}, t))
			}),
			tab === "summary" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mt-4 space-y-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-2xl bg-card border p-4 space-y-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SummaryRow, {
								label: "Total Deposits",
								value: money(deposits),
								tone: "text-success"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "h-px bg-border" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SummaryRow, {
								label: "Total Commissions Paid (7%)",
								value: money(commissions),
								tone: "text-destructive"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "h-px bg-border" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SummaryRow, {
								label: "Jobs Completed",
								value: String(jobsCompleted)
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "h-px bg-border" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SummaryRow, {
								label: "Minimum Balance",
								value: money(MIN_BALANCE),
								hint: "Required to stay online"
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "grid grid-cols-2 gap-3",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Feature, {
								icon: Shield,
								title: "Bank-grade security",
								hint: "Encrypted, auditable transactions."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Feature, {
								icon: Zap,
								title: "Instant top-ups",
								hint: "EcoCash, OneMoney, ZIPIT."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Feature, {
								icon: CircleCheck,
								title: "Real payments only",
								hint: "No fake receipts, verified."
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Feature, {
								icon: TriangleAlert,
								title: "Low-balance alerts",
								hint: "We warn before you go offline."
							})
						]
					}),
					!driver?.withdrawal_pin_hash && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-display font-bold uppercase text-xs tracking-wide text-warning",
							children: "Set a withdrawal PIN"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-[13px] mt-1 opacity-90",
							children: "A 4–8 digit PIN protects your withdrawals. Set it from your Profile."
						})]
					}),
					veryLow && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-display font-bold uppercase text-xs tracking-wide",
							children: "Top up now"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "text-[13px] mt-1 opacity-90",
							children: [
								"Your balance is below ",
								money(MIN_BALANCE),
								". You won't receive new jobs until you top up."
							]
						})]
					})
				]
			}),
			tab === "requests" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-4 space-y-3",
				children: (topups ?? []).length === 0 && (withdrawals ?? []).length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
					icon: Clock,
					title: "No requests yet",
					hint: "Your top-ups and withdrawals will appear here."
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [(topups ?? []).map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RequestRow, {
					kind: "topup",
					amount: Number(r.amount),
					method: r.method,
					reference: r.reference,
					status: r.status,
					rejectReason: r.reject_reason,
					createdAt: r.created_at,
					onCancel: async () => {
						const { error } = await supabase.rpc("cancel_topup", { _id: r.id });
						if (error) toast.error(error.message);
						else toast.success("Request cancelled");
					}
				}, r.id)), (withdrawals ?? []).map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RequestRow, {
					kind: "withdrawal",
					amount: Number(r.amount),
					method: r.method,
					reference: r.destination,
					status: r.status,
					rejectReason: r.reject_reason,
					createdAt: r.created_at,
					onCancel: async () => {
						const { error } = await supabase.rpc("cancel_withdrawal", { _id: r.id });
						if (error) toast.error(error.message);
						else toast.success("Request cancelled");
					}
				}, r.id))] })
			}),
			tab === "history" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-4",
				children: !txs?.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EmptyState, {
					icon: Wallet,
					title: "No transactions yet",
					hint: "Your top-ups and commissions will appear here."
				}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "space-y-2",
					children: txs.map((t) => {
						const positive = Number(t.amount) >= 0;
						return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center gap-3 rounded-2xl bg-card border p-3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", positive ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"),
									children: positive ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowDownLeft, { className: "w-5 h-5" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowUpRight, { className: "w-5 h-5" })
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex-1 min-w-0",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-sm font-semibold capitalize truncate",
										children: String(t.type).replace(/_/g, " ")
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-[11px] text-muted-foreground truncate",
										children: t.note ?? new Date(t.created_at).toLocaleString()
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: cn("font-display font-bold text-sm", positive ? "text-success" : "text-destructive"),
									children: [positive ? "+" : "", money(Number(t.amount))]
								})
							]
						}, t.id);
					})
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TopUpDialog, {
				open: topUpOpen,
				onOpenChange: setTopUpOpen
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(WithdrawDialog, {
				open: withdrawOpen,
				onOpenChange: setWithdrawOpen,
				balance,
				hasPin: !!driver?.withdrawal_pin_hash
			})
		]
	});
}
function RequestRow({ kind, amount, method, reference, status, rejectReason, createdAt, onCancel }) {
	const isTopup = kind === "topup";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "rounded-2xl bg-card border p-3",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex items-start gap-3",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", isTopup ? "bg-success/15 text-success" : "bg-primary/15 text-primary"),
				children: isTopup ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowDownLeft, { className: "w-5 h-5" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowUpRight, { className: "w-5 h-5" })
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex-1 min-w-0",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center justify-between gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "text-sm font-semibold",
							children: [
								isTopup ? "Top Up" : "Withdrawal",
								" · ",
								method.toUpperCase()
							]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: cn("text-sm font-display font-bold", isTopup ? "text-success" : "text-primary"),
							children: [isTopup ? "+" : "-", money(amount)]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-[11px] text-muted-foreground truncate mt-0.5",
						children: [reference ? `Ref: ${reference} · ` : "", new Date(createdAt).toLocaleString()]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "mt-2 flex items-center justify-between gap-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
							className: cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase", {
								pending: "bg-warning/15 text-warning border-warning/30",
								approved: "bg-success/15 text-success border-success/30",
								rejected: "bg-destructive/15 text-destructive border-destructive/30",
								cancelled: "bg-muted text-muted-foreground border-border"
							}[status]),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Clock, { className: "w-3 h-3" }),
								" ",
								status
							]
						}), status === "pending" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							onClick: onCancel,
							className: "text-[11px] text-muted-foreground underline",
							children: "Cancel"
						})]
					}),
					status === "rejected" && rejectReason && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-[11px] text-destructive mt-1",
						children: ["Reason: ", rejectReason]
					})
				]
			})]
		})
	});
}
function Gauge({ balance, ring }) {
	const pct = Math.max(.05, Math.min(1, balance / (MIN_BALANCE * 5)));
	const c = 2 * Math.PI * 28;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "relative w-20 h-20 shrink-0",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("svg", {
			viewBox: "0 0 64 64",
			className: "w-full h-full -rotate-90",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
				cx: "32",
				cy: "32",
				r: "28",
				className: "stroke-white/10",
				strokeWidth: "6",
				fill: "none"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("circle", {
				cx: "32",
				cy: "32",
				r: "28",
				className: cn(ring, "transition-all"),
				strokeWidth: "6",
				fill: "none",
				strokeLinecap: "round",
				strokeDasharray: c,
				strokeDashoffset: c * (1 - pct)
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "absolute inset-0 flex items-center justify-center",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Fuel, { className: "w-6 h-6 text-primary" })
		})]
	});
}
function SummaryRow({ label, value, tone, hint }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-center justify-between",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "text-sm text-foreground",
			children: label
		}), hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "text-[11px] text-muted-foreground",
			children: hint
		})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: cn("font-display font-bold text-sm", tone),
			children: value
		})]
	});
}
function Feature({ icon: Icon, title, hint }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-2xl border bg-card p-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-2",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { className: "w-4 h-4" })
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "text-xs font-display font-bold",
				children: title
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "text-[11px] text-muted-foreground leading-snug mt-0.5",
				children: hint
			})
		]
	});
}
function TopUpDialog({ open, onOpenChange }) {
	const [amount, setAmount] = (0, import_react.useState)(50);
	const [reference, setReference] = (0, import_react.useState)("");
	const [method, setMethod] = (0, import_react.useState)("ecocash");
	const [submitting, setSubmitting] = (0, import_react.useState)(false);
	const presets = [
		10,
		20,
		50,
		100
	];
	const submit = async () => {
		if (!amount || amount <= 0) return toast.error("Enter an amount");
		setSubmitting(true);
		const { error } = await supabase.rpc("request_topup", {
			_amount: amount,
			_method: method,
			_reference: reference || null
		});
		setSubmitting(false);
		if (error) return toast.error(error.message);
		toast.success("Top-up added to your wallet.");
		setReference("");
		onOpenChange(false);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dialog, {
		open,
		onOpenChange,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogContent, {
			className: "max-w-sm rounded-3xl",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogTitle, {
				className: "font-display uppercase tracking-wide",
				children: "Top Up Wallet"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogDescription, { children: "Enter an amount and your payment method — funds are credited to your wallet instantly." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-2xl bg-muted p-4",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-[10px] uppercase tracking-widest text-muted-foreground",
								children: "Enter Amount"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex items-baseline gap-1 mt-1",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "font-display font-bold text-3xl",
									children: "$"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "number",
									min: 1,
									value: amount,
									onChange: (e) => setAmount(Number(e.target.value)),
									className: "bg-transparent font-display font-bold text-3xl w-full outline-none"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "mt-3 flex gap-1.5",
								children: presets.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									type: "button",
									onClick: () => setAmount(p),
									className: cn("flex-1 h-9 rounded-lg text-xs font-display font-bold border transition", amount === p ? "bg-primary text-primary-foreground border-primary" : "hover:border-primary/40"),
									children: ["$", p]
								}, p))
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "text-[10px] uppercase tracking-widest text-muted-foreground mb-2",
						children: "Payment Method"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "space-y-1.5",
						children: METHODS.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							type: "button",
							onClick: () => setMethod(m.id),
							className: cn("w-full flex items-center gap-3 rounded-xl border p-3 text-left transition", method === m.id ? "border-primary bg-primary/5" : "hover:border-primary/40"),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(m.icon, { className: "w-4 h-4" })
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "flex-1",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: "text-sm font-semibold",
										children: m.label
									})
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "text-[11px] text-muted-foreground",
									children: m.hint
								})
							]
						}, m.id))
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
						className: "text-[10px] uppercase tracking-widest text-muted-foreground",
						children: "Payment reference (optional)"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						value: reference,
						onChange: (e) => setReference(e.target.value),
						placeholder: "EcoCash txn ID / bank ref",
						maxLength: 80,
						className: "w-full mt-1 px-3 py-2.5 rounded-xl border bg-background text-sm"
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						onClick: submit,
						disabled: submitting,
						className: "w-full h-12 rounded-xl font-display uppercase tracking-wide",
						children: submitting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: ["I Have Made Payment — ", money(amount || 0)] })
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-[11px] text-center text-muted-foreground",
						children: "Your wallet is credited within minutes after admin verifies the payment."
					})
				]
			})]
		})
	});
}
function WithdrawDialog({ open, onOpenChange, balance, hasPin }) {
	const [amount, setAmount] = (0, import_react.useState)(20);
	const [method, setMethod] = (0, import_react.useState)("ecocash");
	const [destination, setDestination] = (0, import_react.useState)("");
	const [pin, setPin] = (0, import_react.useState)("");
	const [submitting, setSubmitting] = (0, import_react.useState)(false);
	const submit = async () => {
		if (!hasPin) return toast.error("Set a withdrawal PIN in Profile first");
		if (!destination.trim()) return toast.error("Enter destination (number/account)");
		if (pin.length < 4) return toast.error("Enter your PIN");
		if (amount > balance) return toast.error("Amount exceeds balance");
		setSubmitting(true);
		const { error } = await supabase.rpc("request_withdrawal", {
			_amount: amount,
			_method: method,
			_destination: destination,
			_pin: pin
		});
		setSubmitting(false);
		setPin("");
		if (error) return toast.error(error.message);
		toast.success("Withdrawal request submitted");
		setDestination("");
		onOpenChange(false);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Dialog, {
		open,
		onOpenChange,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogContent, {
			className: "max-w-sm rounded-3xl",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogHeader, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogTitle, {
				className: "font-display uppercase tracking-wide",
				children: "Withdraw"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogDescription, { children: "Funds are sent after an admin approves the request." })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "space-y-4",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "rounded-2xl bg-muted p-4",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center justify-between",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "text-[10px] uppercase tracking-widest text-muted-foreground",
								children: "Amount"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "text-[10px] text-muted-foreground",
								children: ["Available ", money(balance)]
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-baseline gap-1 mt-1",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-display font-bold text-3xl",
								children: "$"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "number",
								min: 1,
								value: amount,
								onChange: (e) => setAmount(Number(e.target.value)),
								className: "bg-transparent font-display font-bold text-3xl w-full outline-none"
							})]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "text-[10px] uppercase tracking-widest text-muted-foreground mb-2",
						children: "Payout Method"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "grid grid-cols-2 gap-1.5",
						children: METHODS.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							type: "button",
							onClick: () => setMethod(m.id),
							className: cn("flex items-center gap-2 rounded-xl border p-2.5 text-left transition text-xs font-semibold", method === m.id ? "border-primary bg-primary/5" : "hover:border-primary/40"),
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(m.icon, { className: "w-4 h-4 text-primary" }), m.label]
						}, m.id))
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
						className: "text-[10px] uppercase tracking-widest text-muted-foreground",
						children: "Destination (phone / account)"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						value: destination,
						onChange: (e) => setDestination(e.target.value),
						maxLength: 60,
						className: "w-full mt-1 px-3 py-2.5 rounded-xl border bg-background text-sm"
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", {
							className: "text-[10px] uppercase tracking-widest text-muted-foreground",
							children: "Withdrawal PIN"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "password",
							inputMode: "numeric",
							pattern: "[0-9]*",
							value: pin,
							onChange: (e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8)),
							maxLength: 8,
							placeholder: "••••",
							className: "w-full mt-1 px-3 py-2.5 rounded-xl border bg-background text-sm tracking-widest"
						}),
						!hasPin && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-[11px] text-warning mt-1",
							children: "You haven't set a PIN. Set one from Profile before withdrawing."
						})
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						onClick: submit,
						disabled: submitting || !hasPin,
						className: "w-full h-12 rounded-xl font-display uppercase tracking-wide",
						children: submitting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: ["Request Withdrawal — ", money(amount || 0)] })
					})
				]
			})]
		})
	});
}
//#endregion
export { WalletPage as component };
