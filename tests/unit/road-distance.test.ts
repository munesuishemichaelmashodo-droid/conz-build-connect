import { describe, expect, it } from "vitest";
import {
  assertRoadDistance,
  isRoadDistance,
  ROAD_DISTANCE_UNAVAILABLE_MESSAGE,
} from "@/lib/roadDistance";

describe("road distance guard", () => {
  it("accepts only OSRM road distance", () => {
    expect(isRoadDistance("osrm")).toBe(true);
    expect(isRoadDistance("haversine")).toBe(false);
    expect(isRoadDistance("client_provided")).toBe(false);
    expect(isRoadDistance(null)).toBe(false);
    expect(isRoadDistance(undefined)).toBe(false);
  });
  it("refuses to price from a straight-line estimate", () => {
    expect(() => assertRoadDistance("osrm")).not.toThrow();
    expect(() => assertRoadDistance("haversine")).toThrow(ROAD_DISTANCE_UNAVAILABLE_MESSAGE);
  });
});
