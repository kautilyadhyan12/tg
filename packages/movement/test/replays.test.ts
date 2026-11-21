// The replays themselves (scripts/replays.ts): each changes only what it says, the same way every time for the same
// seed, and the chip's gap is the phone's own measured gap, not one drawn by hand.
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MovementFrame } from "@app/shared";
import { bodySize } from "../src/index.js";
import { readKept, videoOf } from "../scripts/bodyCheck.js";
import { MOVEMENT_VIDEOS } from "../scripts/movementVideos.js";
import {
  FLOOR_LEAN,
  FLOOR_LENS,
  PHONE_GAPS,
  everyNth,
  farther,
  floorCamera,
  focalOf,
  nearer,
  nearestFactor,
  numbers,
  onTheFloor,
  passerBy,
  phoneGap,
  phoneLabel,
  redraw,
  shaken,
  tilted,
  uneven,
} from "../scripts/replays.js";
import { ASPECT, VIDEOS, standingWorld } from "./helpers/body.js";

const squat = VIDEOS.find((v) => v.label === "squat_reference");
if (squat === undefined) throw new Error("no squat video");
const FRAMES = squat.frames;
const seen = (q: readonly number[]): boolean => (q[3] ?? 0) >= 0.5 && (q[4] ?? 0) >= 0.5;

function quantile(values: readonly number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? Number.NaN;
}

/** The middle body size over the frames. */
const sizeOf = (frames: readonly MovementFrame[]): number =>
  quantile(
    frames.flatMap((f) => {
      const p = f.people[0];
      const s = p === undefined ? null : bodySize(p, f.aspect, p.points.map(seen));
      return s === null ? [] : [s];
    }),
    0.5,
  );

