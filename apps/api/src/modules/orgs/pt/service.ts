// PERSONAL TRAINING (spec Part 3 §13.5; ROADMAP 17e-i).
//
// The worst thing this could do to a real person: book two people with one trainer at the
// same time, so one is turned away, or take a session off somebody's pack for a booking
// that never happened. So a booking is one transaction under the gym's lock; what happens
// is decided by the one rule in `@app/shared` (`decidePtBook`, `decidePtCancel`) on what
// is read inside it; the table itself refuses a second session of that trainer that
// overlaps; and a request's key is kept on its session, so the same request again changes
// nothing.
//
// Who may do what: staff holding `schedule.manage` see and change every trainer; anybody
// else on staff has their own hours and their own sessions. Booking also needs
// `members.confirm`, the tick the member list and a person's page need, since it picks a
// person from that list. A stranger gets the 404 of a gym that does not exist.
import type { Sql } from "postgres";
import {
  PT_HORIZON_DAYS,
  PT_WEEK_DAYS,
  PT_WORDS,
  addDays,
  decidePtBook,
  decidePtCancel,
  pickPtCover,
  ptAppointmentSchema,
  ptBusy,
  ptFreeTimes,
  ptOfferedTimes,
  ptTime,
  ptTrainersResponseSchema,
  ptWeekResponseSchema,
  type BookPtRequest,
  type CancelPtRequest,
  type PtAppointment,
  type PtBookRefusal,
  type PtTrainersResponse,
  type PtWeekQuery,
  type PtWeekResponse,
  type SavePtTrainerRequest,
} from "@app/shared";
import { getOrgById, getStaffAuthority, insertAudit, lockOrgRow, type OrgRow } from "../repo.js";
import { OrgsError, holdsPrivilege, requireWritableGym } from "../service.js";
import { dayInTz } from "../../gamification/streak.js";
import { fullName } from "../leaderboard/rank.js";
import { chargePack, givePackClassBack, heldForPt } from "../memberships/heldRepo.js";
import * as repo from "./repo.js";

export interface PtDeps {
  sql: Sql;
  now: () => Date;
}

/** The route's rate limit, asked after standing: false when it has already answered 429. */
export type Limit = () => Promise<boolean>;

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");
const forbidden = (): OrgsError => new OrgsError(403, "forbidden", "Your role doesn't allow that.");
const appointmentNotFound = (): OrgsError => new OrgsError(404, "appointment_not_found", PT_WORDS.appointment_not_found);

interface Standing {
  org: OrgRow;
  /** Runs the timetable: every trainer's hours and sessions. */
  manages: boolean;
  /** May read the member list and open a person's page (`members.confirm`). */
  confirms: boolean;
}

/** What this member of staff may do here; 404 for anybody who is not staff of the gym. */
async function standingOf(deps: Pick<PtDeps, "sql">, gymId: string, staffId: string): Promise<Standing> {
  const [org, authority] = await Promise.all([getOrgById(deps.sql, gymId), getStaffAuthority(deps.sql, gymId, staffId)]);
  if (org === null || authority === null) throw notFound();
  const [manages, confirms] = await Promise.all([
    holdsPrivilege(deps, gymId, staffId, "schedule.manage"),
    holdsPrivilege(deps, gymId, staffId, "members.confirm"),
  ]);
  return { org, manages, confirms };
}

const STATUS: Record<PtBookRefusal, number> = {
  trainer_not_offering: 409,
  not_a_time: 409,
  time_passed: 409,
  too_far: 409,
  time_taken: 409,
  person_busy: 409,
  no_membership: 409,
  not_covered: 409,
  pack_used: 409,
};

/** A member of staff's name as colleagues read it: the one they gave, else their address. */
function staffName(row: Pick<repo.TrainerRow, "displayName" | "email">): { name: string | null; initials: string } {
  const named = fullName({ displayName: row.displayName, email: row.email, recordName: null });
  return named.name === null ? { name: row.email, initials: "" } : named;
}

function shown(row: repo.AppointmentRow, view: { now: Date; freeCancelMinutes: number; opens: boolean }): PtAppointment {
  const named = row.personName === null ? { name: null, initials: "" } : fullName({ displayName: row.personName, email: null, recordName: null });
  const time = ptTime(view.now.getTime(), row.startsAt.getTime(), view.freeCancelMinutes);
  return ptAppointmentSchema.parse({
    id: row.id,
    trainerId: row.trainerId,
    localDate: row.localDate,
    localStartMinute: row.localStartMinute,
    minutes: row.minutes,
    startsAt: row.startsAt.toISOString(),
    status: row.status,
    name: named.name,
    initials: named.name === null ? "" : named.initials,
    entryId: view.opens ? row.entryId : null,
    membership: row.membership,
    packCharged: row.packCharged,
    cancel: row.status !== "booked" || time.started ? null : time.freeCancel ? "free" : "late",
  });
}

