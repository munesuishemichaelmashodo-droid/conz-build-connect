import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BEr3FmPh.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { g as Link, v as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { t as cn } from "./utils-C_uf36nf.mjs";
import { t as Button } from "./button-Bq5vK6RO.mjs";
import { K as LoaderCircle, Tt as ArrowLeft, ft as ChevronsUpDown, ht as Check, lt as Circle, nt as Eye, rt as EyeOff } from "../_libs/lucide-react.mjs";
import { n as PopoverContent, r as PopoverTrigger, t as Popover } from "./popover-Cmlz_mk1.mjs";
import { n as toast } from "../_libs/sonner.mjs";
import { t as Route } from "./auth-DD98SgzG.mjs";
import { t as Input } from "./input-B8Q2ztVi.mjs";
import { t as Label } from "./label-DBD1bRRP.mjs";
import { a as CommandInput, i as CommandGroup, n as Command$1, o as CommandItem, r as CommandEmpty, s as CommandList, t as COUNTRY_CODES } from "./command-B5bNkx_t.mjs";
import { n as RadioGroupIndicator, r as RadioGroupItem$1, t as RadioGroup$1 } from "../_libs/@radix-ui/react-radio-group+[...].mjs";
import { i as Trigger, n as List, r as Root2, t as Content } from "../_libs/radix-ui__react-tabs.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/auth-BBNn9dq5.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var Tabs = Root2;
var TabsList = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(List, {
	ref,
	className: cn("inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className),
	...props
}));
TabsList.displayName = List.displayName;
var TabsTrigger = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trigger, {
	ref,
	className: cn("inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow", className),
	...props
}));
TabsTrigger.displayName = Trigger.displayName;
var TabsContent = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Content, {
	ref,
	className: cn("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className),
	...props
}));
TabsContent.displayName = Content.displayName;
var RadioGroup = import_react.forwardRef(({ className, ...props }, ref) => {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RadioGroup$1, {
		className: cn("grid gap-2", className),
		...props,
		ref
	});
});
RadioGroup.displayName = RadioGroup$1.displayName;
var RadioGroupItem = import_react.forwardRef(({ className, ...props }, ref) => {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RadioGroupItem$1, {
		ref,
		className: cn("aspect-square h-4 w-4 rounded-full border border-primary text-primary shadow cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className),
		...props,
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RadioGroupIndicator, {
			className: "flex items-center justify-center",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Circle, { className: "h-3.5 w-3.5 fill-primary" })
		})
	});
});
RadioGroupItem.displayName = RadioGroupItem$1.displayName;
function AuthPage() {
	const { mode, next, role: initialRole } = Route.useSearch();
	const nav = useNavigate();
	const [tab, setTab] = (0, import_react.useState)(mode ?? (initialRole ? "register" : "login"));
	const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
	const goPostAuth = () => {
		if (safeNext) window.location.replace(safeNext);
		else nav({
			to: "/home",
			replace: true
		});
	};
	(0, import_react.useEffect)(() => {
		let cancelled = false;
		supabase.auth.getSession().then(({ data }) => {
			if (!cancelled && data.session) goPostAuth();
		});
		const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
			if (session) goPostAuth();
		});
		return () => {
			cancelled = true;
			sub.subscription.unsubscribe();
		};
	}, [nav, safeNext]);
	const [loading, setLoading] = (0, import_react.useState)(false);
	const [showPassword, setShowPassword] = (0, import_react.useState)(false);
	const [resetEmail, setResetEmail] = (0, import_react.useState)("");
	const [resetLoading, setResetLoading] = (0, import_react.useState)(false);
	const [authDebug, setAuthDebug] = (0, import_react.useState)(null);
	const [email, setEmail] = (0, import_react.useState)("");
	const [password, setPassword] = (0, import_react.useState)("");
	const [role, setRole] = (0, import_react.useState)(initialRole ?? "customer");
	const [fullName, setFullName] = (0, import_react.useState)("");
	const [countryAlpha2, setCountryAlpha2] = (0, import_react.useState)("ZW");
	const [countryDialCode, setCountryDialCode] = (0, import_react.useState)("+263");
	const [localPhone, setLocalPhone] = (0, import_react.useState)("");
	const phone = `${countryDialCode}${localPhone.replace(/\D/g, "")}`;
	const [acceptedTerms, setAcceptedTerms] = (0, import_react.useState)(false);
	const supabaseUrl = "https://nyivrhdpxsrxyfmexxkn.supabase.co";
	const supabaseKeyPresent = Boolean("sb_publishable_nYF5lkTeBmkVH68LzSTvoQ_q-f9CuoX");
	const reportAuthError = (stage, err, endpoint, hint) => {
		const e = err;
		const info = {
			stage,
			message: e?.message ?? String(err ?? "Unknown error"),
			name: e?.name,
			status: e?.status,
			code: e?.code,
			endpoint,
			hint
		};
		setAuthDebug(info);
		console.error("[auth]", info, err);
		toast.error(`${stage} failed: ${info.message}`);
	};
	const login = async (e) => {
		e.preventDefault();
		setAuthDebug(null);
		setLoading(true);
		const endpoint = `${supabaseUrl}/auth/v1/token?grant_type=password`;
		try {
			const { error } = await supabase.auth.signInWithPassword({
				email,
				password
			});
			setLoading(false);
			if (error) return reportAuthError("Password sign-in", error, endpoint, !supabaseKeyPresent ? "VITE_SUPABASE_PUBLISHABLE_KEY is missing in this deploy." : void 0);
			goPostAuth();
		} catch (err) {
			setLoading(false);
			reportAuthError("Password sign-in (network)", err, endpoint, "The auth endpoint was unreachable. Check the Supabase URL, CORS, and that env vars are set on Vercel.");
		}
	};
	const sendPasswordReset = async () => {
		const target = (resetEmail || email).trim();
		if (!target) return toast.error("Enter your email first");
		setAuthDebug(null);
		setResetLoading(true);
		const endpoint = `${supabaseUrl}/auth/v1/recover`;
		try {
			const { error } = await supabase.auth.resetPasswordForEmail(target, { redirectTo: `${window.location.origin}/reset-password` });
			setResetLoading(false);
			if (error) return reportAuthError("Password reset", error, endpoint);
			toast.success("Password reset link sent. Check your email.");
		} catch (err) {
			setResetLoading(false);
			reportAuthError("Password reset (network)", err, endpoint);
		}
	};
	const register = async (e) => {
		e.preventDefault();
		if (!fullName.trim()) return toast.error("Please enter your full name");
		if (password.length < 8) return toast.error("Password must be at least 8 characters");
		if (!acceptedTerms) return toast.error("Please accept the Terms and Privacy Policy to continue");
		setAuthDebug(null);
		setLoading(true);
		const endpoint = `${supabaseUrl}/auth/v1/signup`;
		try {
			const { data, error } = await supabase.auth.signUp({
				email,
				password,
				options: {
					emailRedirectTo: `${window.location.origin}/oauth-callback`,
					data: {
						full_name: fullName,
						phone,
						role
					}
				}
			});
			if (error) {
				setLoading(false);
				return reportAuthError("Sign-up", error, endpoint);
			}
			if (!data.session) {
				const { error: signInError } = await supabase.auth.signInWithPassword({
					email,
					password
				});
				if (signInError) {
					setLoading(false);
					toast.success("Account created. Check your email to confirm, then log in.");
					setTab("login");
					return;
				}
			}
			try {
				const { data: sess } = await supabase.auth.getSession();
				const uid = sess.session?.user?.id;
				if (uid) await supabase.from("profiles").update({ terms_accepted_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", uid);
			} catch {}
			setLoading(false);
			toast.success("Welcome to Con Z!");
			goPostAuth();
		} catch (err) {
			setLoading(false);
			reportAuthError("Sign-up (network)", err, endpoint);
		}
	};
	const google = async () => {
		if (tab === "register" && !acceptedTerms) return toast.error("Please accept the Terms and Privacy Policy to continue");
		setAuthDebug(null);
		setLoading(true);
		const endpoint = `${supabaseUrl}/auth/v1/authorize?provider=google`;
		const isCancellation = (m) => /cancel/i.test(m) || /closed/i.test(m) || /popup/i.test(m) || /dismiss/i.test(m);
		try {
			if (safeNext) try {
				sessionStorage.setItem("conz.postAuthNext", safeNext);
			} catch {}
			const { data, error } = await supabase.auth.signInWithOAuth({
				provider: "google",
				options: { redirectTo: `${window.location.origin}/oauth-callback` }
			});
			if (error) {
				setLoading(false);
				if (isCancellation(error?.message ?? "")) {
					toast.message("Google sign-in cancelled");
					return;
				}
				return reportAuthError("Google sign-in", error, endpoint, "Check that Google provider is enabled and that this exact origin is in Supabase Auth Redirect URLs.");
			}
			if (data?.url) {
				window.location.href = data.url;
				return;
			}
			goPostAuth();
		} catch (err) {
			setLoading(false);
			if (isCancellation(err instanceof Error ? err.message : String(err))) {
				toast.message("Google sign-in cancelled");
				return;
			}
			reportAuthError("Google sign-in (network)", err, endpoint);
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "min-h-screen bg-background",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mx-auto max-w-screen-sm px-5 py-6",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
					to: "/",
					className: "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowLeft, { className: "w-4 h-4" }), " Back"]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mt-6 flex items-center gap-3",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
						src: "/conz-logo.png",
						alt: "CON Z",
						className: "w-10 h-10 rounded-lg object-cover",
						width: 40,
						height: 40
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
						className: "font-display font-bold text-2xl uppercase tracking-tight leading-none",
						children: "Con Z"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "text-xs text-muted-foreground uppercase tracking-widest",
						children: "Construction Made Easy"
					})] })]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Tabs, {
					value: tab,
					onValueChange: (v) => setTab(v),
					className: "mt-6",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(TabsList, {
							className: "grid grid-cols-2 w-full",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsTrigger, {
								value: "login",
								children: "Login"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsTrigger, {
								value: "register",
								children: "Register"
							})]
						}),
						authDebug && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs space-y-1",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex items-center justify-between gap-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "font-semibold text-destructive uppercase tracking-wide",
										children: [authDebug.stage, " error"]
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => setAuthDebug(null),
										className: "text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground",
										children: "Dismiss"
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-muted-foreground",
										children: "Message:"
									}),
									" ",
									authDebug.message
								] }),
								authDebug.name && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-muted-foreground",
										children: "Name:"
									}),
									" ",
									authDebug.name
								] }),
								authDebug.status !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-muted-foreground",
										children: "HTTP status:"
									}),
									" ",
									String(authDebug.status)
								] }),
								authDebug.code && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-muted-foreground",
										children: "Code:"
									}),
									" ",
									authDebug.code
								] }),
								authDebug.endpoint && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "break-all",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: "text-muted-foreground",
											children: "Endpoint:"
										}),
										" ",
										authDebug.endpoint
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "break-all",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
											className: "text-muted-foreground",
											children: "Supabase URL env:"
										}),
										" ",
										supabaseUrl
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "text-muted-foreground",
										children: "Publishable key present:"
									}),
									" ",
									supabaseKeyPresent ? "yes" : "NO — add VITE_SUPABASE_PUBLISHABLE_KEY on Vercel"
								] }),
								authDebug.hint && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "pt-1 text-muted-foreground",
									children: ["Hint: ", authDebug.hint]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "pt-1 text-[10px] text-muted-foreground",
									children: [
										"Full details also logged to the browser console under ",
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: "[auth]" }),
										"."
									]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(TabsContent, {
							value: "login",
							className: "space-y-4 mt-4",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
									onSubmit: login,
									className: "space-y-3",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
											htmlFor: "email",
											children: "Email"
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
											id: "email",
											type: "email",
											value: email,
											onChange: (e) => setEmail(e.target.value),
											required: true,
											autoComplete: "email"
										})] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
											htmlFor: "password",
											children: "Password"
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PasswordInput, {
											id: "password",
											value: password,
											onChange: setPassword,
											show: showPassword,
											onToggle: () => setShowPassword((v) => !v),
											autoComplete: "current-password"
										})] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
											type: "submit",
											disabled: loading,
											className: "w-full h-11 font-display uppercase tracking-wide",
											children: loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Login"
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "rounded-xl border bg-card p-3 space-y-2",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
										htmlFor: "resetEmail",
										children: "Reset password"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "grid grid-cols-[1fr_auto] gap-2",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
											id: "resetEmail",
											type: "email",
											value: resetEmail,
											onChange: (e) => setResetEmail(e.target.value),
											placeholder: "your@email.com",
											autoComplete: "email"
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
											type: "button",
											variant: "outline",
											onClick: sendPasswordReset,
											disabled: resetLoading,
											children: resetLoading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Send"
										})]
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Divider, {}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "button",
									variant: "outline",
									onClick: google,
									disabled: loading,
									className: "w-full h-11",
									children: "Continue with Google"
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(TabsContent, {
							value: "register",
							className: "space-y-4 mt-4",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
									onSubmit: register,
									className: "space-y-3",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, { children: "I am a…" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(RadioGroup, {
											value: role,
											onValueChange: (v) => setRole(v),
											className: "grid grid-cols-2 gap-2 mt-1",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RoleCard, {
												value: "customer",
												label: "Customer",
												hint: "I need deliveries",
												current: role
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RoleCard, {
												value: "driver",
												label: "Driver",
												hint: "I own a tipper",
												current: role
											})]
										})] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
											htmlFor: "fn",
											children: "Full name"
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
											id: "fn",
											value: fullName,
											onChange: (e) => setFullName(e.target.value),
											required: true,
											maxLength: 80
										})] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
												htmlFor: "localPhone",
												children: "Phone (optional)"
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
												className: "grid grid-cols-[140px_1fr] gap-2",
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CountryCodeSelect, {
													value: countryAlpha2,
													onChange: (c) => {
														setCountryAlpha2(c.code);
														setCountryDialCode(c.dial_code);
													}
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
													id: "localPhone",
													value: localPhone,
													onChange: (e) => setLocalPhone(e.target.value.replace(/\D/g, "")),
													type: "tel",
													maxLength: 15,
													placeholder: "771234567"
												})]
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
												className: "text-[11px] text-muted-foreground mt-1",
												children: ["Full number: ", phone || "—"]
											})
										] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
											htmlFor: "em",
											children: "Email"
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
											id: "em",
											type: "email",
											value: email,
											onChange: (e) => setEmail(e.target.value),
											required: true,
											autoComplete: "email"
										})] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
												htmlFor: "pw",
												children: "Password"
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PasswordInput, {
												id: "pw",
												value: password,
												onChange: setPassword,
												show: showPassword,
												onToggle: () => setShowPassword((v) => !v),
												autoComplete: "new-password",
												minLength: 8
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
												className: "text-[11px] text-muted-foreground mt-1",
												children: "Minimum 8 characters."
											})
										] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "flex items-start gap-2 text-xs text-muted-foreground select-none",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												type: "checkbox",
												checked: acceptedTerms,
												onChange: (e) => setAcceptedTerms(e.target.checked),
												className: "mt-0.5 h-4 w-4 accent-primary",
												required: true
											}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
												"I agree to the",
												" ",
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
													to: "/terms",
													target: "_blank",
													className: "underline text-foreground",
													children: "Terms and Conditions"
												}),
												" ",
												"and",
												" ",
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
													to: "/privacy",
													target: "_blank",
													className: "underline text-foreground",
													children: "Privacy Policy"
												}),
												"."
											] })]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
											type: "submit",
											disabled: loading || !acceptedTerms,
											className: "w-full h-11 font-display uppercase tracking-wide",
											children: loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-4 h-4 animate-spin" }) : "Create account"
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Divider, {}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
									type: "button",
									variant: "outline",
									onClick: google,
									disabled: loading,
									className: "w-full h-11",
									children: "Continue with Google"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "text-[11px] text-muted-foreground text-center",
									children: "Google sign-up creates a Customer account. Switch to a Driver account from your profile."
								})
							]
						})
					]
				})
			]
		})
	});
}
function RoleCard({ value, label, hint, current }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: `flex flex-col items-start gap-1 rounded-xl border p-3 cursor-pointer transition ${current === value ? "border-primary bg-accent" : "border-border hover:bg-muted/50"}`,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex items-center gap-2",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RadioGroupItem, {
				value,
				id: value
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "font-semibold",
				children: label
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-[11px] text-muted-foreground",
			children: hint
		})]
	});
}
function PasswordInput({ id, value, onChange, show, onToggle, autoComplete, minLength }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "relative",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
			id,
			type: show ? "text" : "password",
			value,
			onChange: (e) => onChange(e.target.value),
			required: true,
			minLength,
			autoComplete,
			className: "pr-10"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			onClick: onToggle,
			"aria-label": show ? "Hide password" : "Show password",
			className: "absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground",
			children: show ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(EyeOff, { className: "w-4 h-4" }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Eye, { className: "w-4 h-4" })
		})]
	});
}
function Divider() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "relative",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "absolute inset-0 flex items-center",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "w-full border-t" })
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "relative flex justify-center",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "bg-background px-2 text-[11px] uppercase tracking-widest text-muted-foreground",
				children: "or"
			})
		})]
	});
}
function CountryCodeSelect({ value, onChange }) {
	const [open, setOpen] = (0, import_react.useState)(false);
	const selected = COUNTRY_CODES.find((c) => c.code === value);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Popover, {
		open,
		onOpenChange: setOpen,
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PopoverTrigger, {
			asChild: true,
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
				variant: "outline",
				role: "combobox",
				"aria-expanded": open,
				className: "w-full justify-between px-2 font-normal",
				children: [selected ? `${selected.name} ${selected.dial_code}` : "Select code", /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronsUpDown, { className: "ml-1 h-4 w-4 shrink-0 opacity-50" })]
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PopoverContent, {
			className: "w-[260px] p-0",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Command$1, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CommandInput, { placeholder: "Search country..." }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CommandList, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CommandEmpty, { children: "No country found." }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CommandGroup, { children: COUNTRY_CODES.map((country) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(CommandItem, {
				value: `${country.name} ${country.dial_code}`,
				onSelect: () => {
					onChange(country);
					setOpen(false);
				},
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Check, { className: cn("mr-2 h-4 w-4", value === country.code ? "opacity-100" : "opacity-0") }),
					country.name,
					" ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "ml-auto text-muted-foreground",
						children: country.dial_code
					})
				]
			}, country.code)) })] })] })
		})]
	});
}
//#endregion
export { AuthPage as component };
