// Plain tap-to-dial link: opens the phone's own dialer. Deliberately not a masked/in-app call: it is simple, free, works
// with voice only (no data), and needs no calling provider, at the cost of showing each party the other's real number.
export const telLink = (phone: string | null | undefined): string | null => {
  if (!phone) return null;
  let p = phone.replace(/[^\d+]/g, "");
  if (p.startsWith("+")) p = p.slice(1);
  if (p.startsWith("00")) p = p.slice(2);
  if (p.startsWith("0")) p = "263" + p.slice(1);
  if (p.length < 9) return null;
  return `tel:+${p}`;
};
