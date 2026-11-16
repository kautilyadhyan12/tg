// The small body-points file (ROADMAP 50c-i; spec Part 2 §12.7).
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: keep points that are not what the
// camera saw, so every count and every word of advice later set from them is wrong for
// somebody's body. So, on Kd's own videos: every number a file holds is within half a step
// of what the model gave, reading a file and writing it again changes not one byte, and a
// damaged file is refused whole, never read in part. The cases come from his videos: the
// first try at a small file broke on his barbell video, where an ankle lies at y 2.08, far
// below the picture, a number the try had assumed no point reaches.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { MovementFrame, SeenPerson } from "@app/shared";
import {
  BodyPointsError,
  FORMAT,
  HALF_STEP,
  KINDS,
  SCALE,
  beyondHalfStep,
  crc32,
  decodeBodyPoints,
  encodeBodyPoints,
  largestChanges,
  type BodyPoints,
} from "../scripts/bodyPoints.js";

const REPO = resolve(import.meta.dirname, "../../..");
const KEPT = join(import.meta.dirname, "body-points");
const FILES = readdirSync(KEPT).filter((f) => f.endsWith(".bodypoints")).sort();
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(join(KEPT, name)));
const stored: [string, Uint8Array, BodyPoints][] = FILES.map((name) => {
  const bytes = read(name);
  return [name, bytes, decodeBodyPoints(bytes)];
});

function refuses(bytes: Uint8Array): string {
  try {
    decodeBodyPoints(bytes);
  } catch (err) {
    expect(err).toBeInstanceOf(BodyPointsError);
    return err instanceof Error ? err.message : "";
  }
  throw new Error("the damaged file was read");
}

/** A body-points payload with its check number made right again: a damage the check
 *  number cannot see, so every other check must. */
function withCheck(payload: readonly number[]): Uint8Array {
  const out = new Uint8Array(payload.length + 4);
  out.set(payload);
  new DataView(out.buffer).setUint32(payload.length, crc32(out, payload.length), true);
  return out;
}
function payloadOf(file: Uint8Array): number[] {
  return [...file.subarray(0, file.length - 4)];
}
function varint(n: number): number[] {
  const out: number[] = [];
  let rest = n;
  while (rest >= 128) {
    out.push((rest % 128) | 128);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}
/** Splits a file into what comes before its header, the header, and what follows. */
/** Splits a file into what comes before its header (the name, the format and the five
 *  roundings), the header, and what follows. */
function parts(file: Uint8Array): { head: number[]; header: string; rest: number[] } {
  const payload = payloadOf(file);
  let pos = 8;
  const whole = (): number => {
    let value = 0;
    let unit = 1;
    for (;;) {
      const b = payload[pos++] ?? 0;
      value += (b & 0x7f) * unit;
      unit *= 128;
      if ((b & 0x80) === 0) return value;
    }
  };
  for (let k = 0; k < 5; k++) whole();
  const headEnd = pos;
  const length = whole();
  const header = String.fromCharCode(...payload.slice(pos, pos + length));
  return { head: payload.slice(0, headEnd), header, rest: payload.slice(pos + length) };
}
function f64(v: number): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...b];
}
function signed(n: number): number[] {
  return varint(n >= 0 ? 2 * n : -2 * n - 1);
}
/** One frame as the writer lays it out: its time step, the picture's shape and down on the
 *  first, then each person: a mark byte and 33 x 5 numbers, all 0 but the one given. */
function frameBytes(step: number, first: boolean, people: { mark?: number; at?: [number, number] }[]): number[] {
  const head = first ? [3, ...f64(0.5625), ...f64(0), ...f64(1), ...f64(0)] : [0];
  const persons = people.flatMap(({ mark = 0, at }) => [
    mark,
    ...Array.from({ length: 33 * 5 }, (_, i) => signed(at !== undefined && at[0] === i ? at[1] : 0)).flat(),
  ]);
  return [...varint(step), ...head, ...varint(people.length), ...persons];
}
function rebuilt(file: Uint8Array, header: string, rest?: number[]): Uint8Array {
  const p = parts(file);
  const chars = Array.from({ length: header.length }, (_, i) => header.charCodeAt(i));
  return withCheck([...p.head, ...varint(header.length), ...chars, ...(rest ?? p.rest)]);
}

