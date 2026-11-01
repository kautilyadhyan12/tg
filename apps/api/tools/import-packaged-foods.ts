// Fills our own copy of the packaged-food lists (ROADMAP Stage 5 33b-iii-a). Run once per environment
// after the migrations, then by hand now and then (RUNBOOK, "Packaged foods"): the nightly update keeps
// Open Food Facts' list current but cannot see a product they deleted, and USDA publishes its download
// twice a year. Not a seed, and not part of any test.
//
//   corepack pnpm --filter api exec tsx tools/import-packaged-foods.ts --database-url=postgres://aihg:aihg@localhost:5433/aihg_b --off=<file> --usda=<folder>
//   ... --database-url-env=PROD_DATABASE_URL    for a real environment: no password in the shell's history
//
// --off   Open Food Facts' food export. A real server: the JSONL, which marks their estimates (13 GB):
//         https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz
//         A folder's own database: the CSV, which cannot tell them apart (1.5 GB):
//         https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz
// --usda  USDA's Branded Foods CSV zip from https://fdc.nal.usda.gov/download-datasets, unpacked
// Either may be left out to fill only the other list.
//
// As `import-usda.ts`: the database is named by this tool's own argument and nothing else. It never
// reads `apps/api/.env` or `DATABASE_URL`.
import { statSync } from "node:fs";
import { OFF_DAILY_FILE } from "@app/shared";
import { OFF_DAILY_BASE } from "../src/modules/nutrition/packagedSync.js";
import postgres from "postgres";
import { argValue, databaseUrlFrom } from "./import-usda-args.js";
import { offRowsOfFile, usdaRowsOfDir } from "./packaged-files.js";
import { fillPackagedList, downloadStillCovered, type ListReport } from "./packaged-table.js";

const arg = (name: string): string | undefined => argValue(process.argv, name);
const chosen = databaseUrlFrom(process.argv, process.env);
if (!("url" in chosen)) {
  console.error(
    chosen.problem === "empty-variable"
      ? `import-packaged-foods was told to read ${chosen.variable}, and that variable is empty or unset here.`
      : "import-packaged-foods needs the database to fill: --database-url-env=<variable> or --database-url=<address>. It never reads apps/api/.env or DATABASE_URL.",
  );
  process.exit(2);
}
const offFile = arg("off");
const usdaDir = arg("usda");
if (offFile === undefined && usdaDir === undefined) {
  console.error("import-packaged-foods needs --off=<file>, --usda=<folder>, or both.");
  process.exit(2);
}

const say = (name: string, r: ListReport, seconds: number): void => {
  console.log(`${name}: read ${String(r.read)}, kept ${String(r.kept)}, wrote ${String(r.written)}, removed ${String(r.removed)} in ${seconds.toFixed(1)} s`);
  console.log(`  not kept: ${Object.entries(r.refused).map(([why, n]) => `${why} ${String(n)}`).join(", ")}`);
};

const sql = postgres(chosen.url, { prepare: false, max: 2 });
try {
  if (offFile !== undefined) {
    const started = Date.now();
    // The file's own date, which `curl -R` keeps: how old the download is decides which days to apply again.
    const made = statSync(offFile).mtime;
    const index = await fetch(`${OFF_DAILY_BASE}index.txt`, { signal: AbortSignal.timeout(60_000) }).then((r) => r.text());
    const froms = index.split("\n").flatMap((name) => { const m = OFF_DAILY_FILE.exec(name.trim()); return m === null ? [] : [Number(m[1])]; });
    if (froms.length === 0) throw new Error("Their list of daily files could not be read, so this download's age cannot be judged.");
    if (!downloadStillCovered(made, Math.min(...froms))) throw new Error(`This download is from ${made.toISOString()}, older than the daily files reach back. Download it again.`);
    say("Open Food Facts", await fillPackagedList(sql, "off_products", offRowsOfFile(offFile), made), (Date.now() - started) / 1000);
  }
  if (usdaDir !== undefined) {
    const started = Date.now();
    say("USDA Branded", await fillPackagedList(sql, "usda_branded_products", usdaRowsOfDir(usdaDir)), (Date.now() - started) / 1000);
  }
} finally {
  await sql.end();
}
