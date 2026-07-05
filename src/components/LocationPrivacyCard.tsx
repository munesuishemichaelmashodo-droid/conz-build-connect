import { Shield, ShieldOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useLocationSharingEnabled } from "@/lib/location-privacy";

export function LocationPrivacyCard() {
  const [enabled, setEnabled] = useLocationSharingEnabled();
  return (
    <section className="rounded-2xl bg-card border p-4 shadow-soft space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            {enabled ? <Shield className="w-5 h-5 text-primary" /> : <ShieldOff className="w-5 h-5 text-warning" />}
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-bold uppercase tracking-wide text-sm">Location privacy</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Share your live location with jobs you're delivering.
            </p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Toggle live location sharing" />
      </div>

      <div className={`rounded-lg border p-3 text-xs space-y-1 ${enabled ? "bg-muted/40" : "bg-warning/10 border-warning/40"}`}>
        <div className="font-semibold uppercase tracking-wide text-[11px]">
          {enabled ? "When on" : "When off, this stops"}
        </div>
        {enabled ? (
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Customers on your active jobs see your live GPS on the map</li>
            <li>Sharing runs only while you press "Start sharing" on a job</li>
            <li>Location auto-clears when you press "Stop sharing" or finish the job</li>
          </ul>
        ) : (
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>No live GPS coordinates are sent to any customer, on any job</li>
            <li>Any in-progress live share is ended and the last pin is deleted</li>
            <li>The "Start sharing location" button is disabled on every job</li>
            <li>Address search and "Locate me" on booking still work — those are one-off lookups, not continuous tracking</li>
          </ul>
        )}
      </div>
    </section>
  );
}
