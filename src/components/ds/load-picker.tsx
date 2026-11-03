import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isValidQuantity,
  LOAD_PRESETS_M3,
  loadHint,
  MAX_QUANTITY_M3,
  MIN_QUANTITY_M3,
  stepQuantity,
} from "@/lib/load-size";
import { ChoiceChips } from "@/components/ds";

/**
 * The one load-size control (homepage, /quote, booking): stepper, typed value
 * and the common tipper sizes. Same limits everywhere (src/lib/load-size.ts).
 */
export function LoadPicker({
  value,
  onChange,
  id = "qty",
  className,
}: {
  value: number;
  onChange: (m3: number) => void;
  id?: string;
  className?: string;
}) {
  const valid = isValidQuantity(value);
  const preset = (LOAD_PRESETS_M3 as readonly number[]).includes(value) ? String(value) : null;
  const stepBtn =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cz-control bg-cz-surface text-cz-text hover:bg-cz-surface-2 disabled:opacity-40";
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="min-w-0">
          <span className="block text-sm font-semibold text-cz-text">Load size</span>
          <span
            id={`${id}-hint`}
            className={cn("block text-sm", valid ? "text-cz-muted" : "text-cz-danger-text")}
          >
            {loadHint(value)}
          </span>
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange(stepQuantity(value, -1))}
            disabled={value <= MIN_QUANTITY_M3}
            aria-label="Smaller load"
            className={stepBtn}
          >
            <Minus aria-hidden className="h-5 w-5" />
          </button>
          <div className="flex items-baseline">
            <input
              id={id}
              type="number"
              inputMode="decimal"
              min={MIN_QUANTITY_M3}
              max={MAX_QUANTITY_M3}
              step={0.25}
              value={value}
              aria-invalid={!valid}
              aria-describedby={`${id}-hint`}
              onChange={(e) => onChange(Number(e.target.value))}
              className="cz-display w-[64px] rounded-md bg-transparent text-right text-[28px] font-bold tabular-nums text-cz-text [appearance:textfield] focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="cz-display ml-1 text-[20px] font-bold text-cz-text">m³</span>
          </div>
          <button
            type="button"
            onClick={() => onChange(stepQuantity(value, 1))}
            disabled={value >= MAX_QUANTITY_M3}
            aria-label="Bigger load"
            className={stepBtn}
          >
            <Plus aria-hidden className="h-5 w-5" />
          </button>
        </div>
      </div>
      <ChoiceChips
        label="Common load sizes"
        options={LOAD_PRESETS_M3.map((v) => ({ value: String(v), label: `${v} m³` }))}
        value={preset}
        onChange={(v) => onChange(Number(v))}
      />
    </div>
  );
}
