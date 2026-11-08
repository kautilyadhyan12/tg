// The worker's errors reach Sentry as the api's do: with the fields a database error hangs a row on taken
// off first (logSafety.ts, `scrubbedForSentry`). The privacy policy says error reports carry no personal
// details (ROADMAP Stage 5 21b-i), and the worker never builds app.ts, so it reports on its own.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scrubbedForSentry } from "../src/logSafety.js";
import { withoutQuotedText } from "../src/sentry.js";

const worker = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");

describe("the worker's error reports", () => {
  it("every one goes through the scrubber", () => {
    const reports = worker.match(/Sentry\.captureException\(([^,)]*)/g) ?? [];
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.filter((r) => !r.startsWith("Sentry.captureException(scrubbedForSentry("))).toEqual([]);
  });

  it("nothing else in the server sends Sentry anything: only app.ts and worker.ts capture", () => {
    const dir = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const files = (d: string): string[] =>
      readdirSync(d).flatMap((f) => {
        const path = join(d, f);
        return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
      });
    const capturing = files(dir)
      .filter((f) => /\bcapture(Exception|Message|Event)\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.split(/[\\/]src[\\/]/)[1]);
    expect(capturing.sort()).toEqual(["app.ts", "worker.ts"]);
  });

  it("an error's message reaches Sentry with what it quotes taken off", () => {
    expect(withoutQuotedText('invalid input syntax for type uuid: "amara@realgym.example"')).toBe('invalid input syntax for type uuid: "…"');
    expect(withoutQuotedText("no quotes here")).toBe("no quotes here");
    expect(withoutQuotedText('new row for relation "gym_members" violates check constraint "x"')).toBe('new row for relation "gym_members" violates check constraint "x"');
  });

  it("the scrubber takes off a refused row's values and keeps the message", () => {
    const err = Object.assign(new Error('new row violates check constraint "x"'), {
      detail: "Failing row contains (Amara, amara@realgym.example)",
      parameters: ["Amara"],
      query: "INSERT INTO gym_members …",
    });
    const sent = scrubbedForSentry(err);
    expect(sent).toBe(err);
    expect({ detail: "detail" in err, parameters: "parameters" in err, query: "query" in err, message: err.message }).toEqual({
      detail: false,
      parameters: false,
      query: false,
      message: 'new row violates check constraint "x"',
    });
  });
});
