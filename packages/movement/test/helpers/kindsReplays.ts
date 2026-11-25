// One movement under every replay that must hold (scripts/replays.ts): the checks the squat jump and the lunge share.
// Each has a proof file of its own (vitest.config.ts): one table takes about 8 minutes, and GitHub gives each a machine.
import { beforeAll, describe, expect, it } from "vitest";
import { holds, openRow, proofVideos, readMovement, replayTable, runMovement, type ReplayRow } from "../../scripts/movementCheck.js";
import { isOther } from "../../scripts/movementVideos.js";
import { REPLAYS } from "../../scripts/replays.js";

export function underEveryHeldReplay(name: string): void {
  const HELD = REPLAYS.filter((r) => r.hold);
  const VIDEOS = proofVideos();
  const movement = readMovement(name);
  describe(`${movement.name}, under every held replay`, () => {
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
}
