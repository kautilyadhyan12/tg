// Proves the engine ESLint preset actually rejects R5.1-banned tokens,
// and accepts pure code. Uses ESLint's Node API against inline fixtures.
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import engine from "../eslint-engine.js";

// Fixtures are lint-text strings with no tsconfig, so type-aware base rules
// can't run here. We test exactly the engine-specific restriction rules —
// the last entry of the preset, added on top of base in eslint-engine.js.
const restrictionRules = engine[engine.length - 1].rules;

function makeLinter() {
  return new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: tseslint.parser },
        rules: restrictionRules,
      },
    ],
  });
}

async function messagesFor(code) {
  const results = await makeLinter().lintText(code, { filePath: "src/fixture.ts" });
  return results[0].messages.map((m) => m.ruleId + ": " + m.message);
}

describe("engine ESLint preset (R5.1 purity)", () => {
  it("rejects wall-clock, randomness, platform globals, and node imports", async () => {
    const banned = [
      "const t = Date.now();",
      "const d = new Date();",
      "const r = Math.random();",
      "window.alert('x');",
      "const n = (5).toLocaleString();",
      "const f = new Intl.NumberFormat();",
      "import { readFileSync } from 'node:fs';",
      "setTimeout(() => {}, 1);",
      "console.log('x');",
    ];
    for (const code of banned) {
      const msgs = await messagesFor(code);
      expect(msgs.length, `expected a violation for: ${code}\ngot: none`).toBeGreaterThan(0);
    }
  });

  it("accepts pure deterministic code", async () => {
    const msgs = await messagesFor(
      "export function add(a: number, b: number): number { return a + b; }\n",
    );
    expect(msgs).toEqual([]);
  });
});
