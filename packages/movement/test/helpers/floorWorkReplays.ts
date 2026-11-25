// Floor work (ROADMAP 52c-ii) under every replay that must hold (scripts/replays.ts): nearer, farther, tilted, fewer and
// uneven pictures, shaky points, the phone's own chip gap, a passer-by, the movement done faster or slower. A movement's own
// videos count what a person counts by eye (the fewest a passer-by leaves), with every person's numbers and with their own
// left out, but the cases written on them, and a written case never counts more than by eye; every other movement Kd's
// folders hold counts 0 and is told nothing. One table a proof file, each about eight minutes (vitest.config.ts, PROOF_PARTS).
import { beforeAll, describe, expect, it } from "vitest";
import type { Movement } from "@app/shared";
import { holds, openRow, proofVideos, replayTable, type ReplayRow } from "../../scripts/movementCheck.js";
import { isOther } from "../../scripts/movementVideos.js";
import { REPLAYS } from "../../scripts/replays.js";

export const HELD = REPLAYS.filter((r) => r.hold);

export function floorWorkReplays(movement: Movement): void {
  describe(`${movement.name}, under every held replay`, () => {
    let rows: ReplayRow[] = [];
    beforeAll(() => {
      rows = replayTable(movement, proofVideos(), HELD).filter((r) => r.tried);
    }, 1_200_000);

    it("every held replay is tried on its own videos and on the other movements'", () => {
      expect(new Set(rows.map((r) => r.replay.name))).toEqual(new Set(HELD.map((r) => r.name)));
      expect(rows.filter((r) => r.entry.movement === movement.name).length).toBeGreaterThanOrEqual(HELD.length * 2);
      expect(rows.filter((r) => isOther(r.entry, movement.name)).length).toBeGreaterThanOrEqual(HELD.length * 100);
    });

    it("its own videos hold, but the cases written on them, and a written case never counts more than by eye", () => {
      const wrong = rows.filter((r) => r.entry.movement === movement.name && !holds(r) && !openRow(r)).map((r) => [r.replay.name, r.label, r.count, r.leftOut]);
      expect(wrong).toEqual([]);
      // Round one: a written replay case is fewer reps, never an extra one.
      const more = rows.filter((r) => r.entry.movement === movement.name && openRow(r) && (r.count > r.most || (r.leftOut ?? 0) > r.most)).map((r) => [r.replay.name, r.label, r.count, r.leftOut]);
      expect(more).toEqual([]);
    });

    it("every other movement counts 0 and is told nothing", () => {
      const others = rows.filter((r) => isOther(r.entry, movement.name));
      expect(others.filter((r) => r.count !== 0).map((r) => [r.replay.name, r.label, r.count])).toEqual([]);
      expect(others.flatMap((r) => r.reps.filter((x) => x.reason !== null).map((x) => [r.replay.name, r.label, x.reason]))).toEqual([]);
    });
  });
}
