// Proves the "never the old exercise code" block refuses each old name and file, and lets the
// Exercise Library's own names through. ESLint's Node API on inline code, as eslint-engine.test.js.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import library, { OLD_EXERCISE_NAMES } from "../eslint-exercise-library.js";

async function messagesFor(code) {
  const linter = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{ files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, rules: library.rules }],
  });
  const results = await linter.lintText(code, { filePath: "src/fixture.ts" });
  return results[0].messages.map((m) => m.ruleId);
}

describe("the old exercise code is refused in new code", () => {
  it.each(OLD_EXERCISE_NAMES)("import { %s } from @app/shared", async (name) => {
    expect(await messagesFor(`import { ${name} } from "@app/shared";\n`)).toEqual(["no-restricted-imports"]);
  });

  it("a type-only import of an old shape is refused too", async () => {
    expect(await messagesFor(`import type { ExerciseCatalogItem } from "@app/shared";\n`)).toEqual(["no-restricted-imports"]);
  });

  it.each(["./exerciseCatalog.js", "../exerciseContent.js", "./exerciseCatalog", "../../src/exerciseContent.js", "../catalog.js", "../catalog", "../../src/catalog.js"])("a file's own path: %s", async (path) => {
    expect(await messagesFor(`import * as old from "${path}";\nexport const x = old;\n`)).toEqual(["no-restricted-imports"]);
  });

  it.each(["./catalog.js", "./catalogue.js", "../library/catalog.js", "./exerciseCatalogNew.js"])("a new file whose name only looks alike passes: %s", async (path) => {
    expect(await messagesFor(`import * as mine from "${path}";
export const x = mine;
`)).toEqual([]);
  });

  it("the Exercise Library's own names pass", async () => {
    expect(await messagesFor(`import { checkLibrary, EXERCISE_KINDS, exerciseFileSchema } from "@app/shared";\nexport const x = [checkLibrary, EXERCISE_KINDS, exerciseFileSchema];\n`)).toEqual([]);
  });
});

// The wiring: each package's own lint settings switch the block on where the rule says, and off
// only for the files still allowed the old code. Read from the real config files, as ESLint does.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function blocksOldCode(pkg, file) {
  const linter = new ESLint({ cwd: ROOT + pkg });
  const config = await linter.calculateConfigForFile(file);
  const rule = config.rules?.["no-restricted-imports"];
  return Array.isArray(rule) && JSON.stringify(rule).includes("CATALOG_58");
}

describe("each package applies the block", () => {
  it.each([
    ["apps/mobile", "src/screens/Probe.tsx", true],
    ["apps/mobile", "src/session/probe.ts", true],
    ["apps/mobile", "modules/probe.ts", true],
    ["apps/mobile", "index.ts", true],
    ["apps/mobile", "test/probe.test.ts", true],
    ["apps/mobile", "src/screens/Goals.tsx", false],
    ["packages/shared", "src/library/probe.ts", true],
    ["packages/shared", "test/library.probe.test.ts", true],
    ["packages/shared", "src/goals.ts", false],
    ["apps/api", "src/modules/library/probe.ts", true],
    ["apps/api", "src/modules/goals/service.ts", false],
  ])("%s %s: %s", async (pkg, file, on) => {
    expect(await blocksOldCode(pkg, file)).toBe(on);
  });
});
