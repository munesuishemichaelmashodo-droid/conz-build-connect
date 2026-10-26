import { Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { materialPhoto } from "@/lib/material-media";

/**
 * A small example photo of a material, beside its name. Decorative (alt=""): the
 * name next to it says what it is. Custom materials get a neutral icon.
 */
export function MaterialThumb({
  material,
  size = 32,
  className,
}: {
  material: string | null | undefined;
  size?: 20 | 28 | 32 | 44;
  className?: string;
}) {
  const photo = materialPhoto(material);
  const box = cn("shrink-0 overflow-hidden rounded-md bg-cz-surface-2", className);
  if (!photo) {
    return (
      <span
        aria-hidden
        className={cn(box, "flex items-center justify-center text-cz-muted")}
        style={{ width: size, height: size }}
      >
        <Package className="h-1/2 w-1/2" />
      </span>
    );
  }
  return (
    <img
      src={photo.src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={cn(box, "object-cover")}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * A Con Z tipper unloading sand, drawn (not a photograph of a real truck). Decorative;
 * the colours follow the theme through the .cz-tipper variables in styles.css.
 */
export function TipperIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 260"
      aria-hidden
      focusable="false"
      className={cn("cz-tipper block h-auto w-full", className)}
    >
      <rect x="0" y="226" width="640" height="3" rx="1.5" fill="var(--tipper-ground)" />
      <g fill="var(--tipper-ground)">
        <rect x="300" y="240" width="46" height="3" rx="1.5" />
        <rect x="386" y="240" width="46" height="3" rx="1.5" />
        <rect x="472" y="240" width="46" height="3" rx="1.5" />
        <rect x="558" y="240" width="46" height="3" rx="1.5" />
      </g>
      <path d="M18 227 C 48 178, 92 150, 128 150 C 160 150, 196 182, 214 227 Z" fill="#d9a865" />
      <path d="M60 227 C 82 196, 104 182, 126 182 C 150 182, 170 200, 184 227 Z" fill="#c89150" />
      <g fill="#c89150">
        <circle cx="176" cy="132" r="3.2" />
        <circle cx="166" cy="146" r="2.6" />
        <circle cx="184" cy="150" r="2.4" />
        <circle cx="158" cy="160" r="2.2" />
        <circle cx="190" cy="168" r="2" />
      </g>
      <rect x="188" y="190" width="372" height="14" rx="4" fill="var(--tipper-ink)" />
      <path d="M312 192 L 356 132" stroke="#8a827c" strokeWidth="9" strokeLinecap="round" />
      <path d="M312 192 L 334 162" stroke="#5b534d" strokeWidth="12" strokeLinecap="round" />
      <g transform="rotate(-22 196 188)">
        <path
          d="M196 188 L 196 112 Q 196 104 204 104 L 430 104 Q 438 104 438 112 L 438 188 Z"
          fill="#ff7716"
        />
        <path d="M204 104 L 430 104 L 426 96 L 208 96 Z" fill="#d9600a" />
        <rect x="214" y="122" width="206" height="8" rx="4" fill="#d9600a" />
        <rect x="214" y="150" width="206" height="8" rx="4" fill="#d9600a" />
        <path d="M196 112 L 186 118 L 186 188 L 196 188 Z" fill="#c2550a" />
        <path d="M206 104 C 250 84, 330 80, 428 102 Z" fill="#d9a865" />
      </g>
      <path
        d="M450 190 L 450 120 Q 450 110 460 110 L 520 110 Q 532 110 538 120 L 566 168 Q 570 176 570 184 L 570 190 Z"
        fill="#ff7716"
      />
      <path d="M470 122 L 516 122 Q 522 122 526 128 L 546 162 L 470 162 Z" fill="#dce9f2" />
      <path
        d="M470 122 L 516 122 Q 522 122 526 128 L 546 162 L 470 162 Z"
        fill="none"
        stroke="var(--tipper-ink)"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <rect x="456" y="170" width="20" height="6" rx="3" fill="#d9600a" />
      <rect x="556" y="176" width="16" height="10" rx="3" fill="#f2c14e" />
      <rect x="440" y="96" width="8" height="34" rx="3" fill="#5b534d" />
      {[252, 308, 512].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="208" r="24" fill="var(--tipper-ink)" />
          <circle cx={cx} cy="208" r="10" fill="#b8b0a8" />
        </g>
      ))}
      <path
        d="M222 192 Q 280 166 338 192"
        fill="none"
        stroke="var(--tipper-ink)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M484 192 Q 512 174 540 192"
        fill="none"
        stroke="var(--tipper-ink)"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  );
}
