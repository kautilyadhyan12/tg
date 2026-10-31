// How deep counts, on a drawn side-on body with known true knee angles. No stored
// clip holds a shallow bend, so this pins the side of the line real clips cannot.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exerciseDefinitionSchema, type CameraFrame } from "@app/shared";
import { compileDefinition, createSession } from "../src/index.js";

const THIGH = 0.2;
const SHIN = 0.2;
const FRAME_MS = 66.7;

/** A person facing right, ankle fixed, shin and thigh leaning equally. */
function body(kneeDeg: number, t: number, aspect: number): CameraFrame {
  const lean = ((180 - kneeDeg) / 2) * (Math.PI / 180);
  const ankle = { x: 0.5, y: 0.9 };
  const knee = { x: ankle.x + SHIN * Math.sin(lean), y: ankle.y - SHIN * Math.cos(lean) };
  const hip = { x: knee.x - THIGH * Math.sin(lean), y: knee.y - THIGH * Math.cos(lean) };
  const shoulder = { x: hip.x, y: hip.y - 0.25 };
  const row = (p: { x: number; y: number }): [number, number, number, number] => [
    p.x / aspect,
    p.y,
    0,
    0.9,
  ];
  const kp = Array.from({ length: 33 }, () => row(shoulder));
  kp[11] = kp[12] = row(shoulder);
  kp[23] = kp[24] = row(hip);
  kp[25] = kp[26] = row(knee);
  kp[27] = kp[28] = row(ankle);
  return { t, aspect, kp };
}

function run(defName: string, angles: readonly number[], aspect: number) {
  const raw: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, `../src/definitions/${defName}.json`), "utf8"),
  );
  const session = createSession(compileDefinition(exerciseDefinitionSchema.parse(raw), 1));
  const scores: number[] = [];
  session.onRep?.((e) => scores.push(e.score));
  angles.forEach((a, i) => session.processFrame(body(a, i * FRAME_MS, aspect)));
  return { reps: session.end().reps, scores };
}

/** From one knee angle to another, then held there. */
function move(from: number, to: number): number[] {
  const ramp = Array.from({ length: 15 }, (_, i) => from + ((to - from) * (i + 1)) / 15);
  return [...ramp, ...Array.from({ length: 12 }, () => to)];
}

function squats(defName: string, bottomDeg: number, aspect: number) {
  const angles: number[] = Array.from({ length: 20 }, () => 175);
  for (let rep = 0; rep < 3; rep++) angles.push(...move(175, bottomDeg), ...move(bottomDeg, 175));
  return run(defName, angles, aspect);
}

describe("how deep counts, in true degrees, on any picture", () => {
  const cases: [def: string, bottom: number, reps: number][] = [
    ["squat", 165, 0],
    ["squat", 150, 0],
    ["squat", 140, 0],
    ["squat", 125, 3],
    ["squat", 100, 3],
    ["chair_squat", 150, 0],
    ["chair_squat", 140, 0],
    ["chair_squat", 125, 3],
    ["chair_squat", 80, 3],
    ["jump_squat", 150, 0],
    ["jump_squat", 140, 0],
    ["jump_squat", 120, 3],
  ];
  for (const [def, bottom, reps] of cases) {
    for (const aspect of [9 / 16, 16 / 9]) {
      it(`${def} to ${String(bottom)}° on ${aspect.toFixed(2)}: ${String(reps)} reps`, () => {
        expect(squats(def, bottom, aspect).reps).toBe(reps);
      });
    }
  }

  it("rising only to 150° between bottoms is one rep, finished by standing", () => {
    const angles: number[] = Array.from({ length: 20 }, () => 175);
    angles.push(...move(175, 100));
    for (let rep = 0; rep < 2; rep++) angles.push(...move(100, 150), ...move(150, 100));
    angles.push(...move(100, 175));
    expect(run("squat", angles, 9 / 16).reps).toBe(1);
  });

  it("squat's depth score: full from 110°, less at 120°", () => {
    expect(squats("squat", 105, 9 / 16).scores).toEqual([100, 100, 100]);
    // Depth 65 averaged with an upright trunk's 100; the old curve would give 77.
    expect(squats("squat", 120, 9 / 16).scores).toEqual([83, 83, 83]);
  });
});
