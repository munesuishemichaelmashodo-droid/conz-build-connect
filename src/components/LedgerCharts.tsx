import { useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import type { SeriesPoint } from "@/lib/ledger";

const SERIES: { key: keyof Omit<SeriesPoint, "day">; label: string; color: string }[] = [
  { key: "topup", label: "Top-ups", color: "hsl(var(--success))" },
  { key: "withdrawal", label: "Withdrawals", color: "hsl(var(--warning))" },
  { key: "commission", label: "Commission", color: "hsl(var(--primary))" },
  { key: "refund", label: "Refunds", color: "hsl(var(--destructive))" },
];

export function LedgerCharts({ data }: { data: SeriesPoint[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const toggle = (k: string) => setHidden((h) => (h.includes(k) ? h.filter((x) => x !== k) : [...h, k]));

  const revenue = useMemo(
    () => data.map((d) => ({ day: d.day, net: Number((d.commission - d.refund).toFixed(2)) })),
    [data],
  );

  if (data.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-center text-xs text-muted-foreground">
        No settled transactions in this period to chart.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-card p-4">
        <h3 className="font-display font-bold uppercase tracking-wide text-sm mb-1">Money movement over time</h3>
        <div className="flex gap-2 flex-wrap mb-2">
          {SERIES.map((s) => (
            <button
              key={s.key}
              onClick={() => toggle(s.key)}
              className="rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                borderColor: s.color,
                color: hidden.includes(s.key) ? undefined : s.color,
                opacity: hidden.includes(s.key) ? 0.4 : 1,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 9 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12,
                  fontSize: 11,
                }}
                formatter={(v: number, n: string) => [`$${Number(v).toFixed(2)}`, n]}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {SERIES.filter((s) => !hidden.includes(s.key)).map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <h3 className="font-display font-bold uppercase tracking-wide text-sm mb-2">
          Net platform revenue (commission − refunds)
        </h3>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={revenue} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tick={{ fontSize: 9 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 9 }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 12,
                  fontSize: 11,
                }}
                formatter={(v: number) => [`$${Number(v).toFixed(2)}`, "Net revenue"]}
              />
              <Line type="monotone" dataKey="net" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
