// The nightly gym archive is switched off (Kd, RULINGS 2026-10-02): a gym that stops
// paying is never closed or emptied by the clock, so it finds its member list, leads and
// staff invitations as it left them when it pays again.
import { readFileSync } from "node:fs";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { ORGS_ARCHIVE_JOB, unscheduleArchiveSweep } from "../src/modules/orgs/archiveSchedule.js";

const redisUrl = process.env["TEST_REDIS_URL"];
const TEST_TIMEOUT_MS = 30_000;

describe("the nightly gym archive is switched off", () => {
  it.skipIf(redisUrl === undefined || redisUrl === "")(
    "the schedule an earlier worker left in a real Redis is taken out with its queued run, the other schedules stay, and taking it out twice is fine",
    async () => {
      // A throwaway queue on Redis number 15, so the worker's own queue is never touched.
      const connection = new Redis(redisUrl ?? "", { db: 15, maxRetriesPerRequest: null });
      const queue = new Queue(`archive-off-${String(Date.now())}`, { connection });
      try {
        // What the worker before this change registered at boot, beside a neighbour.
        await queue.upsertJobScheduler(ORGS_ARCHIVE_JOB, { pattern: "30 4 * * *" }, { name: ORGS_ARCHIVE_JOB });
        await queue.upsertJobScheduler("orgs.trial_expiry", { pattern: "0 4 * * *" }, { name: "orgs.trial_expiry" });
        expect((await queue.getJobSchedulers()).map((s) => s.key).sort()).toEqual([ORGS_ARCHIVE_JOB, "orgs.trial_expiry"]);
        expect(await queue.getDelayedCount()).toBe(2);

        await unscheduleArchiveSweep(queue);
        expect((await queue.getJobSchedulers()).map((s) => s.key)).toEqual(["orgs.trial_expiry"]);
        const delayed = await queue.getDelayed();
        expect(delayed.map((job) => job.name)).toEqual(["orgs.trial_expiry"]);

        await expect(unscheduleArchiveSweep(queue)).resolves.toBeUndefined();
        expect((await queue.getJobSchedulers()).map((s) => s.key)).toEqual(["orgs.trial_expiry"]);
      } finally {
        await queue.obliterate({ force: true });
        await queue.close();
        await connection.quit();
      }
    },
    TEST_TIMEOUT_MS,
  );

  // The worker is a script that connects to Redis and Postgres as it loads, so what it
  // does with the job is read from its source: it removes the schedule, never registers
  // it, and a run already queued closes no gym.
  it("the worker removes the archive schedule, never registers it, and never runs the archive", () => {
    const worker = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
    expect(worker).toContain("await unscheduleArchiveSweep(queue);");
    expect(worker).not.toMatch(/upsertJobScheduler\(\s*ORGS_ARCHIVE_JOB/);
    expect(worker).not.toContain("archiveLapsedGyms");
    expect(worker).not.toContain("archiveSweep.js");
    const branch = /if \(job\.name === ORGS_ARCHIVE_JOB\) \{([\s\S]*?)\n {4}\}/.exec(worker);
    expect(branch?.[1]).toBeDefined();
    expect(branch?.[1]).toContain('skipped: "archive_off"');
    expect(branch?.[1]).not.toMatch(/await /);
  });
});