/** The gym's staff and their hours: everybody for staff who run the timetable, the
 *  reader's own row for anybody else. */
export async function getTrainers(deps: PtDeps, staffId: string, gymId: string, limit: Limit): Promise<PtTrainersResponse | null> {
  const standing = await standingOf(deps, gymId, staffId);
  if (!(await limit())) return null;
  const [clock, rows] = await Promise.all([repo.gymClock(deps.sql, gymId), repo.staffTrainers(deps.sql, gymId, standing.manages ? null : staffId)]);
  if (clock === null) throw notFound();
  return ptTrainersResponseSchema.parse({
    timezone: clock.timezone,
    canManage: standing.manages,
    canBook: standing.confirms,
    freeCancelMinutes: clock.freeCancelMinutes,
    trainers: rows.map((r) => ({
      userId: r.userId,
      ...staffName(r),
      offers: r.offers,
      sessionMinutes: r.sessionMinutes,
      hours: r.hours,
      mine: r.userId === staffId,
    })),
  });
}

/** A trainer's hours and session length, replaced whole. Sessions already booked stay as
 *  they are, whatever the new hours. */
export async function saveTrainer(
  deps: PtDeps,
  staffId: string,
  gymId: string,
  trainerId: string,
  req: SavePtTrainerRequest,
  limit: Limit,
): Promise<PtTrainersResponse | null> {
  const standing = await standingOf(deps, gymId, staffId);
  if (!standing.manages && trainerId !== staffId) throw forbidden();
  await requireWritableGym(deps, standing.org);
  if (!(await limit())) return null;
  const saved = await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const [before] = await repo.staffTrainers(tx, gymId, trainerId);
    if (before === undefined) return false;
    await repo.saveTrainer(tx, { gymId, userId: trainerId, ...req, now: deps.now() });
    await insertAudit(tx, {
      actorUserId: staffId,
      gymId,
      action: "org.trainer_hours_saved",
      targetType: "user",
      targetId: trainerId,
      meta: {
        offers: String(req.offers),
        sessionMinutes: String(req.sessionMinutes),
        ranges: String(req.hours.length),
        rangesBefore: String(before.hours.length),
      },
    });
    return true;
  });
  if (!saved) throw new OrgsError(404, "trainer_not_found", PT_WORDS.trainer_not_found);
  return await getTrainers(deps, staffId, gymId, () => Promise.resolve(true));
}

/** Seven days of one trainer: the free times and the sessions booked. */
export async function getWeek(deps: PtDeps, staffId: string, gymId: string, query: PtWeekQuery, limit: Limit): Promise<PtWeekResponse | null> {
  const standing = await standingOf(deps, gymId, staffId);
  if (!standing.manages && query.trainer !== staffId) throw forbidden();
  if (!(await limit())) return null;
  const [clock, trainers] = await Promise.all([repo.gymClock(deps.sql, gymId), repo.staffTrainers(deps.sql, gymId, query.trainer)]);
  const trainer = trainers[0];
  if (clock === null) throw notFound();
  if (trainer === undefined) throw new OrgsError(404, "trainer_not_found", PT_WORDS.trainer_not_found);

  const now = deps.now();
  const today = dayInTz(now, clock.timezone);
  const lastDay = addDays(today, PT_HORIZON_DAYS - 1);
  const from = query.from === undefined || query.from < today ? today : query.from > lastDay ? lastDay : query.from;
  const to = addDays(from, PT_WEEK_DAYS - 1);
  const days = Array.from({ length: PT_WEEK_DAYS }, (_, n) => addDays(from, n));

  const offered =
    trainer.offers && trainer.sessionMinutes !== null
      ? ptOfferedTimes(trainer.hours, trainer.sessionMinutes, days.filter((day) => day <= lastDay))
      : [];
  const [slots, appointments] = await Promise.all([
    repo.instantsOf(deps.sql, clock.timezone, offered),
    repo.appointmentsOf(deps.sql, gymId, trainer.userId, from, to),
  ]);
  const taken = appointments.map((a) => ({ fromMs: a.startsAt.getTime(), toMs: a.startsAt.getTime() + a.minutes * 60_000 }));
  const free = ptFreeTimes(slots, { minutes: trainer.sessionMinutes ?? 0, taken, nowMs: now.getTime() });
  const view = { now, freeCancelMinutes: clock.freeCancelMinutes, opens: standing.confirms };
  return ptWeekResponseSchema.parse({
    trainerId: trainer.userId,
    timezone: clock.timezone,
    today,
    from,
    to,
    lastDay,
    sessionMinutes: trainer.sessionMinutes,
    offers: trainer.offers,
    days: days.map((localDate) => ({
      localDate,
      free: free.filter((t) => t.localDate === localDate).map((t) => t.startMinute),
      appointments: appointments.filter((a) => a.localDate === localDate).map((a) => shown(a, view)),
    })),
  });
}

