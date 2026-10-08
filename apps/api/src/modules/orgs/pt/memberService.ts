// A MEMBER BOOKS AND CANCELS THEIR OWN PERSONAL TRAINING (spec Part 3 §13.5; ROADMAP 17e-ii).
//
// The worst thing this could do to a real person: show a member somebody else's name or
// session, or let them cancel, or pay with, another member's. So nothing here takes a
// person from the request: whose session it is comes from the reader's own membership of
// the gym, read under the gym's lock; a session is found only where it is that record's;
// and what takes a trainer's time is read as spans alone, with no name and no reason.
//
// The booking and the cancel are the staff side's own (`bookUnderLock`, `cancelUnderLock`),
// so a class, a time off and another session refuse a member as they refuse staff. A
// member's routes answer the 404 of a gym that does not exist to anybody who is not a live
// app member of a gym on a live plan.
import {
  MEMBER_PT_HISTORY_DAYS,
  MEMBER_PT_HISTORY_MAX,
  MEMBER_PT_SESSIONS_MAX,
  PT_HORIZON_DAYS,
  PT_MEMBER_WORDS,
  PT_NOT_ON_LIST_ERROR,
  PT_NOT_ON_LIST_WORDS,
  PT_SESSION_MINUTES_MAX,
  PT_WEEK_DAYS,
  PT_WORDS,
  addDays,
  memberPtResponseSchema,
  memberPtSessionSchema,
  pickPtCover,
  ptFreeTimes,
  ptOfferedTimes,
  ptTime,
  type MemberBookPtRequest,
  type MemberCancelPtRequest,
  type MemberPtQuery,
  type MemberPtResponse,
  type MemberPtSession,
  type PtTime,
} from "@app/shared";
import { lockOrgRow } from "../repo.js";
import { OrgsError } from "../service.js";
import { dayInTz } from "../../gamification/streak.js";
import { fullName } from "../leaderboard/rank.js";
import { heldForPtOf } from "../memberships/heldRepo.js";
import { requireMember, type Line } from "../classes/bookingsService.js";
import * as repo from "./repo.js";
import { PtLateCancel, bookUnderLock, cancelUnderLock, type Limit, type PtDeps } from "./service.js";

export interface MemberPtDeps extends PtDeps {
  /** This server's line of members' session writes (`createLine`). */
  inLine: Line;
}

const DAY_MS = 24 * 60 * 60_000;
const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");
const sessionNotFound = (): OrgsError => new OrgsError(404, "appointment_not_found", PT_WORDS.appointment_not_found);

function ownView(row: repo.OwnSessionRow, now: Date, freeCancelMinutes: number): MemberPtSession {
  const time = ptTime(now.getTime(), row.startsAt.getTime(), freeCancelMinutes);
  return memberPtSessionSchema.parse({
    id: row.id,
    trainerName: row.trainerName === null ? null : fullName({ displayName: row.trainerName, email: row.trainerEmail, recordName: null }).name,
    localDate: row.localDate,
    localStartMinute: row.localStartMinute,
    minutes: row.minutes,
    startsAt: row.startsAt.toISOString(),
    freeCancelUntil: new Date(row.startsAt.getTime() - freeCancelMinutes * 60_000).toISOString(),
    status: row.status,
    packCharged: row.packCharged,
    cancel: row.status !== "booked" || time.started ? null : time.freeCancel ? "free" : "late",
  });
}

/** Seven of the gym's days: the trainers taking sessions with the times this member can
 *  book, what would pay on each day, and their own sessions, coming and past. */
