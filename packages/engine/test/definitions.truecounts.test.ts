// Every stored clip's count, judged by finished stand-ups on the clip's hip-height
// curve, not the old Python program's numbers. The one place the engine is short of
// a person's count is named in its line.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exerciseDefinitionSchema } from "@app/shared";
import { compileDefinition, createSession, parseTrace, replay } from "../src/index.js";

const ROOT = join(import.meta.dirname, "traces");
const CASES: [file: string, reps: number, what: string][] = [
  ["parity/sqauta_sideview1goodform", 2, "third rep never stands up before the clip ends"],
  ["parity/squat_sideview2goodform", 2, "deep squats"],
  ["parity/squat_badform_sideview", 3, "first rep shallow, 111 degrees on the camera-side knee"],
  ["parity/chairsquat_sideview_badform", 4, "shallow"],
  ["parity/Chair_squats_goodform_sideview2", 3, "upright picture"],
  ["parity/Chair_Squat_goodform_sideview1", 3, "a person counts 4: the fourth stands on the last frames and the average lags (item 52)"],
  ["parity/jump_squat_goodform_sideview2", 4, "the old program said 2"],
  ["parity/jumpsquat_fast_reps_uncounted_by_legacy_side", 5, "fast; straight each time, but the average lags"],
  ["parity/jump_squat_badform_sideview", 0, "knees stay above 150 degrees: no squat"],
  ["regression/squat_sitting_idle_desk_nocount", 0, "sitting at a desk"],
];

describe("each stored clip's count", () => {
  for (const [file, reps, what] of CASES) {
    it(`${file}: ${String(reps)} (${what})`, () => {
      const trace = parseTrace(readFileSync(join(ROOT, `${file}.jsonl`), "utf8"));
      const raw: unknown = JSON.parse(
        readFileSync(
          join(import.meta.dirname, `../src/definitions/${trace.header.exercise}.json`),
          "utf8",
        ),
      );
      const def = exerciseDefinitionSchema.parse(raw);
      expect(replay(createSession(compileDefinition(def, 1)), trace).summary.reps).toBe(reps);
    });
  }
});
