import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveMaterialSource } from "@/lib/materialSource.functions";
import {
  classifyResolution,
  createSourcingFallback,
  type AwaitingSourcingResult,
} from "@/lib/sourcingFallback";
import {
  parseSourcingRequestInput,
  SOURCING_SWITCH_KEY,
  sourcingRequestsEnabledFrom,
  SUPPLIER_COVERS_MESSAGE,
} from "@/lib/sourcing-request";

async function switchIsOn(): Promise<boolean> {
  // system_settings rows other than the public pricing keys aren't readable by customers (RLS),
  // so read the switch server-side. Any failure reads as off.
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("system_settings")
      .select("value")
      .eq("key", SOURCING_SWITCH_KEY)
      .maybeSingle();
    if (error) return false;
    return sourcingRequestsEnabledFrom(data?.value);
  } catch {
    return false;
  }
}

/** Whether the "ask Con Z for a confirmed quote" option is shown. Off by default. */
export const getSourcingRequestsEnabled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ enabled: boolean }> => ({ enabled: await switchIsOn() }));

/**
 * Records a quotation request for an order no listed supplier covers. The database checks the
 * account (customers only), the details, duplicates and the open-request limit; this checks the
 * switch and that no listed supplier already covers the point.
 */
export const requestSourcingQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseSourcingRequestInput)
  .handler(async ({ data, context }): Promise<AwaitingSourcingResult> => {
    if (!(await switchIsOn())) {
      throw new Error(
        "Quotation requests aren't available yet. Post the open request and drivers will send prices.",
      );
    }
    const resolution = await resolveMaterialSource(
      context.supabase,
      data.material,
      data.quantity,
      data.deliveryLat,
      data.deliveryLng,
    );
    const outcome = classifyResolution(resolution);
    if (outcome.kind === "resolved") throw new Error(SUPPLIER_COVERS_MESSAGE);
    if (outcome.kind === "failure") {
      throw new Error(
        "We couldn't check suppliers for this point right now. Please try again in a moment.",
      );
    }
    return createSourcingFallback(
      context.supabase as unknown as Parameters<typeof createSourcingFallback>[0],
      data,
      outcome.reason,
    );
  });
