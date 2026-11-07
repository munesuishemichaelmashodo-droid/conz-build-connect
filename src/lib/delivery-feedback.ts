// Optional post-delivery question (migration 0149). The database validates the answers and who may answer;
// this list only decides what the customer sees.

export type FeedbackAnswer =
  | "arrived_as_agreed"
  | "price_worked"
  | "delivery_quick"
  | "good_communication"
  | "could_compare_drivers"
  | "confident_choosing"
  | "properly_confirmed"
  | "easy_to_arrange"
  | "other";

export const FEEDBACK_QUESTION = "What mattered most about this delivery?";
export const FEEDBACK_COMMENT_MAX = 280;

export const FEEDBACK_OPTIONS: { value: FeedbackAnswer; label: string }[] = [
  { value: "arrived_as_agreed", label: "The driver arrived as agreed" },
  { value: "price_worked", label: "The price worked for me" },
  { value: "delivery_quick", label: "The delivery was quick" },
  { value: "good_communication", label: "Communication was good" },
  { value: "could_compare_drivers", label: "I could compare different drivers" },
  { value: "confident_choosing", label: "I felt confident choosing the driver" },
  { value: "properly_confirmed", label: "The delivery was properly confirmed" },
  { value: "easy_to_arrange", label: "It was easy to arrange" },
  { value: "other", label: "Other" },
];

export function isFeedbackAnswer(v: unknown): v is FeedbackAnswer {
  return FEEDBACK_OPTIONS.some((o) => o.value === v);
}

/** What to send: an answer is required, the comment is optional, trimmed and capped. */
export function feedbackPayload(
  answer: string | null,
  comment: string,
): { _answer: FeedbackAnswer; _comment: string | null } | null {
  if (!isFeedbackAnswer(answer)) return null;
  const c = comment.trim().slice(0, FEEDBACK_COMMENT_MAX);
  return { _answer: answer, _comment: c ? c : null };
}

/** The prompt shows only when no response (answer or dismissal) exists for this job yet. */
export function shouldAskFeedback(row: { answer: string | null; dismissed: boolean } | null | undefined): boolean {
  return !row;
}
