// WHEN THE AUTOMATIC MESSAGES ARE SENT: the job the worker puts on its queue, and that the
// worker runs it (spec Part 3 §16.2; ROADMAP 20a). No database.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CHALLENGE_RESULTS_PATTERN } from "../src/modules/orgs/challenges/resultPostsSchedule.js";
import { MEMBER_MESSAGES_PATTERN, ORGS_MEMBER_MESSAGES_JOB, scheduleMemberMessages } from "../src/modules/orgs/messages/sendSchedule.js";

/** The minutes of an hour a `from-59/step` pattern's first field names. */
function minutesOf(pattern: string): number[] {
  const [range = "", step = "1"] = (pattern.split(" ")[0] ?? "").split("/");
  const [from = "0", to = "59"] = range.split("-");
  const minutes: number[] = [];
  for (let m = Number(from); m <= Number(to); m += Number(step)) minutes.push(m);
  return minutes;
}

describe("the member messages job", () => {
  it("runs four times an hour, every hour of every day, off the minutes the challenge results use", () => {
    expect(minutesOf(MEMBER_MESSAGES_PATTERN)).toEqual([4, 19, 34, 49]);
    expect(MEMBER_MESSAGES_PATTERN.split(" ").slice(1)).toEqual(["*", "*", "*", "*"]);
    expect(minutesOf(CHALLENGE_RESULTS_PATTERN).filter((m) => minutesOf(MEMBER_MESSAGES_PATTERN).includes(m))).toEqual([]);
  });

  it("is put on the queue under its own name, with that pattern", async () => {
    const calls: unknown[][] = [];
    await scheduleMemberMessages({
      upsertJobScheduler: ((...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(undefined);
      }) as never,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(ORGS_MEMBER_MESSAGES_JOB);
    expect(calls[0]?.[1]).toEqual({ pattern: MEMBER_MESSAGES_PATTERN });
    expect(calls[0]?.[2]).toMatchObject({ name: ORGS_MEMBER_MESSAGES_JOB });
  });

  it("the worker schedules it, accepts its name and runs the sending step for it", async () => {
    const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
    expect(worker).toContain("await scheduleMemberMessages(queue);");
    expect(worker).toContain("job.name !== ORGS_MEMBER_MESSAGES_JOB &&");
    expect(worker).toMatch(/if \(job\.name === ORGS_MEMBER_MESSAGES_JOB\) \{\s+const messages = await sendDueMessages\(\{ sql, log \}\);/);
  });
});
