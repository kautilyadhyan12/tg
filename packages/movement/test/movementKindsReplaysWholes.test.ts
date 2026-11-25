// The squat under every replay that must hold, on the files ROADMAP 52c-i cuts into sets, seen whole: one of the proof
// files (vitest.config.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { proofVideos, readExercise, readMovement, replayTable, type ProofVideo, type ReplayRow } from "../scripts/movementCheck.js";
import { MOVEMENT_VIDEOS } from "../scripts/movementVideos.js";
import { REPLAYS } from "../scripts/replays.js";

const HELD = REPLAYS.filter((r) => r.hold);

describe("the squat sees the files this job cuts into sets whole, under every held replay: 0 and nothing told (round one, T3)", () => {
  // The squat jumps from their low first pictures, the rooftop lunges across their fade: the stretches the cut sets leave out.
  const files = ["squat_jump_1", "squat_jump_2", "squat_jump_3", "squat_jump_4", "fresh_lunge_forward_barbell_2"];
  let rows: ReplayRow[] = [];
  beforeAll(() => {
    const squat = readMovement("squat");
    const wholes: ProofVideo[] = proofVideos(
      files.map((name) => {
        const e = MOVEMENT_VIDEOS.find((x) => x.file === `movement-points/${name}`);
        if (e === undefined) throw new Error(`no video ${name}`);
        return { file: e.file, movement: e.movement, person: e.person, view: e.view, reps: e.reps, sets: false, seen: e.seen };
      }),
    );
    rows = replayTable(squat, wholes, HELD, readExercise("squat", squat)).filter((r) => r.tried);
  }, 600_000);

  it("each counts 0 and is told nothing", () => {
    expect(new Set(rows.map((r) => r.label))).toEqual(new Set(files));
    expect(rows.filter((r) => r.count !== 0).map((r) => [r.replay.name, r.label, r.count])).toEqual([]);
    expect(rows.flatMap((r) => r.reps.filter((x) => x.reason !== null).map((x) => [r.replay.name, r.label, x.reason]))).toEqual([]);
  });
});
