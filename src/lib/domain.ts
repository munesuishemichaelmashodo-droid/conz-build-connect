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
    case "platinum": return { label: "Platinum", className: "bg-secondary text-secondary-foreground" };
    case "gold": return { label: "Gold", className: "bg-warning text-warning-foreground" };
    case "silver": return { label: "Silver", className: "bg-muted text-muted-foreground" };
    default: return { label: "Bronze", className: "bg-accent text-accent-foreground" };
  }
};

export const statusInfo = (s: string) => {
  switch (s) {
    case "open": return { label: "Open", className: "bg-primary/15 text-primary border-primary/30" };
    case "accepted": return { label: "Accepted", className: "bg-warning/15 text-warning border-warning/30" };
    case "in_progress": return { label: "In progress", className: "bg-warning/15 text-warning border-warning/30" };
    case "completed": return { label: "Completed", className: "bg-success/15 text-success border-success/30" };
    case "cancelled": return { label: "Cancelled", className: "bg-muted text-muted-foreground border-border" };
    default: return { label: s, className: "bg-muted text-muted-foreground border-border" };
  }
};
