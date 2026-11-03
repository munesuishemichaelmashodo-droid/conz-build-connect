// One order for what a new user sees after signing in, so overlays never stack:
//   1. Terms gate (TermsGate) until terms_accepted_at is recorded,
//   2. the welcome walkthrough (OnboardingWalkthrough) until onboarding_completed_at,
//   3. then the app; the inline notifications card and the guided-tour offer only
//      appear after the walkthrough (which already asks for notifications).
// Inputs come from the user's own profile row.

export type FirstRunStage = "signed_out" | "loading" | "terms" | "walkthrough" | "done";

export function firstRunStage(input: {
  loading: boolean;
  userId: string | null;
  profile: { terms_accepted_at?: string | null; onboarding_completed_at?: string | null } | null;
}): FirstRunStage {
  if (!input.userId) return input.loading ? "loading" : "signed_out";
  if (input.loading || !input.profile) return "loading";
  if (!input.profile.terms_accepted_at) return "terms";
  if (!input.profile.onboarding_completed_at) return "walkthrough";
  return "done";
}
