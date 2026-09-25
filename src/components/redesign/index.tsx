/**
 * Shared building blocks for the driver / customer mode redesign.
 *
 * Presentation only: nothing in this file reads or writes data. Screens
 * pass in values they already fetch and callbacks that call the existing
 * RPCs/mutations, so the data flow of every screen stays exactly as it was.
 * All of these expect to be rendered inside a `.cz-screen` wrapper (see
 * styles.css), which supplies the dark palette.
 */
import type { ComponentProps, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/** "$165" for whole dollars, "$153.45" otherwise — the redesign's money
 *  format. (The rest of the app keeps using domain.ts's `money`.) */
export function usd(n: number | null | undefined) {
  const v = Number(n ?? 0);
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/** Always two decimals — for receipts and fee breakdowns. */
export function usd2(n: number | null | undefined) {
  return `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/** Full-height dark screen. Centered and capped at phone width on larger
 *  displays so the layout never stretches. */
export function CzScreen({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={cn("cz-screen min-h-[100dvh] w-full", className)}>
      <div className="mx-auto w-full max-w-[480px] min-h-[100dvh] flex flex-col">{children}</div>
    </div>
  );
}

/** Back button + title row used at the top of sub-screens. */
export function CzHeader({
  title,
  onBack,
  backTo,
  right,
  subtitle,
}: {
  title: ReactNode;
  onBack?: () => void;
  backTo?: string;
  right?: ReactNode;
  subtitle?: ReactNode;
}) {
  const backCls =
    "w-11 h-11 -ml-1 shrink-0 flex items-center justify-center rounded-xl text-cz-text hover:bg-cz-surface active:bg-cz-surface-2";
  return (
    <header className="flex items-center gap-2 px-3 pt-3 pb-2">
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Back" className={backCls}>
          <ArrowLeft className="w-5 h-5" />
        </button>
      ) : backTo ? (
        <Link to={backTo as "/jobs"} aria-label="Back" className={backCls}>
          <ArrowLeft className="w-5 h-5" />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="cz-display font-bold text-2xl leading-tight truncate">{title}</h1>
        {subtitle && <div className="text-sm text-cz-muted truncate">{subtitle}</div>}
      </div>
      {right}
    </header>
  );
}

/** Rounded-top sheet with a drag-handle bar. Purely visual (it doesn't
 *  drag) — it's how the redesign separates a map from the controls. */
export function BottomSheet({
  children,
  className,
  handle = true,
  id,
}: {
  children: ReactNode;
  className?: string;
  handle?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "relative z-10 -mt-6 rounded-t-[24px] bg-cz-bg px-5 pb-6 shadow-[0_-8px_30px_rgba(0,0,0,0.45)]",
        handle ? "pt-2.5" : "pt-5",
        className,
      )}
    >
      {handle && <div aria-hidden className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-cz-border-strong" />}
      {children}
    </section>
  );
}

/** Card surface. */
export function CzCard({ children, className, selected, id }: { children: ReactNode; className?: string; selected?: boolean; id?: string }) {
  return (
    <div
      id={id}
      className={cn(
        "rounded-[18px] border bg-cz-surface p-4",
        selected ? "border-cz-amber bg-cz-amber-tint" : "border-cz-border",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type BtnKind = "primary" | "secondary" | "danger" | "ghost" | "success";

const BTN: Record<BtnKind, string> = {
  primary: "bg-cz-amber text-cz-amber-ink hover:brightness-105 active:brightness-95 font-bold",
  secondary: "border-[1.5px] border-cz-amber text-cz-amber hover:bg-cz-amber-tint font-bold",
  danger: "border border-cz-danger-border text-cz-danger-text hover:bg-cz-warn-tint font-semibold",
  ghost: "border border-cz-border-strong text-cz-text hover:bg-cz-surface font-semibold",
  success: "bg-cz-green text-[#0b2416] hover:brightness-105 font-bold",
};

export function czButtonClass(kind: BtnKind = "primary", size: "lg" | "md" | "sm" = "lg", extra?: string) {
  return cn(
    "inline-flex w-full items-center justify-center gap-2 rounded-[14px] px-4 text-center transition disabled:opacity-50 disabled:pointer-events-none select-none",
    size === "lg" ? "min-h-14 text-[17px]" : size === "md" ? "min-h-12 text-[15px] rounded-xl" : "min-h-11 text-sm rounded-xl",
    BTN[kind],
    extra,
  );
}

export function CzButton({
  kind = "primary",
  size = "lg",
  className,
  ...props
}: ComponentProps<"button"> & { kind?: BtnKind; size?: "lg" | "md" | "sm" }) {
  return <button type="button" {...props} className={czButtonClass(kind, size, className)} />;
}

/** Square 44px icon button (chat / call / locate). */
export function IconButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "relative w-11 h-11 shrink-0 rounded-xl border border-cz-border-strong text-cz-text flex items-center justify-center hover:bg-cz-surface-2 disabled:opacity-40",
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

type PillTone = "green" | "amber" | "neutral" | "info";

const PILL: Record<PillTone, string> = {
  green: "bg-cz-green-tint text-cz-green-text border-cz-green-border",
  amber: "bg-cz-amber-tint-2 text-cz-amber-text border-transparent",
  neutral: "bg-cz-bg text-cz-text border-cz-border",
  info: "bg-cz-info-tint text-cz-info-text border-transparent",
};
const DOT: Record<PillTone, string> = {
  green: "bg-cz-green",
  amber: "bg-cz-amber",
  neutral: "bg-cz-muted",
  info: "bg-cz-info-text",
};

/** "Live" / "Online" / "Finding drivers" pill with an optional blinking dot. */
export function StatusPill({
  tone = "neutral",
  dot = false,
  blink = false,
  icon,
  children,
  className,
}: {
  tone?: PillTone;
  dot?: boolean;
  blink?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap",
        PILL[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className={cn("w-2 h-2 rounded-full", DOT[tone], blink && "cz-blink")} />}
      {icon}
      {children}
    </span>
  );
}

/** Material badge, e.g. "River sand · 10 m³". */
export function MaterialBadge({ children, highlight = true }: { children: ReactNode; highlight?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-semibold",
        highlight ? "bg-cz-amber-tint-2 text-cz-amber-text" : "bg-cz-border text-[#d6d4cf]",
      )}
    >
      {children}
    </span>
  );
}

/** Tinted hint box. */
export function HintBox({ tone, icon, children }: { tone: "info" | "green" | "warn"; icon?: ReactNode; children: ReactNode }) {
  const cls =
    tone === "info"
      ? "bg-cz-info-tint text-cz-info-text"
      : tone === "green"
        ? "bg-cz-green-tint text-cz-green-text border border-cz-green-border"
        : "bg-cz-warn-tint text-cz-warn-text";
  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm leading-snug", cls)}>
      {icon && <span className="shrink-0 mt-0.5">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step progress                                                       */
/* ------------------------------------------------------------------ */

export const DELIVERY_STEPS = ["Pickup", "Load", "Deliver", "PIN"] as const;

/**
 * The 4-segment Pickup · Load · Deliver · PIN bar. Used by BOTH the
 * driver's active job and the customer's tracking screen so the two always
 * show the same thing for the same job. `current` is 0–3; pass 4 for
 * "everything done".
 */
export function StepProgress({ current, labels = DELIVERY_STEPS }: { current: number; labels?: readonly string[] }) {
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label={`Step ${Math.min(current + 1, labels.length)} of ${labels.length}`}>
      {labels.map((l, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={l} className="flex flex-col gap-1.5" aria-current={now ? "step" : undefined}>
            <span
              aria-hidden
              className={cn("h-[5px] rounded-full", done ? "bg-cz-green" : now ? "bg-cz-amber" : "bg-cz-upcoming")}
            />
            <span className={cn("text-xs font-semibold", done || now ? "text-cz-text" : "text-cz-faint")}>{l}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/** Big amber number with round −/+ buttons. */
export function PriceStepper({
  value,
  onDec,
  onInc,
  caption,
  decLabel = "Lower price",
  incLabel = "Raise price",
  decDisabled,
  incDisabled,
  display,
}: {
  value: number;
  onDec: () => void;
  onInc: () => void;
  caption?: ReactNode;
  decLabel?: string;
  incLabel?: string;
  decDisabled?: boolean;
  incDisabled?: boolean;
  display?: ReactNode;
}) {
  const round =
    "w-[60px] h-[60px] shrink-0 rounded-full border-[1.5px] border-cz-border-strong bg-cz-surface text-cz-text flex items-center justify-center active:bg-cz-surface-2 disabled:opacity-35";
  return (
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={onDec} aria-label={decLabel} disabled={decDisabled} className={round}>
        <Minus className="w-6 h-6" />
      </button>
      <div className="flex flex-col items-center min-w-0">
        <span className="cz-display font-bold text-[64px] leading-none text-cz-amber tabular-nums" aria-live="polite">
          {display ?? usd(value)}
        </span>
        {caption && <span className="mt-1 text-[13px] text-cz-muted">{caption}</span>}
      </div>
      <button type="button" onClick={onInc} aria-label={incLabel} disabled={incDisabled} className={round}>
        <Plus className="w-6 h-6" />
      </button>
    </div>
  );
}

/** Horizontally scrolling (or wrapping) single-select chips. */
export function MaterialChips<T extends string>({
  options,
  value,
  onChange,
  scroll = true,
  size = "md",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  scroll?: boolean;
  size?: "md" | "sm";
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "flex gap-2",
        scroll ? "overflow-x-auto cz-no-scrollbar -mx-5 px-5" : "flex-wrap",
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full px-4 font-semibold transition",
              size === "md" ? "min-h-11 text-sm" : "min-h-9 text-sm px-3.5",
              on ? "bg-cz-amber text-cz-amber-ink font-bold" : "border border-[#33353b] bg-cz-surface text-cz-text",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Label / value row for money breakdowns. */
export function MoneyRow({
  label,
  value,
  strong,
  valueClassName,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", strong ? "text-base font-bold" : "text-[15px]")}>
      <span className={strong ? "text-cz-text" : "text-cz-muted"}>{label}</span>
      <span className={cn("tabular-nums text-right", valueClassName)}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export function initials(name: string | null | undefined, fallback = "?") {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

export function InitialsAvatar({ name, src, size = 42, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
  return (
    <span
      className={cn("shrink-0 rounded-full bg-cz-border flex items-center justify-center font-bold overflow-hidden", className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : initials(name)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Route graphic                                                       */
/* ------------------------------------------------------------------ */

/** Pickup → drop-off with the small dot / line / square graphic. */
export function RouteStops({
  pickupLabel,
  pickupHint,
  dropLabel,
  dropHint,
}: {
  pickupLabel: ReactNode;
  pickupHint?: ReactNode;
  dropLabel: ReactNode;
  dropHint?: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div aria-hidden className="flex flex-col items-center pt-[5px]">
        <span className="w-2.5 h-2.5 rounded-full border-2 border-cz-amber" />
        <span className="w-0.5 flex-1 min-h-[26px] bg-cz-border-strong" />
        <span className="w-2.5 h-2.5 bg-cz-text" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-3.5">
        <div className="min-w-0">
          <div className="text-xs text-cz-muted">{pickupHint ?? "Pickup"}</div>
          <div className="text-base font-semibold truncate">{pickupLabel}</div>
        </div>
        <div className="min-w-0">
          <div className="text-xs text-cz-muted">{dropHint ?? "Drop-off"}</div>
          <div className="text-base font-semibold truncate">{dropLabel}</div>
        </div>
      </div>
    </div>
  );
}

/** Straight-line distance, km. Display-only ("about N km apart") — never
 *  used for pricing, which stays entirely server-side. */
export function straightKm(
  a: { lat: number | null | undefined; lng: number | null | undefined },
  b: { lat: number | null | undefined; lng: number | null | undefined },
): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** "2 min ago" / "3 h ago" / "4 d ago". */
export function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** First "area" part of an address: "12 Hill Rd, Borrowdale, Harare" → "Borrowdale". */
export function areaOf(address: string | null | undefined) {
  const parts = (address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 2];
  return parts[0] ?? "";
}

/** Short job reference shown on the active job / receipt screens. Matches
 *  the receipt number format used by pod.functions (CONZ-XXXXXXXX). */
export function jobRef(id: string) {
  return `CONZ-${id.slice(0, 8).toUpperCase()}`;
}
