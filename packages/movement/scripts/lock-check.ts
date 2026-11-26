// corepack pnpm --filter @app/movement lock-check
// The lock's numbers (ROADMAP 52d-i): how far each person went from where they exercised once their set had counted,
// and how much larger or smaller the camera read them, as filmed and under each replay that must hold; then the two
// numbers by their rule (scripts/lockCheck.ts) beside the engine's own (src/body/person.ts `PERSON_LIMITS`).
import { PERSON_LIMITS } from "../src/index.js";
import { FLOOR_PERSON } from "./movementVideos.js";
import { PROPORTIONS, lockNumbers, lockRows, proportionRows } from "./lockCheck.js";

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
// Why the lock does not use the body's own proportions: one man's own sets against everybody's.
const props = proportionRows();
const range = (values: readonly number[]): string => `${Math.min(...values).toFixed(2)} to ${Math.max(...values).toFixed(2)}`;
const q = (values: readonly number[], p: number): number => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(p * values.length))] ?? Number.NaN;
say(`Proportions, each bone's 3D length as a share of the trunk, the middle of each of ${String(props.length)} proof sets of ${String(new Set(props.map((r) => r.person)).size)} people:`);
for (const bone of Object.keys(PROPORTIONS)) {
  const all = props.flatMap((r) => (r.middle[bone] === undefined ? [] : [r.middle[bone]]));
  const his = props.filter((r) => r.person === FLOOR_PERSON).flatMap((r) => (r.middle[bone] === undefined ? [] : [r.middle[bone]]));
  const within = props.flatMap((r) => (r.withinSecond[bone] === undefined ? [] : [r.withinSecond[bone]]));
  say(`  ${bone.padEnd(10)} every set ${q(all, 0.05).toFixed(2)} to ${q(all, 0.95).toFixed(2)} (5th to 95th hundredth) | one man's own ${String(his.length)} sets ${range(his)} | one second's middle within a set moves ${(100 * q(within, 0.5)).toFixed(0)} in 100 (the middle set), ${(100 * q(within, 0.9)).toFixed(0)} (the 90th)`);
}
say("");
const rows = lockRows();
say("movement     video                                      replay                     counted at   furthest   size   pictures  unread");
for (const r of rows) {
  say(
    `${r.movement.padEnd(12)} ${r.label.slice(0, 42).padEnd(42)} ${r.replay.padEnd(26)} ${r.counted.toFixed(1).padStart(8)} s ${r.metres.toFixed(2).padStart(7)} m ${r.size.toFixed(2).padStart(6)} ${String(r.pictures).padStart(9)} ${String(r.unread).padStart(7)}`,
  );
}
const n = lockNumbers(rows);
say("");
say(`${String(n.sets)} sets. Furthest from the place ${n.metres.furthest.toFixed(3)} m, the middle set's ${n.metres.middle.toFixed(3)} m: room ${n.room.toFixed(2)} m (the engine's ${PERSON_LIMITS.room.toFixed(2)}).`);
say(`Most times larger or smaller ${n.size.furthest.toFixed(3)}, the middle set's ${n.size.middle.toFixed(3)}: size room ${n.sizeRoom.toFixed(2)} (the engine's ${PERSON_LIMITS.sizeRoom.toFixed(2)}).`);
