/**
 * ConZ "site docket" design-system components (see DESIGN.md).
 *
 * Presentation only: nothing here reads or writes data. Screens pass in values they
 * already have and callbacks that call the existing RPCs, so behaviour stays the same.
 */
import { useId, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleDot,
  Clock,
  Info,
  MapPin,
  PackageCheck,
  Truck,
  UserCheck,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TONE_CLASS,
  TONE_SOLID_CLASS,
  jobStamp,
  type Stamp,
  type StampIcon,
  type StampTone,
} from "@/lib/status-stamp";

/* ------------------------------------------------------------------ */
/* Status stamp                                                        */
/* ------------------------------------------------------------------ */

const STAMP_ICON: Record<StampIcon, LucideIcon> = {
  open: CircleDot,
  chosen: UserCheck,
  loaded: PackageCheck,
  truck: Truck,
  site: MapPin,
  done: CheckCircle2,
  cancelled: XCircle,
  problem: AlertTriangle,
  clock: Clock,
};

/** Icon + word + tone. Never colour alone. */
export function StatusStamp({
  tone = "neutral",
  icon,
  solid,
  children,
  className,
}: {
  tone?: StampTone;
  icon?: StampIcon | null;
  solid?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const Icon = icon ? STAMP_ICON[icon] : null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-[13px] font-semibold leading-none",
        solid ? TONE_SOLID_CLASS[tone] : TONE_CLASS[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={2.25} />}
      {children}
    </span>
  );
}

/** The stamp for a job row or header. */
export function JobStamp({
  job,
  className,
}: {
  job: Parameters<typeof jobStamp>[0];
  className?: string;
}) {
  const s: Stamp = jobStamp(job);
  return (
    <StatusStamp tone={s.tone} icon={s.icon} solid={s.solid} className={className}>
      {s.label}
    </StatusStamp>
  );
}

/* ------------------------------------------------------------------ */
/* Docket panel                                                        */
/* ------------------------------------------------------------------ */

/** A panel of ruled facts with an optional header strip (title, reference, stamp). */
export function DocketPanel({
  title,
  reference,
  stamp,
  action,
  children,
  footer,
  className,
  id,
  titleAs: TitleTag = "h3",
}: {
  title?: ReactNode;
  /** Heading level for the title, to fit the page outline. */
  titleAs?: "h1" | "h2" | "h3";
  reference?: ReactNode;
  stamp?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  id?: string;
}) {
  const hasHeader = title || reference || stamp || action;
  const titleId = useId();
  return (
    // No overflow clipping: menus inside (address search results) must be able to overflow.
    <section
      id={id}
      aria-labelledby={title ? titleId : undefined}
      className={cn("rounded-2xl border border-cz-border bg-cz-surface", className)}
    >
      {hasHeader && (
        <header className="flex items-center gap-3 border-b border-cz-border px-4 py-3">
          <div className="min-w-0 flex-1">
            {title && (
              <TitleTag id={titleId} className="truncate text-[15px] font-semibold text-cz-text">
                {title}
              </TitleTag>
            )}
            {reference && (
              <div className="truncate text-xs tabular-nums text-cz-faint">{reference}</div>
            )}
          </div>
          {stamp}
          {action}
        </header>
      )}
      <div className="divide-y divide-cz-border">{children}</div>
      {footer && <div className="border-t border-cz-border px-4 py-3">{footer}</div>}
    </section>
  );
}

