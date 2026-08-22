import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { MapPin, CircleCheck, CircleAlert, CircleX, HelpCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/supply-coverage")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/auth" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const list = (roles ?? []).map((r: { role: string }) => r.role);
    if (!list.includes("admin") && !list.includes("super_admin")) throw redirect({ to: "/admin" });
  },
  component: SupplyCoveragePage,
});

const MATERIALS = [
  "crusher_run",
  "quarry_dust",
  "stones",
  "gravel",
  "river_sand",
  "pit_sand",
  "top_soil",
  "filling_soil",
  "custom",
] as const;

const MATERIAL_LABEL: Record<string, string> = {
  crusher_run: "Crusher Run",
  quarry_dust: "Quarry Dust",
  stones: "Stones",
  gravel: "Gravel",
  river_sand: "River Sand",
  pit_sand: "Pit Sand",
  top_soil: "Top Soil",
  filling_soil: "Filling Soil",
  custom: "Custom",
};

type CoverageRow = {
  region_label: string;
  region_lat: number;
  region_lng: number;
  material: string;
  status: "green" | "amber" | "red";
  nearest_supplier_name: string | null;
  nearest_distance_km: number | null;
  nearest_radius_km: number | null;
};

type ResearchCandidate = {
  id: string;
  supplier_name: string;
  physical_source_description: string | null;
  region_label: string;
  materials: string[];
  confidence: "medium" | "low";
  notes: string | null;
};

const STATUS_META: Record<
  "green" | "amber" | "red" | "grey",
  { icon: typeof CircleCheck; className: string; label: string }
> = {
  green: { icon: CircleCheck, className: "text-success", label: "Verified source available" },
  amber: { icon: CircleAlert, className: "text-warning", label: "Source exists, outside service radius" },
  red: { icon: CircleX, className: "text-destructive", label: "No verified source configured" },
  grey: { icon: HelpCircle, className: "text-muted-foreground", label: "Research candidate, not production verified" },
};

