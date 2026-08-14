import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type TxType = "topup" | "commission" | "refund" | "adjustment" | "withdrawal";
export type LedgerStatus = "completed" | "pending" | "rejected" | "cancelled";

export type LedgerRow = {
  id: string;
  source: "transaction" | "topup_request" | "withdrawal_request";
  user_id: string;
  type: TxType;
  amount: number;
  balance_after: number | null;
  status: LedgerStatus;
  job_id: string | null;
  note: string | null;
  reference: string | null;
  method: string | null;
  created_by: string | null;
  created_at: string;
  /** Only set on manual admin adjustments (type === "adjustment"). */
  category?: string | null;
  reversal_of_transaction_id?: string | null;
};

export const TX_TYPES: TxType[] = ["topup", "commission", "refund", "adjustment", "withdrawal"];
export const LEDGER_STATUSES: LedgerStatus[] = ["completed", "pending", "rejected", "cancelled"];

export const TYPE_TONE: Record<TxType, string> = {
  topup: "bg-success/15 text-success border-success/30",
  refund: "bg-success/15 text-success border-success/30",
  commission: "bg-primary/15 text-primary border-primary/30",
  withdrawal: "bg-warning/15 text-warning border-warning/30",
  adjustment: "bg-muted text-muted-foreground border-border",
};

export const STATUS_TONE: Record<LedgerStatus, string> = {
  completed: "bg-success/15 text-success border-success/30",
  pending: "bg-warning/15 text-warning border-warning/30",
  rejected: "bg-destructive/15 text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

export type Totals = {
  topups: number;
  withdrawals: number;
  commissions: number;
  refunds: number;
  adjustments: number;
  net: number;
  count: number;
};

/** Sums settled money movements by type. Amounts are absolute values per bucket. */
export function summarise(rows: LedgerRow[]): Totals {
  const t: Totals = {
    topups: 0,
    withdrawals: 0,
    commissions: 0,
    refunds: 0,
    adjustments: 0,
    net: 0,
    count: rows.length,
  };
  for (const r of rows) {
    if (r.status !== "completed") continue;
    const abs = Math.abs(Number(r.amount));
    if (r.type === "topup") t.topups += abs;
    else if (r.type === "withdrawal") t.withdrawals += abs;
    else if (r.type === "commission") t.commissions += abs;
    else if (r.type === "refund") t.refunds += abs;
    else t.adjustments += Number(r.amount);
  }
  // Platform revenue = commission earned less refunds paid back out.
  t.net = t.commissions - t.refunds;
  return t;
}

export type SeriesPoint = { day: string; topup: number; withdrawal: number; commission: number; refund: number };

/** Buckets settled rows into per-day totals, oldest first. */
export function buildSeries(rows: LedgerRow[]): SeriesPoint[] {
  const map = new Map<string, SeriesPoint>();
  for (const r of rows) {
    if (r.status !== "completed") continue;
    const day = r.created_at.slice(0, 10);
    let p = map.get(day);
    if (!p) {
      p = { day, topup: 0, withdrawal: 0, commission: 0, refund: 0 };
      map.set(day, p);
    }
    const abs = Math.abs(Number(r.amount));
    if (r.type === "topup") p.topup += abs;
    else if (r.type === "withdrawal") p.withdrawal += abs;
    else if (r.type === "commission") p.commission += abs;
    else if (r.type === "refund") p.refund += abs;
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export type ExportRow = Record<string, string>;

export const EXPORT_HEADERS = [
  "Transaction ID",
  "Date & Time",
  "User",
  "Role",
  "Type",
  "Amount",
  "Status",
  "Reference",
  "Job ID",
  "Created By",
];

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportCsv(rows: string[][], filename: string) {
  const csv = [EXPORT_HEADERS, ...rows]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${filename}.csv`);
}

/** SpreadsheetML 2003 — opens natively in Excel with typed number cells. */
export function exportExcel(rows: string[][], filename: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cell = (v: string, i: number) =>
    i === 5
      ? `<Cell><Data ss:Type="Number">${esc(v)}</Data></Cell>`
      : `<Cell><Data ss:Type="String">${esc(v)}</Data></Cell>`;
  const body = rows.map((r) => `<Row>${r.map(cell).join("")}</Row>`).join("");
  const head = `<Row>${EXPORT_HEADERS.map((h) => `<Cell><Data ss:Type="String">${esc(h)}</Data></Cell>`).join("")}</Row>`;
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Ledger"><Table>${head}${body}</Table></Worksheet></Workbook>`;
  download(new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8;" }), `${filename}.xls`);
}

export function exportPdf(rows: string[][], filename: string, totals: Totals, subtitle: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(16);
  doc.text("Con Z — Financial Ledger", 40, 40);
  doc.setFontSize(9);
  doc.text(subtitle, 40, 58);
  doc.text(
    `Top-ups $${totals.topups.toFixed(2)}  •  Withdrawals $${totals.withdrawals.toFixed(2)}  •  Commissions $${totals.commissions.toFixed(2)}  •  Refunds $${totals.refunds.toFixed(2)}  •  Net revenue $${totals.net.toFixed(2)}`,
    40,
    72,
  );
  autoTable(doc, {
    head: [EXPORT_HEADERS],
    body: rows,
    startY: 88,
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [24, 24, 24] },
  });
  doc.save(`${filename}.pdf`);
}
