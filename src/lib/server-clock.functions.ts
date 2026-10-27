import { createServerFn } from "@tanstack/react-start";

// The server's clock (Vercel keeps it in sync). Offer expiry is decided by the
// database clock, so screens that count down should not trust the phone's clock.
export const getServerNow = createServerFn({ method: "GET" }).handler(async () => ({
  now: Date.now(),
}));