export async function getMemberPt(deps: PtDeps, userId: string, gymId: string, query: MemberPtQuery, limit: Limit): Promise<MemberPtResponse | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const now = deps.now();
  const [clock, me, staff] = await Promise.all([
    repo.gymClock(deps.sql, gymId),
    repo.memberRecord(deps.sql, gymId, userId),
    repo.staffTrainers(deps.sql, gymId, null),
  ]);
  if (clock === null || me === null) throw notFound();

  const today = dayInTz(now, clock.timezone);
  // A member's booking opens when the gym's class bookings do, and never past the days
  // sessions run.
  const opensUntilMs = now.getTime() + clock.opensDays * DAY_MS;
  const opensDay = dayInTz(new Date(opensUntilMs), clock.timezone);
  const horizonDay = addDays(today, PT_HORIZON_DAYS - 1);
  const lastDay = opensDay < horizonDay ? opensDay : horizonDay;
  const from = addDays(today, query.week * PT_WEEK_DAYS);
  const days = Array.from({ length: PT_WEEK_DAYS }, (_, n) => addDays(from, n));
  const bookable = days.filter((day) => day <= lastDay);

  // Nobody books a session with themself.
  const trainers = staff.flatMap((t) =>
    t.offers && t.sessionMinutes !== null && t.hours.length > 0 && t.userId !== userId ? [{ ...t, sessionMinutes: t.sessionMinutes }] : [],
  );
  const offered = trainers.map((t) => ptOfferedTimes(t.hours, t.sessionMinutes, bookable));
  const keyOf = (t: PtTime): string => `${t.localDate}|${String(t.startMinute)}`;
  const distinct = [...new Map(offered.flat().map((t) => [keyOf(t), t])).values()];

  const entryId = me.entryId;
  const [instants, held, sessions, history] = await Promise.all([
    repo.instantsOf(deps.sql, clock.timezone, distinct),
    entryId !== null && clock.hasTypes ? heldForPtOf(deps.sql, gymId, [entryId]) : [],
    entryId === null ? [] : repo.sessionsOfEntry(deps.sql, gymId, entryId, now, MEMBER_PT_SESSIONS_MAX),
    entryId === null
      ? []
      : repo.pastSessionsOfEntry(deps.sql, gymId, entryId, now, new Date(now.getTime() - MEMBER_PT_HISTORY_DAYS * DAY_MS), MEMBER_PT_HISTORY_MAX),
  ]);
  const startOf = new Map(instants.map((i) => [keyOf(i), i.startsAtMs]));
  const first = instants[0]?.startsAtMs;
  const last = instants[instants.length - 1]?.startsAtMs;
  const busy =
    first === undefined || last === undefined
      ? []
      : await repo.busyOfTrainers(
          deps.sql,
          gymId,
          trainers.map((t) => t.userId),
          new Date(first),
          new Date(last + PT_SESSION_MINUTES_MAX * 60_000),
        );
  // Their own sessions take their own time, whoever the trainer.
  const own = sessions.map((s) => ({ fromMs: s.startsAt.getTime(), toMs: s.startsAt.getTime() + s.minutes * 60_000 }));

  return memberPtResponseSchema.parse({
    timezone: clock.timezone,
    today,
    from,
    to: addDays(from, PT_WEEK_DAYS - 1),
    lastDay,
    freeCancelMinutes: clock.freeCancelMinutes,
    onList: entryId !== null,
    days: days.map((localDate) => {
      if (entryId === null) return { localDate, pays: null, why: null };
      const cover = pickPtCover({ gymHasTypes: clock.hasTypes, day: localDate, held });
      if (!cover.ok) return { localDate, pays: null, why: cover.reason };
      const paying = held.find((h) => h.id === cover.membershipId);
      return {
        localDate,
        pays: {
          membership: paying?.typeName ?? null,
          sessionsLeft: paying !== undefined && paying.membership.kind === "pack" ? paying.membership.classesLeft : null,
        },
        why: null,
      };
    }),
    trainers: trainers.map((t, n) => {
      const slots = (offered[n] ?? []).flatMap((time) => {
        const startsAtMs = startOf.get(keyOf(time));
        return startsAtMs === undefined ? [] : [{ ...time, startsAtMs }];
      });
      const taken = [...busy.filter((b) => b.trainerId === t.userId), ...own];
      const free = ptFreeTimes(slots, { minutes: t.sessionMinutes, taken, nowMs: now.getTime() }).filter((s) => s.startsAtMs <= opensUntilMs);
      return {
        trainerId: t.userId,
        name: fullName({ displayName: t.displayName, email: t.email, recordName: null }).name,
        sessionMinutes: t.sessionMinutes,
        days: days.map((localDate) => ({ localDate, free: free.filter((s) => s.localDate === localDate).map((s) => s.startMinute) })),
      };
    }),
    sessions: sessions.map((s) => ownView(s, now, clock.freeCancelMinutes)),
    history: history.map((s) => ownView(s, now, clock.freeCancelMinutes)),
  });
}

