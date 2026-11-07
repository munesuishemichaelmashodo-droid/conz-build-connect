import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceChips } from "@/components/ds";
import { CzCard } from "@/components/redesign";
import {
  FEEDBACK_COMMENT_MAX,
  FEEDBACK_OPTIONS,
  FEEDBACK_QUESTION,
  feedbackPayload,
  shouldAskFeedback,
  type FeedbackAnswer,
} from "@/lib/delivery-feedback";

type Row = { answer: string | null; dismissed: boolean };

/**
 * One optional, dismissible question after a completed delivery (0149). It never blocks anything: a failed
 * save only shows a message, "Not now" is recorded so the prompt does not come back, and an answered or
 * dismissed job shows nothing here.
 */
export function DeliveryFeedbackCard({ jobId }: { jobId: string }) {
  const qc = useQueryClient();
  const [answer, setAnswer] = useState<FeedbackAnswer | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [thanked, setThanked] = useState(false);

  const { data: row, isLoading } = useQuery({
    queryKey: ["delivery-feedback", jobId],
    queryFn: async (): Promise<Row | null> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types predate 0149
      const { data } = await (supabase as any)
        .from("delivery_feedback")
        .select("answer,dismissed")
        .eq("job_id", jobId)
        .maybeSingle();
      return (data as Row | null) ?? null;
    },
  });

  if (thanked)
    return <p className="px-1 text-sm text-cz-muted">Thank you. That helps us improve ConZ.</p>;
  if (isLoading || !shouldAskFeedback(row)) return null;

  const refresh = () => qc.invalidateQueries({ queryKey: ["delivery-feedback", jobId] });

  const send = async () => {
    const payload = feedbackPayload(answer, comment);
    if (!payload) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types predate 0149
    const { error } = await (supabase as any).rpc("submit_delivery_feedback", {
      _job_id: jobId,
      ...payload,
    });
    setBusy(false);
    if (error) return toast.error("We couldn't save that just now. You can ignore this question.");
    setThanked(true);
    refresh();
  };

  const dismiss = async () => {
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types predate 0149
    await (supabase as any).rpc("dismiss_delivery_feedback", { _job_id: jobId });
    setBusy(false);
    refresh();
  };

  return (
    <CzCard className="space-y-3 p-[18px]" id="delivery-feedback">
      <div>
        <div className="text-[15px] font-semibold">{FEEDBACK_QUESTION}</div>
        <p className="text-[13px] text-cz-muted">
          Optional. It takes a few seconds and doesn't change your delivery.
        </p>
      </div>
      <ChoiceChips
        label={FEEDBACK_QUESTION}
        options={FEEDBACK_OPTIONS}
        value={answer}
        onChange={(v) => setAnswer(v as FeedbackAnswer)}
      />
      {answer && (
        <Textarea
          rows={2}
          maxLength={FEEDBACK_COMMENT_MAX}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a short note (optional)"
          aria-label="Short note (optional)"
        />
      )}
      <div className="flex items-center gap-2">
        <Button onClick={send} disabled={busy || !answer}>
          Send
        </Button>
        <Button variant="ghost" onClick={dismiss} disabled={busy}>
          Not now
        </Button>
      </div>
    </CzCard>
  );
}
