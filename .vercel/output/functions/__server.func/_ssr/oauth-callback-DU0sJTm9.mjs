import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BKwn9D3n.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { v as useNavigate } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { K as LoaderCircle } from "../_libs/lucide-react.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/oauth-callback-DU0sJTm9.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function AuthCallbackPage() {
	const navigate = useNavigate();
	const [message, setMessage] = (0, import_react.useState)("Securing your session…");
	(0, import_react.useEffect)(() => {
		let cancelled = false;
		const readNext = () => {
			try {
				const stashed = sessionStorage.getItem("conz.postAuthNext");
				sessionStorage.removeItem("conz.postAuthNext");
				if (stashed && stashed.startsWith("/") && !stashed.startsWith("//")) return stashed;
			} catch {}
			return null;
		};
		const finish = async () => {
			for (let i = 0; i < 20; i += 1) {
				const { data } = await supabase.auth.getSession();
				if (cancelled) return;
				if (data.session) {
					const next = readNext();
					if (next) window.location.replace(next);
					else navigate({
						to: "/home",
						replace: true
					});
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
			if (!cancelled) setMessage("Session was not completed. Please try Google sign-in again.");
		};
		finish();
		return () => {
			cancelled = true;
		};
	}, [navigate]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "min-h-screen bg-background flex items-center justify-center px-5",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "text-center space-y-3",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, { className: "w-8 h-8 animate-spin text-primary mx-auto" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
					className: "font-display font-bold text-xl uppercase",
					children: "Con Z Login"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "text-sm text-muted-foreground",
					children: message
				})
			]
		})
	});
}
//#endregion
export { AuthCallbackPage as component };
