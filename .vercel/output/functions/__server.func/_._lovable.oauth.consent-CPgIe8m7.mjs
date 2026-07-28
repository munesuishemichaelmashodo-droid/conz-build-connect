import { t as supabase } from "./_ssr/client-BKwn9D3n.mjs";
import { M as redirect, m as createFileRoute, p as lazyRouteComponent } from "./_libs/@tanstack/react-router+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/_._lovable.oauth.consent-CPgIe8m7.js
function oauth() {
	return supabase.auth.oauth;
}
var $$splitErrorComponentImporter = () => import("./_._lovable.oauth.consent-BsFTbRTQ.mjs");
var $$splitComponentImporter = () => import("./_._lovable.oauth.consent-B6jorWD_.mjs");
var Route = createFileRoute("/.lovable/oauth/consent")({
	ssr: false,
	validateSearch: (s) => ({ authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "" }),
	beforeLoad: async ({ search, location }) => {
		if (!search.authorization_id) throw new Error("Missing authorization_id");
		const { data } = await supabase.auth.getSession();
		if (!data.session) throw redirect({
			to: "/auth",
			search: { next: location.pathname + location.searchStr }
		});
	},
	loader: async ({ location }) => {
		const authorizationId = new URLSearchParams(location.search).get("authorization_id");
		const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
		if (error) throw error;
		const immediate = data?.redirect_url ?? data?.redirect_to;
		if (immediate && !data?.client) throw redirect({ href: immediate });
		return data;
	},
	component: lazyRouteComponent($$splitComponentImporter, "component"),
	errorComponent: lazyRouteComponent($$splitErrorComponentImporter, "errorComponent")
});
//#endregion
export { oauth as n, Route as t };
