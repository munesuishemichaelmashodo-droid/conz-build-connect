/**
 * Signature visual motif for Con Z's v1.1 pass: a dashed route line, since
 * live tracking is literally the product. Used as a low-opacity background
 * texture on hero/dashboard cards and empty states — never as a standalone
 * illustration. Uses the app's existing primary color token so it adapts
 * automatically between light and dark mode.
 *
 * Keep `animate` limited to one instance per screen (the truck marker adds
 * a continuous SMIL animation) — this app targets low-end Android on slow
 * networks, so we don't want several animated SVGs competing for a frame.
 */
export function RouteLine({
  opacity = 0.15,
  dash = "5 9",
  animate = false,
  className = "",
}: {
  opacity?: number;
  dash?: string;
  animate?: boolean;
  className?: string;
}) {
  const path = "M -20 90 Q 100 20 200 60 T 420 40";
  return (
    <svg
      viewBox="0 0 400 120"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity, pointerEvents: "none" }}
    >
      <path
        d={path}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="2"
        strokeDasharray={dash}
        strokeLinecap="round"
      />
      {animate && (
        <circle r="4" fill="var(--color-primary)">
          <animateMotion dur="7s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </svg>
  );
}
