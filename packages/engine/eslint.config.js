// Purity rules (R5.1/I1) bind src/** — the engine's runtime code. test/ and
// scripts/ are the Node-side harness shell (fs, console, perf timers) and get
// the base preset; the CI grep likewise covers only packages/engine/src.
import base from "@app/config/eslint-base";
import engine from "@app/config/eslint-engine";

const restrictions = engine[engine.length - 1];

export default [...base, { ...restrictions, files: ["src/**/*.ts"] }];
