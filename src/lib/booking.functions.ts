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

const OfferInput = z.object({
  material: z.enum(MATERIALS),
  quantity: z.number().positive().max(50),
  distanceKm: z.number().min(0).max(500).optional(),
  address: z.string().max(200).optional(),
});

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
 * Hybrid pricing: deterministic offer from admin price guide + short AI explanation.
 * The LLM never decides the price — it only writes a one-line rationale.
 */
export const computeOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OfferInput.parse(input))
  .handler(async ({ data, context }): Promise<OfferResult> => {
    const { supabase } = context;
    const distanceKm = data.distanceKm ?? 15;

    // Deterministic price from the admin-configured price guide.
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

    // AI explanation (best effort — never blocks the offer).
    let explanation =
      `Fair rate for ${g.label ?? data.material.replace("_", " ")} — ${data.quantity} m³, ${Math.round(
        distanceKm,
      )} km.`;
    try {
      const key = process.env.LOVABLE_API_KEY;
      if (key && g.enforced) {
        const { generateText } = await import("ai");
        const { createLovableAiGatewayProvider } = await import("./ai-gateway.server");
        const gateway = createLovableAiGatewayProvider(key);
        const { text } = await generateText({
          model: gateway("google/gemini-3-flash-preview"),
          prompt:
            `Write ONE friendly sentence (max 18 words) explaining a fair transport offer to a construction customer in Zimbabwe. ` +
            `Do NOT mention the price number, ranges, minimums, maximums, formulas, or any dollar figures. ` +
            `Only reference the material, quantity, and distance factors qualitatively. ` +
            `Material: ${g.label ?? data.material}. Quantity: ${data.quantity} m³. Distance: ~${Math.round(distanceKm)} km. ` +
            `Return plain text, no quotes.`,
        });
        if (text?.trim()) explanation = text.trim().replace(/^["']|["']$/g, "");
      }
    } catch {
      /* fall back to default explanation */
    }

    return {
      offer,
      min,
      max,
      step: Number(g.step ?? 5),
      label: g.label ?? data.material,
      unit: g.unit ?? "10-15 m³ load",
      enforced: Boolean(g.enforced),
      etaMinutes,
      distanceKm: Math.round(distanceKm),
      explanation,
    };
  });
