// The movement engine (spec Part 2 §12) is held to the old engine's purity rules
// (§1.3 I1): they bind src/**, its runtime code. test/ and scripts/ are the laptop's
// measuring line (files, Python, the console) and get the base preset; the CI grep
// covers packages/movement/src the same way.
import base from "@app/config/eslint-base";
import engine from "@app/config/eslint-engine";

const restrictions = engine[engine.length - 1];

export default [...base, { ...restrictions, files: ["src/**/*.ts"] }];
