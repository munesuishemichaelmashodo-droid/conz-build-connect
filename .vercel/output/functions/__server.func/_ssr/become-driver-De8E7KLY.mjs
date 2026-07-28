import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BKwn9D3n.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { v as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as cn } from "./utils-C_uf36nf.mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { K as LoaderCircle, X as Image, b as ShieldCheck, ct as Clock, gt as Camera, ht as Check, mt as ChevronLeft, pt as ChevronRight } from "../_libs/lucide-react.mjs";
import { r as useQueryClient } from "../_libs/tanstack__react-query.mjs";
import { n as useAuth } from "./auth-CKNZvOvp.mjs";
import { n as PopoverContent, r as PopoverTrigger, t as Popover } from "./popover-Cmlz_mk1.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { t as AppShell } from "./AppShell-1W_lsY73.mjs";
import { t as Input } from "./input-B8Q2ztVi.mjs";
import { t as Label } from "./label-DBD1bRRP.mjs";
import { a as CommandInput, i as CommandGroup, n as Command$1, o as CommandItem, r as CommandEmpty, s as CommandList, t as COUNTRY_CODES } from "./command-B5bNkx_t.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/become-driver-De8E7KLY.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var STEPS = [
	{
		key: "identity",
		title: "Your details"
	},
	{
		key: "selfie",
		title: "Selfie photo"
	},
	{
		key: "license",
		title: "Driver's licence"
	},
	{
		key: "truck",
		title: "Your truck"
	},
	{
		key: "nationality",
		title: "Nationality"
	}
];
function BecomeDriverPage() {
	const { userId, profile, email, is, refresh } = useAuth();
	const qc = useQueryClient();
	const nav = useNavigate();
	const [step, setStep] = (0, import_react.useState)(0);
	const [name, setName] = (0, import_react.useState)(profile?.full_name ?? "");
	const [emailInput, setEmailInput] = (0, import_react.useState)(email ?? "");
	const [selfie, setSelfie] = (0, import_react.useState)(null);
	const [license, setLicense] = (0, import_react.useState)(null);
	const [truckPhoto, setTruckPhoto] = (0, import_react.useState)(null);
	const [nationality, setNationality] = (0, import_react.useState)("Zimbabwe");
	const [submitting, setSubmitting] = (0, import_react.useState)(false);
	const [done, setDone] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		if (!userId) return;
		(async () => {
			await supabase.from("driver_profiles").upsert({ user_id: userId }, {
				onConflict: "user_id",
				ignoreDuplicates: true
			});
			const { data } = await supabase.from("driver_profiles").select("selfie_url,license_url,tipper_photo_url,nationality,verification_status").eq("user_id", userId).maybeSingle();
			if (data) {
				setSelfie(data.selfie_url ?? null);
				setLicense(data.license_url ?? null);
				setTruckPhoto(data.tipper_photo_url ?? null);
				if (data.nationality) setNationality(data.nationality);
				if (data.verification_status === "pending" && data.selfie_url && data.license_url && data.tipper_photo_url && data.nationality) setDone(true);
			}
		})();
	}, [userId]);
	const canNext = () => {
		if (step === 0) return name.trim().length > 1 && !!emailInput.trim();
		if (step === 1) return !!selfie;
		if (step === 2) return !!license;
		if (step === 3) return !!truckPhoto;
		if (step === 4) return !!nationality;
		return false;
	};
	const submit = async () => {
		if (!userId) return;
		setSubmitting(true);
		try {
			if (name.trim() && name.trim() !== profile?.full_name) await supabase.from("profiles").update({ full_name: name.trim() }).eq("id", userId);
			if (!is("driver")) await supabase.from("user_roles").insert({
				user_id: userId,
				role: "driver"
			});
			await supabase.from("driver_profiles").update({ nationality }).eq("user_id", userId);
			await supabase.from("wallets").upsert({
				user_id: userId,
				balance: 0
			}, {
				onConflict: "user_id",
				ignoreDuplicates: true
			});
			await refresh();
			qc.invalidateQueries();
			setDone(true);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Could not submit");
		} finally {
			setSubmitting(false);
		}
	};
	if (done) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {
		title: "Driver signup",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "max-w-md mx-auto text-center space-y-5 py-10",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "w-20 h-20 rounded-full bg-warning/15 border border-warning/40 mx-auto flex items-center justify-center",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Clock, { className: "w-10 h-10 text-warning" })
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "font-display font-bold text-2xl",
					children: "Pending verification"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
					className: "text-sm text-muted-foreground mt-2",
					children: [
						"Thanks! We've received your documents. Our team usually reviews new drivers within ",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "24 hours" }),
						". You'll get a notification once you're approved to start bidding."
					]
				})] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-xl border bg-muted/30 p-4 text-left text-xs text-muted-foreground flex gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ShieldCheck, { className: "w-4 h-4 text-primary shrink-0 mt-0.5" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Your ID, licence, and truck photos are only visible to you and Con Z admins." })]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						onClick: () => nav({ to: "/home" }),
						children: "Go to home"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						variant: "ghost",
						onClick: () => nav({ to: "/profile" }),
						children: "View profile"
					})]
				})
			]
		})
	});
	const isLast = step === STEPS.length - 1;
	const progress = (step + 1) / STEPS.length * 100;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppShell, {
		title: "Become a driver",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "max-w-md mx-auto space-y-5",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex items-center justify-between text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
						"Step ",
						step + 1,
						" of ",
						STEPS.length
					] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: STEPS[step].title })]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "h-2 rounded-full bg-muted overflow-hidden",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "h-full bg-primary transition-all",
						style: { width: `${progress}%` }
					})
				})] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "rounded-2xl border bg-card p-5 shadow-soft min-h-[280px]",
					children: [
						step === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "space-y-3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
									className: "font-display font-bold text-xl",
									children: "Tell us who you are"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "text-sm text-muted-foreground",
									children: "We'll display this to customers when you bid on jobs."
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
									htmlFor: "fn",
									children: "Full name"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									id: "fn",
									value: name,
									onChange: (e) => setName(e.target.value),
									maxLength: 80
								})] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
									htmlFor: "em",
									children: "Email"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
									id: "em",
									type: "email",
									value: emailInput,
									onChange: (e) => setEmailInput(e.target.value),
									disabled: true
								})] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "text-[11px] text-muted-foreground",
									children: "Email is taken from your Con Z account. Change it in your profile if needed."
								})
							]
						}),
						step === 1 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PhotoStep, {
							title: "Take a clear selfie",
							hint: "Front camera • Face centered, good lighting.",
							field: "selfie_url",
							cameraFacing: "user",
							userId,
							current: selfie,
							onDone: setSelfie
						}),
						step === 2 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PhotoStep, {
							title: "Photo of your driver's licence",
							hint: "Back camera • Whole card, all four corners visible.",
							field: "license_url",
							cameraFacing: "environment",
							userId,
							current: license,
							onDone: setLicense
						}),
						step === 3 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PhotoStep, {
							title: "Photo of your tipper truck",
							hint: "Back camera • Full truck including number plate.",
							field: "tipper_photo_url",
							cameraFacing: "environment",
							userId,
							current: truckPhoto,
							onDone: setTruckPhoto
						}),
						step === 4 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "space-y-3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
									className: "font-display font-bold text-xl",
									children: "Your nationality"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "text-sm text-muted-foreground",
									children: "Where is your citizenship from?"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(NationalitySelect, {
									value: nationality,
									onChange: setNationality
								})
							]
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "flex gap-2",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
						variant: "outline",
						onClick: () => setStep((s) => Math.max(0, s - 1)),
						disabled: step === 0,
						className: "flex-1",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronLeft, { className: "w-4 h-4 mr-1" }), " Back"]
					}), isLast ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						onClick: submit,
						disabled: !canNext() || submitting,
						className: "flex-1",
						children: submitting ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: ["Submit ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, { className: "w-4 h-4 ml-1" })] })
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
						onClick: () => setStep((s) => s + 1),
						disabled: !canNext(),
						className: "flex-1",
						children: ["Next ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: "w-4 h-4 ml-1" })]
					})]
				})
			]
		})
	});
}
function PhotoStep({ title, hint, field, cameraFacing, userId, current, onDone }) {
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
		toast.success("Uploaded");
		onDone(path);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "space-y-3",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
				className: "font-display font-bold text-xl",
				children: title
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-sm text-muted-foreground",
				children: hint
			}),
			current && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "rounded-lg bg-success/10 border border-success/30 p-3 flex items-center gap-2 text-xs",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, { className: "w-4 h-4 text-success" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "Photo uploaded. You can retake it if you want." })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "grid grid-cols-2 gap-2",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "flex flex-col items-center gap-1 rounded-xl border-2 border-dashed bg-muted/30 hover:bg-muted p-5 cursor-pointer transition",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Camera, { className: "w-6 h-6 text-primary" }),
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
					className: "flex flex-col items-center gap-1 rounded-xl border-2 border-dashed bg-muted/30 hover:bg-muted p-5 cursor-pointer transition",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Image, { className: "w-6 h-6 text-primary" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "text-xs font-semibold",
							children: uploading ? "Uploading…" : "From gallery"
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
function NationalitySelect({ value, onChange }) {
	const [open, setOpen] = (0, import_react.useState)(false);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Popover, {
		open,
		onOpenChange: setOpen,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PopoverTrigger, {
			asChild: true,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
				variant: "outline",
				role: "combobox",
				className: "w-full justify-between",
				children: [value || "Select country", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronRight, { className: cn("w-4 h-4 opacity-50 transition-transform", open && "rotate-90") })]
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PopoverContent, {
			className: "p-0 w-[--radix-popover-trigger-width]",
			align: "start",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Command$1, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CommandInput, { placeholder: "Search country…" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CommandList, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CommandEmpty, { children: "No country found." }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CommandGroup, { children: COUNTRY_CODES.map((c) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CommandItem, {
				value: c.name,
				onSelect: () => {
					onChange(c.name);
					setOpen(false);
				},
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, { className: cn("mr-2 h-4 w-4", value === c.name ? "opacity-100" : "opacity-0") }), c.name]
			}, c.code)) })] })] })
		})]
	});
}
//#endregion
export { BecomeDriverPage as component };
