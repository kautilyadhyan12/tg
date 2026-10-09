// WHEN A CHALLENGE'S RESULT IS POSTED (spec Part 3 §15.6; ROADMAP 19d-ii-b). The job's name
// and its schedule in one place, so `worker.ts` and the test read the same two.
import type { Queue } from "bullmq";

export const ORGS_CHALLENGE_RESULTS_JOB = "orgs.challenge_results";

/** Minutes 8, 23, 38 and 53 of every hour: a challenge ends at midnight on its gym's own
 *  clock, which is on the hour, the half or the quarter somewhere, so the post is up
 *  within a quarter of an hour of it, off the other schedules' minutes. */
export const CHALLENGE_RESULTS_PATTERN = "8-59/15 * * * *";

export async function scheduleChallengeResults(queue: Pick<Queue, "upsertJobScheduler">): Promise<void> {
  await queue.upsertJobScheduler(
    ORGS_CHALLENGE_RESULTS_JOB,
    { pattern: CHALLENGE_RESULTS_PATTERN },
    {
      name: ORGS_CHALLENGE_RESULTS_JOB,
      opts: {
        // One `INSERT … ON CONFLICT DO NOTHING` against a unique index on the challenge,
        // and the next run posts whatever this one missed.
        attempts: 1,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    },
  );
}
