import { m as createFileRoute, p as lazyRouteComponent } from "../_libs/@tanstack/react-router+[...].mjs";
import { et as enumType, nt as objectType, rt as stringType } from "../_libs/@ai-sdk/gateway+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/auth-AULqSfFa.js
var $$splitComponentImporter = () => import("./auth-C7K1jw3t.mjs");
var searchSchema = objectType({
	mode: enumType(["login", "register"]).optional(),
	next: stringType().optional(),
	role: enumType(["customer", "driver"]).optional()
});
var Route = createFileRoute("/auth")({
	ssr: false,
	validateSearch: searchSchema,
	component: lazyRouteComponent($$splitComponentImporter, "component")
});
//#endregion
export { Route as t };
