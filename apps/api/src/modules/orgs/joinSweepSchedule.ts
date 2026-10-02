// The waiting room's daily sweep, on and off with join codes (ROADMAP 3c; spec Part 3
// §10.6). The worker calls these two; they live here so a test can run both against a
// real queue and a real database.
import type { Queue } from "bullmq";
import { sweepJoinApplications, type SweepDeps, type SweepOptions, type SweepResult } from "./sweep.js";

export const ORGS_SWEEP_JOB = "orgs.join_sweep";

/** Puts the sweep on the queue at 03:30 UTC every day, or, while join codes are switched
 *  off, takes its schedule out of Redis so the waiting room is neither chased nor
 *  expired. Removing a schedule that is not there is a no-op. */
export async function scheduleJoinSweep(
  queue: Pick<Queue, "upsertJobScheduler" | "removeJobScheduler">,
  joinCodes: boolean,
): Promise<void> {
  if (!joinCodes) {
    await queue.removeJobScheduler(ORGS_SWEEP_JOB);
    return;
  }
  await queue.upsertJobScheduler(
    ORGS_SWEEP_JOB,
    { pattern: "30 3 * * *" },
    {
      name: ORGS_SWEEP_JOB,
      opts: {
        // R3.5: every statement in the sweep is set-based and its WHERE
        // excludes the state it produces, so a retry is a no-op.
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    },
  );
}

/** One run of the sweep, or null without touching a row while join codes are switched
 *  off: a run queued before the switch changes nobody's request. */
export async function runJoinSweep(
  deps: SweepDeps,
  joinCodes: boolean,
  opts: SweepOptions = {},
): Promise<SweepResult | null> {
  if (!joinCodes) return null;
  return sweepJoinApplications(deps, opts);
}
