// The worst thing this step could do: the same squat counted differently because
// of how the phone is held, or a frame of unknown shape deciding anything.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_ASPECT as SCHEMA_MAX,
  MIN_ASPECT as SCHEMA_MIN,
  cameraFrameSchema,
  exerciseDefinitionSchema,
} from "@app/shared";
import {
  MAX_ASPECT,
  MIN_ASPECT,
  TraceParseError,
  calculateAngle,
  compileDefinition,
  createSession,
  parseTrace,
  replay,
  serializeTrace,
  toTrueProportions,
  type Trace,
} from "../../src/index.js";
import { must } from "../fixtures.js";

const TRACES = join(import.meta.dirname, "../traces/parity");
const DEFS = join(import.meta.dirname, "../../src/definitions");
const NAMES = readdirSync(TRACES).filter((f) => f.endsWith(".jsonl") && !f.includes("responses"));

function load(name: string): Trace {
  return parseTrace(readFileSync(join(TRACES, name), "utf8"));
}
function run(trace: Trace) {
  const raw: unknown = JSON.parse(
    readFileSync(join(DEFS, `${trace.header.exercise}.json`), "utf8"),
  );
  const def = exerciseDefinitionSchema.parse(raw);
  return replay(createSession(compileDefinition(def, 1)), trace);
}
/** The same body as the pose model would report it on a picture of another shape. */
function redrawn(trace: Trace, aspect: number): Trace {
  return {
    header: { ...trace.header, aspect },
    frames: trace.frames.map((f) => ({
      t: f.t,
      aspect,
      kp: f.kp.map(([x, y, z, v]): [number, number, number, number] => [
        (x * f.aspect) / aspect,
        y,
        z,
        v,
      ]),
    })),
  };
}

describe("the same body on any picture shape", () => {
  for (const name of NAMES) {
    it(`${name}: same reps and scores upright, sideways and square`, () => {
      const trace = load(name);
      const original = run(trace);
      for (const aspect of [9 / 16, 3 / 4, 1, 4 / 3, 16 / 9]) {
        const other = run(redrawn(trace, aspect));
        expect(other.summary.reps).toBe(original.summary.reps);
        expect(other.repEvents.map((e) => e.score)).toEqual(original.repEvents.map((e) => e.score));
      }
    });
  }

  it("a true 115° reads 115° on 16:9 and on 9:16", () => {
    const rad = (115 * Math.PI) / 180;
    const body = [
      [0, -1],
      [0, 0],
      [Math.sin(rad), -Math.cos(rad)],
    ];
    for (const aspect of [16 / 9, 9 / 16]) {
      const kp = body.map(([x = 0, y = 0]): [number, number, number, number] => [
        (x + 2) / aspect,
        y + 2,
        0,
        1,
      ]);
      const out = toTrueProportions({ t: 0, aspect, kp }).kp;
      expect(calculateAngle(must(out[0]), must(out[1]), must(out[2]))).toBeCloseTo(115, 1);
    }
  });
});

describe("a frame of unknown shape decides nothing", () => {
  const bad = [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 0.1, 6, "16:9"];
  for (const aspect of bad) {
    it(`aspect ${String(aspect)} counts no reps`, () => {
      const trace = load("sqauta_sideview1goodform.jsonl");
      const frames = trace.frames.map((f) => ({ ...f, aspect })) as unknown as Trace["frames"];
      const result = run({ header: trace.header, frames });
      expect(result.summary.reps).toBe(0);
      expect(must(result.frameResults.at(-1)).visibilityOk).toBe(false);
    });
  }

  it("the engine's bounds are the schema's", () => {
    expect([MIN_ASPECT, MAX_ASPECT]).toEqual([SCHEMA_MIN, SCHEMA_MAX]);
    expect(cameraFrameSchema.safeParse({ t: 0, kp: [] }).success).toBe(false);
  });
});

describe("a trace says its picture's shape", () => {
  const body = load("sqauta_sideview1goodform.jsonl");
  it("no shape in the header is refused", () => {
    const header: Record<string, unknown> = { ...body.header };
    delete header["aspect"];
    const line = JSON.stringify({ t: 0, kp: must(body.frames[0]).kp });
    expect(() => parseTrace(`${JSON.stringify(header)}\n${line}\n`)).toThrow(TraceParseError);
  });
  it("a round trip keeps a frame whose shape differs from the header's", () => {
    const f = must(body.frames[0]);
    const g = { ...must(body.frames[1]), aspect: 16 / 9 };
    const back = parseTrace(serializeTrace({ header: body.header, frames: [f, g] }));
    expect(back.frames.map((x) => x.aspect)).toEqual([body.header.aspect, 16 / 9]);
  });
});
