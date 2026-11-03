// Prints every exercise's rules on every stored trace and every trace under measured/.
//   corepack pnpm --filter @app/engine cross-check
// Exits 1 on a fault.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { crossCheckTrace, faultsIn, listTraceFiles, loadDefinitions, tableLines } from "./crossCheck.js";

const ENGINE = resolve(import.meta.dirname, "../..");
const definitions = loadDefinitions(join(ENGINE, "src/definitions"));
const measured = resolve(ENGINE, "../../measured");
const files = [
  ...listTraceFiles(join(ENGINE, "test/traces")),
  ...listTraceFiles(join(ENGINE, "test/cross-check-traces")),
  ...(existsSync(measured) ? listTraceFiles(measured) : []),
];
const rows = files.map((f) => crossCheckTrace(f, readFileSync(f, "utf8"), definitions));
for (const line of tableLines(rows, definitions)) console.log(line);
if (faultsIn(rows) > 0) process.exit(1);
