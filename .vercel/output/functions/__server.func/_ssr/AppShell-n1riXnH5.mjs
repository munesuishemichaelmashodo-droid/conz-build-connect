import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BEr3FmPh.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { g as Link, v as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as cva } from "../_libs/class-variance-authority+clsx.mjs";
import { t as cn } from "./utils-C_uf36nf.mjs";
import { B as Menu, I as Moon, S as Settings, U as LogOut, W as Lock, Z as HardHat, a as User, bt as Bell, g as Shield, ht as Check, n as X, o as Truck, q as LifeBuoy, tt as FileText, u as Sun, z as MessageSquareWarning } from "../_libs/lucide-react.mjs";
import { r as useQueryClient } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-Dij6GkaO.mjs";
import { n as useViewMode } from "./view-mode-CP7WmA6u.mjs";
import { a as DialogOverlay, c as DialogTrigger, i as DialogDescription, n as DialogClose, o as DialogPortal, r as DialogContent, s as DialogTitle, t as Dialog } from "../_libs/@radix-ui/react-dialog+[...].mjs";
import { n as PopoverContent, r as PopoverTrigger, t as Popover } from "./popover-Cmlz_mk1.mjs";
import { n as toast } from "../_libs/sonner.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/AppShell-n1riXnH5.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function NotificationsBell() {
	const { userId } = useAuth();
	const [items, setItems] = (0, import_react.useState)([]);
	const [open, setOpen] = (0, import_react.useState)(false);
	const nav = useNavigate();
	const unread = items.filter((i) => !i.read).length;
	(0, import_react.useEffect)(() => {
		if (!userId) return;
		let active = true;
		const load = async () => {
			const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(30);
			if (active && data) setItems(data);
		};
		load();
		const channel = supabase.channel(`notifications:${userId}`).on("postgres_changes", {
			event: "INSERT",
			schema: "public",
			table: "notifications",
			filter: `user_id=eq.${userId}`
		}, (payload) => {
			const n = payload.new;
			setItems((prev) => [n, ...prev].slice(0, 30));
			toast(n.title, { description: n.body ?? void 0 });
		}).on("postgres_changes", {
			event: "UPDATE",
			schema: "public",
			table: "notifications",
			filter: `user_id=eq.${userId}`
		}, (payload) => {
			const n = payload.new;
			setItems((prev) => prev.map((i) => i.id === n.id ? n : i));
		}).subscribe();
		return () => {
			active = false;
			supabase.removeChannel(channel);
		};
	}, [userId]);
	const markAll = async () => {
		if (!unread) return;
		const ids = items.filter((i) => !i.read).map((i) => i.id);
		setItems((prev) => prev.map((i) => ({
			...i,
			read: true
		})));
		await supabase.from("notifications").update({ read: true }).in("id", ids);
	};
	const openItem = async (n) => {
		if (!n.read) {
			setItems((prev) => prev.map((i) => i.id === n.id ? {
				...i,
				read: true
			} : i));
			await supabase.from("notifications").update({ read: true }).eq("id", n.id);
		}
		setOpen(false);
		if (n.job_id) nav({
			to: "/jobs/$id",
			params: { id: n.job_id }
		});
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Popover, {
		open,
		onOpenChange: setOpen,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PopoverTrigger, {
			asChild: true,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				className: "relative p-2 rounded-md hover:bg-muted text-muted-foreground",
				"aria-label": "Notifications",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Bell, { className: "w-4 h-4" }), unread > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center",
					children: unread > 9 ? "9+" : unread
				})]
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(PopoverContent, {
			align: "end",
			className: "w-80 p-0",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-between px-3 py-2 border-b",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "font-semibold text-sm",
					children: "Notifications"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					onClick: markAll,
					disabled: !unread,
					className: "text-xs text-primary disabled:text-muted-foreground inline-flex items-center gap-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, { className: "w-3 h-3" }), " Mark all read"]
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "max-h-96 overflow-auto",
				children: items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "p-6 text-center text-sm text-muted-foreground",
					children: "You're all caught up"
				}) : items.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: () => openItem(n),
					className: cn("w-full text-left px-3 py-2.5 border-b last:border-0 hover:bg-muted transition-colors", !n.read && "bg-primary/5"),
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-start gap-2",
						children: [!n.read && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex-1 min-w-0",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "text-sm font-medium truncate",
									children: n.title
								}),
								n.body && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "text-xs text-muted-foreground line-clamp-2",
									children: n.body
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "text-[10px] text-muted-foreground mt-0.5",
									children: new Date(n.created_at).toLocaleString()
								})
							]
						})]
					})
				}, n.id))
			})]
		})]
	});
}
var Sheet = Dialog;
var SheetTrigger = DialogTrigger;
var SheetPortal = DialogPortal;
var SheetOverlay = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogOverlay, {
	className: cn("fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0", className),
	...props,
	ref
}));
SheetOverlay.displayName = DialogOverlay.displayName;
var sheetVariants = cva("fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out", {
	variants: { side: {
		top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
		bottom: "inset-x-0 bottom-0 border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
		left: "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm",
		right: "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm"
	} },
	defaultVariants: { side: "right" }
});
var SheetContent = import_react.forwardRef(({ side = "right", className, children, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(SheetPortal, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SheetOverlay, {}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogContent, {
	ref,
	className: cn(sheetVariants({ side }), className),
	...props,
	children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(DialogClose, {
		className: "absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background cursor-pointer transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(X, { className: "h-4 w-4" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "sr-only",
			children: "Close"
		})]
	}), children]
})] }));
SheetContent.displayName = DialogContent.displayName;
var SheetHeader = ({ className, ...props }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
	className: cn("flex flex-col space-y-2 text-center sm:text-left", className),
	...props
});
SheetHeader.displayName = "SheetHeader";
var SheetFooter = ({ className, ...props }) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
	className: cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className),
	...props
});
SheetFooter.displayName = "SheetFooter";
var SheetTitle = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogTitle, {
	ref,
	className: cn("text-lg font-semibold text-foreground", className),
	...props
}));
SheetTitle.displayName = DialogTitle.displayName;
var SheetDescription = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DialogDescription, {
	ref,
	className: cn("text-sm text-muted-foreground", className),
	...props
}));
SheetDescription.displayName = DialogDescription.displayName;
function SidePanel() {
	const [open, setOpen] = (0, import_react.useState)(false);
	const { theme, toggleTheme, activeRole, setActiveRole, availableRoles } = useViewMode();
	const { is, profile, email } = useAuth();
	const isAdmin = is("admin") || is("super_admin");
	const nav = useNavigate();
	const qc = useQueryClient();
	const close = () => setOpen(false);
	const signOut = async () => {
		close();
		await qc.cancelQueries();
		qc.clear();
		await supabase.auth.signOut();
		nav({
			to: "/auth",
			replace: true
		});
	};
	const switchRole = (r) => {
		setActiveRole(r);
		close();
		nav({ to: r === "driver" ? "/driver" : "/customer" });
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Sheet, {
		open,
		onOpenChange: setOpen,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SheetTrigger, {
			asChild: true,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				className: "p-2 rounded-md hover:bg-muted text-muted-foreground",
				"aria-label": "Open menu",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Menu, { className: "w-5 h-5" })
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(SheetContent, {
			side: "left",
			className: "w-[300px] p-0 flex flex-col",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SheetHeader, {
					className: "p-5 border-b",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(SheetTitle, {
						className: "text-left",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-display font-bold",
							children: profile?.full_name ?? "Account"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-xs text-muted-foreground font-normal truncate",
							children: email
						})]
					})
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex-1 overflow-y-auto",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
							label: "Screen mode",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "grid grid-cols-2 gap-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModeButton, {
									active: theme === "light",
									onClick: () => theme !== "light" && toggleTheme(),
									icon: Sun,
									label: "Light"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModeButton, {
									active: theme === "dark",
									onClick: () => theme !== "dark" && toggleTheme(),
									icon: Moon,
									label: "Dark"
								})]
							})
						}),
						availableRoles.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, {
							label: "View as",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "grid grid-cols-2 gap-2",
								children: [availableRoles.includes("customer") && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModeButton, {
									active: activeRole === "customer",
									onClick: () => switchRole("customer"),
									icon: HardHat,
									label: "Customer"
								}), availableRoles.includes("driver") && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ModeButton, {
									active: activeRole === "driver",
									onClick: () => switchRole("driver"),
									icon: Truck,
									label: "Driver"
								})]
							}), availableRoles.length === 1 && availableRoles[0] === "customer" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
								to: "/become-driver",
								onClick: close,
								className: "mt-2 flex items-center justify-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/20",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Truck, { className: "w-4 h-4" }), " Become a driver"]
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, {
							label: "Settings",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavItem, {
									to: "/profile",
									icon: User,
									label: "Profile",
									onClick: close
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavItem, {
									to: "/jobs",
									icon: Bell,
									label: "Notifications & jobs",
									onClick: close
								}),
								isAdmin && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavItem, {
									to: "/admin",
									icon: Shield,
									label: "Admin dashboard",
									onClick: close
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavItem, {
									to: "/profile",
									icon: Settings,
									label: "Account settings",
									onClick: close
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, {
							label: "Support",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavItem, {
								to: "/help",
								icon: LifeBuoy,
								label: "Help & FAQ",
								onClick: close
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavItem, {
								to: "/report",
								icon: MessageSquareWarning,
								label: "Report an issue",
								onClick: close
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, {
							label: "Legal",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavItem, {
								to: "/terms",
								icon: FileText,
								label: "Terms & Conditions",
								onClick: close
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(NavItem, {
								to: "/privacy",
								icon: Lock,
								label: "Privacy Policy",
								onClick: close
							})]
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "p-4 border-t",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						onClick: signOut,
						className: "w-full flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-muted",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LogOut, { className: "w-4 h-4" }), " Sign out"]
					})
				})
			]
		})]
	});
}
function Section({ label, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "p-4 border-b",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "text-[11px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold",
			children: label
		}), children]
	});
}
function ModeButton({ active, onClick, icon: Icon, label }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
		onClick,
		className: cn("flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-semibold transition", active ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted text-muted-foreground"),
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { className: "w-5 h-5" }), label]
	});
}
function NavItem({ to, icon: Icon, label, onClick }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
		to,
		onClick,
		className: "flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Icon, { className: "w-4 h-4 text-muted-foreground" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label })]
	});
}
function AppShell({ title, children, action }) {
	const { profile } = useAuth();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "min-h-screen flex flex-col bg-background",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("header", {
			className: "sticky top-0 z-30 border-b bg-card/95 backdrop-blur",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "mx-auto max-w-screen-sm flex items-center justify-between px-4 h-14",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
						src: "/conz-logo.png",
						alt: "CON Z",
						className: "w-8 h-8 rounded-md object-cover",
						width: 32,
						height: 32
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "leading-tight",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-display font-bold text-base",
							children: title ?? "Con Z"
						}), profile && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-[11px] text-muted-foreground -mt-0.5 truncate max-w-[160px]",
							children: profile.full_name
						})]
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-1",
					children: [
						action,
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NotificationsBell, {}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SidePanel, {})
					]
				})]
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
			className: "flex-1 mx-auto w-full max-w-screen-sm px-4 py-4 pb-6",
			children
		})]
	});
}
//#endregion
export { AppShell as t };
