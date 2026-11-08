// What a screen says while its main data is not there yet. "Loading…" forever is wrong when the phone has no signal
// (the request is paused until it returns) or the request failed: say which, and offer a retry.

export type LoadStateInput = { error: boolean; paused: boolean };

export function loadStateCopy(i: LoadStateInput): {
  kind: "paused" | "error" | "loading";
  title: string;
  detail: string | null;
} {
  if (i.paused)
    return {
      kind: "paused",
      title: "Waiting for signal…",
      detail: "This opens as soon as your phone is back online.",
    };
  if (i.error)
    return {
      kind: "error",
      title: "Couldn't load this",
      detail: "Check your signal, then try again.",
    };
  return { kind: "loading", title: "Loading…", detail: null };
}
