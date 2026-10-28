import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MapPin } from "lucide-react";
import { czButtonClass } from "@/components/redesign";
import { ChoiceChips, DocketPanel, DocketRow, MoneyFigure, Notice } from "@/components/ds";
import { MaterialThumb } from "@/components/ds/media";
import { LoadPicker } from "@/components/ds/load-picker";
import { MATERIALS, money, type MaterialCategory } from "@/lib/domain";
import { isValidQuantity } from "@/lib/load-size";
import {
  computePublicOffer,
  OPEN_REQUEST_HAUL_KM,
  type AwaitingSourcingResult,
  type OfferResult,
} from "@/lib/booking.functions";
import {
  createLatestRequestGate,
  currentQuickPrice,
  quickPriceBookingPath,
  offerBreakdown,
  quickPriceCopy,
  quickPriceErrorMessage,
  quickPriceSignature,
  quickPriceStage,
  runQuickPrice,
} from "@/lib/quick-price";

// The map (Leaflet) is the heaviest part of the page, so it only loads when
// someone starts entering an address. Same picker as booking: same search,
// GPS button, pin and confirm step.
const loadAddressPicker = () =>
  import("@/components/AddressPicker").then((m) => ({ default: m.AddressPicker }));
const AddressPicker = lazy(loadAddressPicker);

const MATERIAL_OPTIONS = MATERIALS.filter((m) => m.value !== "custom").map((m) => ({
  value: m.value,
  label: m.label,
  media: <MaterialThumb material={m.value} size={32} />,
}));

/**
 * Anonymous price check (/quote). Uses computePublicOffer (verified supplier, road distance and
 * compute_material_offer), so the number shown is the engine's estimate and
 * nothing is priced in the browser.
 */
export function QuickPrice({ titleAs = "h2" }: { titleAs?: "h1" | "h2" }) {
  const runOffer = useServerFn(computePublicOffer);
  const [material, setMaterial] = useState<MaterialCategory>("river_sand");
  const [quantity, setQuantity] = useState(12);
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pickerOn, setPickerOn] = useState(false);
  // Signature of the price check in flight, if any. "Checking" shows only while it matches the
  // inputs on screen, so editing anything during a check lets the customer check again at once.
  const [pendingSig, setPendingSig] = useState<string | null>(null);
  const gate = useRef(createLatestRequestGate()).current;
  const [result, setResult] = useState<{
    sig: string;
    offer?: OfferResult;
    awaiting?: AwaitingSourcingResult;
    error?: string;
  } | null>(null);

  const sig = quickPriceSignature({ material, quantity, coords, address });
  const sigRef = useRef(sig);
  sigRef.current = sig;
  const loading = pendingSig === sig;
  // A result only stays on screen (and can be booked) while the inputs still match it.
  const current = currentQuickPrice(result, sig);
  const bookPath = coords
    ? quickPriceBookingPath({ material, quantity, address, coords })
    : "/customer/book";
  const stage = quickPriceStage({
    quantityValid: isValidQuantity(quantity),
    hasDelivery: !!coords,
    loading,
    result: current,
  });

  const checkPrice = async () => {
    if (loading) return;
    const c = coords;
    await runQuickPrice({
      gate,
      sig,
      currentSig: () => sigRef.current,
      hasDelivery: !!c,
      quantity,
      fetch: () =>
        runOffer({
          data: { material, quantity, deliveryLat: c!.lat, deliveryLng: c!.lng, address },
        }),
      setPending: setPendingSig,
      setResult: ({ sig: s, value, error }) => {
        if (value) {
          setResult(
            value.status === "awaiting_sourcing"
              ? { sig: s, awaiting: value }
              : { sig: s, offer: value },
          );
        } else {
          setResult({
            sig: s,
            error: quickPriceErrorMessage(
              error,
              typeof navigator !== "undefined" && !navigator.onLine,
            ),
          });
        }
      },
    });
  };

  return (
    <DocketPanel title="Check a price" titleAs={titleAs} reference="No account needed">
      <div className="space-y-5 px-4 py-4">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Material</legend>
          <ChoiceChips
            grid
            label="Material"
            options={MATERIAL_OPTIONS}
            value={material}
            onChange={(v) => setMaterial(v as MaterialCategory)}
          />
        </fieldset>

        <LoadPicker id="home-qty" value={quantity} onChange={setQuantity} />

        {pickerOn ? (
          <Suspense fallback={<AddressPlaceholder loading />}>
            <AddressPicker
              label="Deliver to"
              value={address}
              onChange={(a, c) => {
                setAddress(a);
                setCoords(c ?? null);
              }}
            />
            <FocusAddressField />
          </Suspense>
        ) : (
          <AddressPlaceholder
            onOpen={() => setPickerOn(true)}
            onIntent={() => void loadAddressPicker()}
          />
        )}

        {!current?.offer && !current?.awaiting && <PickupExplainer />}

        {stage.kind === "error" && current?.error && (
          <Notice tone="danger" title="No price yet">
            {current.error}
          </Notice>
        )}

        {current?.awaiting && (
          <Notice tone="info" title="No listed supplier for this yet">
            {current.awaiting.message}
          </Notice>
        )}

        {current?.offer &&
          (current.offer.openRequest ? (
            <GuideResult offer={current.offer} quantity={quantity} />
          ) : (
            <PriceResult offer={current.offer} quantity={quantity} />
          ))}

        {current?.offer || current?.awaiting ? (
          <Link
            to="/auth"
            search={{ mode: "register", role: "customer", next: bookPath } as never}
            className={czButtonClass("primary")}
          >
            {quickPriceCopy(current.offer && !current.offer.openRequest ? "supplier" : "open").cta}
          </Link>
        ) : (
          <button
            type="button"
            onClick={checkPrice}
            disabled={!coords || loading || !isValidQuantity(quantity)}
            className={czButtonClass("primary")}
          >
            {loading ? (
              <>
                <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> Checking price…
              </>
            ) : stage.kind === "error" ? (
              "Try again"
            ) : (
              "See price"
            )}
          </button>
        )}
        {(stage.kind === "needs_load" ||
          stage.kind === "needs_delivery" ||
          stage.kind === "ready" ||
          stage.kind === "checking") && (
          <p className="-mt-2 text-center text-sm text-cz-muted" aria-live="polite">
            {stage.prompt}
          </p>
        )}
        {(current?.offer || current?.awaiting) && (
          <p className="-mt-2 text-center text-sm text-cz-muted">
            {quickPriceCopy(current.offer && !current.offer.openRequest ? "supplier" : "open").next}
          </p>
        )}
        {current?.offer?.openRequest && (
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("addr-picker");
              el?.scrollIntoView({ block: "center", behavior: "smooth" });
              el?.focus();
            }}
            className={czButtonClass("ghost", "md")}
          >
            Change delivery location
          </button>
        )}
      </div>
    </DocketPanel>
  );
}