/** Every number moved by a part of its own step, from -1/2 to +1/2, sureness kept a share. */
function offStep(frames: readonly MovementFrame[]): MovementFrame[] {
  const fractions = [0.49, -0.49, 0.5, -0.5, 0.3, -0.123, 0.0];
  let n = 0;
  const nudge = (v: number, scale: number): number => v + (fractions[n++ % fractions.length] ?? 0) / scale;
  const share = (v: number): number => Math.min(1, Math.max(0, nudge(v, SCALE.sure)));
  return frames.map((f) => ({
    ...f,
    t: nudge(f.t, SCALE.time),
    people: f.people.map((p) => ({
      points: p.points.map(([x, y, z, vis, pres]) => [nudge(x, SCALE.picture), nudge(y, SCALE.picture), nudge(z, SCALE.depth), share(vis), share(pres)]),
      world: p.world?.map(([x, y, z]) => [nudge(x, SCALE.world), nudge(y, SCALE.world), nudge(z, SCALE.world)]) ?? null,
    })),
  }));
}

function person(x: number, sure = 0.9, world = true): SeenPerson {
  return {
    points: Array.from({ length: 33 }, (_, i) => [x + i * 0.003, 0.2 + i * 0.025, -0.1 + i * 0.002, sure, sure]),
    world: world ? Array.from({ length: 33 }, (_, i) => [-0.3 + i * 0.012, -0.7 + i * 0.045, 0.02 * i]) : null,
  };
}

