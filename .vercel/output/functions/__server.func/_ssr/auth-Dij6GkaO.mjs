import { o as __toESM } from "../_runtime.mjs";
import { t as supabase } from "./client-BEr3FmPh.mjs";
import { u as require_react } from "../_libs/@floating-ui/react-dom+[...].mjs";
import { k as isRedirect, y as useRouter } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as require_jsx_runtime } from "../_libs/@radix-ui/react-arrow+[...].mjs";
import { l as createServerFn } from "./esm-Dova13aH.mjs";
import { t as requireSupabaseAuth } from "./auth-middleware-QNf_D_o9.mjs";
import { t as createSsrRpc } from "./createSsrRpc-Ch-KnEPU.mjs";
import { r as useQueryClient } from "../_libs/tanstack__react-query.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/auth-Dij6GkaO.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function useServerFn(serverFn) {
	const router = useRouter();
	return import_react.useCallback(async (...args) => {
		try {
			const res = await serverFn(...args);
			if (isRedirect(res)) throw res;
			return res;
		} catch (err) {
			if (isRedirect(err)) {
				err.options._fromLocation = router.stores.location.get();
				return router.navigate(router.resolveRedirect(err).options);
			}
			throw err;
		}
	}, [router, serverFn]);
}
var activateAccount = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(createSsrRpc("704032d9d206e39a9e276a7abab3cf5c63d8b503d35b8e04a817cd0789a6dc31"));
var Ctx = (0, import_react.createContext)({
	loading: true,
	userId: null,
	email: null,
	profile: null,
	roles: [],
	is: () => false,
	refresh: async () => {}
});
function AuthProvider({ children }) {
	const [loading, setLoading] = (0, import_react.useState)(true);
	const [userId, setUserId] = (0, import_react.useState)(null);
	const [email, setEmail] = (0, import_react.useState)(null);
	const [profile, setProfile] = (0, import_react.useState)(null);
	const [roles, setRoles] = (0, import_react.useState)([]);
	const activate = useServerFn(activateAccount);
	const qc = useQueryClient();
	const load = async (uid, repair = false) => {
		if (!uid) {
			setProfile(null);
			setRoles([]);
			return;
		}
		if (repair) try {
			await activate();
		} catch (error) {
			console.error("Account activation failed", error);
		}
		const [{ data: p }, { data: r }] = await Promise.all([supabase.from("profiles").select("*").eq("id", uid).maybeSingle(), supabase.from("user_roles").select("role").eq("user_id", uid)]);
		setProfile(p ?? null);
		setRoles((r ?? []).map((x) => x.role));
	};
	(0, import_react.useEffect)(() => {
		const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
			const uid = session?.user?.id ?? null;
			setUserId(uid);
			setEmail(session?.user?.email ?? null);
			setTimeout(() => {
				load(uid, event === "SIGNED_IN" || event === "USER_UPDATED");
			}, 0);
			if (event === "SIGNED_OUT") qc.clear();
			else if (event === "SIGNED_IN" || event === "USER_UPDATED") qc.invalidateQueries();
		});
		supabase.auth.getSession().then(({ data }) => {
			const uid = data.session?.user?.id ?? null;
			setUserId(uid);
			setEmail(data.session?.user?.email ?? null);
			load(uid, !!uid).finally(() => setLoading(false));
		});
		return () => sub.subscription.unsubscribe();
	}, []);
	const value = {
		loading,
		userId,
		email,
		profile,
		roles,
		is: (r) => roles.includes(r),
		refresh: () => load(userId)
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ctx.Provider, {
		value,
		children
	});
}
var useAuth = () => (0, import_react.useContext)(Ctx);
//#endregion
export { useAuth as n, useServerFn as r, AuthProvider as t };
