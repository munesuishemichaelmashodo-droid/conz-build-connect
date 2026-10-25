// Pure rules for the four-stage driver sign-up (become-driver.tsx). Kept free of
// React and Supabase so they can be unit-tested. None of this grants anything:
// approval is decided only by an admin (admin_set_driver_verification) and read
// back from driver_profiles.verification_status.

export const STAGES = [
  { key: "phone", title: "Your phone" },
  { key: "details", title: "Your details" },
  { key: "documents", title: "Truck & documents" },
  { key: "status", title: "Account status" },
] as const;

export type DocKey =
  | "selfie_url"
  | "national_id_url"
  | "license_url"
  | "tipper_photo_url"
  | "tipper_photo_side_url"
  | "tipper_photo_back_url"
  | "operator_license_url"
  | "certificate_of_fitness_url"
  | "git_insurance_url"
  | "zinara_url";

export const REQUIRED_DOCS: readonly DocKey[] = [
  "selfie_url",
  "national_id_url",
  "license_url",
  "tipper_photo_url",
  "tipper_photo_side_url",
  "tipper_photo_back_url",
];

export const OPTIONAL_DOCS: readonly DocKey[] = [
  "operator_license_url",
  "certificate_of_fitness_url",
  "git_insurance_url",
  "zinara_url",
];

export const DOC_LABELS: Record<DocKey, string> = {
  selfie_url: "Selfie",
  national_id_url: "National ID",
  license_url: "Driver's licence",
  tipper_photo_url: "Truck front (number plate)",
  tipper_photo_side_url: "Truck side",
  tipper_photo_back_url: "Truck back (tipper bin)",
  operator_license_url: "Operator's licence / route permit",
  certificate_of_fitness_url: "VID certificate of fitness",
  git_insurance_url: "Goods-in-transit insurance",
  zinara_url: "ZINARA registration",
};

// The driver-docs bucket allows 15 MB; the app asks for a little less so a
// rejected upload is explained before it is sent.
export const DOC_MAX_BYTES = 10 * 1024 * 1024;
export const DOC_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

/** Returns a user-facing reason the file cannot be uploaded, or null when it can. */
export function validateDocFile(file: { type: string; size: number }): string | null {
  if (!(DOC_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return "Use a JPG, PNG, WebP or HEIC photo, or a PDF.";
  }
  if (file.size <= 0) return "That file is empty.";
  if (file.size > DOC_MAX_BYTES) return "That file is over 10 MB. Choose a smaller one.";
  return null;
}

export type DocMap = Partial<Record<DocKey, string | null>>;

/** Required documents (and a registered truck) still missing, as readable labels. */
export function missingRequired(docs: DocMap, hasTruck: boolean): string[] {
  const missing = REQUIRED_DOCS.filter((k) => !docs[k]).map((k) => DOC_LABELS[k]);
  if (!hasTruck) missing.push("Truck registration and capacity");
  return missing;
}

export function detailsComplete(name: string, nationality: string): boolean {
  return name.trim().length > 1 && nationality.trim().length > 0;
}

/**
 * Builds an E.164 number from a dial code and what the user typed. Local numbers
 * are typed with a leading 0 (0771234567); that 0 is not part of the international
 * number. Returns null when the result cannot be a valid mobile number.
 */
export function normalisePhone(dialCode: string, local: string): string | null {
  const dial = dialCode.replace(/[^\d]/g, "");
  let digits = local.replace(/\D/g, "");
  if (!dial || !digits) return null;
  if (digits.startsWith(dial) && digits.length > dial.length + 6)
    digits = digits.slice(dial.length);
  digits = digits.replace(/^0+/, "");
  const total = dial.length + digits.length;
  if (digits.length < 6 || total > 15) return null;
  return `+${dial}${digits}`;
}

export type OtpErrorCode =
  "wrong_or_expired" | "expired" | "invalid" | "rate_limited" | "not_configured" | "unknown";

/**
 * Maps a Supabase Auth error message to something a driver can act on. The
 * "not_configured" case matters: when the project has no SMS provider, we must
 * say so instead of pretending a code was sent.
 */
export function mapOtpError(message: string | undefined | null): {
  code: OtpErrorCode;
  message: string;
} {
  const m = (message ?? "").toLowerCase();
  // Supabase Auth sends "Token has expired or is invalid" for a mistyped code too,
  // so this message can't say which it was.
  if (/expired/.test(m) && /invalid/.test(m)) {
    return {
      code: "wrong_or_expired",
      message: "That code is wrong or has expired. Check the SMS, or send a new code.",
    };
  }
  if (/expired/.test(m)) {
    return { code: "expired", message: "That code has expired. Request a new one." };
  }
  if (/rate limit|too many|over_sms_send_rate|security purposes|after \d+ seconds/.test(m)) {
    return { code: "rate_limited", message: "Too many attempts. Wait a minute, then try again." };
  }
  if (
    /provider|sms.*(disabled|not (enabled|configured|supported))|unsupported phone|phone.*(disabled|not enabled)/.test(
      m,
    )
  ) {
    return {
      code: "not_configured",
      message: "Phone verification is not switched on yet. Please contact Con Z support.",
    };
  }
  if (/invalid|incorrect|token|otp/.test(m)) {
    return { code: "invalid", message: "That code is not right. Check the SMS and try again." };
  }
  return {
    code: "unknown",
    message: "Could not verify your phone. Check your connection and try again.",
  };
}

export const OTP_LENGTH = 6;
export const RESEND_SECONDS = 60;

export function isOtpFormatValid(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);
}

