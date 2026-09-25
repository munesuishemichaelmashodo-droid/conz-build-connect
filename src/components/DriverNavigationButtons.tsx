"use client";

type Point = {
  lat: number | null | undefined;
  lng: number | null | undefined;
};

type DriverNavigationButtonsProps = {
  pickup: Point;
  dropoff: Point;
  pickupLabel?: string;
  dropoffLabel?: string;
};
function hasPoint(point: Point) {
  return (
    typeof point.lat === "number" &&
    typeof point.lng === "number" &&
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng)
  );
}


function googleNavigateTo(point: Point) {
  return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}&travelmode=driving`;
}

function googlePickupToDropoff(pickup: Point, dropoff: Point) {
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&origin=${pickup.lat},${pickup.lng}` +
    `&destination=${dropoff.lat},${dropoff.lng}` +
    `&travelmode=driving`
  );
}

function wazeNavigateTo(point: Point) {
  return `https://waze.com/ul?ll=${point.lat},${point.lng}&navigate=yes`;
}

function defaultPhoneMap(point: Point, label = "Con Z location") {
  return `geo:${point.lat},${point.lng}?q=${point.lat},${point.lng}(${encodeURIComponent(label)})`;
}

function openStreetMapPoint(point: Point) {
  return `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lng}#map=17/${point.lat}/${point.lng}`;
}

function NavButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center min-h-11 rounded-full border border-border bg-secondary px-4 py-2 text-sm font-bold text-secondary-foreground hover:border-primary"
    >
      {children}
    </a>
  );
}

export function DriverNavigationButtons({
  pickup,
  dropoff,
  pickupLabel = "Pickup",
  dropoffLabel = "Drop-off",
}: DriverNavigationButtonsProps) {
  const hasPickup = hasPoint(pickup);
  const hasDropoff = hasPoint(dropoff);

  if (!hasPickup && !hasDropoff) {
    return (
      <div className="mt-3 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
        No GPS coordinates saved for this job yet.
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {hasPickup && (
        <NavButton href={googleNavigateTo(pickup)}>
          Google Maps to pickup
        </NavButton>
      )}

      {hasDropoff && (
        <NavButton href={googleNavigateTo(dropoff)}>
          Google Maps to drop-off
        </NavButton>
      )}

      {hasPickup && hasDropoff && (
        <NavButton href={googlePickupToDropoff(pickup, dropoff)}>
          Route pickup → drop-off
        </NavButton>
      )}

      {hasDropoff && (
        <NavButton href={wazeNavigateTo(dropoff)}>
          Waze
        </NavButton>
      )}

      {hasDropoff && (
        <NavButton href={defaultPhoneMap(dropoff, dropoffLabel)}>
          Phone GPS app
        </NavButton>
      )}

      {hasDropoff && (
        <NavButton href={openStreetMapPoint(dropoff)}>
          OpenStreetMap
        </NavButton>
      )}

      {hasDropoff && (
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(`${dropoff.lat}, ${dropoff.lng}`);
            alert("Drop-off coordinates copied");
          }}
          className="inline-flex items-center min-h-11 rounded-full border border-border px-4 py-2 text-sm font-bold text-foreground hover:bg-muted"
        >
          Copy coordinates
        </button>
      )}
    </div>
  );
}
