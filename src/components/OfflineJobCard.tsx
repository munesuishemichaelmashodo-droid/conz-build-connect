import { useState } from "react";
import { Check, Copy, MapPin, Navigation2, Phone, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { cardCopy, navLinks, type OfflineCard } from "@/lib/offline-card";
import { telLink } from "@/lib/tel-link";

/**
 * What a driver (or customer) sees for a delivery when the job cannot load: the details saved on this phone while there
 * was signal. A call needs voice, not data, so the number works with no data at all.
 */
export function OfflineJobCard({ card, pin = null }: { card: OfflineCard; pin?: string | null }) {
  const copy = cardCopy(card);
  const links = navLinks(card);
  const call = telLink(card.contactPhone);
  const [copied, setCopied] = useState(false);
  const copyPoint = async () => {
    try {
      await navigator.clipboard.writeText(copy.coordinates);
      setCopied(true);
      toast.success("Position copied");
    } catch {
      toast.error(`Couldn't copy. The position is ${copy.coordinates}`);
    }
  };
  return (
    <section
      aria-label="Saved delivery details"
      className="space-y-3 rounded-2xl border border-cz-border bg-cz-surface p-4"
    >
      <div role="status" className="flex items-start gap-2 text-sm text-cz-muted">
        <WifiOff aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-semibold text-cz-text">
            No signal. Showing what is saved on this phone.
          </div>
          <div>{copy.saved}</div>
        </div>
      </div>
      <div>
        <div className="font-semibold">{card.title}</div>
        {card.deliveryAddress && (
          <div className="mt-1 flex items-start gap-2 text-sm">
            <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{card.deliveryAddress}</span>
          </div>
        )}
        <div className="mt-1 text-sm text-cz-muted">{copy.coordinates}</div>
        {card.notes && (
          <p className="mt-2 border-t border-cz-border pt-2 text-sm text-cz-muted">{card.notes}</p>
        )}
      </div>
      {card.role === "customer" && pin && (
        <div className="rounded-xl border border-cz-border bg-cz-surface-2 p-3">
          <div className="text-[13px] text-cz-muted">Your delivery PIN</div>
          <div className="font-display text-3xl font-bold tracking-[0.2em] tabular-nums">{pin}</div>
          <p className="mt-1 text-[13px] text-cz-muted">{copy.pinHelp}</p>
        </div>
      )}
      <div className="space-y-2">
        {call && (
          <a
            href={call}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cz-amber px-4 text-[17px] font-bold text-cz-amber-ink"
          >
            <Phone className="h-5 w-5" /> Call{" "}
            {card.contactName ?? (card.role === "driver" ? "the customer" : "your driver")}
          </a>
        )}
        {card.role === "driver" && links.geo && (
          <a
            href={links.geo}
            className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-cz-border-strong px-4 text-[15px] font-semibold"
          >
            <Navigation2 className="h-4 w-4" /> Open in a maps app
          </a>
        )}
        {card.role === "driver" && card.lat != null && (
          <button
            type="button"
            onClick={copyPoint}
            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-cz-muted"
          >
            <Copy className="h-4 w-4" /> {copied ? "Position copied" : "Copy position"}
          </button>
        )}
      </div>
    </section>
  );
}

/** A small, quiet confirmation on the active job screen that the delivery details are saved on this phone. */
export function ReadyOfflineChip() {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-cz-border bg-cz-surface px-3 py-1.5 text-[13px] text-cz-muted">
      <Check aria-hidden className="h-3.5 w-3.5 text-cz-green" />
      <span>
        <span className="font-semibold text-cz-text">Ready offline.</span> Drop-off and customer's
        number saved on this phone.
      </span>
    </div>
  );
}
