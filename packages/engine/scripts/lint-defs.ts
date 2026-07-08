// §9.2 CI entry: lints every definition document in the repo. Exits non-zero
// on any issue; every message names the file, field, and reason.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { glob } from "node:fs/promises";
import { exerciseDefinitionSchema } from "@app/shared";
import { lintDefinition } from "../src/index.js";

const roots = [
  join(import.meta.dirname, "../test/definitions"), // fixtures
  join(import.meta.dirname, "../src/definitions"), // authored defs (P1.8b+)
];

let failed = false;
let count = 0;
for (const root of roots) {
  for await (const file of glob(join(root, "**/*.json").replaceAll("\\", "/"))) {
    count++;
    const parsed = exerciseDefinitionSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) {
      failed = true;
      console.error(`✗ ${file}: schema: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      continue;
    }
    const issues = lintDefinition(parsed.data);
    if (issues.length > 0) {
      failed = true;
      for (const i of issues) console.error(`✗ ${file}: ${i.field}: ${i.message}`);
    } else {
      console.log(`✓ ${file}`);
    }
  }
}
console.log(`${String(count)} definition(s) linted`);
if (count === 0) console.warn("⚠ no definitions found yet (authored defs arrive with P1.8b)");
process.exit(failed ? 1 : 0);
