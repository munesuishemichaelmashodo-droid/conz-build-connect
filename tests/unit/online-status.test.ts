import { describe, expect, it } from "vitest";
import { noSignalCopy } from "@/lib/online-status";

describe("noSignalCopy", () => {
  it("says what still works and what will not, without promising anything is saved or sent later", () => {
    const c = noSignalCopy();
    expect(c.title).toBe("No signal");
    expect(c.detail).toMatch(/already have open keep working/i);
    expect(c.detail).toMatch(/will not go through until you are back online/i);
    expect(c.detail).not.toMatch(/saved|queued|will be sent|sent later/i);
  });
});
