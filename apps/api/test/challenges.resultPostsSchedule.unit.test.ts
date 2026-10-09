// WHEN A CHALLENGE'S RESULT IS POSTED: the job the worker puts on its queue, and that the
// worker runs it (spec Part 3 §15.6; ROADMAP 19d-ii-b). No database.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CHALLENGE_RESULTS_PATTERN, ORGS_CHALLENGE_RESULTS_JOB, scheduleChallengeResults } from "../src/modules/orgs/challenges/resultPostsSchedule.js";

/** The minutes of an hour a cron pattern's first field names: a range with a step, a list, or every minute. */
function minutesOf(pattern: string): number[] {
  const field = pattern.split(" ")[0] ?? "";
  const minutes = new Set<number>();
  for (const part of field.split(",")) {
    const [range = "", step = "1"] = part.split("/");
    const [from, to] = range === "*" ? ["0", "59"] : range.includes("-") ? range.split("-") : [range, step === "1" ? range : "59"];
    for (let m = Number(from); m <= Number(to); m += Number(step)) minutes.add(m);
  }
  return [...minutes].sort((a, b) => a - b);
}

describe("the challenge results job", () => {
  it("runs four times an hour, every hour of every day, off the minutes the other jobs use", () => {
    expect(minutesOf(CHALLENGE_RESULTS_PATTERN)).toEqual([8, 23, 38, 53]);
    expect(CHALLENGE_RESULTS_PATTERN.split(" ").slice(1)).toEqual(["*", "*", "*", "*"]);
    // The reader itself: the patterns the worker's other jobs use.
    expect(minutesOf("2-59/5 * * * *")).toEqual([2, 7, 12, 17, 22, 27, 32, 37, 42, 47, 52, 57]);
    expect(minutesOf("45 * * * *")).toEqual([45]);
  });

  it("is put on the queue under its own name, with that pattern", async () => {
    const calls: unknown[][] = [];
    await scheduleChallengeResults({
      upsertJobScheduler: ((...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(undefined);
      }) as never,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(ORGS_CHALLENGE_RESULTS_JOB);
    expect(calls[0]?.[1]).toEqual({ pattern: CHALLENGE_RESULTS_PATTERN });
    expect(calls[0]?.[2]).toMatchObject({ name: ORGS_CHALLENGE_RESULTS_JOB });
  });

  it("the worker schedules it, accepts its name and runs the posting step for it", async () => {
    const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
    expect(worker).toContain("await scheduleChallengeResults(queue);");
    // The list of names the worker accepts, and the branch that runs this one.
    expect(worker).toContain("job.name !== ORGS_CHALLENGE_RESULTS_JOB &&");
    expect(worker).toMatch(/if \(job\.name === ORGS_CHALLENGE_RESULTS_JOB\) \{\s+const posted = await postChallengeResults\(\{ sql, log \}\);/);
  });
});
