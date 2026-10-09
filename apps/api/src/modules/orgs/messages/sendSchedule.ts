// WHEN THE AUTOMATIC MESSAGES ARE SENT (spec Part 3 §16.2; ROADMAP 20a). The job's name
// and its schedule in one place, so `worker.ts` and the test read the same two.
import type { Queue } from "bullmq";

export const ORGS_MEMBER_MESSAGES_JOB = "orgs.member_messages";

/** Minutes 4, 19, 34 and 49 of every hour: a message waits a quarter of an hour at most,
 *  and 08:00 on a gym's clock is on the hour, the half or the quarter somewhere. Off the
 *  other schedules' minutes. */
export const MEMBER_MESSAGES_PATTERN = "4-59/15 * * * *";

export async function scheduleMemberMessages(queue: Pick<Queue, "upsertJobScheduler">): Promise<void> {
  await queue.upsertJobScheduler(
    ORGS_MEMBER_MESSAGES_JOB,
    { pattern: MEMBER_MESSAGES_PATTERN },
    {
      name: ORGS_MEMBER_MESSAGES_JOB,
      opts: {
        // One row an occasion under a unique index, and the next run sends whatever this
        // one missed.
        attempts: 1,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    },
  );
}
