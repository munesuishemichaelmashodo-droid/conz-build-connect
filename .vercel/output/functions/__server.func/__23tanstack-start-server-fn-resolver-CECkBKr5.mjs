//#region node_modules/.nitro/vite/services/ssr/assets/__23tanstack-start-server-fn-resolver-CECkBKr5.js
var manifest = {
	"04f96c60f2e8c59fbbbaa44e49e4a8b28592812cb1ecec1bc4098abc6c6e138b": {
		functionName: "computeOffer_createServerFn_handler",
		importer: () => import("./_ssr/booking.functions-BZEKctNP.mjs")
	},
	"1c6c71434ab46b355c7a124c4cc97e4dcd02cd6678474c55ccb412a274e97972": {
		functionName: "getRoute_createServerFn_handler",
		importer: () => import("./_ssr/routing.functions-Bs_EOZgm.mjs")
	},
	"704032d9d206e39a9e276a7abab3cf5c63d8b503d35b8e04a817cd0789a6dc31": {
		functionName: "activateAccount_createServerFn_handler",
		importer: () => import("./_ssr/account.functions-Bwb3veEq.mjs")
	},
	"fdd4242533399c1b51ef088f84151dd36055762fa6349f018cd8a8ae3ba1d2ee": {
		functionName: "explainOffer_createServerFn_handler",
		importer: () => import("./_ssr/booking.functions-BZEKctNP.mjs")
	}
};
async function getServerFnById(id, access) {
	const serverFnInfo = manifest[id];
	if (!serverFnInfo) throw new Error("Server function info not found for " + id);
	const fnModule = serverFnInfo.module ?? await serverFnInfo.importer();
	if (!fnModule) throw new Error("Server function module not resolved for " + id);
	const action = fnModule[serverFnInfo.functionName];
	if (!action) throw new Error("Server function module export not resolved for serverFn ID: " + id);
	return action;
}
//#endregion
export { getServerFnById as t };
