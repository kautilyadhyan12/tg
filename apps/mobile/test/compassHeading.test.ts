// The way the phone points (ROADMAP Stage 5 item 37p): the beam on a run's map. Every hold is built here from the
// phone's own turns, as a hand turns a phone (raise its top, tip it sideways, stand it on its side), never from the
// code's own maths, and the person faces east (90°) in each. Round one's H1: tipped sideways, the first build's beam
// went about a degree off for each degree of tip.
import { describe, expect, it } from "vitest";
import type { PhoneCompass } from "@app/shared";
import { headingOf, screenAxes, sureOf, turnedEnough } from "../src/screens/running/compassHeading";

type V = [number, number, number];
const rad = (d: number) => (d * Math.PI) / 180;
/** Turn v about the unit axis k by a (right hand), Rodrigues' formula. */
function turn(v: V, k: V, a: number): V {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const cross: V = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  const at = (i: 0 | 1 | 2) => v[i] * c + cross[i] * s + k[i] * dot * (1 - c);
  return [at(0), at(1), at(2)];
}

/** A phone as a hand holds it, its axes in east, north and up: it starts flat and face up with its top to the east,
 *  then each step turns it about its own axis as it now stands ("x" its left-right edge, "y" its top, "z" out of its
 *  screen), in degrees, right hand. */
function phone(...steps: ["x" | "y" | "z", number][]): { x: V; y: V; z: V } {
  let x: V = [0, -1, 0];
  let y: V = [1, 0, 0];
  let z: V = [0, 0, 1];
  for (const [about, d] of steps) {
    const k = about === "x" ? x : about === "y" ? y : z;
    x = turn(x, k, rad(d));
    y = turn(y, k, rad(d));
    z = turn(z, k, rad(d));
  }
  return { x, y, z };
}

/** Android's rotation matrix for those axes (row by row; each column one of the phone's axes). */
function reading(axes: { x: V; y: V; z: V }, more: Partial<PhoneCompass> = {}): PhoneCompass {
  const { x, y, z } = axes;
  return { r: [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]], rotation: 0, declination: 0, accuracy: -1, status: 3, ...more };
}

const pointing = (axes: { x: V; y: V; z: V }, more: Partial<PhoneCompass> = {}) => {
  const h = headingOf(reading(axes, more));
  return h === null ? null : Math.round(h.deg * 10) / 10;
};

describe("the person faces east: the beam points east however the phone is held", () => {
  const holds: [string, ["x" | "y" | "z", number][]][] = [
    ["flat", []],
    ["flat, tipped 10° sideways (H1: was 80.1)", [["y", 10]]],
    ["flat, tipped 20° sideways (H1: was 71.1)", [["y", 20]]],
    ["flat, tipped 30° sideways (H1: was 63.4)", [["y", 30]]],
    ["flat, tipped 60° the other way", [["y", -60]]],
    ["top raised 45° to be read", [["x", 45]]],
    ["upright", [["x", 90]]],
    ["upright, leaning 20° sideways in the hand", [["x", 90], ["z", 20]]],
    ["past upright, 110°", [["x", 110]]],
    ["top dipped 30°", [["x", -30]]],
    ["top dipped 60° (H1's table: was 270)", [["x", -60]]],
    ["held sideways and upright, its screen to the person (its edge stands on end)", [["x", 90], ["z", 90]]],
    ["held sideways and upright the other way", [["x", 90], ["z", -90]]],
    ["face down on a table, its top to the east", [["y", 180]]],
    ["face down, tipped 20°", [["y", 160]]],
  ];
  for (const [name, steps] of holds) {
    it(name, () => {
      expect(pointing(phone(...steps))).toBeCloseTo(90, 0);
    });
  }

  it("each way round the compass, flat and upright", () => {
    for (let facing = 0; facing < 360; facing += 15) {
      // Turned about straight up, from east, clockwise as seen from above.
      expect(pointing(phone(["z", -(facing - 90)]))).toBeCloseTo(facing % 360, 0);
      const upright = phone(["x", 90]);
      const k: V = [0, 0, 1];
      const turned = { x: turn(upright.x, k, rad(-(facing - 90))), y: turn(upright.y, k, rad(-(facing - 90))), z: turn(upright.z, k, rad(-(facing - 90))) };
      const got = pointing(turned);
      expect(got === null ? null : Math.abs(((got - facing + 540) % 360) - 180)).toBeLessThan(0.1);
    }
  });
});

