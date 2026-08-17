import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { TourKey } from "@/lib/tour/types";

/**
 * Shown once, the first time a user reaches their dashboard after the
 * existing short OnboardingWalkthrough is already done (that gate — see
 * GuidedTourProvider — is what stops the two intros ever stacking). Purely
 * optional: "Maybe later" persists as a skip, same as bailing out mid-tour,
 * so this never nags on every session.
 */
export function WelcomeTourPrompt({
  tourKey,
  onStart,
  onDismiss,
}: {
  tourKey: TourKey;
  onStart: () => void;
  onDismiss: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-1">
            <Compass className="w-5 h-5" />
          </div>
          <DialogTitle className="font-display uppercase tracking-wide">Welcome to Con Z</DialogTitle>
          <DialogDescription>
            {tourKey === "driver"
              ? "Want a quick walkthrough of finding jobs, bidding, and getting paid?"
              : "Want a quick walkthrough of booking a delivery, start to finish?"}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button onClick={onStart} className="w-full h-11 font-display uppercase tracking-wide">
            Start tour
          </Button>
          <Button onClick={onDismiss} variant="ghost" className="w-full h-11">
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
