// Driver earnings on provider-paid jobs (0171), kept apart from commission credit (wallets).
// A payable is what ConZ owes a driver for one delivered job: agreed total less ConZ's 7% of that total (materials and transport together).

export type PayableStatus = "payable" | "held" | "payout_pending" | "paid_out" | "reversed";

export type PayableRow = {
  id: string;
  job_id: string;
  driver_id?: string;
  gross_amount: number | string;
  commission: number | string;
  amount: number | string;
  status: PayableStatus;
  created_at: string;
};

export type EarningsSummary = {
  owed: number; // earned, not yet paid out (payable + held + payout_pending)
  held: number; // part of `owed` held for a dispute
  paidOut: number;
  commission: number; // ConZ commission taken from collected fares (not reversed)
  gross: number; // fares collected for these jobs (not reversed)
  count: number;
};

const cents = (n: number | string) => Math.round(Number(n) * 100);

export function summarizePayables(rows: readonly PayableRow[]): EarningsSummary {
  let owed = 0,
    held = 0,
    paidOut = 0,
    commission = 0,
    gross = 0,
    count = 0;
  for (const r of rows) {
    if (r.status === "reversed") continue;
    count += 1;
    commission += cents(r.commission);
    gross += cents(r.gross_amount);
    if (r.status === "paid_out") paidOut += cents(r.amount);
    else owed += cents(r.amount);
    if (r.status === "held") held += cents(r.amount);
  }
  return {
    owed: owed / 100,
    held: held / 100,
    paidOut: paidOut / 100,
    commission: commission / 100,
    gross: gross / 100,
    count,
  };
}

export function payableStatusLabel(s: PayableStatus): string {
  switch (s) {
    case "payable":
      return "Owed to you";
    case "held":
      return "Held (under review)";
    case "payout_pending":
      return "Payout in progress";
    case "paid_out":
      return "Paid out";
    case "reversed":
      return "Reversed";
  }
}
