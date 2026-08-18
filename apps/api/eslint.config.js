import base from "@app/config/eslint-base";

export default [
  ...base,
  {
    // Mutation harnesses under `tools/` are plain-node `.mjs` scripts run with
    // `node apps/api/tools/<name>.mjs`, deliberately outside the TypeScript
    // project (that is what lets them run with no build step, and it is the
    // shape every harness in `apps/web/tools/` already has). The typed lint
    // rules cannot parse a file the project service does not own, so the base
    // config errors on them rather than checking them. Scoped to `.mjs` under
    // `tools/` alone — nothing in `src` or `test` is exempted by this.
    ignores: ["tools/**/*.mjs"],
  },
];
