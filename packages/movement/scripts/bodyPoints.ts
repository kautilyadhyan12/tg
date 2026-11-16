// A body-points file: what a pose model saw in a video, small enough to keep in git
// (spec Part 2 §12.7). Every frame, every person in it, the picture's points, the 3D
// points and how sure the model was. Each number is rounded ONCE, to a fixed step far
// finer than the model's own shake: on four of Kd's videos (2026-11-16) a point's
// frame-to-frame jitter was at least 0.0009 of the picture, 0.019 of its depth and
// 1.5 mm in 3D, so a step of 0.00001, 0.0001 and 0.01 mm moves no joint angle by more
// than 0.03 degrees.
//
// The bytes. Whole numbers are written 7 bits a byte (LEB128), signed ones zig-zagged,
// and every point's numbers as the change from the same place in the frame before:
//   "BODYPTS" · format 1 · how many steps make one unit, for time, picture, depth,
//   sureness and 3D (five numbers: the file says its own rounding, so a later change of
//   SCALE can never read it wrong) · header length · header (JSON, plain characters
//   only) · number of frames · frames · CRC-32 of everything before it.
// A frame: its time's change, in time steps (never 0) · one byte saying
// whether the picture's shape (8 bytes) or which way is down (3 × 8 bytes, or "not
// known") follows · the number of people · for each person, one byte saying whether 3D
// points follow, then 33 × [x, y, depth, visibility, presence] and 33 × [x, y, z].
// A file that fails any check is refused whole, never read in part or read wrong.
import {
  KEYPOINT_COUNT,
  MAX_PEOPLE,
  bodyPointsHeaderSchema,
  movementFrameSchema,
  type BodyPointsHeader,
  type MovementFrame,
} from "@app/shared";

export const FORMAT = 1;
const MAGIC = [0x42, 0x4f, 0x44, 0x59, 0x50, 0x54, 0x53]; // "BODYPTS"
const LONGEST_HEADER = 65536;

export const KINDS = ["time", "picture", "depth", "sure", "world"] as const;
export type Kind = (typeof KINDS)[number];
export type Scale = Readonly<Record<Kind, number>>;

/** How many steps make one unit, for each kind of number a file written now keeps. */
export const SCALE: Scale = {
  /** milliseconds: a tenth of one */
  time: 10,
  /** x and y, shares of the picture: 1/100,000 of it */
  picture: 100000,
  /** the picture point's depth, the noisiest number the model gives */
  depth: 10000,
  /** visibility and presence */
  sure: 10000,
  /** the 3D points, metres: a hundredth of a millimetre */
  world: 100000,
};
/** The finest a file may say its numbers were kept to: no step this fine is ever needed. */
const MOST_PER_UNIT = 10_000_000;
const POINT_KINDS: readonly Kind[] = ["picture", "picture", "depth", "sure", "sure"];

const ASPECT_FOLLOWS = 1;
const DOWN_FOLLOWS = 2;
const DOWN_UNKNOWN = 4;
const WORLD_FOLLOWS = 1;

export class BodyPointsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BodyPointsError";
  }
}

// ── CRC-32, the one zip and PNG use (IEEE 802.3) ───────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array, end: number = bytes.length): number {
  let c = 0xffffffff;
  for (let i = 0; i < end; i++) c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── Whole numbers ──────────────────────────────────────────────────────────────────
const LARGEST_SIGNED = 2 ** 52 - 1;

function zigzag(n: number): number {
  return n >= 0 ? 2 * n : -2 * n - 1;
}
function unzigzag(u: number): number {
  return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
}

/** A number as whole steps of its kind. Throws for one no file could hold. */
export function toSteps(value: number, kind: Kind, scale: Scale = SCALE): number {
  const n = Math.round(value * scale[kind]);
  if (!Number.isSafeInteger(n) || Math.abs(n) > LARGEST_SIGNED) {
    throw new BodyPointsError(`${String(value)} is too large to keep as a ${kind} number`);
  }
  return n + 0; // never -0
}

export function fromSteps(n: number, kind: Kind, scale: Scale = SCALE): number {
  return n / scale[kind];
}

