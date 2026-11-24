import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { CODE_LENGTH, normalizeCode } from "@/lib/otp-code";

type Props = {
  id: string;
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
};

/**
 * Six boxes for an authenticator code. Underneath it is ONE ordinary text field, so paste, the
 * phone's "one-time code" suggestion, password-manager autofill and screen readers all work as they
 * do in any field; the boxes are only how it looks.
 */
export const OtpCodeInput = forwardRef<HTMLInputElement, Props>(function OtpCodeInput(
  { id, value, onChange, disabled, invalid, describedBy, autoFocus },
  ref,
) {
  const digits = value.split("");
  const caret = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <div className="relative mx-auto w-full max-w-[18rem]">
      <div aria-hidden="true" className="grid grid-cols-6 gap-2">
        {Array.from({ length: CODE_LENGTH }, (_, i) => (
          <div
            key={i}
            className={cn(
              "flex h-12 items-center justify-center rounded-lg border bg-card font-mono text-xl font-semibold",
              invalid ? "border-destructive" : "border-border",
              // the box the next digit goes into
              !disabled && i === caret && value.length < CODE_LENGTH && "border-foreground/60",
            )}
          >
            {digits[i] ?? ""}
          </div>
        ))}
      </div>
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        maxLength={CODE_LENGTH + 10}
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(normalizeCode(e.target.value))}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          if (pasted) {
            e.preventDefault();
            onChange(normalizeCode(pasted));
          }
        }}
        // the real field sits over the boxes, transparent; the focus ring shows on the whole group
        className="absolute inset-0 h-12 w-full cursor-text rounded-lg bg-transparent text-transparent caret-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
      />
    </div>
  );
});
