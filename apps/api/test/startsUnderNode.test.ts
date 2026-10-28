// The api's code loads under plain Node, as production starts it (`node --import tsx`,
// infra/Dockerfile). Vitest's own loader does not stop on an import loop that leaves a schema
// read before it is made; Node does, and the api never starts (the 15c security re-check,
// `@app/shared`'s auth.ts importing checkin.ts). So each is loaded here in a Node of its own.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const load = (what: string): string =>
  execFileSync(process.execPath, ["--import", "tsx", "-e", `await import(${JSON.stringify(what)}); console.log("loaded")`], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    timeout: 60_000,
  });

describe("the api's code loads under plain Node", () => {
  it.each(["@app/shared", "./src/app.ts"])("%s", (what) => {
    expect(load(what).trim()).toBe("loaded");
  });
});
