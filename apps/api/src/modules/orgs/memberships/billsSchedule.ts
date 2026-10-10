// WHEN THE BILLS THAT HAVE FALLEN DUE ARE OPENED (spec Part 3 §14.2; ROADMAP 18a-i). The
// job's name and its schedule in one place, so `worker.ts` and the test read the same two.
import type { Queue } from "bullmq";

export const ORGS_MEMBER_BILLS_JOB = "orgs.member_bills";

/** Minute 17 of every hour, off the other schedules' minutes. A period starts at midnight
 *  on its gym's own clock, which is a different hour for each gym, so each gym's bills are
 *  open within the hour; a run that opens nothing is the usual one. */
export const MEMBER_BILLS_PATTERN = "17 * * * *";

export async function scheduleMemberBills(queue: Pick<Queue, "upsertJobScheduler">): Promise<void> {
  await queue.upsertJobScheduler(
    ORGS_MEMBER_BILLS_JOB,
    { pattern: MEMBER_BILLS_PATTERN },
    {
      name: ORGS_MEMBER_BILLS_JOB,
      opts: {
        // A period has one bill (a unique index), and the next run opens whatever this
        // one missed.
        attempts: 1,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    },
  );
}
