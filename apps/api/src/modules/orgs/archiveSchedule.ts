// The nightly gym archive, SWITCHED OFF (Kd, RULINGS 2026-10-02): a gym that stops
// paying is never closed or emptied by the clock. Its console locks and its members get
// the free app until it pays again. `archiveSweep.ts` and `tools/archive-sweep.ts` are
// kept; nothing schedules them.
import type { Queue } from "bullmq";

export const ORGS_ARCHIVE_JOB = "orgs.archive";

/** Takes out of Redis the 04:30 schedule an earlier worker registered, with its next
 *  queued run. Removing a schedule that is not there is a no-op. */
export async function unscheduleArchiveSweep(queue: Pick<Queue, "removeJobScheduler">): Promise<void> {
  await queue.removeJobScheduler(ORGS_ARCHIVE_JOB);
}
