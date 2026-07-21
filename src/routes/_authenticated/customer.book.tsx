import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { AddressPicker } from "@/components/AddressPicker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ArrowRight, Loader2, Minus, Plus, Sparkles, Truck, Package, MapPin, CheckCircle2 } from "lucide-react";
import { MATERIALS, type MaterialCategory, money } from "@/lib/domain";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { computeOffer, explainOffer, type OfferResult } from "@/lib/booking.functions";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/customer/book")({
  component: BookDelivery,
});

const BOOKABLE_MATERIALS = MATERIALS.filter((m) => m.value !== "custom");

// Average tipper truck fuel consumption (litres per 100 km).
const FUEL_LITRES_PER_100KM = 32;
// Default supplier pickup point (Harare CBD) — used until per-supplier pickup is added.
const PICKUP_POINT = { lat: -17.8292, lng: 31.0522 };

function BookDelivery() {
  const { userId, is } = useAuth();
  const nav = useNavigate();
  const runOffer = useServerFn(computeOffer);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [material, setMaterial] = useState<MaterialCategory>("river_sand");
  const [quantity, setQuantity] = useState<number>(12);
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [computing, setComputing] = useState(false);
  const [offerData, setOfferData] = useState<OfferResult | null>(null);
  const [offer, setOffer] = useState<number>(0);
  const [posting, setPosting] = useState(false);

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
      const { data } = await supabase.from("system_settings").select("value").eq("key", "diesel_price_per_liter").maybeSingle();
      return Number(data?.value ?? 1.87);
    },
  });

  const { data: commissionRate } = useQuery({
    queryKey: ["commission-rate"],
    queryFn: async () => {
      const { data } = await supabase.from("system_settings").select("value").eq("key", "commission_rate").maybeSingle();
      return Number(data?.value ?? 7);
    },
  });

  const suggestion = useMemo(() => {
    if (!matPrice || !coords) return null;
    const distanceKm = haversineKm(PICKUP_POINT, coords);
    const midMaterial = (Number(matPrice.min_price) + Number(matPrice.max_price)) / 2;
    const fuelCost = distanceKm * (FUEL_LITRES_PER_100KM / 100) * Number(dieselPrice ?? 1.87);
    const commission = (midMaterial + fuelCost) * (Number(commissionRate ?? 7) / 100);
    const total = midMaterial + fuelCost + commission;
    const low = Math.max(Number(matPrice.min_price), Math.round(total * 0.9));
    const high = Math.min(Number(matPrice.max_price), Math.round(total * 1.1));
    return { low, high, distanceKm, fuelCost, commission, total: Math.round(total) };
  }, [matPrice, coords, dieselPrice, commissionRate]);

  // Prevent unused-var warning when suggestion is only rendered conditionally.
  useEffect(() => { void suggestion; }, [suggestion]);


  if (!is("customer")) {
    return (
      <AppShell title="Book delivery">
        <div className="text-center py-10 space-y-3">
          <p className="text-muted-foreground">Only customer accounts can book deliveries.</p>
          <Button asChild variant="outline"><Link to="/profile">Go to profile</Link></Button>
        </div>
      </AppShell>
    );
  }

  const runExplain = useServerFn(explainOffer);

  const goToOffer = async () => {
    if (!address.trim()) return toast.error("Enter the delivery address");
    if (!quantity || quantity < 1) return toast.error("Enter quantity");
    setComputing(true);
    try {
      const distanceKm = coords
        ? haversineKm({ lat: -17.8252, lng: 31.0335 }, coords)
        : 15;
      const result = await runOffer({ data: { material, quantity, distanceKm, address } });
      setOfferData(result);
      setOffer(result.offer);
      setStep(3);
      // Fire AI explanation in background — never blocks the UI.
      runExplain({ data: { material, quantity, distanceKm } })
        .then(({ explanation }) => {
          setOfferData((prev) => (prev ? { ...prev, explanation } : prev));
        })
        .catch(() => { /* keep fallback */ });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not calculate offer");
    } finally {
      setComputing(false);
    }
  };

  const step5 = offerData?.step ?? 5;
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
    setPosting(true);
    const { data, error } = await supabase.from("jobs").insert({
      customer_id: userId!,
      material,
      custom_material: null,
      quantity_m3: quantity,
      delivery_address: address.trim(),
      budget: offer,
      preferred_date: date || null,
      notes: notes.trim() || null,
    }).select().single();
    setPosting(false);
    if (error) return toast.error(error.message);
    toast.success("Booking confirmed! Searching for trucks…");
    nav({ to: "/jobs/$id", params: { id: data.id } });
  };

  return (
    <AppShell title="Book delivery">
      <button
        type="button"
        onClick={() => (step === 1 ? nav({ to: "/customer" }) : setStep((step - 1) as 1 | 2 | 3))}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <Stepper current={step} />

      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="s1" {...anim} className="space-y-5 mt-6">
            <Header icon={MapPin} title="Where to?" hint="We'll match you with the closest tipper truck." />
            <AddressPicker
              value={address}
              onChange={(a, c) => {
                setAddress(a);
                if (c) setCoords(c);
              }}
            />
            <Button
              onClick={() => {
                if (!address.trim()) return toast.error("Enter the delivery address");
                setStep(2);
              }}
              className="w-full h-14 rounded-2xl font-display uppercase tracking-wide text-base"
            >
              Continue <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div key="s2" {...anim} className="space-y-5 mt-6">
            <Header icon={Package} title="What are we moving?" hint="Pick a material and volume." />

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
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{m.group}</div>
                  <div className="font-display font-bold text-sm">{m.label}</div>
                </button>
              ))}
            </div>

            <div>
              <Label>Quantity (m³) — one tipper load is 10–15 m³</Label>
              <div className="flex gap-2 mt-2">
                {[10, 12, 14, 15].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setQuantity(v)}
                    className={cn(
                      "flex-1 rounded-xl border py-2 font-display font-bold",
                      quantity === v ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground",
                    )}
                  >
                    {v} m³
                  </button>
                ))}
              </div>
              <Input
                type="number"
                min={1}
                max={30}
                step={0.5}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="mt-2"
              />
            </div>

            {suggestion && (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary font-semibold">
                  <Sparkles className="w-3 h-3" /> Suggested price range
                </div>
                <div className="font-display font-bold text-2xl">
                  {money(suggestion.low)} <span className="text-muted-foreground text-lg">–</span> {money(suggestion.high)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Based on {matPrice?.label} pricing, ~{suggestion.distanceKm.toFixed(1)} km from pickup,
                  fuel at {FUEL_LITRES_PER_100KM} L/100 km × ${Number(dieselPrice ?? 1.87).toFixed(2)}/L,
                  plus {commissionRate ?? 7}% platform commission. This is a hint — you can still enter any budget within the enforced range.
                </p>
              </div>
            )}



            <div>
              <Label htmlFor="date">Preferred date (optional)</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={300} />
            </div>

            <Button
              onClick={goToOffer}
              disabled={computing}
              className="w-full h-14 rounded-2xl font-display uppercase tracking-wide text-base"
            >
              {computing ? (
                <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Calculating fair offer…</>
              ) : (
                <>Get AI offer <Sparkles className="w-5 h-5 ml-2" /></>
              )}
            </Button>
          </motion.div>
        )}

        {step === 3 && offerData && (
          <motion.div key="s3" {...anim} className="space-y-5 mt-6">
            <div className="rounded-3xl bg-gradient-dark text-white p-8 shadow-lift text-center">
              <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-primary font-semibold">
                <Sparkles className="w-3 h-3" /> AI Recommended
              </div>
              <div className="text-[11px] uppercase tracking-widest text-white/60 mt-3">Your offer</div>
              <motion.div
                key={offer}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 18 }}
                className="font-display font-bold text-primary text-6xl mt-1"
              >
                {money(offer)}
              </motion.div>
              <p className="text-xs text-white/70 mt-3 max-w-xs mx-auto">{offerData.explanation}</p>

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
              <Row icon={Truck} label="Estimated distance" value={`${offerData.distanceKm} km`} />
            </div>

            <Button
              onClick={confirm}
              disabled={posting}
              className="w-full h-14 rounded-2xl font-display uppercase tracking-wide text-base"
            >
              {posting ? <Loader2 className="w-5 h-5 animate-spin" /> : (<>Confirm booking <CheckCircle2 className="w-5 h-5 ml-2" /></>)}
            </Button>
            <p className="text-[11px] text-center text-muted-foreground">
              We'll immediately search for the closest verified tipper truck.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}

const anim = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
  transition: { duration: 0.25 },
};

function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center gap-2">
      {[1, 2, 3].map((n) => (
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

function Header({ icon: Icon, title, hint }: { icon: typeof MapPin; title: string; hint: string }) {
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

function Row({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
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
