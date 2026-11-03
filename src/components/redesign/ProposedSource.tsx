import { offerMessageParts } from "@/lib/proposed-source";

/**
 * The driver's proposed loading point and note from an offer message. The source is
 * always labelled as the driver's choice, not checked by Con Z. Text is rendered as
 * React text, never as HTML.
 */
export function OfferMessage({
  message,
  driverArranged,
  noteClassName = "text-sm text-cz-muted",
}: {
  message: string | null | undefined;
  driverArranged: boolean;
  noteClassName?: string;
}) {
  const { source, note } = offerMessageParts(message, driverArranged);
  if (!source && !note) return null;
  return (
    <>
      {source && (
        <p className="text-sm" data-testid="proposed-source">
          <span className="text-cz-muted">Loads at: </span>
          <span className="font-semibold break-words">{source}</span>
          <span className="block text-[12px] text-cz-muted">
            The driver's choice, not checked by Con Z.
          </span>
        </p>
      )}
      {note && <p className={`${noteClassName} break-words`}>"{note}"</p>}
    </>
  );
}