describe("a body-points file holds what the camera saw (the worst thing first)", () => {
  it("is kept for each of Kd's six reference videos", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
  });

  it.each(stored)("%s reads back to the very bytes it was kept as", (_name, bytes, decoded) => {
    expect(decoded.frames.length).toBeGreaterThan(0);
    expect(encodeBodyPoints(decoded.header, decoded.frames)).toEqual(bytes);
  });

  it.each(stored)("%s: a number between two steps comes back within half a step", (_name, _bytes, decoded) => {
    const measured = offStep(decoded.frames);
    const kept = decodeBodyPoints(encodeBodyPoints(decoded.header, measured)).frames;
    const changes = largestChanges(measured, kept);
    expect(beyondHalfStep(changes)).toEqual([]);
    // The nudges really reached half a step, so the bound was tested, not skirted.
    expect(changes.picture).toBeGreaterThan(HALF_STEP.picture * 0.9);
    expect(changes.world).toBeGreaterThan(HALF_STEP.world * 0.9);
  });

  it("Kd's videos hold the points that broke the first try, and they are kept", () => {
    const outside = stored.flatMap(([, , d]) => d.frames.flatMap((f) => f.people.flatMap((p) => p.points.filter(([x, y]) => y > 1.5 || y < -0.2 || x < -0.2 || x > 1.2))));
    expect(outside.length).toBeGreaterThan(0);
    const far: SeenPerson = person(0.4);
    far.points[28] = [0.612345678, 2.081234567, -2.107654321, 0.0001234, 0.000987];
    far.points[15] = [-0.40000049, 0.5, 2.55419, 1, 1];
    const frames: MovementFrame[] = [{ t: 0, aspect: 16 / 9, down: [0, 1, 0], people: [far] }];
    const kept = decodeBodyPoints(encodeBodyPoints(stored[0]?.[2].header ?? fail(), frames)).frames;
    expect(beyondHalfStep(largestChanges(frames, kept))).toEqual([]);
  });

  it("keeps every person in every frame, as many as come and go, in their order", () => {
    const header = stored[0]?.[2].header ?? fail();
    const frames: MovementFrame[] = [
      { t: 0, aspect: 0.5625, down: [0, 1, 0], people: [person(0.2)] },
      { t: 33.3, aspect: 0.5625, down: [0, 1, 0], people: [person(0.2), person(0.6, 0.4)] },
      { t: 66.7, aspect: 0.5625, down: [0, 1, 0], people: [person(0.6, 0.4), person(0.2)] },
      { t: 100, aspect: 0.5625, down: null, people: [] },
      { t: 133.3, aspect: 0.5625, down: [0.6, 0.8, 0], people: [person(0.25, 1, false)] },
      { t: 166.7, aspect: 1.7778, down: [0.6, 0.8, 0], people: Array.from({ length: 6 }, (_, n) => person(n * 0.15, 0.2 + n * 0.1, n % 2 === 0)) },
    ];
    const kept = decodeBodyPoints(encodeBodyPoints(header, frames)).frames;
    expect(beyondHalfStep(largestChanges(frames, kept))).toEqual([]);
    expect(kept.map((f) => f.people.length)).toEqual([1, 2, 2, 0, 1, 6]);
    expect(kept[2]?.people[0]?.points[0]?.[0]).toBeCloseTo(0.6, 5);
    expect(kept.map((f) => f.down)).toEqual([[0, 1, 0], [0, 1, 0], [0, 1, 0], null, [0.6, 0.8, 0], [0.6, 0.8, 0]]);
    expect(kept[4]?.people[0]?.world).toBeNull();
    expect(kept[5]?.aspect).toBe(1.7778);
  });

  it("holds the very numbers the model gave for Kd's videos, to half a step", () => {
    // From measured/<label>/measured.jsonl of the run that made the kept files (2026-11-16):
    // the numbers as the pose model gave them, before any rounding.
    const squat = stored.find(([n]) => n === "squat_reference.bodypoints")?.[2] ?? fail();
    const barbell = stored.find(([n]) => n === "barbell_bench_press_reference.bodypoints")?.[2] ?? fail();
    const given: [MovementFrame | undefined, number, number, readonly number[], readonly number[] | null][] = [
      [squat.frames[0], 0, 23, [0.7045101523399353, 0.5152546763420105, -0.2592650353908539, 0.99973064661026, 0.999924898147583], [0.00281211594119668, 0.01140730082988739, -0.07762414962053299]],
      [squat.frames[47], 0, 23, [0.8241519331932068, 0.6378673911094666, -0.181899294257164, 0.9999508857727051, 0.9999847412109375], [0.019282236695289612, 0.027079610154032707, -0.08675768226385117]],
      [squat.frames[326], 0, 28, [0.6345750689506531, 0.7869077920913696, 0.6728648543357849, 0.1461600363254547, 0.9997286200523376], null],
      [barbell.frames[68], 3, 0, [0.47326207160949707, 0.49221256375312805, 0.2440442591905594, 0.9999743700027466, 1.0], [-0.0037622731178998947, -0.2772924602031708, 0.08072585612535477]],
      [barbell.frames[26], 0, 31, [0.4049806296825409, 2.0269296169281006, 0.42722243070602417, 0.0005582713056355715, 0.0018798349192366004], null],
    ];
    expect([squat.frames[47]?.t, squat.frames[326]?.t, barbell.frames[68]?.t, barbell.frames[68]?.people.length]).toEqual([1566.7, 10866.7, 2266.7, 4]);
    const kinds = ["picture", "picture", "depth", "sure", "sure"] as const;
    for (const [frame, person, point, picture, world] of given) {
      const seen = frame?.people[person];
      picture.forEach((v, k) => {
        expect(Math.abs((seen?.points[point]?.[k] ?? Number.NaN) - v)).toBeLessThanOrEqual(HALF_STEP[kinds[k] ?? "picture"] * (1 + 1e-9));
      });
      world?.forEach((v, k) => {
        expect(Math.abs((seen?.world?.[point]?.[k] ?? Number.NaN) - v)).toBeLessThanOrEqual(HALF_STEP.world * (1 + 1e-9));
      });
    }
  });

  it("is read by its own rounding, so a later change of the steps cannot read it wrong", () => {
    const [, , decoded] = stored[0] ?? fail();
    const coarser = { ...SCALE, picture: 50000, world: 10000 };
    const other = encodeBodyPoints(decoded.header, decoded.frames, coarser);
    const read = decodeBodyPoints(other);
    expect(read.scale).toEqual(coarser);
    expect(other).not.toEqual(encodeBodyPoints(decoded.header, decoded.frames));
    const changes = largestChanges(decoded.frames, read.frames);
    expect(changes.picture).toBeLessThanOrEqual((0.5 / 50000) * (1 + 1e-9));
    expect(changes.world).toBeLessThanOrEqual((0.5 / 10000) * (1 + 1e-9));
    for (const [, , d] of stored) expect(d.scale).toEqual(SCALE);
    expect(() => encodeBodyPoints(decoded.header, decoded.frames, { ...SCALE, depth: 0 })).toThrow(/no file keeps depth/);
  });

  it("says which kind of number moved too far", () => {
    expect(beyondHalfStep({ time: 0, picture: HALF_STEP.picture * 1.01, depth: 0, sure: 0, world: Number.NaN })).toEqual(["picture", "world"]);
    expect(KINDS).toEqual(Object.keys(SCALE));
  });
});

