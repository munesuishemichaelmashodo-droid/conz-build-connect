import { n as createClient } from "./dist-DcqqEwZQ.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/client-BEr3FmPh.js
function createSupabaseClient() {
	return createClient("https://nyivrhdpxsrxyfmexxkn.supabase.co", "sb_publishable_nYF5lkTeBmkVH68LzSTvoQ_q-f9CuoX", { auth: {
		storage: typeof window !== "undefined" ? localStorage : void 0,
		persistSession: true,
		autoRefreshToken: true
	} });
}
var _supabase;
var supabase = new Proxy({}, { get(_, prop, receiver) {
	if (!_supabase) _supabase = createSupabaseClient();
	return Reflect.get(_supabase, prop, receiver);
} });
//#endregion
export { supabase as t };
