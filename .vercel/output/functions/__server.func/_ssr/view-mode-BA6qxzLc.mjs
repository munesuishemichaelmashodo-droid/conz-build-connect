import { o as __toESM } from "../_runtime.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { n as useAuth } from "./auth-CKNZvOvp.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/view-mode-BA6qxzLc.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var Ctx = (0, import_react.createContext)({
	theme: "light",
	setTheme: () => {},
	toggleTheme: () => {},
	activeRole: null,
	setActiveRole: () => {},
	availableRoles: []
});
var THEME_KEY = "conz.theme";
var ROLE_KEY = "conz.activeRole";
function ViewModeProvider({ children }) {
	const { is } = useAuth();
	const isCustomer = is("customer");
	const isDriver = is("driver");
	const availableRoles = [...isCustomer ? ["customer"] : [], ...isDriver ? ["driver"] : []];
	const [theme, setThemeState] = (0, import_react.useState)(() => {
		if (typeof window === "undefined") return "dark";
		return localStorage.getItem(THEME_KEY) ?? "dark";
	});
	const [activeRole, setActiveRoleState] = (0, import_react.useState)(() => {
		if (typeof window === "undefined") return null;
		return localStorage.getItem(ROLE_KEY) ?? null;
	});
	(0, import_react.useEffect)(() => {
		const root = document.documentElement;
		if (theme === "dark") root.classList.add("dark");
		else root.classList.remove("dark");
		localStorage.setItem(THEME_KEY, theme);
	}, [theme]);
	(0, import_react.useEffect)(() => {
		if (availableRoles.length === 0) return;
		if (!activeRole || !availableRoles.includes(activeRole)) setActiveRoleState(availableRoles[0]);
	}, [availableRoles.join(","), activeRole]);
	const setTheme = (t) => setThemeState(t);
	const toggleTheme = () => setThemeState((p) => p === "dark" ? "light" : "dark");
	const setActiveRole = (r) => {
		setActiveRoleState(r);
		localStorage.setItem(ROLE_KEY, r);
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ctx.Provider, {
		value: {
			theme,
			setTheme,
			toggleTheme,
			activeRole,
			setActiveRole,
			availableRoles
		},
		children
	});
}
var useViewMode = () => (0, import_react.useContext)(Ctx);
//#endregion
export { useViewMode as n, ViewModeProvider as t };