describe("a damaged file is refused whole, never read in part", () => {
  const [name, file] = stored[0] ?? fail();

  it(`refuses ${name} cut short anywhere`, () => {
    for (let n = 0; n < 24; n++) {
      const at = Math.floor((n * (file.length - 1)) / 23);
      refuses(file.subarray(0, at));
    }
  });

  it("refuses one byte changed anywhere", () => {
    for (let n = 0; n < 60; n++) {
      const at = Math.floor((n * (file.length - 1)) / 59);
      for (const flip of [0x01, 0x80, 0xff]) {
        const bad = file.slice();
        bad[at] = (bad[at] ?? 0) ^ flip;
        refuses(bad);
      }
    }
  });

  it("refuses a file whose line ends were changed, as git does to text on Windows", () => {
    const lf = [...file].filter((b) => b === 0x0a).length;
    expect(lf).toBeGreaterThan(0);
    const crlf = new Uint8Array([...file].flatMap((b) => (b === 0x0a ? [0x0d, 0x0a] : [b])));
    refuses(crlf);
  });

  it("is a file git never treats as text", () => {
    const r = spawnSync("git", ["check-attr", "text", "diff", "--", "packages/movement/test/body-points/x.bodypoints"], { cwd: REPO, encoding: "utf8" });
    expect(r.stdout).toContain("text: unset");
    expect(r.stdout).toContain("diff: unset");
  });

  it("refuses what is not a body-points file", () => {
    expect(refuses(new TextEncoder().encode('{"traceVersion":1,"exercise":"squat"}\n{"t":0,"kp":[]}\n'))).toMatch(/not a body-points file/);
    expect(refuses(new Uint8Array(0))).toMatch(/not a body-points file/);
    expect(refuses(file.subarray(0, 11))).toMatch(/not a body-points file|damaged/);
  });

  it("refuses a file made in a later format, rather than misread it", () => {
    const later = file.slice();
    later[7] = FORMAT + 1;
    expect(refuses(later)).toMatch(/format 2/);
  });

  it("refuses a sound check number around a header that is not a body-points header", () => {
    const { header } = parts(file);
    expect(refuses(rebuilt(file, header.replace(/"label":"[^"]*"/, '"label":"D:/vidoe referene/squat"')))).toMatch(/not a body-points header/);
    expect(refuses(rebuilt(file, header.replace('"source":"video"', '"source":"phone"')))).toMatch(/not a body-points header/);
    expect(refuses(rebuilt(file, "{not json"))).toMatch(/not readable/);
  });

  it("refuses a sound check number around frames that cannot be", () => {
    const { header, rest } = parts(file);
    expect(refuses(rebuilt(file, header, [...rest, 0]))).toMatch(/after its last frame|ends too soon|impossible/);
    expect(refuses(rebuilt(file, header, [...varint(10 ** 9), ...rest.slice(varint(stored[0]?.[2].frames.length ?? 0).length)]))).toMatch(/impossible/);
    // One frame: time 0, the shape and down follow, then seven people.
    const seven = [...varint(1), 0, 3, ...new Array<number>(32).fill(0), 7];
    expect(refuses(rebuilt(file, header, seven))).toMatch(/more than 6 people/);
    const marked = [...varint(1), 0, 0x10];
    expect(refuses(rebuilt(file, header, marked))).toMatch(/never writes/);
    const noShape = [...varint(1), 0, 0, 0];
    expect(refuses(rebuilt(file, header, noShape))).toMatch(/first frame/);
  });

  it("refuses a sound check number around a person, a time or a number that cannot be", () => {
    const { header } = parts(file);
    const frames = (list: number[][]): Uint8Array => rebuilt(file, header, [...varint(list.length), ...list.flat()]);
    // The same bytes with possible numbers are read, so each refusal below is for its own reason.
    expect(decodeBodyPoints(frames([frameBytes(0, true, [{ at: [3, 10000] }])])).frames[0]?.people[0]?.points[0]?.[3]).toBe(1);
    expect(decodeBodyPoints(frames([frameBytes(0, true, []), frameBytes(1, false, [])])).frames.length).toBe(2);
    expect(refuses(frames([frameBytes(0, true, [{ at: [3, 10001] }])]))).toMatch(/not a possible frame/);
    expect(refuses(frames([frameBytes(0, true, []), frameBytes(0, false, [])]))).toMatch(/same time/);
    expect(refuses(frames([frameBytes(0, true, [{ mark: 2 }])]))).toMatch(/never writes/);
    // A time of 0 written in two bytes, where the writer uses one.
    expect(refuses(rebuilt(file, header, [...varint(1), 0x80, 0x00, ...frameBytes(0, true, []).slice(1)]))).toMatch(/never writes/);
    // A control character in the header, which the writer never puts there.
    expect(refuses(rebuilt(file, header.replace('"source"', String.fromCharCode(0x1f) + '"source"')))).toMatch(/not plain/);
  });

  it("refuses a file that says its numbers were kept in a way no file keeps them", () => {
    const { header, rest } = parts(file);
    const chars = Array.from({ length: header.length }, (_, i) => header.charCodeAt(i));
    const withSteps = (steps: number[]): Uint8Array => withCheck([...payloadOf(file).slice(0, 8), ...steps.flatMap(varint), ...varint(header.length), ...chars, ...rest]);
    expect(decodeBodyPoints(withSteps([10, 100000, 10000, 10000, 100000])).frames.length).toBeGreaterThan(0);
    expect(refuses(withSteps([10, 0, 10000, 10000, 100000]))).toMatch(/no file keeps/);
    expect(refuses(withSteps([10, 100000, 10000, 10000, 10 ** 9]))).toMatch(/no file keeps/);
  });
});

describe("the writer refuses what no file should hold", () => {
  const header = stored[0]?.[2].header ?? fail();
  const at = (t: number, people = [person(0.3)]): MovementFrame => ({ t, aspect: 0.5625, down: [0, 1, 0], people });

  it("refuses frames out of time, or two at one tenth of a millisecond", () => {
    expect(() => encodeBodyPoints(header, [at(10), at(5)])).toThrow(BodyPointsError);
    expect(() => encodeBodyPoints(header, [at(10), at(10)])).toThrow(BodyPointsError);
    expect(() => encodeBodyPoints(header, [at(10.01), at(10.04)])).toThrow(/not later/);
    expect(() => encodeBodyPoints(header, [])).toThrow(/at least one frame/);
  });

  it("refuses a header that could carry a path", () => {
    expect(() => encodeBodyPoints({ ...header, label: "C:\\Users\\kd\\squat" }, [at(0)])).toThrow();
  });

  it("refuses a number no file could hold, and more people than a frame holds", () => {
    const huge = person(0.3);
    huge.points[0] = [1e12, 0, 0, 1, 1];
    expect(() => encodeBodyPoints(header, [at(0, [huge])])).toThrow(/too large/);
    expect(() => encodeBodyPoints(header, [at(0, Array.from({ length: 7 }, () => person(0.3)))])).toThrow(/more than 6 people/);
  });
});

function fail(): never {
  throw new Error("no stored body-points file to test with");
}
