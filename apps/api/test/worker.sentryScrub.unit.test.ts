// The worker's errors reach Sentry as the api's do: with the fields a database error hangs a row on taken
// off first (logSafety.ts, `scrubbedForSentry`). The privacy policy says error reports carry no personal
// details (ROADMAP Stage 5 21b-i), and the worker never builds app.ts, so it reports on its own.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scrubbedForSentry } from "../src/logSafety.js";

const worker = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");

describe("the worker's error reports", () => {
  it("every one goes through the scrubber", () => {
    const reports = worker.match(/Sentry\.captureException\(([^,)]*)/g) ?? [];
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.filter((r) => !r.startsWith("Sentry.captureException(scrubbedForSentry("))).toEqual([]);
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
