import { jobStamp, TONE_CLASS } from "@/lib/status-stamp";

export type AppRole = "customer" | "driver" | "admin" | "super_admin";

export type MaterialCategory =
  | "river_sand"
  | "pit_sand"
  | "quarry_dust"
  | "crusher_run"
  | "gravel"
  | "stones"
  | "top_soil"
  | "filling_soil"
  | "custom";

export const MATERIALS: { value: MaterialCategory; label: string; group: string }[] = [
  { value: "river_sand", label: "River Sand", group: "Sand" },
  { value: "pit_sand", label: "Pit Sand", group: "Sand" },
  { value: "quarry_dust", label: "Quarry Dust", group: "Aggregates" },
  { value: "crusher_run", label: "Crusher Run", group: "Aggregates" },
  { value: "gravel", label: "Gravel", group: "Aggregates" },
  { value: "stones", label: "Stones", group: "Aggregates" },
  { value: "top_soil", label: "Top Soil", group: "Soil" },
  { value: "filling_soil", label: "Filling Soil", group: "Soil" },
  { value: "custom", label: "Custom Material", group: "Other" },
];

export const materialLabel = (m: MaterialCategory, custom?: string | null) =>
  m === "custom" ? (custom?.trim() || "Custom material") : MATERIALS.find((x) => x.value === m)?.label || m;

export const money = (n: number | null | undefined) =>
  `$${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const levelInfo = (l: string) => {
  switch (l) {
    case "platinum": return { label: "Platinum", className: "bg-secondary text-secondary-foreground", nextAt: null as number | null };
    case "gold": return { label: "Gold", className: "bg-warning text-warning-foreground", nextAt: 500 };
    case "silver": return { label: "Silver", className: "bg-muted text-muted-foreground", nextAt: 101 };
    default: return { label: "Bronze", className: "bg-accent text-accent-foreground", nextAt: 21 };
  }
};

// Same words and tones as the status stamps (src/lib/status-stamp.ts). Warning
// colours are kept for real problems, never for a job that is simply moving.
export const statusInfo = (s: string) => {
  const stamp = jobStamp({ status: s });
  return { label: stamp.label, className: `${TONE_CLASS[stamp.tone]} border-transparent` };
};
