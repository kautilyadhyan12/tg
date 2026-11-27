// The form check's proof (ROADMAP 52b-ii-a; spec Part 2 §12.5): a few minutes on the laptop, so it runs with the other
// proof files (vitest.config.ts `PROOF_FILES`).
//   - Every good-form squat set under every replay that must hold (nearer, farther, tilted, fewer and uneven pictures,
//     shaky points, the chip's gap, a passer-by, faster and slower), with every person's numbers and with their own left
//     out: no mistake is ever marked (the worst thing: a person squatting properly told to change their form).
//   - The camera file's lines are what form-check sets from the videos.
//   - Each mistake the camera checks, drawn onto every rep of the real squats that reads it (scripts/mistakes.ts): just
//     past its line, the rep still counts and that mistake, and no other, is marked; just short of it, nothing is; and
//     the reading follows what was drawn (the search for each rep's size makes the reading meet its target, so that alone
//     would prove nothing about the reading).
import { describe, expect, it } from "vitest";
import { checkedOf } from "../src/index.js";
import { fitForm, formRows } from "../scripts/formCheck.js";
import { bendOf, drawnTo, kneesIn, leanForward, perRep, trunkOf, type DrawnRep } from "../scripts/mistakes.js";
import { runOf } from "../scripts/measureCheck.js";
import { LEAD_IN, proofVideos, readExercise, readMovement, replayTable, runMovement } from "../scripts/movementCheck.js";
import { REPLAYS } from "../scripts/replays.js";
import { correctionsOf, saidOf, speaking } from "../scripts/coachCheck.js";

const SQUAT = readMovement("squat");
const EXERCISE = readExercise("squat");
const VIDEOS = proofVideos();
const SETTING = VIDEOS.filter((v) => v.entry.movement === "squat" && v.video.sets);
const GOOD = VIDEOS.filter((v) => v.entry.movement === "squat" && v.entry.reps !== null && v.entry.open === undefined);
/** The camera file with every mistake it checks spoken (53b-i): the coach's worst case. */
const LOUD = speaking(EXERCISE, SQUAT);

describe("the worst thing, under every replay of the world: no proper squat is told to change its form", () => {
  const held = REPLAYS.filter((r) => r.hold);
  const rows = formRows(SQUAT, EXERCISE, held, VIDEOS);

  it("every good-form set under each of the 14 replays that must hold, and with its person left out", () => {
    expect(held.length).toBe(14);
    expect(rows.length).toBe(15 * 40);
  });

  it.each(held.map((r) => [r.name] as const))("%s: no mistake is marked, and nobody is told to keep the chest up", (name) => {
    const marked = rows.filter((r) => r.replay?.name === name && r.made.length > 0).map((r) => `${r.label}${r.leftOut ? " (left out)" : ""}: ${r.made.map((m) => m.mistake).join(", ")}`);
    expect(marked).toEqual([]);
    const told = rows.filter((r) => r.replay?.name === name && r.told.length > 0).map((r) => `${r.label}${r.leftOut ? " (left out)" : ""}: ${String(r.told.length)}`);
    expect(told).toEqual([]);
  });

  // 53b-i: the coach, every mistake the camera checks spoken, says nothing to a proper squat: no correction, no reason.
  it.each(["as filmed", ...held.map((r) => r.name)])("%s: the coach says nothing", (name) => {
    const said = rows.filter((r) => (r.replay?.name ?? "as filmed") === name && r.said.length > 0).map((r) => `${r.label}${r.leftOut ? " (left out)" : ""}: ${r.said.map((x) => x.words).join(" / ")}`);
    expect(said).toEqual([]);
  });
});

describe("the camera file's lines are what form-check sets", () => {
  it("each checked mistake's line, set from the nine people's good-form videos as filmed and replayed", () => {
    const fitted = fitForm(SQUAT, EXERCISE, SETTING);
    expect(fitted.map((f) => [f.mistake, f.bound])).toEqual(checkedOf(EXERCISE).map((m) => [m.id, m.atMost ?? m.atLeast]));
    expect(fitted.map((f) => [f.mistake, f.bound])).toEqual([
      ["lean_forward", 46],
      ["knees_cave_in", -0.12],
    ]);
  });
});