describe("the screen's own turn (round one, L1)", () => {
  // A tablet whose natural way up is landscape, running this portrait app: its screen is turned a quarter from the
  // tablet's own axes. Held flat with the screen's top to the east, the person faces east.
  it("turned a quarter one way (Android's ROTATION_90): the screen's top is the tablet's right-hand edge", () => {
    // The tablet's own top points north, so its right-hand edge (the screen's top) points east.
    const tablet = phone(["z", 90]);
    expect(tablet.x[0]).toBeCloseTo(1);
    expect(pointing(tablet, { rotation: 1 })).toBeCloseTo(90, 0);
    expect(pointing(tablet, { rotation: 0 })).toBeCloseTo(0, 0);
  });

  it("turned a quarter the other way (ROTATION_270): the screen's top is the tablet's left-hand edge", () => {
    const tablet = phone(["z", -90]);
    expect(tablet.x[0]).toBeCloseTo(-1);
    expect(pointing(tablet, { rotation: 3 })).toBeCloseTo(90, 0);
  });

  it("turned a half (ROTATION_180): the screen's top is the tablet's own bottom", () => {
    const tablet = phone(["z", 180]);
    expect(pointing(tablet, { rotation: 2 })).toBeCloseTo(90, 0);
  });

  it("the axes are those of Android's own remap for a compass (x to -y, y to x at a quarter turn)", () => {
    const r = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(screenAxes(r, 1)).toEqual({ x: [-2, -5, -8], y: [1, 4, 7], z: [3, 6, 9] });
    expect(screenAxes(r, 3)).toEqual({ x: [2, 5, 8], y: [-1, -4, -7], z: [3, 6, 9] });
  });
});

describe("true north, the map's", () => {
  it("magnetic north 5° east of true north (as in much of the US's west): a phone at magnetic north points 5°", () => {
    const north = phone(["z", 90]);
    expect(pointing(north, { declination: 5 })).toBeCloseTo(5, 0);
  });

  it("magnetic north 12° west of true north: a phone at magnetic north points 348°", () => {
    expect(pointing(phone(["z", 90]), { declination: -12 })).toBeCloseTo(348, 0);
  });
});

describe("how sure, by Android's own estimate of the error where it gives one (round one, L3)", () => {
  const cases: [string, number, number, number][] = [
    ["5° of error: high", rad(5), 0, 3],
    ["20°: high", rad(20), 0, 3],
    ["30°: medium", rad(30), 3, 2],
    ["45°: low", rad(45), 3, 1],
    ["90°: unreliable, though the status says high", rad(90), 3, 0],
    ["none given (-1): the status, high", -1, 3, 3],
    ["none given: the status, low", -1, 1, 1],
    ["none given: no contact (-1) reads as unreliable", -1, -1, 0],
    ["an estimate of exactly 0 is none given", 0, 2, 2],
  ];
  for (const [name, accuracy, status, sure] of cases) {
    it(name, () => {
      expect(sureOf(accuracy, status)).toBe(sure);
      expect(headingOf(reading(phone(), { accuracy, status }))?.sure).toBe(sure);
    });
  }
});

describe("drawn again only when it has turned", () => {
  it("under a degree either way round is the same beam; a degree or a new sureness is a new one", () => {
    expect(turnedEnough(null, { deg: 10, sure: 3 })).toBe(true);
    expect(turnedEnough({ deg: 10, sure: 3 }, { deg: 10.9, sure: 3 })).toBe(false);
    expect(turnedEnough({ deg: 10, sure: 3 }, { deg: 11, sure: 3 })).toBe(true);
    expect(turnedEnough({ deg: 359.6, sure: 3 }, { deg: 0.4, sure: 3 })).toBe(false);
    expect(turnedEnough({ deg: 359.6, sure: 3 }, { deg: 0.7, sure: 3 })).toBe(true);
    expect(turnedEnough({ deg: 10, sure: 3 }, { deg: 10, sure: 2 })).toBe(true);
  });
});