async function ownSession(deps: PtDeps, gymId: string, entryId: string, id: string): Promise<MemberPtSession> {
  const [row, clock] = await Promise.all([repo.sessionOfEntry(deps.sql, gymId, entryId, id), repo.gymClock(deps.sql, gymId)]);
  if (row === null || clock === null) throw sessionNotFound();
  return ownView(row, deps.now(), clock.freeCancelMinutes);
}

/** Book a session for the reader's own record. The same `requestKey` again changes nothing. */
export async function memberBook(
  deps: MemberPtDeps,
  userId: string,
  gymId: string,
  req: MemberBookPtRequest,
  limit: Limit,
): Promise<MemberPtSession | null> {
  const org = await requireMember(deps, gymId, userId);
  if (org.status !== "active") throw notFound();
  if (!(await limit())) return null;
  const outcome = await deps.inLine(gymId, async (): Promise<OrgsError | { id: string; entryId: string }> => {
    // A "no" needs no lock: a time somebody already holds is answered from a plain read, so a
    // rush for one popular time does not make the gym's other bookings wait behind it. It is
    // read in this server's line, after the press before it has finished. The same request
    // again is let through to find the session it made.
    const [sent, held] = await Promise.all([
      repo.byKey(deps.sql, gymId, req.requestKey),
      repo.trainerHolds(deps.sql, gymId, req.trainerId, req.localDate, req.startMinute, req.minutes),
    ]);
    if (sent === null && held) return new OrgsError(409, "time_taken", PT_MEMBER_WORDS.time_taken);
    return await deps.sql.begin(async (tx): Promise<OrgsError | { id: string; entryId: string }> => {
      await lockOrgRow(tx, gymId);
      // Who they are is read under the lock: a member taken off the list a moment ago books nothing.
      const me = await repo.memberRecord(tx, gymId, userId);
      if (me === null) return notFound();
      if (me.entryId === null) return new OrgsError(409, PT_NOT_ON_LIST_ERROR, PT_NOT_ON_LIST_WORDS);
      if (req.trainerId === userId) return new OrgsError(409, "not_a_time", PT_MEMBER_WORDS.not_a_time);
      const id = await bookUnderLock(tx, deps.now(), gymId, { ...req, entryId: me.entryId }, { userId, member: true });
      return typeof id === "string" ? { id, entryId: me.entryId } : id;
    });
  });
  if (outcome instanceof OrgsError) throw outcome;
  return await ownSession(deps, gymId, outcome.entryId, outcome.id);
}

/** Cancel one of the reader's own sessions. Past the free time it is refused (`PtLateCancel`)
 *  until the request says `lateOk`, and then the session stays used: a member never gives
 *  one back. */
export async function memberCancel(
  deps: MemberPtDeps,
  userId: string,
  gymId: string,
  sessionId: string,
  req: MemberCancelPtRequest,
  limit: Limit,
): Promise<MemberPtSession | null> {
  const org = await requireMember(deps, gymId, userId);
  if (org.status !== "active") throw notFound();
  if (!(await limit())) return null;
  const outcome = await deps.inLine(gymId, () =>
    deps.sql.begin(async (tx): Promise<OrgsError | PtLateCancel | string> => {
      await lockOrgRow(tx, gymId);
      const me = await repo.memberRecord(tx, gymId, userId);
      if (me === null) return notFound();
      if (me.entryId === null) return sessionNotFound();
      const refused = await cancelUnderLock(tx, deps.now(), gymId, sessionId, { lateOk: req.lateOk, giveBack: false }, { userId, member: true }, me.entryId);
      return refused ?? me.entryId;
    }),
  );
  if (typeof outcome !== "string") throw outcome;
  return await ownSession(deps, gymId, outcome, sessionId);
}
