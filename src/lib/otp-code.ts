// The authenticator-code screen (/mfa): what counts as a code, where to go afterwards, and how to
// word what went wrong. The database still decides every crucial action (require_aal2); nothing here
// grants anything.

export const CODE_LENGTH = 6;

/** Keeps the digits from typed or pasted text ("123 456", "123-456", "Code: 123456"), at most six. */
export function normalizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

export function isCompleteCode(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
}

/**
 * Where to go after a code is accepted: a safe in-app path, never back to the code screen itself
 * (that would ask again at once), otherwise the admin home.
 */
export function codeScreenDestination(safePath: string | null): string {
  if (!safePath) return "/admin";
  const path = safePath.split(/[?#]/)[0];
  if (path === "/mfa" || path.startsWith("/mfa/")) return "/admin";
  return safePath;
}

export type CodeProblem = {
  message: string;
  /** clear the boxes so the next code can be typed straight away */
  clear: boolean;
  /** show a "Try again" button (the code itself was not judged) */
  retry: boolean;
};

type AuthLikeError =
  { message?: string; code?: string; status?: number; name?: string } | null | undefined;

/** Plain words for a failed challenge or verify call. */
export function describeCodeProblem(error: AuthLikeError): CodeProblem {
  const code = error?.code ?? "";
  const msg = (error?.message ?? "").toLowerCase();
  const status = error?.status;
  if (code === "mfa_factor_not_found") {
    return {
      message:
        "This authenticator is no longer linked to your account. Reload the page to set it up again.",
      clear: true,
      retry: false,
    };
  }
  if (
    code === "over_request_rate_limit" ||
    status === 429 ||
    msg.includes("rate limit") ||
    msg.includes("too many")
  ) {
    return {
      message: "Too many tries. Wait a minute, then enter the newest code from your app.",
      clear: true,
      retry: false,
    };
  }
  if (
    code === "mfa_verification_failed" ||
    msg.includes("invalid totp") ||
    msg.includes("invalid code") ||
    msg.includes("invalid")
  ) {
    return {
      message: "That code didn't match. Codes change every 30 seconds: enter the newest one.",
      clear: true,
      retry: false,
    };
  }
  if (code === "mfa_challenge_expired" || msg.includes("expired")) {
    return {
      message: "That took too long. Enter the newest code from your app.",
      clear: true,
      retry: false,
    };
  }
  if (status === undefined || status === 0 || msg.includes("fetch") || msg.includes("network")) {
    return {
      message: "No connection. Check your signal, then try again.",
      clear: false,
      retry: true,
    };
  }
  return {
    message: "Something went wrong checking the code. Try again.",
    clear: false,
    retry: true,
  };
}
