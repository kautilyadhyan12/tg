// The squat jump and the lunge (ROADMAP 52c-i) under every replay that must hold (scripts/replays.ts): nearer, farther,
// tilted, fewer and uneven pictures, shaky points, the phone's own chip gap, a passer-by, the reps done faster or slower.
// Their own videos count what a person counts by eye (the fewest a passer-by leaves), with every person's numbers and with
// their own left out; every other movement Kd's folders hold counts 0 and is told nothing; every lunge counted is given
// the leg the pictures show in front. A few minutes and about 2 GB: one of the proof files (vitest.config.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { holds, openRow, proofVideos, readExercise, readMovement, replayTable, runMovement, type ProofVideo, type ReplayRow } from "../scripts/movementCheck.js";
import { MOVEMENT_VIDEOS } from "../scripts/movementVideos.js";
import { isOther } from "../scripts/movementVideos.js";
import { REPLAYS } from "../scripts/replays.js";

const HELD = REPLAYS.filter((r) => r.hold);
const VIDEOS = proofVideos();

describe.each([readMovement("squat-jump"), readMovement("lunge")])("$name, under every held replay", (movement) => {
  // Worked out when this movement's tests run, so each can be run alone (`-t`): each table takes about 8 minutes.
  let rows: ReplayRow[] = [];
  beforeAll(() => {
    rows = replayTable(movement, VIDEOS, HELD).filter((r) => r.tried);
  }, 1_200_000);

  it("every held replay is tried on its own videos and on the other movements'", () => {
    expect(new Set(rows.map((r) => r.replay.name))).toEqual(new Set(HELD.map((r) => r.name)));
    expect(rows.filter((r) => r.entry.movement === movement.name).length).toBeGreaterThanOrEqual(HELD.length * 4);
  });

  it("its own videos hold, but the cases written on them", () => {
    const wrong = rows.filter((r) => r.entry.movement === movement.name && !holds(r) && !openRow(r)).map((r) => [r.replay.name, r.label, r.count, r.leftOut]);
    expect(wrong).toEqual([]);
  });

  it("every other movement counts 0 and is told nothing", () => {
    const others = rows.filter((r) => isOther(r.entry, movement.name));
    expect(others.filter((r) => r.count !== 0).map((r) => [r.replay.name, r.label, r.count])).toEqual([]);
    expect(others.flatMap((r) => r.reps.filter((x) => x.reason !== null).map((x) => [r.replay.name, r.label, x.reason]))).toEqual([]);
  });

  it("where it counts every lunge, each is given the leg the pictures show in front", () => {
    const own = rows.filter((r) => r.entry.movement === movement.name && r.entry.sides !== undefined);
    const sided = own.filter((r) => r.count === r.entry.sides?.length);
    for (const r of sided) {
      expect([r.replay.name, r.label, r.reps.filter((x) => x.verdict === "counted").map((x) => x.side)]).toEqual([r.replay.name, r.label, r.entry.sides]);
    }
    // Where a replay counts fewer, every lunge it counts is given the leg the eye gave it, never only one of the video's
    // legs (round one, T2): in a video with one leg throughout, that leg; in one whose legs take turns, the leg of the filmed
    // lunge it overlaps in time, which needs a replay that keeps the video's own clock (a passer-by does; the reps done
    // faster or slower do not, and those must count every lunge of such a video).
    const tempo = new Set(["faster", "slower", "twice as slow"]);
    for (const r of own.filter((x) => x.count < (x.entry.sides?.length ?? 0))) {
      const sides = r.entry.sides ?? [];
      const counted = r.reps.filter((y) => y.verdict === "counted");
      if (new Set(sides).size === 1) {
        for (const x of counted) expect([r.replay.name, r.label, x.side]).toEqual([r.replay.name, r.label, sides[0]]);
        continue;
      }
      expect([r.replay.name, r.label, tempo.has(r.replay.name)]).toEqual([r.replay.name, r.label, false]);
      const v = VIDEOS.find((x) => x.video.label === r.label);
      if (v === undefined) throw new Error(`no video ${r.label}`);
      const filmed = runMovement(movement, v.video).reps.filter((x) => x.verdict === "counted");
      expect([r.label, filmed.length]).toEqual([r.label, sides.length]);
      for (const x of counted) {
        const k = filmed.findIndex((f) => Math.min(f.end, x.end) > Math.max(f.start, x.start));
        expect([r.replay.name, r.label, k >= 0, x.side]).toEqual([r.replay.name, r.label, true, sides[k]]);
      }
    }
  });
});

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
