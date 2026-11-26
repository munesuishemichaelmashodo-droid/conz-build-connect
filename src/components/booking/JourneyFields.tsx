import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { JOURNEYS, LIMITS, TRUCKS, type JourneyInput } from "@/lib/booking-journey";

/** The journey choice (shown first) — two large options, one must be picked. */
export function JourneyChoice({
  value,
  onChange,
}: {
  value: JourneyInput;
  onChange: (next: JourneyInput) => void;
}) {
  return (
    <fieldset className="space-y-2" data-testid="journey-choice">
      <legend className="cz-display mb-1 text-[22px] font-bold leading-tight">
        What do you need?
      </legend>
      {JOURNEYS.map((j) => {
        const active = value.kind === j.value;
        return (
          <label
            key={j.value}
            className={cn(
              "flex min-h-14 cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3",
              active
                ? "border-primary bg-primary/5 shadow-[inset_0_0_0_1px_var(--color-primary)]"
                : "border-cz-border bg-cz-surface",
            )}
          >
            <input
              type="radio"
              name="journey"
              value={j.value}
              checked={active}
              onChange={() => onChange({ ...value, kind: j.value })}
              className="mt-1 h-4 w-4 accent-[var(--color-primary)]"
            />
            <span className="min-w-0">
              <span className="block font-semibold">{j.title}</span>
              <span className="block text-[13px] text-cz-muted">{j.body}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** What is being moved, and the truck it needs (both journeys). */
export function LoadFields({
  value,
  onChange,
}: {
  value: JourneyInput;
  onChange: (next: JourneyInput) => void;
}) {
  return (
    <div
      className="space-y-3 rounded-xl border border-cz-border bg-cz-surface p-3.5"
      data-testid="load-fields"
    >
      <div>
        <Label htmlFor="load-description">What are you moving? (optional)</Label>
        <Input
          id="load-description"
          value={value.loadDescription}
          maxLength={LIMITS.description}
          placeholder="e.g. 2,000 bricks, roofing sheets, river sand"
          onChange={(e) => onChange({ ...value, loadDescription: e.target.value })}
          className="min-h-11"
        />
      </div>
      <div>
        <Label htmlFor="load-details">Weight, size or other details (optional)</Label>
        <Input
          id="load-details"
          value={value.loadDetails}
          maxLength={LIMITS.details}
          placeholder="e.g. about 6 tonnes, sheets 3.6 m long"
          onChange={(e) => onChange({ ...value, loadDetails: e.target.value })}
          className="min-h-11"
        />
      </div>
      <div>
        <Label htmlFor="truck">Truck needed</Label>
        <select
          id="truck"
          value={value.truck}
          onChange={(e) => onChange({ ...value, truck: e.target.value as JourneyInput["truck"] })}
          className="mt-1 h-11 w-full rounded-md border bg-background px-2"
        >
          {TRUCKS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Supplier / shop details (collect-and-deliver only). Shown to the selected driver only. */
export function CollectionFields({
  value,
  onChange,
}: {
  value: JourneyInput;
  onChange: (next: JourneyInput) => void;
}) {
  return (
    <div className="space-y-3" data-testid="collection-fields">
      <div>
        <Label htmlFor="collection-name">Supplier, shop or place name</Label>
        <Input
          id="collection-name"
          value={value.collectionName}
          maxLength={LIMITS.name}
          placeholder="e.g. Halsted Builders, Msasa"
          onChange={(e) => onChange({ ...value, collectionName: e.target.value })}
          className="min-h-11"
          aria-required
        />
      </div>
      <div>
        <Label htmlFor="collection-contact">Contact at collection (optional)</Label>
        <Input
          id="collection-contact"
          value={value.collectionContact}
          maxLength={LIMITS.contact}
          placeholder="Name and phone of the person releasing the order"
          onChange={(e) => onChange({ ...value, collectionContact: e.target.value })}
          className="min-h-11"
        />
      </div>
      <div>
        <Label htmlFor="collection-reference">Order or collection reference (optional)</Label>
        <Input
          id="collection-reference"
          value={value.collectionReference}
          maxLength={LIMITS.reference}
          placeholder="e.g. invoice or order number"
          onChange={(e) => onChange({ ...value, collectionReference: e.target.value })}
          className="min-h-11"
        />
      </div>
      <p className="text-[13px] text-cz-muted">
        Only the driver you choose sees the contact and reference. You arrange and pay for the
        materials with the supplier; Con Z arranges the transport.
      </p>
    </div>
  );
}
