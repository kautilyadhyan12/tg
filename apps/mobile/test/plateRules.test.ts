import { describe, expect, it } from "vitest";
import { fillReach, glassShape, partPath, plateShare, slicePath } from "../src/screens/food/plateRules";

// The worst thing the Food tab's plate could do (32c-i): look fuller than what was eaten. Every class of
// number the server can send, with what the plate must draw.
describe("a plate is never drawn fuller than was eaten", () => {
  const cases: readonly (readonly [string, number | null, number, number])[] = [
    ["nothing eaten", 0, 2300, 0],
    ["not known yet (a meal waiting for its numbers)", null, 2300, 0],
    ["a third", 700, 2100, 1 / 3],
    ["half", 70, 140, 0.5],
    ["just under the target", 2299, 2300, 2299 / 2300],
    ["exactly the target", 2300, 2300, 1],
    ["over the target: full, never past it", 3100, 2300, 1],
    ["no target", 500, 0, 0],
    ["a target below zero", 500, -10, 0],
    ["eaten below zero", -5, 2300, 0],
    ["not a number eaten", Number.NaN, 2300, 0],
    ["not a number target", 500, Number.NaN, 0],
    ["endless", Number.POSITIVE_INFINITY, 2300, 0],
  ];
  it.each(cases)("%s", (_, had, of, share) => {
    expect(plateShare(had, of)).toBeCloseTo(share, 10);
  });

  it("a part's food reaches from the hub to the rim and never past either", () => {
    expect(fillReach(0, 36, 82)).toBe(36);
    expect(fillReach(0.5, 36, 82)).toBe(59);
    expect(fillReach(1, 36, 82)).toBe(82);
    expect(fillReach(4, 36, 82)).toBe(82);
    expect(fillReach(-1, 36, 82)).toBe(36);
  });

  it("a day's plate: nothing, a slice, or the whole plate, never an arc that wraps round", () => {
    expect(slicePath(17, 17, 12, 0)).toEqual({ kind: "none" });
    expect(slicePath(17, 17, 12, Number.NaN)).toEqual({ kind: "none" });
    expect(slicePath(17, 17, 12, 1)).toEqual({ kind: "whole" });
    const quarter = slicePath(17, 17, 12, 0.25);
    expect(quarter).toEqual({ kind: "slice", d: "M17,17 L17.00,5.00 A12,12 0 0 1 29.00,17.00 Z" });
    const most = slicePath(17, 17, 12, 0.75);
    expect(most.kind === "slice" ? most.d : "").toContain(" 0 1 1 ");
  });

  it("a part of the plate is the ring between the hub and its reach", () => {
    expect(partPath(112, 112, 0, 90, 36, 82)).toBe("M194.00,112.00 A82,82 0 0 1 112.00,194.00 L112.00,148.00 A36,36 0 0 0 148.00,112.00 Z");
  });
});

// The Week tab's glasses: a day is never drawn fuller than its bar's height, nor past the glass's brim.
describe("a day's glass", () => {
  it("is empty with no meals, and its liquid's surface sits at the bar's height", () => {
    expect(glassShape(34, 112, 12, null).liquid).toBeNull();
    expect(glassShape(34, 112, 12, 0).liquid).toBeNull();
    expect(glassShape(34, 112, 12, Number.NaN).liquid).toBeNull();
    expect(glassShape(34, 112, 12, 56).liquid?.top).toBe(68);
  });

  it("never runs past its brim, and a little is still a sliver", () => {
    expect(glassShape(34, 112, 12, 500).liquid?.top).toBe(14);
    expect(glassShape(34, 112, 12, 2).liquid?.top).toBe(115);
  });

  it("has bubbles only where there is room for them", () => {
    expect(glassShape(34, 112, 12, 10).liquid?.bubbles).toEqual([]);
    expect(glassShape(34, 112, 12, 80).liquid?.bubbles).toHaveLength(3);
  });
});
