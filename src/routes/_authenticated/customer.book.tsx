import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { AddressPicker } from "@/components/AddressPicker";
import { SpotlightCallout } from "@/components/SpotlightCallout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  ChevronDown,
  Loader2,
  Minus,
  Plus,
  CheckCircle2,
  Calendar as CalendarIcon,
  ShieldCheck,
  HandCoins,
} from "lucide-react";
import { MATERIALS, type MaterialCategory, money } from "@/lib/domain";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { computeOffer, explainOffer, type OfferResult } from "@/lib/booking.functions";
import { motion } from "framer-motion";
import {
  CzScreen,
  CzHeader,
  CzCard,
  CzButton,
  HintBox,
  IconButton,
  MaterialChips,
  MoneyRow,
  areaOf,
  usd,
  usd2,
} from "@/components/redesign";
import { useNearbyTrucks } from "@/components/redesign/rpc";
import { cn } from "@/lib/utils";
import { z } from "zod";

const bookSearchSchema = z.object({
  material: z.string().optional(),
  quantity: z.coerce.number().optional(),
  address: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  driverId: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/customer/book")({
  component: BookDelivery,
  validateSearch: bookSearchSchema,
});

const BOOKABLE_MATERIALS = MATERIALS.filter((m) => m.value !== "custom");
// Under 1m3, the pricing engine switches to a minimum-trip-charge model
// (see compute_material_offer, mode "small_load") instead of rounding up
// to a full truck-load bucket price.
const MIN_QUANTITY_M3 = 0.25;

// Average tipper truck fuel consumption, litres per 100 km.
const FUEL_LITRES_PER_100KM = 32;

// Default supplier pickup point, Harare CBD.
// Later this can become a real supplier pickup location.
const PICKUP_POINT = { lat: -17.8292, lng: 31.0522 };
const PICKUP_ADDRESS = "Harare CBD supplier pickup point";