export type StatusKind = "review" | "approved" | "rejected";

export interface StatusView {
  kind: StatusKind;
  title: string;
  body: string;
  /** Only an approved account may enter Driver Mode. */
  canEnterDriverMode: boolean;
}

/** What Stage 4 shows. The inputs come from the database, never from the client. */
export function statusView(
  status: "pending" | "verified" | "rejected" | null | undefined,
  notes?: string | null,
): StatusView {
  if (status === "verified") {
    return {
      kind: "approved",
      title: "Approved",
      body: "You are cleared to bid on jobs. Go online when you are ready.",
      canEnterDriverMode: true,
    };
  }
  if (status === "rejected") {
    const reason = notes?.trim();
    return {
      kind: "rejected",
      title: "Not approved",
      body: reason
        ? `Reason: ${reason}`
        : "Your documents were not accepted. Fix what is missing and submit again.",
      canEnterDriverMode: false,
    };
  }
  return {
    kind: "review",
    title: "Under review",
    body: "We have your documents. Reviews usually take about 24 hours. You can not bid until you are approved.",
    canEnterDriverMode: false,
  };
}

/**
 * A fresh profile row is 'pending' before anything is submitted, so "under
 * review" only applies once the required documents are all on file.
 */
export function hasSubmitted(
  status: "pending" | "verified" | "rejected" | null | undefined,
  docs: DocMap,
  hasTruck: boolean,
  nationality: string | null | undefined,
): boolean {
  if (status === "verified" || status === "rejected") return true;
  return missingRequired(docs, hasTruck).length === 0 && !!nationality?.trim();
}

/**
 * Driver home banner for an account that is not yet approved. The text follows
 * the real application state so a driver always knows the next step. Returns null
 * for an approved driver.
 */
export function verificationBanner(
  status: "pending" | "verified" | "rejected" | null | undefined,
  submitted: boolean,
): { title: string; body: string; action: string } | null {
  if (status === "verified") return null;
  if (status === "rejected") {
    return {
      title: "Your application needs changes",
      body: "See what to fix, upload it again and resubmit.",
      action: "See what to fix",
    };
  }
  if (submitted) {
    return {
      title: "Your application is under review",
      body: "You can bid as soon as Con Z approves your documents.",
      action: "Check status",
    };
  }
  return {
    title: "Finish your driver sign-up",
    body: "Verify your phone, add your truck and upload your documents to start bidding.",
    action: "Continue sign-up",
  };
}