/** Book a session for a person on the member list. */
export async function book(deps: PtDeps, staffId: string, gymId: string, req: BookPtRequest, limit: Limit): Promise<PtAppointment | null> {
  const standing = await standingOf(deps, gymId, staffId);
  if ((!standing.manages && req.trainerId !== staffId) || !standing.confirms) throw forbidden();
  await requireWritableGym(deps, standing.org);
  if (!(await limit())) return null;

  const outcome = await deps.sql.begin(async (tx): Promise<OrgsError | string> => {
    await lockOrgRow(tx, gymId);
    // The same request again: the session it made stands, and nothing is added.
    const again = await repo.byKey(tx, gymId, req.requestKey);
    if (again !== null) {
      const same =
        again.trainerId === req.trainerId && again.entryId === req.entryId && again.localDate === req.localDate && again.localStartMinute === req.startMinute;
      return same ? again.id : new OrgsError(409, "request_reused", PT_WORDS.request_reused);
    }
    const [clock, trainers, entry] = await Promise.all([
      repo.gymClock(tx, gymId),
      repo.staffTrainers(tx, gymId, req.trainerId),
      repo.currentEntry(tx, gymId, req.entryId),
    ]);
    const trainer = trainers[0];
    if (clock === null) return notFound();
    if (trainer === undefined) return new OrgsError(404, "trainer_not_found", PT_WORDS.trainer_not_found);
    if (entry === null) return new OrgsError(404, "person_not_found", PT_WORDS.person_not_found);

    const now = deps.now();
    const today = dayInTz(now, clock.timezone);
    const minutes = trainer.sessionMinutes;
    const offers = trainer.offers && minutes !== null;
    const isOffered =
      offers && ptOfferedTimes(trainer.hours, minutes, [req.localDate]).some((t) => t.startMinute === req.startMinute);
    // The time as an instant; none where the gym's clock skips it on that day.
    const [slot] = isOffered ? await repo.instantsOf(tx, clock.timezone, [{ localDate: req.localDate, startMinute: req.startMinute }]) : [];
    const startsAt = slot === undefined ? null : new Date(slot.startsAtMs);
    const span = startsAt === null || minutes === null ? null : { from: startsAt, to: new Date(startsAt.getTime() + minutes * 60_000) };
    const [trainerTaken, personTaken, held] = await Promise.all([
      span === null ? [] : repo.takenBy(tx, gymId, { trainerId: trainer.userId }, span.from, span.to),
      span === null ? [] : repo.takenBy(tx, gymId, { entryId: req.entryId }, span.from, span.to),
      clock.hasTypes ? heldForPt(tx, gymId, req.entryId) : [],
    ]);
    const busy = (taken: Awaited<ReturnType<typeof repo.takenBy>>) => startsAt !== null && minutes !== null && ptBusy(startsAt.getTime(), minutes, taken);
    const decision = decidePtBook({
      offers,
      offered: startsAt !== null,
      started: startsAt !== null && ptTime(now.getTime(), startsAt.getTime(), clock.freeCancelMinutes).started,
      tooFar: req.localDate > addDays(today, PT_HORIZON_DAYS - 1),
      trainerBusy: busy(trainerTaken),
      personBusy: busy(personTaken),
      cover: pickPtCover({ gymHasTypes: clock.hasTypes, day: req.localDate, held }),
    });
    if (decision.kind === "refuse") return new OrgsError(STATUS[decision.reason], decision.reason, PT_WORDS[decision.reason]);
    if (startsAt === null || minutes === null) throw new Error("a session was decided with no time");

    const id = await repo.insertAppointment(tx, {
      gymId,
      trainerId: trainer.userId,
      entryId: req.entryId,
      heldMembershipId: decision.membershipId,
      localDate: req.localDate,
      startMinute: req.startMinute,
      startsAt,
      minutes,
      packCharged: decision.chargePack,
      requestKey: req.requestKey,
      bookedBy: staffId,
      now,
    });
    // The table's own refusal: the rule above read the same rows under the same lock, so
    // this is the backstop, answered in the rule's words.
    if (id === null) return new OrgsError(409, "time_taken", PT_WORDS.time_taken);
    // The pack is charged after the session exists, in the same transaction.
    if (decision.chargePack && decision.membershipId !== null && !(await chargePack(tx, gymId, decision.membershipId, now))) {
      throw new Error("a pack the rule chose had no session left");
    }
    await insertAudit(tx, {
      actorUserId: staffId,
      gymId,
      action: "org.pt_booked",
      targetType: "gym_pt_appointment",
      targetId: id,
      meta: { trainerId: trainer.userId, entryId: req.entryId, on: req.localDate, at: String(req.startMinute), packCharged: String(decision.chargePack) },
    });
    return id;
  });
  if (typeof outcome !== "string") throw outcome;
  return await appointmentView(deps, standing, gymId, outcome);
}

