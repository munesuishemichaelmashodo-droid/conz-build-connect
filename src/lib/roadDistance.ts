// Prices are based on real ROAD distance (OSRM). A straight-line (haversine) figure understates the
// distance, so it must never be used to price a customer's order or secure a quote. When the router is
// unavailable the caller fails with a retryable message instead of quoting a cheaper guess.

export const ROAD_DISTANCE_UNAVAILABLE_MESSAGE =
  "We couldn't measure the road distance right now, so we can't give you a reliable price. Please try again in a moment.";

export function isRoadDistance(source: string | null | undefined): boolean {
  return source === "osrm";
}

export function assertRoadDistance(source: string | null | undefined): void {
  if (!isRoadDistance(source)) throw new Error(ROAD_DISTANCE_UNAVAILABLE_MESSAGE);
}