function PriceResult({ offer, quantity }: { offer: OfferResult; quantity: number }) {
  const breakdown = offerBreakdown(offer);
  return (
    <div className="rounded-xl border border-cz-border bg-cz-bg" aria-live="polite">
      <div className="px-4 pb-3 pt-4">
        <MoneyFigure label="Estimated price" estimate value={money(offer.offer)} size="xl" />
      </div>
      <div className="divide-y divide-cz-border border-t border-cz-border">
        <DocketRow label="Likely range">
          {money(offer.min)} to {money(offer.max)}
        </DocketRow>
        {breakdown && (
          <DocketRow label="Includes">
            Material about {money(breakdown.material)} + delivery about {money(breakdown.delivery)}
          </DocketRow>
        )}
        <DocketRow label="Load">
          {quantity} m³ {offer.label.toLowerCase()}
          {offer.tripCount > 1 && (
            <div className="text-xs text-cz-faint">About {offer.tripCount} trips</div>
          )}
        </DocketRow>
        {offer.resolvedSource && (
          <DocketRow
            label="Collected from"
            hint={`Listed supplier, about ${offer.distanceKm} km by road from your site`}
          >
            {offer.resolvedSource.supplierName}
          </DocketRow>
        )}
      </div>
      <p className="border-t border-cz-border px-4 py-3 text-sm leading-snug text-cz-muted">
        {quickPriceCopy("supplier").note}
      </p>
    </div>
  );
}

/** No listed supplier covers the point: an honest range, never a single "price". */
function GuideResult({ offer, quantity }: { offer: OfferResult; quantity: number }) {
  return (
    <div className="rounded-xl border border-cz-border bg-cz-bg" aria-live="polite">
      <div className="px-4 pt-4">
        <Notice tone="info" title="No fixed-price supplier nearby yet">
          Approved drivers can still send you their prices. They collect the material from their own
          source.
        </Notice>
      </div>
      <div className="px-4 pb-3 pt-4">
        <MoneyFigure
          label="Guide range"
          estimate
          value={`${money(offer.min)} to ${money(offer.max)}`}
          size="lg"
        />
      </div>
      <div className="divide-y divide-cz-border border-t border-cz-border">
        <DocketRow label="Load">
          {quantity} m³ {offer.label.toLowerCase()}
          {offer.tripCount > 1 && (
            <div className="text-xs text-cz-faint">About {offer.tripCount} trips</div>
          )}
        </DocketRow>
        <DocketRow label="Collected from">Driver arranges it</DocketRow>
      </div>
      <p className="border-t border-cz-border px-4 py-3 text-sm leading-snug text-cz-muted">
        The range covers hauls of {OPEN_REQUEST_HAUL_KM.low} to {OPEN_REQUEST_HAUL_KM.high} km,
        because the pickup isn't known yet. It isn't a quote: drivers set the final price, and
        availability is confirmed only when a driver accepts.
      </p>
    </div>
  );
}

/** Answers "where does the material come from?" before a price exists. */
function PickupExplainer() {
  return (
    <div className="rounded-xl bg-cz-surface-2 px-3.5 py-3 text-sm leading-snug">
      <div className="font-semibold">You don't need to choose a supplier</div>
      <p className="mt-0.5 text-cz-muted">
        Set where the load goes. We find a listed supplier near it and price the road trip. If none
        covers your area, drivers arrange the pickup.
      </p>
    </div>
  );
}

/** Looks like the address field; loads the map picker when used. */
function AddressPlaceholder({
  onOpen,
  onIntent,
  loading,
}: {
  onOpen?: () => void;
  onIntent?: () => void;
  loading?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold" id="deliver-to-label">
        Deliver to
      </div>
      <button
        type="button"
        onClick={onOpen}
        onPointerEnter={onIntent}
        onFocus={onIntent}
        disabled={loading}
        aria-labelledby="deliver-to-label"
        aria-describedby="deliver-to-hint"
        className="flex h-12 w-full items-center gap-2.5 rounded-md border border-cz-control bg-cz-surface px-3.5 text-left text-base text-cz-faint hover:bg-cz-surface-2"
      >
        {loading ? (
          <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <MapPin aria-hidden className="h-4 w-4 shrink-0" />
        )}
        <span id="deliver-to-hint" className="truncate">
          {loading ? "Loading the map…" : "Search address, suburb or landmark"}
        </span>
      </button>
    </div>
  );
}

function FocusAddressField() {
  useEffect(() => {
    document.getElementById("addr-picker")?.focus();
  }, []);
  return null;
}
