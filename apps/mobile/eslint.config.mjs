import base from "@app/config/eslint-base";
import exerciseLibrary from "@app/config/eslint-exercise-library";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  fetch: "readonly",
  setTimeout: "readonly",
  require: "readonly",
  module: "writable",
  __dirname: "readonly",
  jest: "readonly",
};

export default [
  ...base,
  {
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    // Plain Node files outside the TypeScript project: read without the typed rules.
    files: ["scripts/*.mjs", "plugins/*.js", "metro.config.js", "jest.config.js", "test/screens/setup.js", "test/screens/clearWaiting.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: nodeGlobals,
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // The phone never uses the old exercise code (spec Part 2 §13.1). Goals still reads the old
  // list until job 63 moves its exercise picker to the Exercise Library.
  { files: ["**/*.{ts,tsx}"], ignores: ["src/screens/Goals.tsx"], ...exerciseLibrary },
];
