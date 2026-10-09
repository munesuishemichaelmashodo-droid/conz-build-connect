import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  // Redesign: the date/notes drawer grows the sheet, so the map controls move up.
  const [sheetOpenExtra, setSheetOpenExtra] = useState(false);
  // The booking sheet's real height, so the map's locate button / status pill
  // always sit just above it (a fixed offset hid them behind taller sheets).
  const [sheetEl, setSheetEl] = useState<HTMLElement | null>(null);
  const [sheetHeight, setSheetHeight] = useState(372);
  useEffect(() => {
    if (!sheetEl) return;
    const update = () => setSheetHeight(Math.round(sheetEl.getBoundingClientRect().height));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(sheetEl);
    return () => ro.disconnect();
  }, [sheetEl]);

  // Approximate (~1 km) Online trucks around the selected delivery pin.
  const nearbyTrucks = useNearbyTrucks(coords);

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
      const result = await runOffer({
        data: {
          material,
          quantity,
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

        pickup_address: offerData.resolvedSource.label ?? offerData.resolvedSource.address ?? "Verified supplier location",
        pickup_lat: offerData.resolvedSource.lat,
        pickup_lng: offerData.resolvedSource.lng,


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
  // Mirrors compute_material_offer's reference-truck trip rule — display only.
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
            {/* The wrapper above has no in-flow content (the picker is
                absolutely positioned), so it measures 0px tall — the tour
                now targets the picker's floating search field instead. */}
            <AddressPicker
              variant="fullscreen"
              label="Deliver to"
              value={address}
              initialCoords={coords}
              trucks={nearbyTrucks}
              controlsBottom={sheetHeight + 12}
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

          <section ref={setSheetEl} className="absolute inset-x-0 bottom-0 z-30 max-h-[62dvh] overflow-y-auto rounded-t-[24px] bg-cz-bg px-5 pt-2.5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(0,0,0,0.45)]">
            <div aria-hidden className="mx-auto mb-3.5 h-[5px] w-10 rounded-full bg-cz-border-strong" />
            <div className="space-y-4">
              {search.driverId && (
                <HintBox tone="green" icon={<CheckCircle2 className="w-4 h-4" />}>
                  We'll notify your previous driver directly so they can bid first.
                </HintBox>
              )}

              <div id="tour-book-material" data-tour="book-material" className="space-y-3">
                <h1 className="cz-display font-bold text-[26px] leading-tight">What do you need delivered?</h1>
                <MaterialChips
                  options={BOOKABLE_MATERIALS.map((m) => ({ value: m.value, label: m.label }))}
                  value={material}
                  onChange={(v) => setMaterial(v)}
                />
              </div>

              <div data-tour="book-quantity" className="flex items-center justify-between gap-2 rounded-[14px] border border-cz-border bg-cz-surface py-2 pl-4 pr-2">
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
                data-tour="book-review"
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

              <p className="text-[13px] text-cz-muted">
                We’ll calculate the price using an eligible material pickup and the route to your delivery point.
              </p>
              {address.trim().length > 2 && !coords && (
                <p className="text-[13px] text-cz-danger-text">
                  Tap the map or pick a search result so the driver can navigate accurately.
                </p>
              )}

              <CzButton
                data-tour="book-see-price"
                data-location-ready={locationValid ? "true" : "false"}
                onClick={goToOffer}
                disabled={computing || !quantityValid || !locationValid}
              >
                {computing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" /> Calculating…
                  </>
                ) : !address.trim() ? (
                  "Set the delivery point first"
                ) : !coords ? (
                  "Tap the map to set the delivery point"
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
        <div id="tour-book-offer" data-tour="book-offer" className="space-y-3">
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
          <MoneyRow label="Picked up from" value={offerData.resolvedSource.label || offerData.resolvedSource.address || "Verified supplier location"} valueClassName="text-cz-muted text-sm" />
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
        <CzButton id="tour-book-confirm" data-tour="book-confirm" onClick={confirm} disabled={posting}>
          {posting ? <Loader2 className="w-5 h-5 animate-spin" /> : `Post job · ${usd(offer)}`}
        </CzButton>
        <p className="text-center text-[11px] text-cz-faint">We'll immediately search for the closest verified tipper truck.</p>
      </footer>
    </CzScreen>
  );
}
