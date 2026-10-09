// CHECK-IN MEETS BOOKINGS (spec Part 3 §13.6; ROADMAP 17f).
//
// The worst thing this could do to a real person: mark a member who came as a no-show,
// or let one person's check-in mark somebody else's booking as came. So a check-in marks
// only the bookings of the ACCOUNT it named, never a record's or a name's; a place is
// called a no-show only where the gym was checking people in during that class's window
// and nothing in it could be this person; and everything else is left for staff.
// What happens is decided by the rules in `@app/shared` (`checkinMarksBooking`,
// `decideClassSweep`) on rows read under the gym's lock, the lock a booking and a cancel
// take, so a mark and a cancel sent together each see the other.
import type { Sql, TransactionSql } from "postgres";
import {
  CLASS_CHECKIN_BEFORE_MINUTES,
  CLASS_NO_SHOW_AFTER_MINUTES,
  CLASS_NO_SHOW_LOOKBACK_HOURS,
  checkinMarksBooking,
  decideClassSweep,
} from "@app/shared";
import { lockOrgRow } from "../repo.js";
import * as repo from "./bookingsRepo.js";

const marksNow = (now: Date) => (b: repo.MarkableBooking) =>
  checkinMarksBooking({ status: b.status, cancelled: b.cancelled, nowMs: now.getTime(), startsAtMs: b.startsAt.getTime(), minutes: b.minutes });

/** This account checked in at the gym at `now`: their own booked places in classes whose
 *  window holds that moment are marked came. Answers how many. A check-in by somebody
 *  with nothing booked near now, which is nearly every one, is one read and no lock.
 *  The marks of one gym wait for its lock one after another; a desk reads at most 120
 *  codes a minute, so they do not queue (`tools/measure-class-attendance-cost.ts`: a
 *  line of them in this process, as bookings have, made 200 at once three times slower). */
export async function markCameAtCheckin(sql: Sql, gymId: string, userId: string, now: Date): Promise<number> {
  const marks = marksNow(now);
  if (!(await repo.bookingsNear(sql, gymId, userId, now, false)).some(marks)) return 0;
  return await sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const mine = (await repo.bookingsNear(tx, gymId, userId, now, true)).filter(marks);
    return await repo.markAs(tx, gymId, mine.map((b) => b.id), "attended", ["booked"]);
  });
}

export interface NoShowRun {
  gyms: number;
  attended: number;
  noShows: number;
  /** Places still booked that the rule would not decide: left for staff. */
  left: number;
}

/** The places still booked in classes that ended 15 minutes ago or more: came where the
 *  person's own account checked in during the class's window, no-show where the gym was
 *  checking people in and nothing could be them, and left as they are otherwise. A gym at
 *  a time, each in its own transaction under its lock. Run again it finds those places
 *  marked and changes nothing. `only`: these gyms and no others. */
export async function markEndedClasses(
  deps: { sql: Sql; log: { warn: (obj: object, msg: string) => void } },
  now: Date = new Date(),
  only: readonly string[] | null = null,
): Promise<NoShowRun> {
  const run: NoShowRun = { gyms: 0, attended: 0, noShows: 0, left: 0 };
  const when = {
    now,
    afterMinutes: CLASS_NO_SHOW_AFTER_MINUTES,
    beforeMinutes: CLASS_CHECKIN_BEFORE_MINUTES,
    lookbackHours: CLASS_NO_SHOW_LOOKBACK_HOURS,
  };
  /** One gym's places decided by the rule, from a plain read or under its lock. */
  const decide = async (sql: Sql | TransactionSql, gymId: string, lock: boolean): Promise<{ came: string[]; missed: string[]; left: number }> => {
    const decided = { came: [] as string[], missed: [] as string[], left: 0 };
    for (const b of await repo.endedBooked(sql, gymId, when, lock)) {
      const decision = decideClassSweep({
        status: b.status,
        cancelled: b.cancelled,
        nowMs: now.getTime(),
        startsAtMs: b.startsAt.getTime(),
        minutes: b.minutes,
        visit: b.visit,
        gymCheckedIn: b.gymCheckedIn,
      });
      if (decision === "attended") decided.came.push(b.id);
      else if (decision === "no_show") decided.missed.push(b.id);
      else decided.left += 1;
    }
    return decided;
  };
  for (const gymId of await repo.gymsWithEndedBooked(deps.sql, now, when.afterMinutes, when.lookbackHours, only)) {
    try {
      // A gym with nothing to mark, which is every gym on nearly every run, and a gym that
      // does not use check-in on all of them, is one plain read and no lock.
      const seen = await decide(deps.sql, gymId, false);
      const done =
        seen.came.length + seen.missed.length === 0
          ? { attended: 0, noShows: 0, left: seen.left }
          : await deps.sql.begin(async (tx) => {
              await lockOrgRow(tx, gymId);
              // Decided again on what is read under the lock: a place cancelled or marked since is not written.
              const { came, missed, left } = await decide(tx, gymId, true);
              return {
                attended: await repo.markAs(tx, gymId, came, "attended", ["booked"]),
                noShows: await repo.markAs(tx, gymId, missed, "no_show", ["booked"]),
                left,
              };
            });
      run.gyms += 1;
      run.attended += done.attended;
      run.noShows += done.noShows;
      run.left += done.left;
    } catch (err: unknown) {
      // One gym's failure is not the others': its places stay booked for the next run.
      deps.log.warn({ event: "classes.no_show_run_failed", gymId, errName: err instanceof Error ? err.name : typeof err }, "a gym's ended classes could not be marked");
    }
  }
  return run;
}
