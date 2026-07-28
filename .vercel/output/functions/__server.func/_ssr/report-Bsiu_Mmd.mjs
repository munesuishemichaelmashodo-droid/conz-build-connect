import { m as createFileRoute, p as lazyRouteComponent } from "../_libs/@tanstack/react-router+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/report-Bsiu_Mmd.js
var $$splitComponentImporter = () => import("./report-XQP2wKSf.mjs");
var Route = createFileRoute("/_authenticated/report")({
	component: lazyRouteComponent($$splitComponentImporter, "component"),
	validateSearch: (s) => ({ jobId: typeof s.jobId === "string" ? s.jobId : void 0 })
});
//#endregion
export { Route as t };
