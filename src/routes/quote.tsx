import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MATERIALS, money, type MaterialCategory } from "@/lib/domain";
import { AddressPicker } from "@/components/AddressPicker";
import { supabase } from "@/integrations/supabase/client";
import { computePublicOffer } from "@/lib/booking.functions";
import { getRoute } from "@/lib/routing.functions";
import { Button } from "@/components/ui/button";
import { Minus, Plus, Loader2, Sparkles, ShieldCheck, Camera, MapPinned } from "lucide-react";
import type { OfferResult } from "@/lib/booking.functions";

export const Route = createFileRoute("/quote")({
  ssr: false,
  component: PublicQuotePage,
});

const BOOKABLE_MATERIALS = MATERIALS.filter((m) => m.value !== "custom");
const PICKUP_POINT = { lat: -17.8292, lng: 31.0522 };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-screen-sm px-4 py-6 space-y-4">
        <div className="flex items-center gap-2">
          <img src="/conz-logo.png" alt="Con Z" className="h-8 w-auto" />
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Instant price check</span>
        </div>
        {children}
        <p className="text-center text-[11px] text-muted-foreground pt-4">
          Powered by Con Z — Zimbabwe's construction marketplace
        </p>
      </div>
    </div>
  );
}

function PublicQuotePage() {
  const runOffer = useServerFn(computePublicOffer);
  const runRoute = useServerFn(getRoute);

  const [material, setMaterial] = useState<MaterialCategory>("river_sand");
  const [quantity, setQuantity] = useState(12);
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [offer, setOffer] = useState<OfferResult | null>(null);

  const [materialPickups, setMaterialPickups] = useState<Record<string, { lat: number | null; lng: number | null; label: string | null }>>({});
  useEffect(() => {
    (supabase.rpc as unknown as (f: string) => Promise<{ data: unknown }>)("public_material_pickups")
      .then(({ data }) => setMaterialPickups((data ?? {}) as typeof materialPickups))
      .catch(() => {});
  }, []);
  const pickupPoint = useMemo(() => {
    const p = materialPickups[material];
    if (p?.lat != null && p?.lng != null) return { lat: p.lat, lng: p.lng };
    return PICKUP_POINT;
  }, [materialPickups, material]);

  const checkPrice = async () => {
    if (!coords) return;
    setLoading(true);
    setOffer(null);
    try {
      let distanceKm = 15;
      try {
        const route = await runRoute({
          data: { startLat: pickupPoint.lat, startLng: pickupPoint.lng, destLat: coords.lat, destLng: coords.lng },
        });
        if (route?.distanceKm) distanceKm = route.distanceKm;
      } catch {
        // fall back to the default distance estimate
      }
      const result = await runOffer({ data: { material, quantity, distanceKm, address } });
      setOffer(result);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Shell>
      <div className="rounded-2xl bg-card border p-5 space-y-4">
        <div>
          <h1 className="font-display font-bold text-xl">Check a price</h1>
          <p className="text-sm text-muted-foreground">No sign-up needed — see a fair market rate before you book.</p>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">Material</div>
          <div className="grid grid-cols-2 gap-1.5">
            {BOOKABLE_MATERIALS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMaterial(m.value)}
                className={`rounded-lg border py-2 text-xs font-semibold ${
                  material === m.value ? "bg-primary text-primary-foreground border-primary" : "bg-background"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">Quantity (m³)</div>
          <div className="flex items-center gap-3">
            <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="w-9 h-9 rounded-lg border flex items-center justify-center">
              <Minus className="w-4 h-4" />
            </button>
            <span className="flex-1 text-center font-display font-bold text-lg">{quantity} m³</span>
            <button onClick={() => setQuantity((q) => Math.min(50, q + 1))} className="w-9 h-9 rounded-lg border flex items-center justify-center">
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>

        <AddressPicker
          value={address}
          onChange={(a, c) => {
            setAddress(a);
            setCoords(c ?? null);
          }}
        />

        <Button onClick={checkPrice} disabled={!coords || loading} className="w-full">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Check price <Sparkles className="w-4 h-4 ml-1" /></>}
        </Button>

        {offer && (
          <div className="rounded-xl bg-primary/5 border border-primary/30 p-4 space-y-3">
            <div className="text-center">
              <div className="text-[11px] uppercase tracking-widest text-muted-foreground">Fair price estimate</div>
              <div className="font-display font-bold text-3xl text-primary">{money(offer.offer)}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Market range {money(offer.min)}–{money(offer.max)} · ~{offer.etaMinutes} min ETA
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground border-t pt-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-success shrink-0" /> Verified drivers only, no surprise charges
              </div>
              <div className="flex items-center gap-2">
                <Camera className="w-3.5 h-3.5 text-success shrink-0" /> Photo proof of pickup and delivery
              </div>
              <div className="flex items-center gap-2">
                <MapPinned className="w-3.5 h-3.5 text-success shrink-0" /> Live GPS tracking from pickup to your door
              </div>
            </div>
            <Link
              to="/auth"
              search={{ mode: "register", role: "customer" }}
              className="block w-full text-center rounded-xl bg-primary text-primary-foreground font-display font-bold uppercase tracking-wide py-3"
            >
              Book this delivery
            </Link>
          </div>
        )}
      </div>
    </Shell>
  );
}
