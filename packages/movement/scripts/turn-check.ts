// corepack pnpm --filter @app/movement turn-check
// The turn's number (ROADMAP 52d-ii): between reps, how far from the way they faced when their standing was taken each
// person faced, once their set had counted, as filmed and under each replay that must hold; then the number by its rule
// (scripts/turnCheck.ts) beside the engine's own (src/movement/matcher.ts `MATCH_LIMITS.turned`).
import { MATCH_LIMITS } from "../src/index.js";
import { turnNumber, turnRows } from "./turnCheck.js";

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const rows = turnRows();
const n = turnNumber(rows);
say(`${String(n.sets)} sets counted, as filmed and under each replay that must hold.`);
say(`The furthest set ${n.furthest.toFixed(1)} degrees, the middle set ${n.middle.toFixed(1)}: the turn's number ${String(n.turned)} (the engine's ${String(MATCH_LIMITS.turned)}).`);
for (const r of [...rows].sort((a, b) => b.turned - a.turned).slice(0, 15)) say(`  ${r.turned.toFixed(1).padStart(5)}  ${r.movement.padEnd(10)} ${r.label} (${r.replay})`);