// 52b-ii-b, Kd's ruling of 2026-11-23: past the movement's "chest up" a squat is not counted, and is told "Keep your chest
// up." when it is a squat in every other way, in a set that has already counted a squat (round one). Kd's folder holds no
// squat done so, so the lean is drawn onto the real side-on squats, as the lean's own line was: past the line, on every rep
// but each set's first, which stays as filmed and counts.
describe("the chest drawn past chest up onto real squats: told to keep it up, or, where it reads as a hinge, silent", () => {
  const chest = SQUAT.rules.find((r) => r.name === "chest up")?.atMost ?? Number.NaN;
  const at = (r: { label: string; start: number }): string => `${r.label} ${(r.start / 1000).toFixed(1)} s`;
  const past = GOOD.flatMap((v) => drawnTo(SQUAT, EXERCISE, v.video, "lean_forward", leanForward, chest + 2, 70, 0.5, "refused", 1).map((r) => ({ label: v.video.label, ...r })));
  const short = GOOD.flatMap((v) => drawnTo(SQUAT, EXERCISE, v.video, "lean_forward", leanForward, chest - 2, 70, 0.5).map((r) => ({ label: v.video.label, ...r })));
  const counted = (v: (typeof GOOD)[number]) =>
    runMovement(SQUAT, v.video, EXERCISE)
      .reps.filter((r) => r.verdict === "counted")
      .map((r) => ({ start: r.start - LEAD_IN, end: r.end - LEAD_IN, lean: r.form.find((f) => f.mistake === "lean_forward")?.reading ?? null }));

  it("every side-on rep that reads the lean is drawn: past the line, each set's first left as filmed; short of it, all", () => {
    expect(chest).toBe(52);
    expect([past.length, short.length]).toEqual([15, 26]);
  });

  it("2 degrees past chest up: 13 reps not counted, each told \"Keep your chest up.\", the lean marked made", () => {
    const told = past.filter((r) => r.verdict === "refused");
    expect(told.length).toBe(13);
    expect(told.filter((r) => r.rule !== "chest up" || r.reason !== "Keep your chest up." || r.made.join() !== "lean_forward" || r.reading === null || r.reading <= chest).map(at)).toEqual([]);
  });

  it("each set's first rep drawn past chest up is not counted and says nothing: no squat counted yet in that set", () => {
    const sets = GOOD.filter((v) => past.some((r) => r.label === v.video.label) || short.some((r) => r.label === v.video.label));
    expect(sets.length).toBe(11);
    const wrong = sets.flatMap((v) => {
      const first = counted(v)[0];
      if (first === undefined) return [`${v.video.label}: no rep`];
      // Drawn 8 degrees past chest up on the picture, from where it was filmed.
      const frames = leanForward(perRep([{ ...first, size: chest + 8 - (first.lean ?? 0) }]))(v.video.frames);
      const own = runMovement(SQUAT, { ...v.video, frames }, EXERCISE).reps.find((r) => r.start - LEAD_IN < first.end && first.start < r.end - LEAD_IN);
      return own?.verdict === "other" && own.reason === null && (own.readings["chest up"] ?? 0) > chest ? [] : [`${v.video.label}: ${own?.verdict ?? "no rep"} ${own?.reason ?? ""}`];
    });
    expect(wrong).toEqual([]);
  });

  it("the other two: drawn that far, their hips fold far past their knees and read as a hinge, so they are silent; never counted without the lean marked", () => {
    const rest = past.filter((r) => r.verdict !== "refused");
    expect(rest.map(at)).toEqual(["squat_normal_2 3.0 s", "chair_squat_reference 4.5 s"]);
    expect(rest.filter((r) => r.reason !== null || (r.verdict === "counted" && !r.made.includes("lean_forward")) || (r.verdict !== "counted" && r.verdict !== "other")).map(at)).toEqual([]);
    // Each drawn 12 degrees further: another movement by "hips and knees together", which says nothing.
    for (const label of [...new Set(rest.map((r) => r.label))]) {
      const v = GOOD.find((x) => x.video.label === label);
      if (v === undefined) throw new Error(`no ${label}`);
      const mine = rest.filter((r) => r.label === label);
      const frames = leanForward(perRep(mine.map((r) => ({ ...r, size: r.size + 12 }))))(v.video.frames);
      const reps = runMovement(SQUAT, { ...v.video, frames }, EXERCISE).reps.map((r) => ({ ...r, start: r.start - LEAD_IN, end: r.end - LEAD_IN }));
      for (const r of mine) {
        const own = reps.find((x) => x.start < r.end && r.start < x.end);
        expect([at(r), own?.verdict, own?.rule, own?.reason]).toEqual([at(r), "other", "hips and knees together", null]);
      }
    }
  });

  it("2 degrees short of chest up: every rep still counted, leaning too far forward marked, nobody told anything; the plate goblet squat's first already reads as a hinge, silent", () => {
    expect(short.filter((r) => r.reason !== null).map(at)).toEqual([]);
    const notCounted = short.filter((r) => r.verdict !== "counted");
    expect(notCounted.map((r) => [at(r), r.verdict, r.rule])).toEqual([["fresh_goblet_squat_plate 1.5 s", "other", "hips and knees together"]]);
    expect(short.filter((r) => r.verdict === "counted" && r.made.join() !== "lean_forward").map(at)).toEqual([]);
  });

  it("facing the phone, the chest drawn 40 degrees forward on every rep but the first: the picture cannot see a lean from the front, and nobody is told", () => {
    const front = GOOD.filter((v) => v.entry.view === "front" && (v.entry.reps ?? 0) >= 2);
    expect(front.length).toBeGreaterThanOrEqual(4);
    const told = front.flatMap((v) => {
      const later = counted(v).slice(1);
      expect([v.video.label, later.length > 0]).toEqual([v.video.label, true]);
      const reps = runMovement(SQUAT, { ...v.video, frames: leanForward(perRep(later.map((r) => ({ ...r, size: 40 }))))(v.video.frames) }, EXERCISE).reps;
      expect([v.video.label, reps.filter((r) => r.verdict === "counted").length > 0]).toEqual([v.video.label, true]);
      return reps.filter((r) => r.verdict === "refused").map((r) => `${v.video.label} ${String(r.start)}`);
    });
    expect(told).toEqual([]);
  });

  it("round one's worst case: every other movement under the replays shown and not held (a phone on the floor among them) is never told it either", () => {
    const shown = REPLAYS.filter((r) => !r.hold);
    expect(shown.map((r) => r.name)).toContain("on the floor");
    const rows = replayTable(SQUAT, VIDEOS.filter((v) => v.entry.movement !== "squat"), shown, EXERCISE);
    expect(rows.length).toBeGreaterThan(250);
    // The kettlebell swing's first dip, under the floor view, broke "chest up" alone and was told it before the set counted.
    expect(rows.flatMap((r) => r.reps.filter((x) => x.verdict === "refused").map((x) => `${r.replay.name}: ${r.label} ${((x.start - LEAD_IN) / 1000).toFixed(2)} s`))).toEqual([]);
  });
});