async function appointmentView(deps: PtDeps, standing: Standing, gymId: string, id: string): Promise<PtAppointment> {
  const [row, clock] = await Promise.all([repo.appointmentById(deps.sql, gymId, id, false), repo.gymClock(deps.sql, gymId)]);
  if (row === null || clock === null) throw appointmentNotFound();
  return shown(row, { now: deps.now(), freeCancelMinutes: clock.freeCancelMinutes, opens: standing.confirms });
}

/** The 409 a cancel answers past the free time until staff say which it is: `packCharged`
 *  says whether a pack's session is at stake. */
export class PtLateCancel extends Error {
  readonly packCharged: boolean;
  constructor(packCharged: boolean) {
    super(PT_WORDS.late_cancel);
    this.name = "PtLateCancel";
    this.packCharged = packCharged;
  }
}

/** Cancel a session. A cancel sent again finds it done. */
export async function cancel(
  deps: PtDeps,
  staffId: string,
  gymId: string,
  appointmentId: string,
  req: CancelPtRequest,
  limit: Limit,
): Promise<PtAppointment | null> {
  const standing = await standingOf(deps, gymId, staffId);
  // Whose session it is decides who may cancel it, so it is read before the lock; a
  // session that is not this trainer's reads as one that is not there.
  const seen = await repo.appointmentById(deps.sql, gymId, appointmentId, false);
  if (!standing.manages && (seen === null || seen.trainerId !== staffId)) {
    if (seen === null) throw appointmentNotFound();
    throw forbidden();
  }
  if (seen === null) throw appointmentNotFound();
  await requireWritableGym(deps, standing.org);
  if (!(await limit())) return null;

  const refused = await deps.sql.begin(async (tx): Promise<OrgsError | PtLateCancel | null> => {
    await lockOrgRow(tx, gymId);
    const [row, clock] = await Promise.all([repo.appointmentById(tx, gymId, appointmentId, true), repo.gymClock(tx, gymId)]);
    if (row === null || clock === null) return appointmentNotFound();
    const now = deps.now();
    const decision = decidePtCancel({
      status: row.status,
      ...ptTime(now.getTime(), row.startsAt.getTime(), clock.freeCancelMinutes),
      packCharged: row.packCharged,
      lateOk: req.lateOk,
      giveBack: req.giveBack,
    });
    if (decision.kind === "already") return null;
    if (decision.kind === "refuse") {
      return decision.reason === "late_cancel" ? new PtLateCancel(row.packCharged) : new OrgsError(409, "started", PT_WORDS.started);
    }
    await repo.markCancelled(tx, { gymId, id: row.id, status: decision.status, packCharged: row.packCharged && !decision.refundPack, now });
    if (decision.refundPack && row.heldMembershipId !== null) await givePackClassBack(tx, gymId, row.heldMembershipId, now);
    await insertAudit(tx, {
      actorUserId: staffId,
      gymId,
      action: "org.pt_cancelled",
      targetType: "gym_pt_appointment",
      targetId: row.id,
      meta: { status: decision.status, packSessionBack: String(decision.refundPack) },
    });
    return null;
  });
  if (refused !== null) throw refused;
  return await appointmentView(deps, standing, gymId, appointmentId);
}