/** "No ratings yet" instead of a 0.0 star when nobody has rated the driver. */
export function ratingLabel(
  avg: number | null | undefined,
  count: number | null | undefined,
): string {
  const n = Number(count ?? 0);
  if (!(n > 0)) return "No ratings yet";
  return `${Number(avg ?? 0).toFixed(1)} (${n})`;
}

export function jobsDoneLabel(n: number | null | undefined): string {
  const v = Math.max(0, Number(n ?? 0));
  return `${v} ${v === 1 ? "job" : "jobs"} done`;
}

// ---------------------------------------------------------------------------
// Phone without SMS (25/10/2026). ConZ has no free SMS sender, so the phone step
// saves the number to the driver's own profile and moves on. Nothing in the
// database depends on phone verification (checked 25/10: no function or policy
// reads auth phone confirmation), and a saved number is never shown as verified.
// ---------------------------------------------------------------------------

export type PhoneStatus = "sms_verified" | "unverified" | "missing";

const digitsOnly = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** A saved international number (as normalisePhone builds it) finishes the phone step. */
export function phoneStepComplete(profilePhone: string | null | undefined): boolean {
  const d = digitsOnly(profilePhone);
  return d.length >= 9 && d.length <= 15;
}

/**
 * Verified by SMS only when Supabase Auth confirmed this same number (Auth stores
 * it without the +). Anything else is unverified, never "verified".
 */
export function phoneStatus(input: {
  profilePhone: string | null | undefined;
  authPhone: string | null | undefined;
  authPhoneConfirmedAt: string | null | undefined;
}): PhoneStatus {
  const saved = digitsOnly(input.profilePhone);
  if (!saved) return "missing";
  const auth = digitsOnly(input.authPhone);
  if (auth && auth === saved && input.authPhoneConfirmedAt) return "sms_verified";
  return "unverified";
}

/** Which step to reopen: progress comes from the database, so a driver can leave and come back. */
export function firstUnfinishedStage(input: {
  submitted: boolean;
  phoneSaved: boolean;
  detailsDone: boolean;
}): number {
  if (input.submitted) return 3;
  if (!input.phoneSaved) return 0;
  if (!input.detailsDone) return 1;
  return 2;
}

export type ChecklistState = "done" | "waiting" | "todo" | "problem";

export interface ChecklistRow {
  key: "account" | "application" | "phone" | "identity" | "truck" | "approval";
  label: string;
  state: ChecklistState;
}

/**
 * The status screen's separate lines. Inputs come from the database. Identity and
 * truck are checked in the same admin review today (one verification status per
 * driver), so both lines follow that status; final approval also needs the driver
 * role, which only admin approval grants.
 */
export function applicationChecklist(input: {
  phone: PhoneStatus;
  submitted: boolean;
  status: "pending" | "verified" | "rejected" | null | undefined;
  isDriver: boolean;
}): ChecklistRow[] {
  const review: ChecklistState = !input.submitted
    ? "todo"
    : input.status === "verified"
      ? "done"
      : input.status === "rejected"
        ? "problem"
        : "waiting";
  const reviewWord =
    review === "done"
      ? "approved"
      : review === "problem"
        ? "not accepted"
        : review === "waiting"
          ? "in review"
          : "not sent";
  const approved = input.status === "verified" && input.isDriver;
  return [
    { key: "account", label: "Con Z account created", state: "done" },
    {
      key: "application",
      label: input.submitted ? "Application sent" : "Application not sent yet",
      state: input.submitted ? "done" : "todo",
    },
    {
      key: "phone",
      label:
        input.phone === "sms_verified"
          ? "Phone verified by SMS"
          : input.phone === "unverified"
            ? "Phone saved (not verified)"
            : "Phone number missing",
      state: input.phone === "sms_verified" ? "done" : "todo",
    },
    { key: "identity", label: `ID and licence: ${reviewWord}`, state: review },
    { key: "truck", label: `Truck: ${reviewWord}`, state: review },
    {
      key: "approval",
      label: approved
        ? "Approved to bid on jobs"
        : input.status === "rejected"
          ? "Not approved"
          : "Not approved yet",
      state: approved ? "done" : input.status === "rejected" ? "problem" : "waiting",
    },
  ];
}