function BookDelivery() {
  const { userId, is } = useAuth();
  const nav = useNavigate();
  const search = Route.useSearch();

  const runOffer = useServerFn(computeOffer);
  const runExplain = useServerFn(explainOffer);

  const [step, setStep] = useState<number>(0);
  const [address, setAddress] = useState(search.address ?? "");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    search.lat != null && search.lng != null ? { lat: search.lat, lng: search.lng } : null,
  );
  const [material, setMaterial] = useState<MaterialCategory>(
    BOOKABLE_MATERIALS.some((m) => m.value === search.material) ? (search.material as MaterialCategory) : "river_sand",
  );
  const [quantity, setQuantity] = useState<number>(search.quantity ?? 12);
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [computing, setComputing] = useState(false);
  const [offerData, setOfferData] = useState<OfferResult | null>(null);
  const [offer, setOffer] = useState<number>(0);
  const [posting, setPosting] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"direct" | "escrow">("direct");
  const [roadDistanceKm, setRoadDistanceKm] = useState<number | null>(null);
  // Redesign: the date/notes drawer grows the sheet, so the map controls move up.
  const [sheetOpenExtra, setSheetOpenExtra] = useState(false);

  const { data: materialPickups } = useQuery({
    queryKey: ["material-pickups"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await (supabase.rpc as unknown as (f: string) => Promise<{ data: unknown }>)("public_material_pickups");
      return (data ?? {}) as Record<string, { lat: number | null; lng: number | null; label: string | null }>;
    },
  });

  // Distance/price used to always be measured from one hardcoded Harare
  // point regardless of material — but different materials genuinely come
  // from different real pickup sites. Use the material-specific one where
  // an admin has set it, falling back to the Harare default otherwise.
  const pickupPoint = useMemo(() => {
    const p = materialPickups?.[material];
    if (p?.lat != null && p?.lng != null) return { lat: p.lat, lng: p.lng };
    return PICKUP_POINT;
  }, [materialPickups, material]);
  const pickupLabel = materialPickups?.[material]?.label ?? null;

  useEffect(() => {
    if (!coords) {
      setRoadDistanceKm(null);
      return;
    }
     const dest = coords;
    
    
     let cancelled = false;
    async function loadRoute() {
      try {
        const { getRoute } = await import("@/lib/routing.functions");

        const r = await getRoute({
          data: {
            startLat: pickupPoint.lat,
            startLng: pickupPoint.lng,
            destLat: dest.lat,
            destLng: dest.lng,
          },
        });

        if (!cancelled && typeof r.distanceKm === "number") {
          setRoadDistanceKm(r.distanceKm);
        }
      } catch {
        // Fall back to haversine.
      }
    }

    loadRoute();

    return () => {
      cancelled = true;
    };
  }, [coords, pickupPoint.lat, pickupPoint.lng]);

  const { data: matPrice } = useQuery({
    queryKey: ["material-price", material],
    queryFn: async () => {
      const { data } = await supabase
        .from("material_prices")
        .select("min_price,max_price,label")
        .eq("material", material)
        .maybeSingle();

      return data;
    },
  });

  const { data: dieselPrice } = useQuery({
    queryKey: ["diesel-price"],
    queryFn: async () => {
      const { data } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "diesel_price_per_liter")
        .maybeSingle();

      return Number(data?.value ?? 1.87);
    },
  });

  const { data: commissionRate } = useQuery({
    queryKey: ["commission-rate"],
    queryFn: async () => {
      const { data } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "commission_rate")
        .maybeSingle();

      return Number(data?.value ?? 7);
    },
  });

  const suggestion = useMemo(() => {
    if (!matPrice || !coords) return null;

    const distanceKm = roadDistanceKm ?? haversineKm(pickupPoint, coords);
    // matPrice.min_price/max_price are now true per-m³ rates (matches how
    // Zimbabwe tipper operators actually quote — "$18/cubic" — rather
    // than a fixed price for a nominal load band).
    const midPerM3 = (Number(matPrice.min_price) + Number(matPrice.max_price)) / 2;
    const materialCost = midPerM3 * Math.max(quantity, 1);
    // Zone-banded transport cost, matching how operators actually price
    // a trip (a flat local rate, not a raw distance × fuel calculation)
    // — past 50km, where no standard band exists, the marginal rate
    // comes from the real diesel price (32L/100km × diesel price ×
    // 1.5x markup for driver time/wear), matching the server formula.
    const longHaulRate = (FUEL_LITRES_PER_100KM / 100) * Number(dieselPrice ?? 1.87) * 1.5;
    const zoneBandCost =
      distanceKm <= 10 ? 20 :
      distanceKm <= 20 ? 30 :
      distanceKm <= 30 ? 40 :
      distanceKm <= 50 ? 60 :
      60 + (distanceKm - 50) * longHaulRate;
    // Above 20 m³ the reference truck (10 m³) needs multiple trips —
    // mirrors compute_material_offer's Mode C: trip_count = ceil(qty / 10),
    // transport = zone-band cost × trip_count. This preview is not the
    // authoritative price (that's always computeOffer/compute_material_offer),
    // but it must not understate it either.
    const tripCount = quantity > 20 ? Math.ceil(quantity / 10) : 1;
    const fuelCost = zoneBandCost * tripCount;
    const commission = (materialCost + fuelCost) * (Number(commissionRate ?? 7) / 100);
    const total = materialCost + fuelCost + commission;
    // Floor only — deliberately no ceiling at matPrice.max_price. That
    // clamp used to silently discount every long-distance or large-load
    // job back down to the same price as a small nearby one, which is
    // exactly backwards: those are the jobs where real fuel/material
    // cost matters most.
    const floor = Number(matPrice.min_price) * Math.max(quantity, 1);
    const low = Math.max(floor, Math.round(total * 0.9));
    const high = Math.max(low, Math.round(total * 1.1));

    return {
      low,
      high,
      distanceKm,
      fuelCost,
      commission,
      total: Math.round(total),
    };
  }, [matPrice, coords, pickupPoint, dieselPrice, commissionRate, roadDistanceKm, quantity]);

  useEffect(() => {
    void suggestion;
  }, [suggestion]);

  // Approximate (~1 km) Online trucks around the pin, or Harare by default
  // (migration 0062).
  const nearbyTrucks = useNearbyTrucks(coords ?? { lat: -17.8252, lng: 31.0335 });

  if (!is("customer")) {
    return (
      <AppShell title="Book delivery">
        <div className="text-center py-10 space-y-3">
          <p className="text-muted-foreground">Only customer accounts can book deliveries.</p>
          <Button asChild variant="outline">
            <Link to="/profile">Go to profile</Link>
          </Button>
        </div>
      </AppShell>
    );
  }


  const goToOffer = async () => {
    if (!address.trim()) return toast.error("Enter the delivery address");

    if (!coords) {
      setStep(2);
      return toast.error("Select the delivery point on the map so the driver can navigate.");
    }

    if (!quantity || quantity < MIN_QUANTITY_M3) return toast.error("Enter quantity");

    setComputing(true);

    try {
      const distanceKm =
        roadDistanceKm ?? (coords ? haversineKm(pickupPoint, coords) : 15);

      const result = await runOffer({
        data: {
          material,
          quantity,
          // Fallback only, used if coordinates below are somehow missing —
          // the server derives the authoritative distance itself from
          // pickupLat/pickupLng/deliveryLat/deliveryLng when present.
          distanceKm,
          pickupLat: pickupPoint.lat,
          pickupLng: pickupPoint.lng,
          deliveryLat: coords.lat,
          deliveryLng: coords.lng,
          address,
        },
      });

      setOfferData(result);
      setOffer(result.offer);
      setStep(5);

      runExplain({ data: { material, quantity, distanceKm: result.distanceKm } })
        .then(({ explanation }) => {
          setOfferData((prev) => (prev ? { ...prev, explanation } : prev));
        })
        .catch(() => {
          // Keep fallback explanation.
        });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not calculate offer");
    } finally {
      setComputing(false);
    }
  };

  const nextStep = (v: number) => (v < 100 ? 5 : v < 300 ? 10 : 20);

  const adjust = (dir: -1 | 1) => {
    if (!offerData) return;

    const s = nextStep(offer);
    const proposed = offer + dir * s;

    if (dir < 0 && proposed < offerData.min) {
      toast("Minimum offer reached.");
      return;
    }

    if (dir > 0 && proposed > offerData.max) {
      toast("Maximum offer reached.");
      return;
    }

    setOffer(proposed);
  };

  const confirm = async () => {
    if (!offerData) return;

    if (!coords) {
      setStep(2);
      return toast.error("Select the delivery point on the map before confirming.");
    }

    setPosting(true);

    const { data, error } = await supabase
      .from("jobs")
      .insert({
        customer_id: userId!,

        material,
        custom_material: null,
        quantity_m3: quantity,
        quote_id: offerData.quoteId,

        delivery_address: address.trim(),
        delivery_lat: coords.lat,
        delivery_lng: coords.lng,

        pickup_address: offerData.resolvedSource?.label ?? offerData.resolvedSource?.address ?? PICKUP_ADDRESS,
        pickup_lat: offerData.resolvedSource?.lat ?? pickupPoint.lat,
        pickup_lng: offerData.resolvedSource?.lng ?? pickupPoint.lng,


        budget: offer,
        preferred_date: date || null,
        notes: notes.trim() || null,
        preferred_driver_id: search.driverId || null,
        payment_method: paymentMethod,
      } as any)
      .select()
      .single();

    setPosting(false);

    if (error) return toast.error(error.message);

    toast.success("Booking confirmed! Searching for trucks…");

    nav({ to: "/jobs/$id", params: { id: data.id } });
  };

  const goBack = () => {
    if (step === 0) return nav({ to: "/customer" });
    if (step === 5) return setStep(4);
    setStep(step - 1);
  };

  // ---------------------------------------------------------------------
  // Customer mode redesign. C1 (map + "what do you need delivered?" sheet)
  // covers the old material / quantity / delivery / date / notes steps on
  // one screen; C2 is the old offer step. All state, validation
  // (canNext-equivalent checks in goToOffer), computeOffer/explainOffer
  // and the jobs insert in confirm() above are unchanged.
  // ---------------------------------------------------------------------
  const quantityValid = quantity >= MIN_QUANTITY_M3 && quantity <= 30;
  const locationValid = address.trim().length > 2 && !!coords;
  // Mirrors compute_material_offer's reference-truck trip rule (see
  // suggestion above) — display only.
  const tripsEstimate = quantity > 20 ? Math.ceil(quantity / 10) : 1;
  const stepQty = (dir: -1 | 1) => {
    const stepSize = quantity < 1 || (dir < 0 && quantity <= 1) ? 0.25 : 1;
    const next = Math.round((quantity + dir * stepSize) * 100) / 100;
    setQuantity(Math.min(30, Math.max(MIN_QUANTITY_M3, next)));
  };

  if (step !== 5 || !offerData) {
    return (
      <CzScreen>
        <div className="relative h-[100dvh] overflow-hidden">
          <div id="tour-book-address">
            <AddressPicker
              variant="fullscreen"
              label="Deliver to"
              value={address}
              initialCoords={coords}
              trucks={nearbyTrucks}
              controlsBottom={sheetOpenExtra ? 470 : 372}
              leading={
                <button
                  type="button"
                  onClick={() => nav({ to: "/customer" })}
                  aria-label="Back"
                  className="w-[50px] h-[50px] shrink-0 rounded-[14px] bg-cz-bg text-cz-text flex items-center justify-center shadow-[0_4px_14px_rgba(0,0,0,0.4)]"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              }
              onChange={(a, c) => {
                setAddress(a);
                setCoords(c ?? null);
              }}
            />
          </div>

          <section className="absolute inset-x-0 bottom-0 z-30 max-h-[78dvh] overflow-y-auto rounded-t-[24px] bg-cz-bg px-5 pt-2.5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,0.45)]">
            <div aria-hidden className="mx-auto mb-3.5 h-[5px] w-10 rounded-full bg-cz-border-strong" />
            <div className="space-y-4">
              {search.driverId && (
                <HintBox tone="green" icon={<CheckCircle2 className="w-4 h-4" />}>
                  We'll notify your previous driver directly so they can bid first.
                </HintBox>
              )}

              <div id="tour-book-material" className="space-y-3">
                <h1 className="cz-display font-bold text-[26px] leading-tight">What do you need delivered?</h1>
                <MaterialChips
                  options={BOOKABLE_MATERIALS.map((m) => ({ value: m.value, label: m.label }))}
                  value={material}
                  onChange={(v) => setMaterial(v)}
                />
              </div>

              <div className="flex items-center justify-between gap-2 rounded-[14px] border border-cz-border bg-cz-surface py-2 pl-4 pr-2">
                <label htmlFor="qty" className="flex flex-col min-w-0">
                  <span className="text-[13px] text-cz-muted">Quantity</span>
                  <span className="text-xs text-cz-faint">
                    {quantityValid
                      ? tripsEstimate > 1
                        ? `About ${tripsEstimate} tipper loads`
                        : "About 1 tipper load"
                      : `Between ${MIN_QUANTITY_M3} and 30 m³`}
                  </span>
                </label>
                <div className="flex items-center gap-1.5">
                  <IconButton onClick={() => stepQty(-1)} disabled={quantity <= MIN_QUANTITY_M3} aria-label="Less">
                    <Minus className="w-[18px] h-[18px]" />
                  </IconButton>
                  <div className="flex items-baseline">
                    <input
                      id="qty"
                      type="number"
                      inputMode="decimal"
                      min={MIN_QUANTITY_M3}
                      max={30}
                      step={0.25}
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                      className="w-[58px] bg-transparent text-right cz-display font-bold text-[28px] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="cz-display font-bold text-[20px] ml-1">m³</span>
                  </div>
                  <IconButton onClick={() => stepQty(1)} disabled={quantity >= 30} aria-label="More">
                    <Plus className="w-[18px] h-[18px]" />
                  </IconButton>
                </div>
              </div>

              <div className="flex gap-2">
                {[10, 15, 20].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setQuantity(v)}
                    aria-pressed={quantity === v}
                    className={cn(
                      "flex-1 min-h-10 rounded-full text-sm font-semibold",
                      quantity === v ? "bg-cz-amber-tint-2 text-cz-amber-text" : "border border-cz-border-strong text-cz-muted",
                    )}
                  >
                    {v} m³ load
                  </button>
                ))}
              </div>

              <details
                id="tour-book-review"
                className="group rounded-[14px] border border-cz-border bg-cz-surface"
                onToggle={(e) => setSheetOpenExtra((e.target as HTMLDetailsElement).open)}
              >
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-[15px] font-semibold">
                  <span className="flex items-center gap-2 min-w-0">
                    <CalendarIcon className="w-4 h-4 text-cz-muted shrink-0" />
                    <span className="truncate">{date || notes ? `${date || "As soon as possible"}${notes ? " · notes added" : ""}` : "Date & notes for the driver"}</span>
                  </span>
                  <ChevronDown className="w-4 h-4 text-cz-muted transition group-open:rotate-180 shrink-0" />
                </summary>
                <div className="space-y-3 px-4 pb-4">
                  <div>
                    <Label htmlFor="date">Preferred date</Label>
                    <div className="flex gap-2 items-center">
                      <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11" />
                      {date && (
                        <button type="button" onClick={() => setDate("")} className="min-h-11 px-2 text-xs text-cz-muted underline shrink-0">
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-cz-muted">Optional — leave blank for as soon as possible.</p>
                  </div>
                  <div>
                    <Label htmlFor="notes">Notes (optional)</Label>
                    <Textarea
                      id="notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      maxLength={300}
                      placeholder="Access instructions, contact person, gate code…"
                    />
                  </div>
                  <p className="text-xs text-cz-muted">
                    Under 1 m³ includes a minimum trip charge that covers dispatch and the driver's return trip. From 1–20 m³, we
                    price against the next load size up (e.g. 13 m³ is priced as a 15 m³ load). Above 20 m³, we price it from
                    recent driver bids on similar-sized loads once there's enough data — otherwise it's routed to a custom quote.
                  </p>
                </div>
              </details>

              {suggestion && (
                <p className="text-[13px] text-cz-muted">
                  Usually {money(suggestion.low)}–{money(suggestion.high)} for {matPrice?.label ?? "this material"}, ~
                  {suggestion.distanceKm.toFixed(1)} km from pickup (incl. {commissionRate ?? 7}% platform commission).
                </p>
              )}
              {address.trim().length > 2 && !coords && (
                <p className="text-[13px] text-cz-danger-text">
                  Please select a map result or confirm the pin so the driver can navigate accurately.
                </p>
              )}

              <CzButton onClick={goToOffer} disabled={computing || !quantityValid || !locationValid}>
                {computing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Calculating…
                  </>
                ) : !address.trim() ? (
                  "Set the delivery point first"
                ) : !coords ? (
                  "Confirm the pin to continue"
                ) : (
                  "See price"
                )}
              </CzButton>
            </div>
          </section>
        </div>
      </CzScreen>
    );
  }

  const tiers = [
    { key: "low", title: "Low", value: offerData.low, hint: "Fewer drivers may respond" },
    { key: "recommended", title: "Recommended", value: offerData.recommended, hint: "Most drivers respond to this" },
    { key: "high", title: "High", value: offerData.high, hint: "Fastest offers" },
  ].filter((t) => Number.isFinite(t.value) && t.value >= offerData.min && t.value <= offerData.max);

  return (
    <CzScreen>
      <CzHeader
        title="Choose your price"
        onBack={goBack}
        subtitle={`${offerData.label} · ${quantity} m³ → ${areaOf(address) || address} · ${offerData.distanceKm} km`}
      />

      <div className="flex-1 space-y-4 px-5 pb-6">
        <div id="tour-book-offer" className="space-y-3">
          <div role="radiogroup" aria-label="Your price" className="grid gap-2.5">
            {tiers.map((t) => {
              const on = offer === t.value;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setOffer(t.value)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-[16px] border px-4 py-3.5 text-left transition",
                    on ? "border-cz-amber bg-cz-amber-tint" : "border-cz-border bg-cz-surface",
                  )}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-bold">
                      {t.title}
                      {t.key === "recommended" && (
                        <span className="rounded-full bg-cz-amber-tint-2 px-2 py-0.5 text-[11px] font-semibold text-cz-amber-text">
                          Suggested
                        </span>
                      )}
                    </span>
                    <span className="block text-[13px] text-cz-muted">{t.hint}</span>
                  </span>
                  <span className={cn("cz-display font-bold text-[30px] tabular-nums", on ? "text-cz-amber" : "text-cz-text")}>
                    {usd(t.value)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="rounded-[16px] border border-cz-border bg-cz-surface px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-cz-muted">Or set your own</span>
              <div className="flex items-center gap-2">
                <IconButton onClick={() => adjust(-1)} aria-label="Decrease offer">
                  <Minus className="w-[18px] h-[18px]" />
                </IconButton>
                <motion.span
                  key={offer}
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="min-w-[84px] text-center cz-display font-bold text-[30px] text-cz-amber tabular-nums"
                >
                  {usd(offer)}
                </motion.span>
                <IconButton onClick={() => adjust(1)} aria-label="Increase offer">
                  <Plus className="w-[18px] h-[18px]" />
                </IconButton>
              </div>
            </div>
          </div>
          {offerData.explanation && <p className="text-[13px] text-cz-muted">{offerData.explanation}</p>}
        </div>

        <CzCard className="space-y-2.5">
          {offerData.materialCost > 0 && (
            <MoneyRow label={`Material (${quantity} m³)`} value={usd2(offerData.materialCost)} />
          )}
          {offerData.transportCost > 0 && (
            <MoneyRow label={`Transport (${offerData.distanceKm} km)`} value={usd2(offerData.transportCost)} />
          )}
          {pickupLabel && <MoneyRow label="Picked up from" value={pickupLabel} valueClassName="text-cz-muted text-sm" />}
          <p className="text-[13px] text-cz-muted">
            Estimated {offerData.tripCount} trip{offerData.tripCount === 1 ? "" : "s"}, based on a {offerData.referenceCapacityM3} m³
            reference truck. All amounts in USD.
          </p>
        </CzCard>

        <div className="space-y-2">
          <div className="text-sm font-semibold text-cz-muted">How will you pay?</div>
          <SpotlightCallout
            id="conz-pay-choice"
            title="Two ways to pay"
            body="Pay the driver directly like usual, or choose Con Z Pay to have us hold the money until you confirm delivery — good if you're paying on someone else's behalf."
          />
          <div role="radiogroup" aria-label="How will you pay?" className="space-y-2">
            {(
              [
                {
                  v: "escrow" as const,
                  icon: ShieldCheck,
                  title: "Con Z Pay (recommended)",
                  body: `We hold your ${money(offer)} until your load arrives, then release it to the driver with your delivery PIN.`,
                },
                { v: "direct" as const, icon: HandCoins, title: "Pay driver directly", body: "Cash or EcoCash to the driver on delivery." },
              ]
            ).map((o) => {
              const on = paymentMethod === o.v;
              const Icon = o.icon;
              return (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPaymentMethod(o.v)}
                  className={cn(
                    "w-full flex items-start gap-3 rounded-[16px] border px-4 py-3.5 text-left transition",
                    on ? "border-cz-amber bg-cz-amber-tint" : "border-cz-border bg-cz-surface",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "mt-0.5 w-5 h-5 shrink-0 rounded-full border-2",
                      on ? "border-[6px] border-cz-amber bg-cz-bg" : "border-cz-border-strong",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Icon className={cn("w-4 h-4", o.v === "escrow" ? "text-cz-green-text" : "text-cz-muted")} /> {o.title}
                    </span>
                    <span className="block text-[13px] text-cz-muted">{o.body}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <footer className="sticky bottom-0 z-20 space-y-2 border-t border-cz-border bg-cz-surface px-5 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
        <CzButton id="tour-book-confirm" onClick={confirm} disabled={posting}>
          {posting ? <Loader2 className="w-5 h-5 animate-spin" /> : `Post job · ${usd(offer)}`}
        </CzButton>
        <p className="text-center text-[11px] text-cz-faint">We'll immediately search for the closest verified tipper truck.</p>
      </footer>
    </CzScreen>
  );
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(s));
}
