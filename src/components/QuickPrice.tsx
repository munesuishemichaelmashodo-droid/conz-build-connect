import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MapPin } from "lucide-react";
import { czButtonClass } from "@/components/redesign";
import { ChoiceChips, DocketPanel, DocketRow, MoneyFigure, Notice } from "@/components/ds";
import { LoadPicker } from "@/components/ds/load-picker";
import { MATERIALS, money, type MaterialCategory } from "@/lib/domain";
import { isValidQuantity } from "@/lib/load-size";
import {
  computePublicOffer,
  type AwaitingSourcingResult,
  type OfferResult,
} from "@/lib/booking.functions";
import {
  quickPriceBookingPath,
  quickPriceErrorMessage,
  quickPriceSignature,
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
}));

/**
 * Anonymous price check (homepage and /quote). Uses computePublicOffer (computePublicOffer: verified supplier, road distance and
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
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    sig: string;
    offer?: OfferResult;
    awaiting?: AwaitingSourcingResult;
    error?: string;
  } | null>(null);

  const sig = quickPriceSignature({ material, quantity, coords });
  // A result only stays on screen while the inputs still match it.
  const current = result && result.sig === sig ? result : null;
  const bookPath = coords
    ? quickPriceBookingPath({ material, quantity, address, coords })
    : "/customer/book";

  const checkPrice = async () => {
    if (!coords || loading || !isValidQuantity(quantity)) return;
    setLoading(true);
    try {
      const r = await runOffer({
        data: { material, quantity, deliveryLat: coords.lat, deliveryLng: coords.lng, address },
      });
      setResult(r.status === "awaiting_sourcing" ? { sig, awaiting: r } : { sig, offer: r });
    } catch (error) {
      setResult({
        sig,
        error: quickPriceErrorMessage(error, typeof navigator !== "undefined" && !navigator.onLine),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <DocketPanel title="Check a price" titleAs={titleAs} reference="No account needed">
      <div className="space-y-5 px-4 py-4">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Material</legend>
          <ChoiceChips
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

        {current?.error && <Notice tone="danger">{current.error}</Notice>}

        {current?.awaiting && (
          <Notice tone="info" title="No listed supplier for this yet">
            {current.awaiting.message}
          </Notice>
        )}

        {current?.offer && <PriceResult offer={current.offer} quantity={quantity} />}

        {current?.offer || current?.awaiting ? (
          <Link
            to="/auth"
            search={{ mode: "register", role: "customer", next: bookPath } as never}
            className={czButtonClass("primary")}
          >
            {current.offer ? "Book this delivery" : "Sign up to request it"}
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
            ) : (
              "See price"
            )}
          </button>
        )}
        {!coords && !current && (
          <p className="-mt-2 text-center text-sm text-cz-muted">
            Set the delivery point to see a price.
          </p>
        )}
      </div>
    </DocketPanel>
  );
}

function PriceResult({ offer, quantity }: { offer: OfferResult; quantity: number }) {
  return (
    <div className="rounded-xl border border-cz-border bg-cz-bg" aria-live="polite">
      <div className="px-4 pb-3 pt-4">
        <MoneyFigure label="Estimated price" estimate value={money(offer.offer)} size="xl" />
      </div>
      <div className="divide-y divide-cz-border border-t border-cz-border">
        <DocketRow label="Likely range">
          {money(offer.min)} to {money(offer.max)}
        </DocketRow>
        <DocketRow label="Load">
          {quantity} m³ {offer.label.toLowerCase()}
          {offer.tripCount > 1 && (
            <div className="text-xs text-cz-faint">About {offer.tripCount} trips</div>
          )}
        </DocketRow>
        {offer.resolvedSource && (
          <DocketRow label="Collected from" hint={`About ${offer.distanceKm} km away`}>
            {offer.resolvedSource.supplierName}
          </DocketRow>
        )}
      </div>
      <p className="border-t border-cz-border px-4 py-3 text-sm leading-snug text-cz-muted">
        Drivers send their own offers, so the price you accept can differ. You see each total before
        you accept.
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
