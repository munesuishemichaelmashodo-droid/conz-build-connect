import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { AddressPicker } from "@/components/AddressPicker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  Truck,
  Package,
  MapPin,
  CheckCircle2,
  Calendar as CalendarIcon,
  StickyNote,
  ShieldCheck,
  HandCoins,
  type LucideIcon,
} from "lucide-react";
import { MATERIALS, type MaterialCategory, money } from "@/lib/domain";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { computeOffer, explainOffer, type OfferResult } from "@/lib/booking.functions";
import { motion, AnimatePresence } from "framer-motion";
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

// Average tipper truck fuel consumption, litres per 100 km.
const FUEL_LITRES_PER_100KM = 32;

// Default supplier pickup point, Harare CBD.
// Later this can become a real supplier pickup location.
const PICKUP_POINT = { lat: -17.8292, lng: 31.0522 };
const PICKUP_ADDRESS = "Harare CBD supplier pickup point";

const STEPS = [
  { key: "material", title: "Material" },
  { key: "quantity", title: "Quantity" },
  { key: "address", title: "Delivery" },
  { key: "date", title: "Date" },
  { key: "review", title: "Notes" },
] as const;

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
            startLat: PICKUP_POINT.lat,
            startLng: PICKUP_POINT.lng,
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
  }, [coords]);

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

    const distanceKm = roadDistanceKm ?? haversineKm(PICKUP_POINT, coords);
    const midMaterial = (Number(matPrice.min_price) + Number(matPrice.max_price)) / 2;
    const fuelCost =
      distanceKm * (FUEL_LITRES_PER_100KM / 100) * Number(dieselPrice ?? 1.87);
    const commission = (midMaterial + fuelCost) * (Number(commissionRate ?? 7) / 100);
    const total = midMaterial + fuelCost + commission;
    const low = Math.max(Number(matPrice.min_price), Math.round(total * 0.9));
    const high = Math.min(Number(matPrice.max_price), Math.round(total * 1.1));

    return {
      low,
      high,
      distanceKm,
      fuelCost,
      commission,
      total: Math.round(total),
    };
  }, [matPrice, coords, dieselPrice, commissionRate, roadDistanceKm]);

  useEffect(() => {
    void suggestion;
  }, [suggestion]);

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

  const canNext = () => {
    if (step === 0) return !!material;
    if (step === 1) return quantity >= 1 && quantity <= 30;
    if (step === 2) return address.trim().length > 2 && !!coords;
    if (step === 3) return true;
    if (step === 4) return true;
    return true;
  };

  const goToOffer = async () => {
    if (!address.trim()) return toast.error("Enter the delivery address");

    if (!coords) {
      setStep(2);
      return toast.error("Select the delivery point on the map so the driver can navigate.");
    }

    if (!quantity || quantity < 1) return toast.error("Enter quantity");

    setComputing(true);

    try {
      const distanceKm =
        roadDistanceKm ?? (coords ? haversineKm(PICKUP_POINT, coords) : 15);

      const result = await runOffer({
        data: { material, quantity, distanceKm, address },
      });

      setOfferData(result);
      setOffer(result.offer);
      setStep(5);

      runExplain({ data: { material, quantity, distanceKm } })
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

        delivery_address: address.trim(),
        delivery_lat: coords.lat,
        delivery_lng: coords.lng,

        pickup_address: PICKUP_ADDRESS,
        pickup_lat: PICKUP_POINT.lat,
        pickup_lng: PICKUP_POINT.lng,


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

  const isReview = step === 4;

  return (
    <AppShell title="Book delivery">
      <button
        type="button"
        onClick={goBack}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {step < 5 && <Stepper current={step} total={STEPS.length} />}

      {search.driverId && (
        <div className="mt-4 rounded-xl bg-primary/10 border border-primary/30 p-3 text-xs text-primary flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>We'll notify your previous driver directly so they can bid first.</span>
        </div>
      )}

      <AnimatePresence mode="wait">
        {step === 0 && (
          <motion.div key="s-material" {...anim} className="space-y-5 mt-6">
            <Header icon={Package} title="What are we moving?" hint="Pick the material you need delivered." />

            <div className="grid grid-cols-2 gap-2">
              {BOOKABLE_MATERIALS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMaterial(m.value)}
                  className={cn(
                    "rounded-2xl border p-3 text-left transition",
                    material === m.value
                      ? "border-primary bg-primary/10 shadow-lift"
                      : "hover:border-primary/40",
                  )}
                >
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {m.group}
                  </div>
                  <div className="font-display font-bold text-sm">{m.label}</div>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div key="s-qty" {...anim} className="space-y-5 mt-6">
            <Header icon={Truck} title="How much?" hint="One tipper load carries 10–15 m³." />

            <div className="flex gap-2">
              {[10, 12, 14, 15].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setQuantity(v)}
                  className={cn(
                    "flex-1 rounded-xl border py-3 font-display font-bold",
                    quantity === v
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {v} m³
                </button>
              ))}
            </div>

            <div>
              <Label htmlFor="qty">Custom quantity (m³)</Label>
              <Input
                id="qty"
                type="number"
                min={1}
                max={30}
                step={0.5}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="s-addr" {...anim} className="space-y-5 mt-6">
            <Header
              icon={MapPin}
              title="Where to?"
              hint="We'll match you with the closest tipper truck."
            />

            <AddressPicker
              value={address}
              onChange={(a, c) => {
                setAddress(a);
                setCoords(c ?? null);
              }}
            />

            {address.trim().length > 2 && !coords && (
              <p className="text-xs text-destructive">
                Please select a map result or pin the delivery point so the driver can navigate accurately.
              </p>
            )}

            {suggestion && (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary font-semibold">
                  <Sparkles className="w-3 h-3" /> Suggested price range
                </div>

                <div className="font-display font-bold text-2xl">
                  {money(suggestion.low)}{" "}
                  <span className="text-muted-foreground text-lg">–</span>{" "}
                  {money(suggestion.high)}
                </div>

                <p className="text-xs text-muted-foreground">
                  Based on {matPrice?.label} pricing, ~{suggestion.distanceKm.toFixed(1)} km from pickup,
                  fuel at {FUEL_LITRES_PER_100KM} L/100 km Ã— $
                  {Number(dieselPrice ?? 1.87).toFixed(2)}/L, plus {commissionRate ?? 7}% platform commission.
                </p>
              </div>
            )}
          </motion.div>
        )}

        {step === 3 && (
          <motion.div key="s-date" {...anim} className="space-y-5 mt-6">
            <Header
              icon={CalendarIcon}
              title="When do you need it?"
              hint="Optional — leave blank for as soon as possible."
            />

            <div>
              <Label htmlFor="date">Preferred date</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            {date && (
              <button
                type="button"
                onClick={() => setDate("")}
                className="text-xs text-muted-foreground underline"
              >
                Clear date
              </button>
            )}
          </motion.div>
        )}

        {step === 4 && (
          <motion.div key="s-notes" {...anim} className="space-y-5 mt-6">
            <Header
              icon={StickyNote}
              title="Anything else?"
              hint="Add notes for the driver, then get your AI offer."
            />

            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder="Access instructions, contact person, gate code…"
              />
            </div>

            <div className="rounded-2xl bg-card border p-4 space-y-2 text-sm">
              <Row
                icon={Package}
                label={matPrice?.label ?? "Material"}
                value={`${quantity} m³`}
              />
              <Row icon={MapPin} label="Delivery to" value={address || "—"} />
              <Row
                icon={CalendarIcon}
                label="Preferred date"
                value={date || "As soon as possible"}
              />
            </div>
          </motion.div>
        )}

        {step === 5 && offerData && (
          <motion.div key="s-offer" {...anim} className="space-y-5 mt-6">
            <div className="rounded-3xl bg-gradient-dark text-white p-8 shadow-lift text-center">
              <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary font-semibold">
                <Sparkles className="w-3 h-3" /> AI Recommended
              </div>

              <div className="text-[11px] uppercase tracking-widest text-white/60 mt-3">
                Your offer
              </div>

              <motion.div
                key={offer}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 18 }}
                className="font-display font-bold text-primary text-6xl mt-1"
              >
                {money(offer)}
              </motion.div>

              <p className="text-xs text-white/70 mt-3 max-w-xs mx-auto">
                {offerData.explanation}
              </p>

              <div className="mt-6 flex items-center justify-center gap-6">
                <button
                  type="button"
                  onClick={() => adjust(-1)}
                  className="w-14 h-14 rounded-full bg-white/10 border border-white/20 hover:bg-white/20 flex items-center justify-center transition"
                  aria-label="Decrease offer"
                >
                  <Minus className="w-6 h-6" />
                </button>

                <button
                  type="button"
                  onClick={() => adjust(1)}
                  className="w-14 h-14 rounded-full bg-primary text-primary-foreground hover:brightness-110 flex items-center justify-center shadow-lift transition"
                  aria-label="Increase offer"
                >
                  <Plus className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="rounded-2xl bg-card border p-4 space-y-2 text-sm">
              <Row icon={Package} label={offerData.label} value={`${quantity} m³`} />
              <Row icon={MapPin} label="Delivery to" value={address} />
              <Row
                icon={Truck}
                label="Estimated distance"
                value={`${offerData.distanceKm} km`}
              />
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-2">
                How will you pay?
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("direct")}
                  className={cn(
                    "w-full flex items-start gap-3 rounded-2xl border p-3 text-left transition",
                    paymentMethod === "direct" ? "border-primary bg-primary/5" : "hover:border-primary/40",
                  )}
                >
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <HandCoins className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">Pay the driver directly</div>
                    <div className="text-xs text-muted-foreground">Cash or EcoCash on delivery, arranged between you.</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("escrow")}
                  className={cn(
                    "w-full flex items-start gap-3 rounded-2xl border p-3 text-left transition",
                    paymentMethod === "escrow" ? "border-primary bg-primary/5" : "hover:border-primary/40",
                  )}
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">Con Z Pay <span className="text-[10px] font-normal text-muted-foreground">— pay now, held safely</span></div>
                    <div className="text-xs text-muted-foreground">
                      Pay {money(offer)} now through Con Z. We hold it and only release it to the
                      driver once you confirm delivery — good for paying on someone else's behalf.
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <Button
              onClick={confirm}
              disabled={posting}
              className="w-full h-14 rounded-2xl font-display uppercase tracking-wide text-base"
            >
              {posting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Confirm booking <CheckCircle2 className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>

            <p className="text-[11px] text-center text-muted-foreground">
              We'll immediately search for the closest verified tipper truck.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {step < 5 && (
        <div className="flex gap-2 mt-8">
          <Button
            variant="outline"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex-1 h-12"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Back
          </Button>

          {isReview ? (
            <Button
              onClick={goToOffer}
              disabled={computing || !canNext()}
              className="flex-1 h-12 font-display uppercase tracking-wide"
            >
              {computing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Calculating…
                </>
              ) : (
                <>
                  Get AI offer <Sparkles className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canNext()}
              className="flex-1 h-12"
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      )}
    </AppShell>
  );
}

const anim = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: 0.25 },
};

function Stepper({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, n) => (
        <div
          key={n}
          className={cn(
            "flex-1 h-1.5 rounded-full transition-colors",
            n <= current ? "bg-primary" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function Header({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  hint: string;
}) {
  return (
    <div>
      <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3">
        <Icon className="w-6 h-6" />
      </div>
      <h1 className="font-display font-bold text-2xl">{title}</h1>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        <div className="text-sm truncate">{value}</div>
      </div>
    </div>
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
