// After a new release, a tab still running the old version asks for page files the server
// no longer has, so opening another page fails ("Failed to fetch dynamically imported module")
// and buttons seem dead. A fresh load picks up the new version, so we reload once, with a guard
// so a real outage can't cause a reload loop.

const KEY = "conz:stale-build-reload-at";
const MIN_GAP_MS = 60_000;

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError/i;

export function isStaleBuildError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : "";
  return CHUNK_ERROR.test(message);
}

type Store = Pick<Storage, "getItem" | "setItem">;

/**
 * `navigator.onLine === false` is reliable ("definitely no connection"); `true` is not (it can be true with no
 * real internet), so only the false case is used to hold back a reload.
 */
export function isDefinitelyOffline(
  nav: { onLine?: boolean } | undefined = typeof navigator === "undefined" ? undefined : navigator,
): boolean {
  return nav?.onLine === false;
}

/**
 * Reloads unless we already did so in the last minute, or the phone is definitely offline (a page file that fails
 * to load with no signal is not a new release, and a reload would end on the browser's error page and lose
 * whatever the driver had open). Returns whether it reloaded.
 */
export function reloadOnceForNewBuild(
  store: Store | null,
  reload: () => void,
  now: number = Date.now(),
  offline: boolean = false,
): boolean {
  if (offline) return false;
  try {
    const last = Number(store?.getItem(KEY) ?? 0);
    if (Number.isFinite(last) && now - last < MIN_GAP_MS) return false;
    store?.setItem(KEY, String(now));
  } catch {
    // Storage blocked (private mode): still reload once; the browser's own reload is the fallback.
  }
  reload();
  return true;
}

const ROUTER_RELOAD_PREFIX = "tanstack_router_reload:";

/**
 * TanStack Router reloads the page, once per message, when a screen's code fails to load, and remembers that in
 * sessionStorage. With no signal that reload ends on the browser's error page and loses whatever was open, so while
 * the phone is definitely offline we answer "already reloaded": the failure then reaches the error screen, which
 * says "No signal" and tries again by itself when it returns.
 */
export function shouldTreatRouterReloadAsDone(key: unknown, offline: boolean): boolean {
  return offline && typeof key === "string" && key.startsWith(ROUTER_RELOAD_PREFIX);
}

let routerGuardInstalled = false;
function installOfflineRouterReloadGuard(): void {
  if (routerGuardInstalled || typeof window === "undefined" || typeof Storage === "undefined")
    return;
  routerGuardInstalled = true;
  const original = Storage.prototype.getItem;
  Storage.prototype.getItem = function (this: Storage, key: string) {
    if (shouldTreatRouterReloadAsDone(key, isDefinitelyOffline())) return "1";
    return original.call(this, key);
  };
}

function sessionStore(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function recoverFromStaleBuild(error: unknown): boolean {
  if (typeof window === "undefined" || !isStaleBuildError(error)) return false;
  return reloadOnceForNewBuild(
    sessionStore(),
    () => window.location.reload(),
    Date.now(),
    isDefinitelyOffline(),
  );
}

let installed = false;
/** Vite fires `vite:preloadError` when a page file fails to load. */
export function installStaleBuildRecovery(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  installOfflineRouterReloadGuard();
  window.addEventListener("vite:preloadError", (event) => {
    const reloaded = reloadOnceForNewBuild(
      sessionStore(),
      () => window.location.reload(),
      Date.now(),
      isDefinitelyOffline(),
    );
    if (reloaded) event.preventDefault();
  });
}
