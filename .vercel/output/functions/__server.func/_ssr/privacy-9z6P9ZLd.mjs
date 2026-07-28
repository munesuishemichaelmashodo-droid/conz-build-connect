import { g as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { wt as ArrowLeft } from "../_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/privacy-9z6P9ZLd.js
var import_jsx_runtime = require_jsx_runtime();
function PrivacyPage() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "min-h-screen bg-background",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mx-auto max-w-3xl px-5 py-8",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Link, {
					to: "/",
					className: "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowLeft, { className: "w-4 h-4" }), " Back"]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
					className: "mt-6 mb-8",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "text-xs text-muted-foreground uppercase tracking-widest",
							children: "Con Z Connect"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
							className: "font-display font-bold text-3xl uppercase tracking-tight",
							children: "Privacy Policy"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs text-muted-foreground mt-2",
							children: "Last updated: 23 July 2026"
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "space-y-6",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
							title: "1. Who We Are",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Con Z Connect (\"Con Z\", \"we\") is a Zimbabwean company [Company Registration Number] that operates the Con Z construction logistics marketplace. This policy explains what personal data we collect through the app, how we use it, and how we protect it." })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
							title: "2. Information We Collect",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
								className: "list-disc pl-5 space-y-2",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Account information" }), " — your full name, email address, phone number, and account role (customer, driver, admin) stored in your user profile."] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Driver verification documents" }),
										" — a selfie, a photo of your driver's licence, a photo of your tipper truck, and your declared nationality. These are stored in the private ",
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: "driver-docs" }),
										" storage bucket."
									] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Location and GPS data" }),
										" — while you have an active job, your device shares live location to power route tracking and ETA. Locations are stored in the",
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: " driver_locations" }),
										" table and automatically pruned after 24 hours. You can stop sharing at any time using the in-app privacy toggle."
									] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Job and delivery data" }), " — pickup and drop-off addresses, cargo type and quantity, bids, prices, proof-of-delivery photos, ratings, messages between the customer and driver, and dispute records."] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Wallet and payment data" }),
										" — wallet balances, top-up requests, withdrawal requests, transaction history, and a hashed withdrawal PIN. We do ",
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "not" }),
										" store raw card numbers on our servers."
									] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Device and log data" }), " — basic technical logs (e.g. authentication events, error reports) used to keep the service secure and reliable."] })
								]
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
							title: "3. How We Use Your Information",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
								className: "list-disc pl-5 space-y-1",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "To create and manage your account, and to verify drivers." }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "To match customers with nearby verified drivers and to display live tracking and ETA." }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "To calculate suggested pricing, commission, and wallet balances." }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "To operate in-app messaging, notifications, ratings, and disputes." }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "To detect fraud, abuse, and safety issues, and to enforce our Terms." }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "To comply with applicable Zimbabwean law." })
								]
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Section, {
							title: "4. Sharing",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
								className: "list-disc pl-5 space-y-1",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Between customers and drivers" }), " — once a bid is accepted, limited profile information, live location, and messages are shared between the two parties for that job."] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Con Z administrators" }), " — may access verification documents, disputes, and audit logs strictly to run the platform."] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Service providers" }), " — we use trusted infrastructure providers to host the database, storage, and mapping. They act on our instructions and are bound by confidentiality."] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "Legal" }), " — we may disclose data where required by law or lawful authority."] })
								]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "pt-2",
								children: "We do not sell your personal data."
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
							title: "5. Retention",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "We retain profile, job, wallet and dispute records for as long as your account is active and for a reasonable period afterward to meet legal, accounting, and dispute obligations. Live location records are automatically deleted after 24 hours." })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
							title: "6. Security",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Access to your data is protected by row-level security policies in our database, private storage buckets for verification documents, and hashed credentials for sensitive fields such as the withdrawal PIN. No system is perfectly secure — please keep your login credentials and PIN confidential." })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
							title: "7. Your Choices",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
								className: "list-disc pl-5 space-y-1",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Update your profile details at any time from the Profile page." }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Toggle live location sharing on or off from the Location Privacy panel." }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Request account deletion by contacting us — some records may be retained where required." })
								]
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
							title: "8. Children",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "The Platform is not intended for anyone under 18. We do not knowingly collect data from children." })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
							title: "9. Changes",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "We may update this Privacy Policy from time to time. Material changes will be brought to your attention through the Platform." })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Section, {
							title: "10. Contact",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
								"For privacy questions or requests, contact us at ",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "[contact email]" }),
								" or",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: " [company postal address]" }),
								", Zimbabwe."
							] })
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "pt-6 text-xs text-muted-foreground",
							children: [
								"See also our ",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
									to: "/terms",
									className: "underline",
									children: "Terms and Conditions"
								}),
								"."
							]
						})
					]
				})
			]
		})
	});
}
function Section({ title, children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "space-y-2",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
			className: "font-display font-bold uppercase tracking-wide text-base",
			children: title
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: "text-sm text-muted-foreground leading-relaxed",
			children
		})]
	});
}
//#endregion
export { PrivacyPage as component };
