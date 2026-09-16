// Fills the USDA food table from the two published FoodData Central releases
// (ROADMAP 7a-iii-a). Run ONCE PER ENVIRONMENT after the migrations, production
// included — it is not a seed and not part of any test.
//
//   corepack pnpm --filter api exec tsx tools/import-usda.ts --database-url=postgres://aihg:aihg@localhost:5433/aihg
//   corepack pnpm --filter api exec tsx tools/import-usda.ts --database-url-env=PROD_DATABASE_URL
//   ... --cache=<dir>   where the two zips are kept (default: the system temp folder)
//
// THE DATABASE IS NAMED BY THIS TOOL'S OWN ARGUMENT AND NOTHING ELSE. It does
// not read `apps/api/.env`, and it does not fall back to `DATABASE_URL` in the
// environment: that file and that variable point at Kd's real Neon data on this
// machine, and a food importer must never be one forgotten shell variable away
// from writing to it. Either the address is typed out (`--database-url=`) or the
// variable holding it is named (`--database-url-env=`) — nothing is silent.
//
// FOR A REAL ENVIRONMENT, NAME THE VARIABLE. An address typed on the command
// line carries the database PASSWORD into shell history and into the process
// list, where every other user of that machine can read it; `--database-url-env`
// keeps the secret in the variable and passes only its name. The tool never
// prints either.
//
// Running it twice changes nothing: every write is an upsert keyed by USDA's own
// `fdc_id`, guarded so a row that would not change is not written (see
// `usda-table.ts`). A second run prints "nothing changed".
import postgres from "postgres";
import { argValue, databaseUrlFrom } from "./import-usda-args.js";
import { defaultCache, loadUsdaTables, USDA_RELEASE_ORDER, type UsdaEntry, type UsdaRelease } from "./usda-files.js";
import { importUsda } from "./usda-table.js";

const arg = (name: string): string | undefined => argValue(process.argv, name);

const chosen = databaseUrlFrom(process.argv, process.env);
if (!("url" in chosen)) {
  // A variable's NAME is safe to print; its value never is.
  console.error(
    chosen.problem === "empty-variable"
      ? `import-usda was told to read ${chosen.variable}, and that variable is empty or unset here.`
      : "import-usda needs the database to fill, named one of two ways:\n" +
          "  --database-url-env=PROD_DATABASE_URL                       the variable holding the address (use this for a real environment: no password on the command line)\n" +
          "  --database-url=postgres://user:pass@host:port/db           the address itself\n" +
          "It never reads apps/api/.env or falls back to DATABASE_URL — on this machine both point at the real data.",
  );
  process.exit(2);
}
const databaseUrl = chosen.url;

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
