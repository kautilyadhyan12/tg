// Every household measure name the loaded USDA table gives a food, as the measure picker shows it
// (ROADMAP 32b-ii-b, Kd's click-through: "the options are bizarre"). Prints each name once, with how
// many measures carry it, and what the picker shows for it, or that it is left out; the most common
// first. Run on a local database with the USDA table loaded:
//   DATABASE_URL=postgres://aihg:aihg@localhost:5433/aihg_b corepack pnpm --filter api exec tsx tools/measure-names-sweep.ts [--changed]
import postgres from "postgres";
import { isHouseholdMeasure, plainMeasureName, usdaMeasureName } from "../src/modules/nutrition/measures.js";

const url = process.env["DATABASE_URL"] ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) throw new Error("DATABASE_URL must be a local database");
const changedOnly = process.argv.includes("--changed");
const sql = postgres(url, { prepare: false, max: 1 });
const rows = await sql<{ amount: number | null; unit: string; n: string }[]>`
  SELECT amount, unit, count(*) AS n FROM usda_food_portions GROUP BY amount, unit`;
await sql.end();

const names = new Map<string, { n: number; shown: string | null }>();
for (const row of rows) {
  if (!isHouseholdMeasure(row)) continue;
  const name = usdaMeasureName(row);
  const before = names.get(name);
  names.set(name, { n: (before?.n ?? 0) + Number(row.n), shown: plainMeasureName(name) });
}
const sorted = [...names.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]));
const changed = sorted.filter(([name, v]) => v.shown !== name);
const left = sorted.filter(([, v]) => v.shown === null);
console.log(`${String(sorted.length)} names; ${String(changed.length)} reworded or left out; ${String(left.length)} left out (${String(left.reduce((n, [, v]) => n + v.n, 0))} measures)`);
for (const [name, v] of changedOnly ? changed : sorted) console.log(`${String(v.n)}\t${name}\t→ ${v.shown ?? "(left out)"}`);
