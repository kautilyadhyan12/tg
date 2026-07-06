// Engine purity preset (CLAUDE.md R5.1 / spec Part 2 §1.3 I1).
// packages/engine must be platform-free and wall-clock-free: time exists only
// as frame timestamps in the input. Every banned token here mirrors the CI grep.
import tseslint from "typescript-eslint";
import base from "./eslint-base.js";

const BANNED_GLOBALS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "fetch",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
  "performance",
  "process",
  "console",
  "XMLHttpRequest",
  "WebSocket",
];

export default tseslint.config(...base, {
  rules: {
    "no-restricted-globals": [
      "error",
      ...BANNED_GLOBALS.map((name) => ({
        name,
        message: `Engine purity (R5.1/I1): '${name}' is banned in packages/engine.`,
      })),
    ],
    "no-restricted-properties": [
      "error",
      { object: "Date", property: "now", message: "R5.1: no wall clock in the engine." },
      { object: "Math", property: "random", message: "R5.1: no nondeterminism in the engine." },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: "NewExpression[callee.name='Date']",
        message: "R5.1: no wall clock in the engine (new Date).",
      },
      {
        selector: "CallExpression[callee.property.name=/^toLocale/]",
        message: "R5.1: no locale-dependent formatting in the engine.",
      },
      {
        selector: "MemberExpression[object.name='Intl']",
        message: "R5.1: no Intl in the engine.",
      },
    ],
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["node:*"],
            message: "R5.1: no node builtins in the engine.",
          },
        ],
      },
    ],
  },
});
