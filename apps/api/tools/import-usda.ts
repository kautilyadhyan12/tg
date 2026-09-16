// Fills the USDA food table from the two published FoodData Central releases
// (ROADMAP 7a-iii-a). Run ONCE PER ENVIRONMENT after the migrations, production
// included — it is not a seed and not part of any test.
//
//   corepack pnpm --filter api exec tsx tools/import-usda.ts --database-url=postgres://aihg:aihg@localhost:5433/aihg
//   ... --cache=<dir>   where the two zips are kept (default: the system temp folder)
//
// THE DATABASE ADDRESS IS THIS TOOL'S OWN ARGUMENT AND NOTHING ELSE. It does not
// read `apps/api/.env`, and it does not fall back to `DATABASE_URL` in the
// environment: that file and that variable point at Kd's real Neon data on this
// machine, and a food importer must never be one forgotten shell variable away
// from writing to it. The address is typed out, every time, for the database
// that is meant.
//
// Running it twice changes nothing: every write is an upsert keyed by USDA's own
// `fdc_id`, guarded so a row that would not change is not written (see
// `usda-table.ts`). A second run prints "nothing changed".
import postgres from "postgres";
import { defaultCache, loadUsdaTables, USDA_RELEASE_ORDER, type UsdaEntry, type UsdaRelease } from "./usda-files.js";
import { importUsda } from "./usda-table.js";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const databaseUrl = arg("database-url");
if (databaseUrl === undefined || databaseUrl === "") {
  console.error(
    "import-usda needs the database to fill, spelled out:\n" +
      "  corepack pnpm --filter api exec tsx tools/import-usda.ts --database-url=postgres://user:pass@host:port/db\n" +
      "It never reads apps/api/.env or DATABASE_URL — on this machine both point at the real data.",
  );
  process.exit(2);
}

const cache = arg("cache") ?? defaultCache();
console.log(`reading the releases (cache: ${cache})`);
const tables = await loadUsdaTables(cache);
const releases: (readonly [UsdaRelease, Iterable<UsdaEntry>])[] = [];
for (const release of USDA_RELEASE_ORDER) {
  const table = tables.get(release);
  if (table === undefined) throw new Error(`no table read for ${release}`);
  console.log(`  ${release}: ${String(table.size)} foods`);
  releases.push([release, table.values()]);
}

const sql = postgres(databaseUrl, { prepare: false, max: 2 });
try {
  const report = await importUsda(sql, releases);
  for (const r of report.perRelease) {
    console.log(`${r.release}: ${String(r.foods)} foods, ${String(r.portions)} household measures${r.skipped > 0 ? `, ${String(r.skipped)} skipped` : ""}`);
  }
  console.log(
    `${String(report.foods)} foods in the table; ${report.changed === 0 ? "nothing changed" : `${String(report.changed)} rows written`}.`,
  );
  if (report.stale > 0) {
    console.log(`${String(report.stale)} foods in the table are from an older release and were left alone (a saved meal may name one).`);
  }
} finally {
  await sql.end();
}
