import { describe, expect, it } from "vitest";
import { jobStamp, PUBLIC_STEPS, publicStepsDone, sentence } from "@/lib/status-stamp";

describe("jobStamp", () => {
  it("gives every job status one label, tone and icon", () => {
    expect(jobStamp({ status: "open" })).toEqual({ label: "Open", tone: "info", icon: "open" });
    expect(jobStamp({ status: "accepted" })).toEqual({
      label: "Driver chosen",
      tone: "brand",
      icon: "chosen",
    });
    expect(jobStamp({ status: "in_progress" })).toEqual({
      label: "On the way",
      tone: "success",
      icon: "truck",
    });
    expect(jobStamp({ status: "completed" })).toEqual({
      label: "Delivered",
      tone: "success",
      icon: "done",
      solid: true,
    });
    expect(jobStamp({ status: "cancelled" })).toEqual({
      label: "Cancelled",
      tone: "neutral",
      icon: "cancelled",
    });
  });

  it("follows the delivery stages the job fields show", () => {
    expect(jobStamp({ status: "accepted", pickup_photo_url: "j/p.jpg" }).label).toBe("Loaded");
    expect(
      jobStamp({ status: "in_progress", driver_arrived_dropoff_at: "2026-10-23T10:00:00Z" }).label,
    ).toBe("At your site");
    expect(jobStamp({ status: "in_progress", delivery_photo_url: "j/d.jpg" }).label).toBe(
      "At your site",
    );
  });

  it("never uses the warning tone for normal progress", () => {
    for (const status of ["open", "accepted", "in_progress", "completed", "cancelled"]) {
      expect(jobStamp({ status }).tone).not.toBe("warning");
    }
  });

  it("shows an unknown status in sentence case instead of a raw value", () => {
    expect(jobStamp({ status: "on_hold" })).toEqual({
      label: "On hold",
      tone: "neutral",
      icon: "clock",
    });
    expect(sentence("")).toBe("Unknown");
  });
});

describe("publicStepsDone", () => {
  it("ticks only the steps the job status proves", () => {
    expect(PUBLIC_STEPS).toEqual(["Booked", "Driver chosen", "On the way", "Delivered"]);
    expect(publicStepsDone("open")).toBe(1);
    expect(publicStepsDone("accepted")).toBe(2);
    expect(publicStepsDone("in_progress")).toBe(3);
    expect(publicStepsDone("completed")).toBe(4);
    expect(publicStepsDone("cancelled")).toBe(0);
    expect(publicStepsDone("something_new")).toBe(0);
  });
});