/** One ruled label/value row inside a DocketPanel. */
export function DocketRow({
  label,
  children,
  hint,
  strong,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 px-4 py-3", className)}>
      <div
        className={cn("shrink-0 text-sm", strong ? "font-semibold text-cz-text" : "text-cz-muted")}
      >
        {label}
      </div>
      <div
        className={cn(
          "min-w-0 text-right text-sm tabular-nums text-cz-text",
          strong && "text-base font-semibold",
        )}
      >
        {children}
        {hint && <div className="text-xs font-normal text-cz-faint">{hint}</div>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/** A big tabular amount with its label, flagged when it is an estimate. */
export function MoneyFigure({
  value,
  label,
  estimate,
  size = "lg",
  className,
}: {
  value: ReactNode;
  label?: ReactNode;
  estimate?: boolean;
  size?: "md" | "lg" | "xl";
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {label && (
        <div className="flex items-center gap-1.5 text-sm text-cz-muted">
          {label}
          {estimate && (
            <span className="rounded-md bg-cz-surface-2 px-1.5 py-0.5 text-xs font-semibold text-cz-muted">
              Estimate
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          "cz-display font-bold leading-none tabular-nums text-cz-text",
          size === "md" ? "text-[26px]" : size === "lg" ? "text-[34px]" : "text-[44px]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Brand                                                               */
/* ------------------------------------------------------------------ */

/** The one header lockup: icon + "Con Z" + an optional role label. */
export function LogoLockup({
  role,
  to = "/",
  className,
}: {
  role?: string | null;
  to?: string;
  className?: string;
}) {
  return (
    <Link
      to={to as "/"}
      aria-label={role ? `Con Z ${role}, home` : "Con Z home"}
      className={cn("inline-flex min-h-11 items-center gap-2 rounded-lg", className)}
    >
      <img src="/conz-icon-192.png" alt="" width={32} height={32} className="h-8 w-8 rounded-lg" />
      <span className="cz-display text-[22px] font-bold leading-none text-cz-text">Con Z</span>
      {role && (
        <span className="rounded-md border border-cz-border-strong px-1.5 py-0.5 text-xs font-semibold text-cz-muted">
          {role}
        </span>
      )}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Choice chips                                                        */
/* ------------------------------------------------------------------ */

/**
 * Single-select chips (material, load size, filters, sort). Selected = raised neutral
 * with a check, never orange, so it cannot be mistaken for the main action.
 */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  label,
  scroll = false,
  className,
}: {
  options: { value: T; label: ReactNode; hint?: ReactNode }[];
  value: T | null;
  onChange: (v: T) => void;
  label: string;
  scroll?: boolean;
  className?: string;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value ?? ""}
      onValueChange={(v) => v && onChange(v as T)}
      aria-label={label}
      className={cn(
        "flex gap-2",
        scroll ? "cz-no-scrollbar -mx-4 overflow-x-auto px-4" : "flex-wrap",
        className,
      )}
    >
      {options.map((o) => (
        <ToggleGroupPrimitive.Item
          key={o.value}
          value={o.value}
          className={cn(
            "group inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-cz-border-strong bg-cz-surface px-3.5 text-sm font-semibold text-cz-text transition-colors",
            "hover:bg-cz-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cz-text focus-visible:ring-offset-2 focus-visible:ring-offset-cz-bg",
            "data-[state=on]:border-cz-text data-[state=on]:bg-cz-surface-2 data-[state=on]:shadow-[inset_0_0_0_1px_var(--cz-text)]",
          )}
        >
          <Check
            aria-hidden
            className="hidden h-4 w-4 shrink-0 group-data-[state=on]:block"
            strokeWidth={2.5}
          />
          <span>{o.label}</span>
          {o.hint && <span className="text-xs font-normal text-cz-muted">{o.hint}</span>}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/* ------------------------------------------------------------------ */
/* Notice                                                              */
/* ------------------------------------------------------------------ */

const NOTICE_ICON: Record<"info" | "success" | "warning" | "danger", LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertTriangle,
};

/** Inline message with an icon. Dismissible only when the caller passes onDismiss. */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  onDismiss,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const Icon = NOTICE_ICON[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-xl px-4 py-3 text-sm leading-snug",
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && "mt-0.5", "text-cz-text/90")}>{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

/**
 * Steps a delivery has passed. Only ticks what the caller knows happened
 * (`done` counts from the first step); never a guess at what comes next.
 */
export function Milestones({
  steps,
  done,
  label,
  className,
}: {
  steps: string[];
  done: number;
  label: string;
  className?: string;
}) {
  return (
    <ol aria-label={label} className={cn("flex items-start", className)}>
      {steps.map((step, i) => {
        const isDone = i < done;
        const isLatest = isDone && i === done - 1;
        return (
          <li
            key={step}
            aria-current={isLatest ? "step" : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center"
          >
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "absolute right-1/2 top-[11px] h-0.5 w-full",
                  isDone ? "bg-cz-green-text" : "bg-cz-border-strong",
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2",
                isDone
                  ? "border-cz-green-text bg-cz-green-text text-cz-surface"
                  : "border-cz-border-strong bg-cz-surface",
              )}
            >
              {isDone && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
            </span>
            <span
              className={cn(
                "px-0.5 text-xs leading-tight",
                isDone ? "font-semibold text-cz-text" : "text-cz-muted",
              )}
            >
              {step}
              <span className="sr-only">{isDone ? ", done" : ", not yet"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