describe("each mistake drawn onto real squats is marked, and no other", () => {
  // `edge`: reps at the edge of what the camera sees of them, which the search cannot draw to the target, just past or just
  // short of the line (`past`, `short`): on a sumo squat, half turned, knees drawn in just under what passes -0.15 leave the
  // picture's knees' width in sight too briefly, so the camera says nothing there, and at 0.12 m it sees and marks them
  // again (`further`, metres). Each stays counted and unmarked where it could not be drawn, and is marked further.
  const cases = [
    { id: "lean_forward", draw: leanForward, step: 2, most: 60, near: 0.5, reps: 26, edge: { past: [], short: [] }, further: 0 },
    {
      id: "knees_cave_in",
      draw: kneesIn,
      step: 0.03,
      most: 0.25,
      near: 0.01,
      reps: 16,
      edge: { past: ["sumo_squat_2b 7.7 s"], short: [] },
      further: 0.12,
    },
  ] as const;
  /** For the knees, frame by frame in each set: how far the measures read the knees' width less the feet's moved, against
   *  how far the drawing carried the knees together in that very frame (both knees' metres, as far through its bend as the
   *  body was, in the body's own trunks), where it carried them at least 0.02 of a trunk and the picture gives both
   *  readings. The middle of a set's frames, and its least. */
  const kneesFollow = (label: string, reps: readonly DrawnRep[]): { middle: number; least: number; frames: number } => {
    const v = GOOD.find((x) => x.video.label === label);
    if (v === undefined || reps.length === 0) return { middle: Number.NaN, least: Number.NaN, frames: 0 };
    const size = perRep(reps);
    const drawnFrames = kneesIn(size)(v.video.frames);
    const filmed = runOf(v.video).measured;
    const drawn = runOf({ ...v.video, frames: drawnFrames }).measured;
    const trunk = trunkOf(v.video.frames);
    const gap = (m: (typeof filmed)[number] | undefined): number | null => {
      const k = m?.readings.get("knees apart")?.flat ?? null;
      const f = m?.readings.get("feet apart")?.flat ?? null;
      return k === null || f === null ? null : k - f;
    };
    const ratios = v.video.frames.flatMap((f, i) => {
      const world = f.people[0]?.world ?? null;
      const a = gap(filmed[i]);
      const b = gap(drawn[i]);
      const carried = world === null ? 0 : (2 * size(f.t) * bendOf(world)) / trunk;
      return a === null || b === null || carried < 0.02 ? [] : [(a - b) / carried];
    });
    const sorted = [...ratios].sort((x, y) => x - y);
    return { middle: sorted[Math.floor(sorted.length / 2)] ?? Number.NaN, least: sorted[0] ?? Number.NaN, frames: sorted.length };
  };

  it("every mistake the camera checks is drawn", () => {
    expect(cases.map((c) => c.id)).toEqual(checkedOf(EXERCISE).map((m) => m.id));
  });

  describe.each(cases)("$id", ({ id, draw, step, most, near, reps, edge, further }) => {
    const m = checkedOf(EXERCISE).find((x) => x.id === id);
    const line = m?.atMost ?? m?.atLeast ?? Number.NaN;
    const up = m?.atMost !== undefined;
    const at = (r: { label: string; start: number }): string => `${r.label} ${(r.start / 1000).toFixed(1)} s`;
    for (const [word, off, edges] of [
      ["just past its line", 1, edge.past],
      ["just short of its line", -1, edge.short],
    ] as const) {
      const target = line + (up ? off : -off) * step;
      const all = GOOD.flatMap((v) => drawnTo(SQUAT, EXERCISE, v.video, id, draw, target, most, near).map((r) => ({ label: v.video.label, ...r })));
      const missed = all.filter((r) => r.reading === null || Math.abs(r.reading - target) > near);
      const drawn = all.filter((r) => !missed.includes(r));

      it(`${word}: every rep that reads it is drawn there, from the people's and the twins' videos, but the reps at the edge of sight, named`, () => {
        expect(all.length).toBe(reps);
        expect(missed.map(at)).toEqual([...edges]);
      });

      it.runIf(edges.length > 0)(`${word}: each rep at the edge of sight, where it could not be drawn, is counted and unmarked, and drawn further is marked`, () => {
        expect(missed.filter((r) => r.verdict !== "counted" || r.made.length > 0).map(at)).toEqual([]);
        for (const label of [...new Set(missed.map((r) => r.label))]) {
          const v = GOOD.find((x) => x.video.label === label);
          if (v === undefined) throw new Error(`no ${label}`);
          const mine = missed.filter((r) => r.label === label);
          const frames = draw(perRep(mine.map((r) => ({ ...r, size: further }))))(v.video.frames);
          const out = runMovement(SQUAT, { ...v.video, frames }, EXERCISE).reps.map((r) => ({ ...r, start: r.start - LEAD_IN, end: r.end - LEAD_IN }));
          for (const r of mine) {
            const own = out.find((x) => x.start < r.end && r.start < x.end);
            expect([at(r), own?.verdict, own?.form.find((f) => f.mistake === id)?.status]).toEqual([at(r), "counted", "made"]);
          }
        }
      });

      it(`${word}: the reading follows what was drawn`, () => {
        if (id === "lean_forward") {
          // Each rep's lean moved within a quarter of the degrees the trunk was turned: the body's turn shortens it on the
          // picture, and the phone's place can stretch it (two reps lay 3 to 4 degrees from it, round one's re-check).
          const wrong = drawn.flatMap((r) => {
            const moved = (r.reading ?? Number.NaN) - r.filmed;
            const share = moved / r.size;
            return share >= 0.75 && share <= 1.25 ? [] : [`${r.label} ${(r.start / 1000).toFixed(1)} s: moved ${moved.toFixed(2)}, drawn ${r.size.toFixed(2)}`];
          });
          expect(wrong).toEqual([]);
        } else {
          // In each set, the knees' width moved by what the drawing carried in that frame: its middle within about a third
          // (measured 0.95 to 1.26 over both drawings), and no frame the other way.
          const sets = [...new Set(drawn.map((r) => r.label))];
          const wrong = sets.flatMap((label) => {
            const follow = kneesFollow(
              label,
              drawn.filter((r) => r.label === label),
            );
            const right = follow.frames >= 10 && follow.middle >= 0.75 && follow.middle <= 1.35 && follow.least > 0;
            return right ? [] : [`${label}: middle ${follow.middle.toFixed(2)}, least ${follow.least.toFixed(2)}, ${String(follow.frames)} frames`];
          });
          expect(sets.length).toBeGreaterThan(3);
          expect(wrong).toEqual([]);
        }
      });

      it(`${word}: each still counts, and ${off > 0 ? "only this mistake is" : "no mistake is"} marked`, () => {
        expect(drawn.filter((r) => r.verdict !== "counted")).toEqual([]);
        expect(drawn.filter((r) => r.made.join() !== (off > 0 ? id : ""))).toEqual([]);
      });

      // 53b-i: the coach over each drawn set, every mistake spoken: past the line, this mistake's correction and nothing
      // else, after the second rep it is made in and every second one after; short of it, nothing.
      it(`${word}: the coach says ${off > 0 ? "this mistake's correction, after every second rep it is made in, and nothing else" : "nothing"}`, () => {
        const words = correctionsOf(LOUD).get(id);
        const sets = [...new Set(all.map((r) => r.label))];
        const heard = sets.map((label) => {
          const v = GOOD.find((x) => x.video.label === label);
          if (v === undefined) throw new Error(`no ${label}`);
          const mine = all.filter((r) => r.label === label);
          const reps = runMovement(SQUAT, { ...v.video, frames: draw(perRep(mine))(v.video.frames) }, EXERCISE).reps;
          const made = reps.filter((r) => r.verdict === "counted" && r.form.some((f) => f.mistake === id && f.status === "made")).length;
          return { label, made, said: saidOf(reps, LOUD).map((x) => x.words) };
        });
        expect(heard.filter((h) => h.said.some((w) => w !== words)).map((h) => `${h.label}: ${h.said.join(" / ")}`)).toEqual([]);
        if (off > 0) {
          expect(heard.filter((h) => h.said.length !== Math.floor(h.made / 2)).map((h) => `${h.label}: made ${String(h.made)}, said ${String(h.said.length)}`)).toEqual([]);
          expect(heard.some((h) => h.said.length > 0)).toBe(true);
        } else expect(heard.flatMap((h) => h.said)).toEqual([]);
      });
    }
  });
});
