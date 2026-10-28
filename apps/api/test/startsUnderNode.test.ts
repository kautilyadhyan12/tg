// The api's code loads under plain Node, as production starts it (`node --import tsx`,
// infra/Dockerfile). Vitest's own loader does not stop on an import loop that leaves a schema
// read before it is made; Node does, and the api never starts (the 15c security re-check,
// `@app/shared`'s auth.ts importing checkin.ts). So each is loaded here in a Node of its own.
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const load = (what: string, env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, ["--import", "tsx", "-e", `await import(${JSON.stringify(what)}); console.log("loaded")`], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    timeout: 60_000,
    env,
  });

describe("the api's code loads under plain Node", () => {
  it.each(["@app/shared", "./src/app.ts"])("%s", (what) => {
    const run = load(what);
    expect(run.stderr).not.toMatch(/before initialization/);
    expect(run.stdout.trim()).toBe("loaded");
  });

  it("./src/worker.ts gets as far as its own settings, which it reads at start", () => {
    // With no settings it stops at their check: past every import, and without starting work.
    const unset = new Set(["DATABASE_URL", "WEB_ORIGIN", "JWT_SECRET"]);
    const run = load("./src/worker.ts", Object.fromEntries(Object.entries(process.env).filter(([name]) => !unset.has(name))));
    expect(run.stderr).not.toMatch(/before initialization/);
    expect(run.stderr).toMatch(/Invalid environment/);
  });
});
