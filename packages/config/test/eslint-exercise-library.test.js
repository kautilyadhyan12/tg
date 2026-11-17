// Proves the "never the old exercise code" block refuses each old name and file, and lets the
// Exercise Library's own names through. ESLint's Node API on inline code, as eslint-engine.test.js.
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

  it.each(["./exerciseCatalog.js", "../exerciseContent.js", "../../catalog.js", "./exerciseCatalog"])("a file's own path: %s", async (path) => {
    expect(await messagesFor(`import * as old from "${path}";\nexport const x = old;\n`)).toEqual(["no-restricted-imports"]);
  });

  it("the Exercise Library's own names pass", async () => {
    expect(await messagesFor(`import { checkLibrary, EXERCISE_KINDS, exerciseFileSchema } from "@app/shared";\nexport const x = [checkLibrary, EXERCISE_KINDS, exerciseFileSchema];\n`)).toEqual([]);
  });
});
