import { describe, expect, it } from "vitest";
import { sortRows } from "@/lib/sort-rows";

const rows = [
  { name: "rudo", balance: 12.5 },
  { name: "Farai", balance: 0 },
  { name: null, balance: 40 },
  { name: "anesu", balance: 12.5 },
];

describe("sortRows", () => {
  it("sorts text case-insensitively with empty values last", () => {
    expect(sortRows(rows, (r) => r.name, "asc").map((r) => r.name)).toEqual([
      "anesu",
      "Farai",
      "rudo",
      null,
    ]);
    expect(sortRows(rows, (r) => r.name, "desc").map((r) => r.name)).toEqual([
      "rudo",
      "Farai",
      "anesu",
      null,
    ]);
  });

  it("sorts numbers numerically and keeps ties in their original order", () => {
    expect(sortRows(rows, (r) => r.balance, "asc").map((r) => r.name)).toEqual([
      "Farai",
      "rudo",
      "anesu",
      null,
    ]);
    expect(sortRows(rows, (r) => r.balance, "desc").map((r) => r.name)).toEqual([
      null,
      "rudo",
      "anesu",
      "Farai",
    ]);
  });

  it("does not change the input array", () => {
    const copy = [...rows];
    sortRows(rows, (r) => r.balance, "desc");
    expect(rows).toEqual(copy);
  });
});
