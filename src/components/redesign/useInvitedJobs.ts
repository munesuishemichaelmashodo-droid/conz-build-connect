import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Jobs where a past customer invited this driver to offer. The signal is the driver's own
 * `repeat_customer` notification (written when a job is posted with a preferred driver), so
 * no extra data is exposed. An invitation gives no priority and no assignment.
 */
export function useInvitedJobIds(userId: string | null | undefined): Set<string> {
  const { data } = useQuery({
    queryKey: ["invited-job-ids", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("job_id")
        .eq("user_id", userId!)
        .eq("type", "repeat_customer")
        .not("job_id", "is", null)
        .limit(200);
      if (error) return [] as string[];
      return (data ?? []).map((r) => r.job_id as string);
    },
  });
  return new Set(data ?? []);
}

export const RETURNING_CUSTOMER_TEXT =
  "A customer you have delivered for before invited you to offer on this request. It is still open to other verified drivers, and the customer makes the final choice.";
