import base from "@app/config/eslint-base";
import exerciseLibrary from "@app/config/eslint-exercise-library";

export default [
  ...base,
  // The Exercise Library never uses the old exercise code (spec Part 2 §13.1).
  { files: ["src/library/**", "test/library.*"], ...exerciseLibrary },
];