function SupplyCoveragePage() {
  const [selected, setSelected] = useState<{ region: string; material: string } | null>(null);

  const { data: coverage } = useQuery({
    queryKey: ["admin-supply-coverage"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin_supply_coverage isn't in the generated Supabase types (fresh migration)
      const { data, error } = await (supabase.rpc as any)("admin_supply_coverage");
      if (error) throw error;
      return (data ?? []) as CoverageRow[];
    },
  });

  const { data: research } = useQuery({
    queryKey: ["admin-supply-research-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supply_research_candidates" as any)
        .select("id,supplier_name,physical_source_description,region_label,materials,confidence,notes");
      if (error) throw error;
      return (data ?? []) as unknown as ResearchCandidate[];
    },
  });

  const regions = useMemo(() => {
    const seen = new Map<string, { lat: number; lng: number }>();
    for (const row of coverage ?? []) {
      if (!seen.has(row.region_label)) seen.set(row.region_label, { lat: row.region_lat, lng: row.region_lng });
    }
    return [...seen.keys()];
  }, [coverage]);

  const cell = (region: string, material: string): { status: "green" | "amber" | "red" | "grey"; row?: CoverageRow; research?: ResearchCandidate } => {
    const row = coverage?.find((r) => r.region_label === region && r.material === material);
    if (row?.status === "green") return { status: "green", row };
    // Only show grey when otherwise uncovered (red) — an amber source
    // already gives a real, better answer than an unverified research note.
    const matchingResearch = research?.find((c) => c.region_label.includes(region) && c.materials.includes(material));
    if (row?.status === "red" && matchingResearch) return { status: "grey", row, research: matchingResearch };
    return { status: row?.status ?? "red", row };
  };

  const totals = useMemo(() => {
    if (!coverage) return null;
    const materialsCovered = new Set(coverage.filter((r) => r.status === "green").map((r) => r.material)).size;
    const regionsWithCoverage = new Set(coverage.filter((r) => r.status === "green").map((r) => r.region_label)).size;
    const verifiedSources = new Set(coverage.filter((r) => r.nearest_supplier_name).map((r) => r.nearest_supplier_name)).size;
    return {
      verifiedSources,
      materialsCovered,
      regionsWithCoverage,
      regionsWithGaps: regions.length - regionsWithCoverage,
    };
  }, [coverage, regions]);

  const selectedInfo = selected ? cell(selected.region, selected.material) : null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-dark text-white p-5 shadow-lift">
        <div className="text-xs uppercase tracking-widest text-white/60">ConZ Supply Coverage</div>
        <div className="font-display font-bold text-xl mt-1 flex items-center gap-2">
          <MapPin className="w-5 h-5" /> National Supply Network
        </div>
        {totals && (
          <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
            <div>
              <div className="text-white/60 text-xs">Verified Sources</div>
              <div className="font-display font-bold text-2xl">{totals.verifiedSources}</div>
            </div>
            <div>
              <div className="text-white/60 text-xs">Materials Covered</div>
              <div className="font-display font-bold text-2xl">{totals.materialsCovered}/9</div>
            </div>
            <div>
              <div className="text-white/60 text-xs">Regions With Coverage</div>
              <div className="font-display font-bold text-2xl">{totals.regionsWithCoverage}</div>
            </div>
            <div>
              <div className="text-white/60 text-xs">Regions With Gaps</div>
              <div className="font-display font-bold text-2xl">{totals.regionsWithGaps}</div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        {(Object.keys(STATUS_META) as (keyof typeof STATUS_META)[]).map((k) => {
          const m = STATUS_META[k];
          const Icon = m.icon;
          return (
            <div key={k} className="flex items-center gap-1.5">
              <Icon className={cn("w-3.5 h-3.5", m.className)} />
              <span className="text-muted-foreground">{m.label}</span>
            </div>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/40">
              <th className="text-left p-2 sticky left-0 bg-muted/40 z-10 min-w-[110px]">Region</th>
              {MATERIALS.map((m) => (
                <th key={m} className="p-2 text-center min-w-[64px] whitespace-nowrap">
                  {MATERIAL_LABEL[m]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {regions.map((region) => (
              <tr key={region} className="border-t">
                <td className="p-2 font-medium sticky left-0 bg-background z-10">{region}</td>
                {MATERIALS.map((material) => {
                  const info = cell(region, material);
                  const meta = STATUS_META[info.status];
                  const Icon = meta.icon;
                  return (
                    <td key={material} className="p-2 text-center">
                      <button
                        onClick={() => setSelected({ region, material })}
                        className="inline-flex items-center justify-center hover:opacity-70"
                        aria-label={`${region} — ${MATERIAL_LABEL[material]}: ${meta.label}`}
                      >
                        <Icon className={cn("w-4 h-4", meta.className)} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && selectedInfo && (
        <div className="rounded-xl border p-4 space-y-2">
          <div className="font-display font-bold text-lg">
            {selected.region} — {MATERIAL_LABEL[selected.material]}
          </div>
          <div className={cn("text-sm font-semibold flex items-center gap-1.5", STATUS_META[selectedInfo.status].className)}>
            {(() => {
              const Icon = STATUS_META[selectedInfo.status].icon;
              return <Icon className="w-4 h-4" />;
            })()}
            Status: {STATUS_META[selectedInfo.status].label}
          </div>

          {selectedInfo.row?.nearest_supplier_name && (
            <div className="text-sm text-muted-foreground space-y-1 pt-1">
              <div>
                Nearest {selectedInfo.status === "green" ? "verified source" : "source (delivery market only)"}:{" "}
                <span className="text-foreground font-medium">{selectedInfo.row.nearest_supplier_name}</span>
              </div>
              <div>Distance: {selectedInfo.row.nearest_distance_km} km</div>
              <div>Configured radius: {selectedInfo.row.nearest_radius_km} km</div>
              {selectedInfo.status === "amber" && (
                <div className="text-xs pt-1">Result: outside source service radius — {selected.region} is a delivery market, not a source; the source above is the nearest real, verified physical location.</div>
              )}
            </div>
          )}

          {selectedInfo.status === "grey" && selectedInfo.research && (
            <div className="text-sm text-muted-foreground space-y-1 pt-1 border-t mt-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground/70 pt-2">Research candidate — not production verified</div>
              <div>
                Supplier: <span className="text-foreground font-medium">{selectedInfo.research.supplier_name}</span>
              </div>
              {selectedInfo.research.physical_source_description && <div>{selectedInfo.research.physical_source_description}</div>}
              <div className="uppercase text-[10px] tracking-wide">Confidence: {selectedInfo.research.confidence}</div>
              {selectedInfo.research.notes && <div className="text-xs pt-1">{selectedInfo.research.notes}</div>}
            </div>
          )}

          {selectedInfo.status === "red" && !selectedInfo.research && (
            <div className="text-sm text-muted-foreground pt-1">No source, verified or research-stage, currently exists anywhere for this material near {selected.region}.</div>
          )}
        </div>
      )}
    </div>
  );
}
