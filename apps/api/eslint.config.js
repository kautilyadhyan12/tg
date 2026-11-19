import base from "@app/config/eslint-base";
import exerciseLibrary from "@app/config/eslint-exercise-library";

export default [
  ...base,
  {
    // Mutation harnesses under `tools/` are plain-node `.mjs` scripts run with
    // `node apps/api/tools/<name>.mjs`, deliberately outside the TypeScript
    // project (that is what lets them run with no build step, and it is the
    // shape every harness in `apps/web/tools/` already has). The typed lint
    // rules cannot parse a file the project service does not own, so the base
    // config errors on them rather than checking them. Scoped to `.mjs` under
    // `tools/` alone — nothing in `src` or `test` is exempted by this, but for
    // the member file worker's two-line entry, plain JavaScript so it can load
    // tsx on Node 22 (its own comment says why).
    ignores: ["tools/**/*.mjs", "src/modules/orgs/memberList/parseWorker.boot.mjs"],
  },
  // The server's Exercise Library module (job 60b on) never uses the old exercise code (spec Part 2 §13.1).
  { files: ["src/modules/library/**", "test/library.*"], ...exerciseLibrary },
];
