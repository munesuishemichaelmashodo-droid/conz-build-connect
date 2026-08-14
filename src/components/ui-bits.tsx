import { cn } from "@/lib/utils";
import { RouteLine } from "@/components/RouteLine";

export function StatusBadge({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("select-none inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide", className)}>
      {label}
    </span>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-bold text-lg uppercase tracking-wide">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon: Icon, title, hint }: { icon: React.ComponentType<{ className?: string }>; title: string; hint?: string }) {
  return (
    <div className="relative overflow-hidden flex flex-col items-center justify-center text-center py-12 px-6 rounded-xl bg-muted/40 border border-dashed">
      <RouteLine opacity={0.12} dash="3 8" />
      <Icon className="relative w-10 h-10 text-muted-foreground mb-3" />
      <p className="relative font-semibold">{title}</p>
      {hint && <p className="relative text-sm text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