class Writer {
  private buf = new Uint8Array(1 << 16);
  private length = 0;

  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(b: number): void {
    this.room(1);
    this.buf[this.length++] = b;
  }
  bytes(list: readonly number[] | Uint8Array): void {
    for (const b of list) this.byte(b);
  }
  whole(u: number): void {
    let rest = u;
    while (rest >= 128) {
      this.byte((rest % 128) | 128);
      rest = Math.floor(rest / 128);
    }
    this.byte(rest);
  }
  signed(n: number): void {
    if (Math.abs(n) > LARGEST_SIGNED) throw new BodyPointsError("a change between two frames is too large to keep");
    this.whole(zigzag(n));
  }
  float(v: number): void {
    this.room(8);
    new DataView(this.buf.buffer, this.buf.byteOffset + this.length, 8).setFloat64(0, v, true);
    this.length += 8;
  }
  done(): Uint8Array {
    this.room(4);
    const out = this.buf.slice(0, this.length + 4);
    new DataView(out.buffer).setUint32(this.length, crc32(out, this.length), true);
    return out;
  }
}

class Reader {
  pos = 0;
  constructor(
    private readonly buf: Uint8Array,
    private readonly end: number,
  ) {}

  byte(): number {
    const b = this.pos < this.end ? this.buf[this.pos] : undefined;
    if (b === undefined) throw new BodyPointsError("the file ends too soon");
    this.pos++;
    return b;
  }
  whole(): number {
    let value = 0;
    let unit = 1;
    // 8 bytes hold 56 bits, more than any number a file of ours holds.
    for (let i = 0; i < 8; i++) {
      const b = this.byte();
      value += (b & 0x7f) * unit;
      if ((b & 0x80) === 0) {
        if (i > 0 && b === 0) throw new BodyPointsError("a number in the file is written in a way this format never writes");
        if (!Number.isSafeInteger(value)) break;
        return value;
      }
      unit *= 128;
    }
    throw new BodyPointsError("a number in the file is longer than any this format writes");
  }
  signed(): number {
    return unzigzag(this.whole());
  }
  float(): number {
    if (this.pos + 8 > this.end) throw new BodyPointsError("the file ends too soon");
    const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, true);
    this.pos += 8;
    return v;
  }
}

