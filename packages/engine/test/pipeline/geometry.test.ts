// Geometry primitives vs hand-computed fixtures (§7.6's explicit requirement).
import { describe, expect, it } from "vitest";
import { calculateAngle, inclineFromVertical } from "../../src/index.js";

describe("calculateAngle (3-point interior angle)", () => {
  it("right angle: (0,1)-(0,0)-(1,0) = 90°", () => {
    expect(calculateAngle([0, 1], [0, 0], [1, 0])).toBeCloseTo(90, 4);
  });
  it("straight line: (0,0)-(1,0)-(2,0) = 180°", () => {
    expect(calculateAngle([0, 0], [1, 0], [2, 0])).toBeCloseTo(180, 3);
  });
  it("folded back: (1,0)-(0,0)-(1,0) = 0°", () => {
    expect(calculateAngle([1, 0], [0, 0], [1, 0])).toBeCloseTo(0, 3);
  });
  it("45°: (1,1)-(0,0)-(1,0)", () => {
    expect(calculateAngle([1, 1], [0, 0], [1, 0])).toBeCloseTo(45, 4);
  });
  it("equilateral triangle vertex = 60°", () => {
    expect(calculateAngle([1, 0], [0, 0], [0.5, Math.sqrt(3) / 2])).toBeCloseTo(60, 4);
  });
  it("degenerate coincident points does not throw (epsilon denominator)", () => {
    expect(() => calculateAngle([0, 0], [0, 0], [0, 0])).not.toThrow();
  });
});

describe("inclineFromVertical (0 = upright; image y down)", () => {
  it("vertical top→bottom = 0°", () => {
    expect(inclineFromVertical([0.5, 0.2], [0.5, 0.8])).toBeCloseTo(0, 4);
  });
  it("horizontal = 90°", () => {
    expect(inclineFromVertical([0.2, 0.5], [0.8, 0.5])).toBeCloseTo(90, 4);
  });
  it("45° lean", () => {
    expect(inclineFromVertical([0, 0], [1, 1])).toBeCloseTo(45, 4);
  });
  it("inverted (bottom above top) = 180°", () => {
    expect(inclineFromVertical([0.5, 0.8], [0.5, 0.2])).toBeCloseTo(180, 3);
  });
});