describe("each replay changes only what it says", () => {
  it("tilted: the picture and the 3D points turn together, and 'down' is the phone's own", () => {
    const out = tilted(15)(FRAMES);
    const a = (15 * Math.PI) / 180;
    expect(out[0]?.down).toEqual([-Math.sin(a), Math.cos(a), 0]);
    // A length on the picture, in true proportion, and in 3D, is the same after the turn.
    const f = FRAMES[100];
    const g = out[100];
    const p = f?.people[0];
    const q = g?.people[0];
    if (f === undefined || g === undefined || p === undefined || q === undefined) throw new Error("no frame");
    const flat = (pts: typeof p.points, i: number, j: number) => Math.hypot(((pts[i]?.[0] ?? 0) - (pts[j]?.[0] ?? 0)) * f.aspect, (pts[i]?.[1] ?? 0) - (pts[j]?.[1] ?? 0));
    expect(flat(q.points, 23, 25)).toBeCloseTo(flat(p.points, 23, 25), 9);
    expect(sizeOf(out)).toBeCloseTo(sizeOf(FRAMES), 6);
    // The picture turned the way 'down' says: standing tall, her hip to ankle line lies along the new down, as it lay
    // along the picture's own down before.
    const along = (pts: typeof p.points, aspect: number, d: readonly number[]) => {
      const dx = ((pts[27]?.[0] ?? 0) - (pts[23]?.[0] ?? 0)) * aspect;
      const dy = (pts[27]?.[1] ?? 0) - (pts[23]?.[1] ?? 0);
      return (dx * (d[0] ?? 0) + dy * (d[1] ?? 0)) / Math.hypot(dx, dy);
    };
    const first = FRAMES[0];
    const turned = out[0];
    const p0 = first?.people[0];
    const q0 = turned?.people[0];
    if (first === undefined || turned === undefined || p0 === undefined || q0 === undefined) throw new Error("no first frame");
    expect(along(p0.points, first.aspect, [0, 1])).toBeGreaterThan(0.98);
    expect(along(q0.points, first.aspect, turned.down ?? [0, 0])).toBeGreaterThan(0.98);
    expect(along(q0.points, first.aspect, [0, 1])).toBeLessThan(0.98);
  });

  it("nearer: the body grows by up to 1.3 and every point the model saw stays on the picture", () => {
    const k = nearestFactor(FRAMES, 1.3);
    expect(k).toBeGreaterThanOrEqual(1);
    expect(k).toBeLessThanOrEqual(1.3);
    const out = nearer(1.3)(FRAMES);
    expect(sizeOf(out) / sizeOf(FRAMES)).toBeCloseTo(k, 2);
    for (const f of out) for (const p of f.people) for (const q of p.points) if (seen(q)) expect(q[0] >= 0 && q[0] <= 1 && q[1] >= 0 && q[1] <= 1).toBe(true);
  });

  it("farther: the body 0.6 times as big", () => {
    expect(sizeOf(farther(0.6)(FRAMES)) / sizeOf(FRAMES)).toBeCloseTo(0.6, 2);
  });

  it("fewer pictures: 8 a second keeps about one picture in four", () => {
    const out = everyNth(8)(FRAMES);
    const span = ((FRAMES[FRAMES.length - 1]?.t ?? 0) - (FRAMES[0]?.t ?? 0)) / 1000;
    expect(out.length / span).toBeGreaterThan(7.5);
    expect(out.length / span).toBeLessThan(8.5);
  });

  it("uneven: each picture 1 to 4 camera pictures after the last, the same for one seed and another for another", () => {
    const a = uneven(4)(FRAMES, 7);
    const steps = a.slice(1).map((f, k) => Math.round((f.t - (a[k]?.t ?? 0)) / (1000 / 30)));
    expect(Math.min(...steps)).toBe(1);
    expect(Math.max(...steps)).toBe(4);
    expect(uneven(4)(FRAMES, 7).map((f) => f.t)).toEqual(a.map((f) => f.t));
    expect(uneven(4)(FRAMES, 8).map((f) => f.t)).not.toEqual(a.map((f) => f.t));
  });

  it("shaky: 95 in 100 of the moves within 1 cm, in 3D and on the picture alike", () => {
    const out = shaken(0.01)(FRAMES, 3);
    const size = sizeOf(FRAMES);
    const flat = FRAMES.flatMap((f, i) => {
      const p = f.people[0]?.points;
      const q = out[i]?.people[0]?.points;
      return p === undefined || q === undefined ? [] : p.map((a, k) => Math.hypot((a[0] - (q[k]?.[0] ?? a[0])) * f.aspect, a[1] - (q[k]?.[1] ?? a[1])) / size);
    });
    // On the picture a move has two of its three parts: about 0.8 of the 3D one.
    expect(quantile(flat, 0.95)).toBeGreaterThan(0.006);
    expect(quantile(flat, 0.95)).toBeLessThan(0.011);
    const moves = FRAMES.flatMap((f, i) => {
      const p = f.people[0]?.world;
      const q = out[i]?.people[0]?.world;
      return p === null || p === undefined || q === null || q === undefined ? [] : p.map((w, k) => Math.hypot(...w.map((x, j) => x - (q[k]?.[j] ?? x))));
    });
    expect(quantile(moves, 0.95)).toBeGreaterThan(0.008);
    expect(quantile(moves, 0.95)).toBeLessThan(0.012);
  });

  it("a passer-by hides points only for its 0.8 s, never more than its width of the picture at once, and most of the person for a moment", () => {
    const at = 3000;
    const out = passerBy(() => at)(FRAMES, 0, []);
    out.forEach((f, i) => {
      const before = FRAMES[i]?.people[0]?.points ?? [];
      const after = f.people[0]?.points ?? [];
      const hid = after.flatMap((q, k) => ((before[k]?.[3] ?? 0) !== q[3] ? [before[k]?.[0] ?? 0] : []));
      if (Math.abs(f.t - at) > 400) expect(hid).toEqual([]);
      if (hid.length > 0) expect(Math.max(...hid) - Math.min(...hid)).toBeLessThanOrEqual(0.45);
    });
    // Most of her body at once, for a moment: she fills much of her tall picture's width.
    const most = out.filter((f) => (f.people[0]?.points ?? []).filter((q) => q[3] < 0.5).length >= 20).length;
    expect(most).toBeGreaterThan(0);
  });

  it("the stream of numbers is the same for a seed", () => {
    const a = numbers(5);
    const b = numbers(5);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("the chip's gap is the phone's own, measured", () => {
  it("is kept for the chosen set-up, the graphics chip and the small model, on both squat videos", () => {
    const files = readdirSync(join(import.meta.dirname, "phone-points")).filter((f) => f.endsWith(".bodypoints")).sort();
    // Exactly the replays' set-ups and one chosen set-up run for each proof video (52a-iii): a run left over from a renamed
    // or removed video, or another set-up's run of a proof video, is a fault.
    const proof = MOVEMENT_VIDEOS.map((v) => `${basename(v.file)}.${PHONE_GAPS[0].run}.bodypoints`);
    expect(files).toEqual([...new Set([...PHONE_GAPS.flatMap((g) => g.videos.map((v) => `${v}.${g.run}.bodypoints`)), ...proof])].sort());
  });

  it("the phone's files say they are the phone's, under a name of their own, and set no number even if written as looked at", () => {
    for (const g of PHONE_GAPS) {
      for (const label of g.videos) {
        const file = readKept(new Uint8Array(readFileSync(join(import.meta.dirname, "phone-points", `${label}.${g.run}.bodypoints`))));
        expect(file.header.source).toBe("phone");
        expect(file.header.label).toBe(phoneLabel(label, g.run));
        expect(file.header.label).not.toBe(label);
        expect(videoOf(file).sets).toBe(false);
        // Written as looked at, under its very check number: still refused, for being the phone's.
        const looked = { [file.header.label]: { sets: true, sha256: file.sha256, seen: "drawn and looked at" } };
        const judged = videoOf(file, looked);
        expect(judged.sets).toBe(false);
        expect(judged.why).toMatch(/phone's reading/);
      }
    }
  });

  it("the chosen set-up's foot points lie 0.7 to 1.1 cm up or down from the laptop's in 95 of 100, as measured (51b-i's runs)", () => {
    const gaps = phoneGap("pose_landmarker_full.cpu.t4");
    expect(gaps.length).toBe(327 + 224);
    const feet = gaps.flatMap((frame) => [29, 30, 31, 32].flatMap((k) => {
      const o = frame[k] ?? null;
      return o === null ? [] : [Math.abs(o.picture[1])];
    }));
    expect(quantile(feet, 0.95)).toBeGreaterThan(0.006);
    expect(quantile(feet, 0.95)).toBeLessThan(0.012);
  });
});

describe("on the floor: the phone redrawn lower (52a-ii-b-ii)", () => {
  it("drawn from the phone's own place, the picture, the 3D points and 'down' come back exactly", () => {
    const out = redraw(FRAMES, { height: 1, from: [0, 0, 0], lean: 0, back: 0 });
    expect(out.length).toBe(FRAMES.length);
    let points = 0;
    out.forEach((f, i) => {
      const was = FRAMES[i];
      expect(f.down).toEqual(was?.down);
      f.people.forEach((p, n) => {
        const o = was?.people[n];
        p.points.forEach((q, k) => {
          expect(q).toEqual(o?.points[k]);
          points++;
        });
        expect(p.world).toEqual(o?.world);
      });
    });
    expect(points).toBeGreaterThan(30 * 33);
  });

  // A body the phone saw exactly: its picture the true projection of its 3D points, the phone 0.95 m above the floor,
  // level, the hips 2.5 m away. Redrawn from the floor, it lands where the floor phone, at the place the redraw chose,
  // would see the same 3D points.
  const focal = focalOf(ASPECT);
  const height = 0.95;
  const depth = 2.5;
  const world = standingWorld();
  // The toes are the lowest point, 0.9 m under the hips: the floor lies `height` under the phone.
  const atCamera = world.map(([x = 0, y = 0, z = 0]) => [x, y + height - 0.9, z + depth]);
  const picture = (q: readonly number[]): [number, number] => [(focal * (q[0] ?? 0)) / (q[2] ?? 1) / ASPECT + 0.5, (focal * (q[1] ?? 0)) / (q[2] ?? 1) + 0.5];
  const exact: MovementFrame[] = Array.from({ length: 60 }, (_, n) => ({
    t: Math.round((n * 1000 * 10) / 30) / 10,
    aspect: ASPECT,
    down: [0, 1, 0],
    people: [{ points: atCamera.map((q) => [...picture(q), 0, 0.99, 0.99]), world: world.map(([x = 0, y = 0, z = 0]): [number, number, number] => [x, y, z]) }],
  }));

  it("finds the phone's height above the floor and puts the floor phone at the lens's height, leaning back as asked", () => {
    const camera = floorCamera(exact, FLOOR_LENS, (FLOOR_LEAN * Math.PI) / 180);
    expect(camera).not.toBeNull();
    expect(Math.abs((camera?.height ?? 0) - height)).toBeLessThan(0.02);
    expect(camera?.from[1]).toBeCloseTo((camera?.height ?? 0) - FLOOR_LENS, 9);
    expect(camera?.lean).toBeCloseTo((-FLOOR_LEAN * Math.PI) / 180, 9);
  });

  it("a body the phone saw exactly is drawn within a centimetre of where the floor phone sees it", () => {
    const camera = floorCamera(exact, FLOOR_LENS, (FLOOR_LEAN * Math.PI) / 180);
    if (camera === null) throw new Error("no camera");
    const c = Math.cos(camera.lean);
    const s = Math.sin(camera.lean);
    const out = onTheFloor(FLOOR_LENS, FLOOR_LEAN)(exact);
    const misses = (out[30]?.people[0]?.points ?? []).map((q, i) => {
      const at = atCamera[i] ?? [0, 0, 1];
      const v = [(at[0] ?? 0) - camera.from[0], (at[1] ?? 0) - camera.from[1], (at[2] ?? 0) - camera.from[2]];
      const want = picture([v[0] ?? 0, (v[1] ?? 0) * c - (v[2] ?? 0) * s, (v[1] ?? 0) * s + (v[2] ?? 0) * c]);
      // Metres at the body: picture heights over the picture heights a metre is there.
      return Math.hypot((q[0] - want[0]) * ASPECT, q[1] - want[1]) / (focal / depth);
    });
    expect(misses).toHaveLength(33);
    expect(Math.max(...misses)).toBeLessThan(0.01);
    // And the floor phone sees him from below: his feet nearer its middle line than his hips are to theirs before.
    const feetBefore = exact[30]?.people[0]?.points[31]?.[1] ?? 0;
    const feetAfter = out[30]?.people[0]?.points[31]?.[1] ?? 0;
    expect(Math.abs(feetAfter - 0.5)).toBeLessThan(Math.abs(feetBefore - 0.5) + 0.2);
  });
});
