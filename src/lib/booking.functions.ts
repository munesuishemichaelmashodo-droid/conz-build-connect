import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MATERIALS = [
  "river_sand",
  "pit_sand",
  "quarry_dust",
  "crusher_run",
  "gravel",
  "stones",
  "top_soil",
  "filling_soil",
  "custom",
] as const;

const MAX_SERVICE_KM = 900;
const TOO_FAR_MESSAGE =
  "This delivery address is too far from our service area — please choose a closer address.";

const OfferInput = z
  .object({
    material: z.enum(MATERIALS),
    quantity: z.number().positive().max(50),
    distanceKm: z.number().min(0).optional(),
    address: z.string().max(200).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.distanceKm !== undefined && val.distanceKm > MAX_SERVICE_KM) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: TOO_FAR_MESSAGE, path: ["distanceKm"] });
    }
  });

function parseOfferInput(input: unknown) {
  const result = OfferInput.safeParse(input);
  if (!result.success) {
    const tooFar = result.error.issues.find((i) => i.message === TOO_FAR_MESSAGE);
    if (tooFar) throw new Error(TOO_FAR_MESSAGE);
    throw new Error(result.error.issues[0]?.message ?? "Invalid booking details");
  }
  return result.data;
}

export type OfferResult = {
  offer: number;
  min: number;
  max: number;
  step: number;
  label: string;
  unit: string;
  enforced: boolean;
  etaMinutes: number;
  distanceKm: number;
  explanation: string;
};

/**
 * Fast deterministic offer. No AI in the hot path — returns immediately from the price guide.
 */
export const computeOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseOfferInput)
  .handler(async ({ data, context }): Promise<OfferResult> => {
    const { supabase } = context;
    const distanceKm = data.distanceKm ?? 15;

    const { data: guide, error } = await supabase.rpc("compute_material_offer", {
      _material: data.material,
      _quantity: data.quantity,
      _distance_km: distanceKm,
    });
    if (error) throw new Error(error.message);
    const g = guide as {
      offer: number | null;
      min: number | null;
      max: number | null;
      step: number;
      label?: string;
      unit?: string;
      enforced: boolean;
    };

    const offer = Number(g.offer ?? 0);
    const min = Number(g.min ?? 0);
    const max = Number(g.max ?? 0);
    const etaMinutes = Math.max(10, Math.round((distanceKm / 40) * 60) + 20);
    const label = g.label ?? data.material.replace("_", " ");

    return {
      offer,
      min,
      max,
      step: Number(g.step ?? 5),
      label,
      unit: g.unit ?? "10-15 m³ load",
      enforced: Boolean(g.enforced),
      etaMinutes,
      distanceKm: Math.round(distanceKm),
      explanation: `Fair rate for ${label} — ${data.quantity} m³, ${Math.round(distanceKm)} km.`,
    };
  });

const ExplainInput = z.object({
  material: z.string().max(50),
  quantity: z.number().positive().max(50),
  // Clamp instead of hard-max so the AI blurb never becomes the source of a
  // raw Zod error surfaced to the customer.
  distanceKm: z.number().min(0).transform((v) => Math.min(v, MAX_SERVICE_KM)),
});

/**
 * Best-effort AI explanation. Called in the background after the offer is shown.
 */
export const explainOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ExplainInput.parse(input))
  .handler(async ({ data }): Promise<{ explanation: string }> => {
    const fallback = `Fair rate for ${data.material.replace("_", " ")} — ${data.quantity} m³, ${Math.round(data.distanceKm)} km.`;
    try {
      const key = process.env.LOVABLE_API_KEY;
      if (!key) return { explanation: fallback };
      const { generateText } = await import("ai");
      const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
      const gateway = createLovableAiGatewayProvider(key);
      const { text } = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        prompt:
          `Write ONE friendly sentence (max 18 words) explaining a fair transport offer to a construction customer in Zimbabwe. ` +
          `Do NOT mention any price number, ranges, minimums, maximums, formulas, or dollar figures. ` +
          `Only reference material, quantity, and distance qualitatively. ` +
          `Material: ${data.material}. Quantity: ${data.quantity} m³. Distance: ~${Math.round(data.distanceKm)} km. ` +
          `Return plain text, no quotes.`,
      });
      const clean = text?.trim().replace(/^["']|["']$/g, "");
      return { explanation: clean || fallback };
    } catch {
      return { explanation: fallback };
    }
  });
