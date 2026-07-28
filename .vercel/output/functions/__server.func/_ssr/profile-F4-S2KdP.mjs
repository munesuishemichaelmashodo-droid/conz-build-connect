import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BKwn9D3n.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as cn } from "./utils-C_uf36nf.mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { K as LoaderCircle, X as Image, Y as KeyRound, b as ShieldCheck, g as Shield, gt as Camera, o as Truck, y as ShieldOff } from "../_libs/lucide-react.mjs";
import { r as useQueryClient, t as useQuery } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-CKNZvOvp.mjs";
import { n as useViewMode } from "./view-mode-BA6qxzLc.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { t as AppShell } from "./AppShell-1W_lsY73.mjs";
import { r as StatusBadge } from "./ui-bits-DE9HqP-8.mjs";
import { t as Input } from "./input-B8Q2ztVi.mjs";
import { t as Label } from "./label-DBD1bRRP.mjs";
import { t as useLocationSharingEnabled } from "./location-privacy-BVeQVH5l.mjs";
import { n as SwitchThumb, t as Switch$1 } from "../_libs/radix-ui__react-switch.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/profile-F4-S2KdP.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var Switch = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Switch$1, {
	className: cn("peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input", className),
	...props,
	ref,
	children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SwitchThumb, { className: cn("pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0") })
}));
Switch.displayName = Switch$1.displayName;
function LocationPrivacyCard() {
	const [enabled, setEnabled] = useLocationSharingEnabled();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-2xl bg-card border p-4 shadow-soft space-y-3",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex items-start justify-between gap-3",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-start gap-3 min-w-0",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0",
					children: enabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Shield, { className: "w-5 h-5 text-primary" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldOff, { className: "w-5 h-5 text-warning" })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "min-w-0",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display font-bold uppercase tracking-wide text-sm",
						children: "Location privacy"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-xs text-muted-foreground mt-1",
						children: "Share your live location with jobs you're delivering."
					})]
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Switch, {
				checked: enabled,
				onCheckedChange: setEnabled,
				"aria-label": "Toggle live location sharing"
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: `rounded-lg border p-3 text-xs space-y-1 ${enabled ? "bg-muted/40" : "bg-warning/10 border-warning/40"}`,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "font-semibold uppercase tracking-wide text-[11px]",
				children: enabled ? "When on" : "When off, this stops"
			}), enabled ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
				className: "list-disc list-inside text-muted-foreground space-y-1",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Customers on your active jobs see your live GPS on the map" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Sharing runs only while you press \"Start sharing\" on a job" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Location auto-clears when you press \"Stop sharing\" or finish the job" })
				]
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
				className: "list-disc list-inside text-muted-foreground space-y-1",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "No live GPS coordinates are sent to any customer, on any job" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Any in-progress live share is ended and the last pin is deleted" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "The \"Start sharing location\" button is disabled on every job" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Address search and \"Locate me\" on booking still work — those are one-off lookups, not continuous tracking" })
				]
			})]
		})]
	});
}
function ProfilePage() {
	const { userId, profile, roles, is, refresh } = useAuth();
	const { activeRole } = useViewMode();
	const qc = useQueryClient();
	const [name, setName] = (0, import_react.useState)(profile?.full_name ?? "");
	const [phone, setPhone] = (0, import_react.useState)(profile?.phone ?? "");
	const [saving, setSaving] = (0, import_react.useState)(false);
	const { data: driver } = useQuery({
		queryKey: ["driver-profile", userId],
		enabled: !!userId && is("driver"),
		queryFn: async () => (await supabase.from("driver_profiles").select("*").eq("user_id", userId).maybeSingle()).data
	});
	const { data: trucks } = useQuery({
		queryKey: ["trucks", userId],
		enabled: !!userId && is("driver"),
		queryFn: async () => (await supabase.from("trucks").select("*").eq("driver_id", userId)).data ?? []
	});
	const saveProfile = async () => {
		if (!name.trim()) return toast.error("Name required");
		setSaving(true);
		const { error } = await supabase.from("profiles").update({
			full_name: name.trim(),
			phone: phone.trim() || null
		}).eq("id", userId);
		setSaving(false);
		if (error) return toast.error(error.message);
		toast.success("Profile saved");
		refresh();
	};
	const becomeDriver = async () => {
		const { error } = await supabase.from("user_roles").insert({
			user_id: userId,
			role: "driver"
		});
		if (error) return toast.error(error.message);
		await supabase.from("driver_profiles").upsert({ user_id: userId }, { onConflict: "user_id" });
		await supabase.from("wallets").upsert({
			user_id: userId,
			balance: 0
		}, { onConflict: "user_id" });
		toast.success("You're now a driver. Complete verification to start bidding.");
		refresh();
		qc.invalidateQueries();
	};
	const becomeCustomer = async () => {
		const { error } = await supabase.from("user_roles").insert({
			user_id: userId,
			role: "customer"
		});
		if (error) return toast.error(error.message);
		toast.success("Customer account active.");
		refresh();
		qc.invalidateQueries();
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {
		title: "Profile",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "space-y-6",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "rounded-2xl bg-card border p-4 shadow-soft space-y-3",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-display font-bold uppercase tracking-wide",
							children: "Account"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
							htmlFor: "n",
							children: "Full name"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							id: "n",
							value: name,
							onChange: (e) => setName(e.target.value),
							maxLength: 80
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
							htmlFor: "p",
							children: "Phone"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
							id: "p",
							value: phone,
							onChange: (e) => setPhone(e.target.value),
							maxLength: 20,
							placeholder: "+263 …"
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
							onClick: saveProfile,
							disabled: saving,
							className: "w-full",
							children: saving ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Save"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "flex flex-wrap gap-1 pt-2",
							children: roles.map((r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
								label: r.replace("_", " "),
								className: "bg-accent text-accent-foreground border-accent"
							}, r))
						})
					]
				}),
				activeRole === "driver" && !is("driver") && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
					onClick: becomeDriver,
					variant: "outline",
					className: "w-full h-12",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Truck, { className: "w-4 h-4 mr-2" }), "Become a driver too"]
				}),
				activeRole === "customer" && !is("customer") && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
					onClick: becomeCustomer,
					variant: "outline",
					className: "w-full h-12",
					children: "Enable customer account"
				}),
				activeRole === "driver" && is("driver") && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "rounded-2xl bg-card border p-4 shadow-soft space-y-3",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center justify-between",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "font-display font-bold uppercase tracking-wide",
								children: "Driver verification"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
								label: driver?.verification_status ?? "pending",
								className: driver?.verification_status === "verified" ? "bg-success/15 text-success border-success/30" : driver?.verification_status === "rejected" ? "bg-destructive/15 text-destructive border-destructive/30" : "bg-warning/15 text-warning border-warning/30"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs text-muted-foreground",
							children: "Take each photo with your phone camera. Make sure your face and documents are clearly visible."
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DocUpload, {
							field: "selfie_url",
							label: "Selfie (face photo)",
							hint: "Front camera • Look at the camera in good light",
							cameraFacing: "user",
							userId,
							current: driver?.selfie_url,
							refresh: () => qc.invalidateQueries({ queryKey: ["driver-profile", userId] })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DocUpload, {
							field: "license_url",
							label: "Driver's licence",
							hint: "Back camera • Full licence card, all corners visible",
							cameraFacing: "environment",
							userId,
							current: driver?.license_url,
							refresh: () => qc.invalidateQueries({ queryKey: ["driver-profile", userId] })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DocUpload, {
							field: "tipper_photo_url",
							label: "Tipper truck photo",
							hint: "Back camera • Whole truck with number plate visible",
							cameraFacing: "environment",
							userId,
							current: driver?.tipper_photo_url,
							refresh: () => qc.invalidateQueries({ queryKey: ["driver-profile", userId] })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DocUpload, {
							field: "national_id_url",
							label: "National ID",
							hint: "Back camera • Front side of your ID card",
							cameraFacing: "environment",
							userId,
							current: driver?.national_id_url,
							refresh: () => qc.invalidateQueries({ queryKey: ["driver-profile", userId] })
						}),
						driver?.verification_notes && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "text-xs text-muted-foreground bg-muted p-2 rounded",
							children: ["Admin note: ", driver.verification_notes]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "border-t pt-3 mt-3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex items-center gap-2 text-sm font-semibold mb-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Truck, { className: "w-4 h-4" }), "My trucks"]
								}),
								trucks?.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "text-sm border rounded p-2 mb-1",
									children: [
										t.registration,
										" • ",
										Number(t.capacity_m3),
										" m³"
									]
								}, t.id)),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AddTruckForm, {
									userId,
									onSaved: () => qc.invalidateQueries({ queryKey: ["trucks", userId] })
								})
							]
						})
					]
				}),
				activeRole === "driver" && is("driver") && driver?.verification_status === "verified" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-xl bg-success/10 border border-success/30 p-3 flex items-center gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldCheck, { className: "w-5 h-5 text-success" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "text-sm",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "font-semibold",
							children: "You're verified"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-muted-foreground text-xs",
							children: "You can bid on any open job."
						})]
					})]
				}),
				activeRole === "customer" && is("customer") && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "rounded-2xl bg-card border p-4 shadow-soft space-y-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display font-bold uppercase tracking-wide",
						children: "Customer account"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-muted-foreground",
						children: "Post jobs, review bids, and track deliveries live on the map."
					})]
				}),
				activeRole === "driver" && is("driver") && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(WithdrawalPinCard, {}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(SetPasswordCard, {}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LocationPrivacyCard, {})
			]
		})
	});
}
function SetPasswordCard() {
	const [pw, setPw] = (0, import_react.useState)("");
	const [confirm, setConfirm] = (0, import_react.useState)("");
	const [saving, setSaving] = (0, import_react.useState)(false);
	const save = async () => {
		if (pw.length < 8) return toast.error("Password must be at least 8 characters");
		if (pw !== confirm) return toast.error("Passwords do not match");
		setSaving(true);
		const { error } = await supabase.auth.updateUser({ password: pw });
		setSaving(false);
		if (error) return toast.error(error.message);
		setPw("");
		setConfirm("");
		toast.success("Password saved. You can now log in with email + password.");
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-2xl bg-card border p-4 shadow-soft space-y-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(KeyRound, { className: "w-4 h-4 text-primary" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
					className: "font-display font-bold uppercase tracking-wide",
					children: "Set / change login password"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted-foreground",
				children: "Set a password so you can log in with email + password — even if you originally signed up with Google. Google never shares your Google password with any app, so this is a separate Con Z password you control."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid grid-cols-2 gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
					htmlFor: "npw",
					children: "New password"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
					id: "npw",
					type: "password",
					value: pw,
					onChange: (e) => setPw(e.target.value),
					minLength: 8,
					autoComplete: "new-password"
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
					htmlFor: "npw2",
					children: "Confirm"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
					id: "npw2",
					type: "password",
					value: confirm,
					onChange: (e) => setConfirm(e.target.value),
					minLength: 8,
					autoComplete: "new-password"
				})] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				onClick: save,
				disabled: saving,
				className: "w-full",
				children: saving ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Save password"
			})
		]
	});
}
function DocUpload({ field, label, hint, cameraFacing = "environment", userId, current, refresh }) {
	const [uploading, setUploading] = (0, import_react.useState)(false);
	const upload = async (file) => {
		setUploading(true);
		const path = `${userId}/${field}-${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
		const { error: uerr } = await supabase.storage.from("driver-docs").upload(path, file, { upsert: true });
		if (uerr) {
			setUploading(false);
			return toast.error(uerr.message);
		}
		const patch = {
			[field]: path,
			verification_status: "pending"
		};
		const { error } = await supabase.from("driver_profiles").update(patch).eq("user_id", userId);
		setUploading(false);
		if (error) return toast.error(error.message);
		toast.success(`${label} uploaded`);
		refresh();
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "rounded-xl border p-3 space-y-2",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-between gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
					className: "font-semibold",
					children: label
				}), current && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
					label: "Uploaded",
					className: "bg-success/15 text-success border-success/30"
				})]
			}),
			hint && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-[11px] text-muted-foreground",
				children: hint
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid grid-cols-2 gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 hover:bg-muted transition p-3 cursor-pointer",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Camera, { className: "w-5 h-5 text-primary shrink-0" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-xs font-semibold",
							children: uploading ? "Uploading…" : "Take photo"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "file",
							accept: "image/*",
							capture: cameraFacing,
							disabled: uploading,
							onChange: (e) => e.target.files?.[0] && upload(e.target.files[0]),
							className: "hidden"
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "flex items-center gap-2 rounded-lg border border-dashed bg-muted/40 hover:bg-muted transition p-3 cursor-pointer",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Image, { className: "w-5 h-5 text-primary shrink-0" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-xs font-semibold",
							children: uploading ? "Uploading…" : "Choose from gallery"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "file",
							accept: "image/*",
							disabled: uploading,
							onChange: (e) => e.target.files?.[0] && upload(e.target.files[0]),
							className: "hidden"
						})
					]
				})]
			})
		]
	});
}
function AddTruckForm({ userId, onSaved }) {
	const [reg, setReg] = (0, import_react.useState)("");
	const [cap, setCap] = (0, import_react.useState)("");
	const [saving, setSaving] = (0, import_react.useState)(false);
	const submit = async (e) => {
		e.preventDefault();
		if (!reg.trim() || !parseFloat(cap)) return toast.error("Enter registration and capacity");
		setSaving(true);
		const { error } = await supabase.from("trucks").insert({
			driver_id: userId,
			registration: reg.trim(),
			capacity_m3: parseFloat(cap)
		});
		setSaving(false);
		if (error) return toast.error(error.message);
		setReg("");
		setCap("");
		toast.success("Truck added");
		onSaved();
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		onSubmit: submit,
		className: "grid grid-cols-3 gap-2 mt-2",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
				placeholder: "Reg.",
				value: reg,
				onChange: (e) => setReg(e.target.value),
				maxLength: 20
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
				placeholder: "m³",
				type: "number",
				inputMode: "decimal",
				min: 1,
				value: cap,
				onChange: (e) => setCap(e.target.value)
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				type: "submit",
				disabled: saving,
				size: "sm",
				children: saving ? "…" : "Add"
			})
		]
	});
}
function WithdrawalPinCard() {
	const { userId } = useAuth();
	const qc = useQueryClient();
	const { data: driver } = useQuery({
		queryKey: ["driver-pin-profile", userId],
		enabled: !!userId,
		queryFn: async () => (await supabase.from("driver_profiles").select("withdrawal_pin_hash").eq("user_id", userId).maybeSingle()).data
	});
	const hasPin = !!driver?.withdrawal_pin_hash;
	const [pin, setPin] = (0, import_react.useState)("");
	const [confirm, setConfirm] = (0, import_react.useState)("");
	const [saving, setSaving] = (0, import_react.useState)(false);
	const save = async () => {
		if (!/^\d{4,8}$/.test(pin)) return toast.error("PIN must be 4-8 digits");
		if (pin !== confirm) return toast.error("PINs do not match");
		setSaving(true);
		const { error } = await supabase.rpc("set_withdrawal_pin", { _pin: pin });
		setSaving(false);
		if (error) return toast.error(error.message);
		setPin("");
		setConfirm("");
		toast.success("Withdrawal PIN saved");
		qc.invalidateQueries({ queryKey: ["driver-pin-profile", userId] });
		qc.invalidateQueries({ queryKey: ["driver-pin", userId] });
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "rounded-2xl bg-card border p-4 shadow-soft space-y-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-between",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(KeyRound, { className: "w-4 h-4 text-primary" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
						className: "font-display font-bold uppercase tracking-wide",
						children: "Withdrawal PIN"
					})]
				}), hasPin && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatusBadge, {
					label: "Set",
					className: "bg-success/15 text-success border-success/30"
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs text-muted-foreground",
				children: "Required to authorise withdrawals from your wallet. 4–8 digits. Five wrong entries locks withdrawals for 15 minutes."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid grid-cols-2 gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
					htmlFor: "pin",
					children: hasPin ? "New PIN" : "PIN"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
					id: "pin",
					type: "password",
					inputMode: "numeric",
					value: pin,
					onChange: (e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8)),
					maxLength: 8
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
					htmlFor: "pin2",
					children: "Confirm"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
					id: "pin2",
					type: "password",
					inputMode: "numeric",
					value: confirm,
					onChange: (e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 8)),
					maxLength: 8
				})] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				onClick: save,
				disabled: saving,
				className: "w-full",
				children: saving ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : hasPin ? "Update PIN" : "Set PIN"
			})
		]
	});
}
//#endregion
export { ProfilePage as component };
