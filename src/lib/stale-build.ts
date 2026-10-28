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

/** Reloads unless we already did so in the last minute. Returns whether it reloaded. */
export function reloadOnceForNewBuild(
  store: Store | null,
  reload: () => void,
  now: number = Date.now(),
): boolean {
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

function sessionStore(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function recoverFromStaleBuild(error: unknown): boolean {
  if (typeof window === "undefined" || !isStaleBuildError(error)) return false;
  return reloadOnceForNewBuild(sessionStore(), () => window.location.reload());
}

let installed = false;
/** Vite fires `vite:preloadError` when a page file fails to load. */
export function installStaleBuildRecovery(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("vite:preloadError", (event) => {
    const reloaded = reloadOnceForNewBuild(sessionStore(), () => window.location.reload());
    if (reloaded) event.preventDefault();
  });
}