// ── The file ───────────────────────────────────────────────────────────────────────
function sameDown(a: MovementFrame["down"], b: MovementFrame["down"]): boolean {
  if (a === null || b === null) return a === b;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** The frames are those `movementFrameSchema` accepted, in the order they were seen.
 *  `scale` is SCALE but in the tests, which make files of another rounding with it. */
export function encodeBodyPoints(header: BodyPointsHeader, frames: readonly MovementFrame[], scale: Scale = SCALE): Uint8Array {
  const checkedHeader = bodyPointsHeaderSchema.parse(header);
  if (frames.length === 0) throw new BodyPointsError("a body-points file needs at least one frame");
  const json = JSON.stringify(checkedHeader);
  if (json.length > LONGEST_HEADER || /[^\x20-\x7e]/.test(json)) {
    throw new BodyPointsError("the header must be short and plain characters only");
  }

  const w = new Writer();
  w.bytes(MAGIC);
  w.byte(FORMAT);
  for (const kind of KINDS) {
    if (!Number.isInteger(scale[kind]) || scale[kind] < 1 || scale[kind] > MOST_PER_UNIT) throw new BodyPointsError(`no file keeps ${kind} numbers that way`);
    w.whole(scale[kind]);
  }
  w.whole(json.length);
  for (let i = 0; i < json.length; i++) w.byte(json.charCodeAt(i));
  w.whole(frames.length);

  const lastPoints: number[][] = [];
  const lastWorld: number[][] = [];
  let lastT = -1;
  let last: MovementFrame | null = null;
  frames.forEach((frame, f) => {
    const t = toSteps(frame.t, "time", scale);
    if (t <= lastT) {
      throw new BodyPointsError(`frame ${String(f + 1)} is not later than the one before it, to the file's time step`);
    }
    w.whole(last === null ? t : t - lastT);
    lastT = t;

    let flags = 0;
    if (last === null || last.aspect !== frame.aspect) flags |= ASPECT_FOLLOWS;
    if (last === null || !sameDown(last.down, frame.down)) flags |= frame.down === null ? DOWN_UNKNOWN : DOWN_FOLLOWS;
    w.byte(flags);
    if (flags & ASPECT_FOLLOWS) w.float(frame.aspect);
    if (flags & DOWN_FOLLOWS && frame.down !== null) for (const v of frame.down) w.float(v);

    if (frame.people.length > MAX_PEOPLE) throw new BodyPointsError(`frame ${String(f + 1)} holds more than ${String(MAX_PEOPLE)} people`);
    w.whole(frame.people.length);
    frame.people.forEach((person, p) => {
      w.byte(person.world === null ? 0 : WORLD_FOLLOWS);
      const before = (lastPoints[p] ??= new Array<number>(KEYPOINT_COUNT * 5).fill(0));
      for (let i = 0; i < KEYPOINT_COUNT; i++) {
        const point = person.points[i];
        if (point === undefined) throw new BodyPointsError(`frame ${String(f + 1)}: a person has fewer than ${String(KEYPOINT_COUNT)} points`);
        point.forEach((v, k) => {
          const n = toSteps(v, POINT_KINDS[k] ?? "picture", scale);
          const at = i * 5 + k;
          w.signed(n - (before[at] ?? 0));
          before[at] = n;
        });
      }
      if (person.world === null) return;
      const beforeWorld = (lastWorld[p] ??= new Array<number>(KEYPOINT_COUNT * 3).fill(0));
      for (let i = 0; i < KEYPOINT_COUNT; i++) {
        const point = person.world[i];
        if (point === undefined) throw new BodyPointsError(`frame ${String(f + 1)}: a person has fewer than ${String(KEYPOINT_COUNT)} 3D points`);
        point.forEach((v, k) => {
          const n = toSteps(v, "world", scale);
          const at = i * 3 + k;
          w.signed(n - (beforeWorld[at] ?? 0));
          beforeWorld[at] = n;
        });
      }
    });
    last = frame;
  });
  return w.done();
}

export interface BodyPoints {
  header: BodyPointsHeader;
  frames: MovementFrame[];
  /** How finely this file's numbers were kept, as the file itself says. */
  scale: Scale;
}

export function decodeBodyPoints(file: Uint8Array): BodyPoints {
  const end = file.length - 4;
  if (end < MAGIC.length + 1 || MAGIC.some((b, i) => file[i] !== b)) {
    throw new BodyPointsError("this is not a body-points file");
  }
  const format = file[MAGIC.length];
  if (format !== FORMAT) {
    throw new BodyPointsError(`this body-points file is format ${String(format)}; this tool reads format ${String(FORMAT)}`);
  }
  if (new DataView(file.buffer, file.byteOffset, file.length).getUint32(end, true) !== crc32(file, end)) {
    throw new BodyPointsError("this body-points file is damaged: its check number does not match");
  }

  const r = new Reader(file, end);
  r.pos = MAGIC.length + 1;
  const perUnit = KINDS.map(() => r.whole());
  if (perUnit.some((n) => n < 1 || n > MOST_PER_UNIT)) throw new BodyPointsError("the file says its numbers were kept in a way no file keeps them");
  const [time, picture, depth, sure, world] = perUnit;
  const scale: Scale = { time: time ?? 0, picture: picture ?? 0, depth: depth ?? 0, sure: sure ?? 0, world: world ?? 0 };
  const headerLength = r.whole();
  if (headerLength > LONGEST_HEADER || r.pos + headerLength > end) throw new BodyPointsError("the header's length is impossible");
  let json = "";
  for (let i = 0; i < headerLength; i++) {
    const c = r.byte();
    if (c < 0x20 || c > 0x7e) throw new BodyPointsError("the header holds a character that is not plain");
    json += String.fromCharCode(c);
  }
  let rawHeader: unknown;
  try {
    rawHeader = JSON.parse(json);
  } catch {
    throw new BodyPointsError("the header is not readable");
  }
  const checkedHeader = bodyPointsHeaderSchema.safeParse(rawHeader);
  if (!checkedHeader.success) throw new BodyPointsError(`the header is not a body-points header: ${checkedHeader.error.message}`);

  const count = r.whole();
  if (count === 0 || count > end - r.pos) throw new BodyPointsError("the number of frames is impossible");
  const lastPoints: number[][] = [];
  const lastWorld: number[][] = [];
  const frames: MovementFrame[] = [];
  let t = 0;
  let aspect: number | null = null;
  let down: [number, number, number] | null | undefined;
  for (let f = 0; f < count; f++) {
    const step = r.whole();
    if (f > 0 && step === 0) throw new BodyPointsError(`frame ${String(f + 1)} has the same time as the one before it`);
    t = f === 0 ? step : t + step;

    const flags = r.byte();
    if ((flags & ~(ASPECT_FOLLOWS | DOWN_FOLLOWS | DOWN_UNKNOWN)) !== 0 || (flags & DOWN_FOLLOWS && flags & DOWN_UNKNOWN)) {
      throw new BodyPointsError(`frame ${String(f + 1)} is marked in a way this format never writes`);
    }
    if (flags & ASPECT_FOLLOWS) aspect = r.float();
    if (flags & DOWN_FOLLOWS) down = [r.float(), r.float(), r.float()];
    if (flags & DOWN_UNKNOWN) down = null;
    if (aspect === null || down === undefined) {
      throw new BodyPointsError("the first frame does not say the picture's shape and which way is down");
    }

    const peopleCount = r.whole();
    if (peopleCount > MAX_PEOPLE) throw new BodyPointsError(`frame ${String(f + 1)} holds more than ${String(MAX_PEOPLE)} people`);
    const people: { points: number[][]; world: number[][] | null }[] = [];
    for (let p = 0; p < peopleCount; p++) {
      const personFlags = r.byte();
      if ((personFlags & ~WORLD_FOLLOWS) !== 0) throw new BodyPointsError(`frame ${String(f + 1)} is marked in a way this format never writes`);
      const before = (lastPoints[p] ??= new Array<number>(KEYPOINT_COUNT * 5).fill(0));
      const points: number[][] = [];
      for (let i = 0; i < KEYPOINT_COUNT; i++) {
        const point: number[] = [];
        for (let k = 0; k < 5; k++) {
          const at = i * 5 + k;
          const n = (before[at] ?? 0) + r.signed();
          before[at] = n;
          point.push(fromSteps(n, POINT_KINDS[k] ?? "picture", scale));
        }
        points.push(point);
      }
      let world: number[][] | null = null;
      if (personFlags & WORLD_FOLLOWS) {
        const beforeWorld = (lastWorld[p] ??= new Array<number>(KEYPOINT_COUNT * 3).fill(0));
        world = [];
        for (let i = 0; i < KEYPOINT_COUNT; i++) {
          const point: number[] = [];
          for (let k = 0; k < 3; k++) {
            const at = i * 3 + k;
            const n = (beforeWorld[at] ?? 0) + r.signed();
            beforeWorld[at] = n;
            point.push(fromSteps(n, "world", scale));
          }
          world.push(point);
        }
      }
      people.push({ points, world });
    }
    const frame = movementFrameSchema.safeParse({ t: fromSteps(t, "time", scale), aspect, down, people });
    if (!frame.success) throw new BodyPointsError(`frame ${String(f + 1)} is not a possible frame: ${frame.error.message}`);
    frames.push(frame.data);
  }
  if (r.pos !== end) throw new BodyPointsError("the file holds bytes after its last frame");
  return { header: checkedHeader.data, frames, scale };
}

// ── How far a file is from what was measured ───────────────────────────────────────
export type Changes = Record<Kind, number>;

/** Half of each kind's step: no number in a file may be further than this from what
 *  was measured (and a hair more, for the last digit of a decimal). */
export const HALF_STEP: Changes = {
  time: 0.5 / SCALE.time,
  picture: 0.5 / SCALE.picture,
  depth: 0.5 / SCALE.depth,
  sure: 0.5 / SCALE.sure,
  world: 0.5 / SCALE.world,
};
const SLACK = 1 + 1e-9;

/** The largest difference of each kind between two runs of the same frames. Throws when
 *  they are not the same frames at all: a person missing, 3D points lost, another shape. */
export function largestChanges(measured: readonly MovementFrame[], kept: readonly MovementFrame[]): Changes {
  if (measured.length !== kept.length) throw new BodyPointsError(`${String(measured.length)} frames were measured and ${String(kept.length)} kept`);
  const most: Changes = { time: 0, picture: 0, depth: 0, sure: 0, world: 0 };
  const note = (kind: Kind, a: number, b: number): void => {
    most[kind] = Math.max(most[kind], Math.abs(a - b));
  };
  measured.forEach((m, f) => {
    const k = kept[f];
    const at = `frame ${String(f + 1)}`;
    if (k === undefined || m.people.length !== k.people.length) throw new BodyPointsError(`${at}: the number of people differs`);
    if (m.aspect !== k.aspect || !sameDown(m.down, k.down)) throw new BodyPointsError(`${at}: the picture's shape or which way is down differs`);
    note("time", m.t, k.t);
    m.people.forEach((mp, p) => {
      const kp = k.people[p];
      if (kp === undefined || (mp.world === null) !== (kp.world === null)) throw new BodyPointsError(`${at}: a person's 3D points differ`);
      mp.points.forEach((point, i) => {
        point.forEach((v, n) => {
          note(POINT_KINDS[n] ?? "picture", v, kp.points[i]?.[n] ?? Number.NaN);
        });
      });
      mp.world?.forEach((point, i) => {
        point.forEach((v, n) => {
          note("world", v, kp.world?.[i]?.[n] ?? Number.NaN);
        });
      });
    });
  });
  for (const kind of KINDS) {
    if (Number.isNaN(most[kind])) throw new BodyPointsError(`a ${kind} number is missing`);
  }
  return most;
}

/** The kinds whose largest change is more than half a step: empty for a sound file. */
export function beyondHalfStep(changes: Changes): Kind[] {
  return KINDS.filter((k) => !(changes[k] <= HALF_STEP[k] * SLACK));
}
