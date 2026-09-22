// SETTING A GYM'S TIMETABLE — Part 3 §13.3, ROADMAP 17b-i.
//
// **THE WORST THING THIS CARD COULD DO TO A REAL PERSON**, and the sentence the
// first test in `classes.routes.test.ts` was written from: put a class on the
// calendar at the wrong hour, so somebody turns up to a locked room — or show
// one gym's timetable, and the name of its coach, to a different gym. The first
// is the fill's business (`fill.ts` holds the rule and the measurements); the
// second is this file's, and it is the whole reason every function below starts
// on the same gate.
//
// **EVERY ROUTE HERE — THE READ INCLUDED — IS `schedule.manage`.** §13.3 grants
// it to owner and manager, and grants a trainer a look at "the lists of their
// own classes", which is a SCOPE and not a tick: `gym_staff` has no group
// column, so approximating it with this tick would hand a trainer the gym's
// whole timetable AND the power to rewrite it. Gating the read as well is
// narrower than §13.3 strictly needs and is the reversible direction —
// `staff.manage`'s reasoning verbatim. The read a trainer and a member actually
// want is the CALENDAR, and that is 17b-ii's and 17d's, gated on being this
// gym's audience.
//
// **WRITES GO THROUGH `requireWritablePrivilege`, READS THROUGH
// `requirePrivilege`** — §4.2's read-only console, unchanged: a gym with no live
// plan keeps reading its own timetable and cannot change it, exactly like its
// roster and its opening hours. No new refusal vocabulary is invented here.
import type { Sql } from "postgres";
import {
  CLASS_FILL_HORIZON_DAYS,
  classColourSchema,
  gymClassesResponseSchema,
  type CreateGymClassScheduleRequest,
  type CreateGymClassTypeRequest,
  type GymClassesResponse,
  type GymClassSchedule,
  type GymClassType,
  type UpdateGymClassTypeRequest,
} from "@app/shared";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import * as repo from "./repo.js";

export interface ClassesDeps {
  sql: Sql;
  /** THE CLOCK, INJECTED. Every date this module writes is worked out from it —
   *  the eight-week horizon, "which sessions are in the future", the archive
   *  stamp — so a test that cannot move it can only prove the calendar by
   *  waiting for a summer-time weekend. */
  now: () => Date;
}

/** The module's standing 404. Identical in wording to the orgs module's, and
 *  deliberately so: a class type that does not exist and a class type belonging
 *  to somebody else's gym must be indistinguishable, and a second sentence here
 *  would be the difference a stranger could read. */
const NOT_FOUND_MESSAGE = "That class was not found.";

/** A date the user typed, made real before it reaches Postgres.
 *
 *  `2026-02-31` matches the wire schema's pattern and is not a day; Postgres
 *  refusing the `::date` cast is a 500 nobody can act on. Same split, same
 *  reason, as `requireCalendarDate` one module up — written here rather than
 *  imported because that one is not exported and duplicating a four-line
 *  calendar check is cheaper than widening another module's surface.
 *
 *  **`Date.UTC` and not `new Date(text)`** — the second is timezone-dependent
 *  parsing, and the question being asked ("is 2026-02-31 a date at all") has no
 *  timezone in it. The year-zero hole is closed by the wire pattern's four
 *  digits plus the round-trip below. */
function requireCalendarDate(text: string, field: string): string {
  const parts = text.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const made = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year) ||
    made.getUTCFullYear() !== year ||
    made.getUTCMonth() !== month - 1 ||
    made.getUTCDate() !== day
  ) {
    throw new OrgsError(400, "validation_error", `${field}: not a real date`);
  }
  return text;
}

function toClassType(row: repo.ClassTypeRow): GymClassType {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    minutes: row.minutes,
    places: row.places,
    coachUserId: row.coachUserId,
    coachName: row.coachName,
    // PARSED, NOT CAST (R2.3, and CLAUDE.md §4's no-`as` rule outside adapters).
    // The column's CHECK holds the same list as `CLASS_COLOURS`, so this can
    // only fail if the two have drifted — and a `as ClassColour` there would
    // paint a colour the web has never heard of into a gym's calendar rather
    // than saying so.
    colour: classColourSchema.parse(row.colour),
    openGym: row.openGym,
    archivedAt: row.archivedAt === null ? null : row.archivedAt.toISOString(),
  };
}

function toSchedule(row: repo.ClassScheduleRow): GymClassSchedule {
  return {
    id: row.id,
    classTypeId: row.classTypeId,
    weekdays: row.weekdays,
    startMinute: row.startMinute,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    nextDates: row.nextDates,
    sessionsAhead: row.sessionsAhead,
  };
}

/** ONE PLACE TURNS THE ROWS INTO THE ANSWER, so the six routes that all reply
 *  with the whole timetable cannot each shape it slightly differently.
 *
 *  **ARCHIVED TYPES ARE A SEPARATE LIST AND NOT A FLAG ON ONE**, because they
 *  are a different question: the live list is what the gym runs, and the
 *  archived list is what it used to. A screen filtering one list on a flag
 *  renders an archived class in the middle of the timetable on the one release
 *  somebody forgets the filter. Their repeats are stopped by construction (the
 *  archive does it in the same transaction), so they carry none. */
function toResponse(row: repo.TimetableRow): GymClassesResponse {
  const schedulesByType = new Map<string, GymClassSchedule[]>();
  for (const s of row.schedules) {
    const list = schedulesByType.get(s.classTypeId) ?? [];
    list.push(toSchedule(s));
    schedulesByType.set(s.classTypeId, list);
  }
  return gymClassesResponseSchema.parse({
    timezone: row.timezone,
    clockFormat: row.clockFormat,
    horizonDays: CLASS_FILL_HORIZON_DAYS,
    entries: row.types
      .filter((t) => t.archivedAt === null)
      .map((t) => ({ type: toClassType(t), schedules: schedulesByType.get(t.id) ?? [] })),
    archived: row.types.filter((t) => t.archivedAt !== null).map(toClassType),
  });
}

async function readOr404(deps: ClassesDeps, gymId: string): Promise<GymClassesResponse> {
  const row = await repo.readTimetable(deps.sql, gymId, { now: deps.now() });
  // Unreachable in practice — the gate above every caller has already read the
  // org — but a gym deleted between that read and this one must not surface as
  // a 500.
  if (row === null) throw new OrgsError(404, "org_not_found", "Organisation not found.");
  return toResponse(row);
}

/** WHAT DOES THIS GYM RUN — the console's Classes screen, whole. */
export async function getTimetable(
  deps: ClassesDeps,
  userId: string,
  gymId: string,
): Promise<GymClassesResponse> {
  await requirePrivilege(deps, gymId, userId, "schedule.manage");
  return await readOr404(deps, gymId);
}

/** Turn a repo outcome into this module's refusals, in ONE place: six routes
 *  share four outcomes, and a `switch` per route is four chances for one of them
 *  to answer 200 on a failure nobody mapped. */
function throwOnFailure(outcome: repo.ClassWriteOutcome): void {
  switch (outcome.kind) {
    case "ok":
      return;
    case "not_found":
      throw new OrgsError(404, "class_not_found", NOT_FOUND_MESSAGE);
    case "coach_not_staff":
      // 400 and not 404: the caller is allowed to know that the person they
      // picked is not on this gym's staff — they can see the staff list — and a
      // 404 here would look like the CLASS was missing.
      throw new OrgsError(
        400,
        "coach_not_staff",
        "Pick a coach who is on this gym's staff, or leave it blank.",
      );
    case "too_many":
      throw new OrgsError(
        409,
        "too_many_classes",
        `This gym is at its limit of ${String(outcome.cap)}. Archive one you no longer run first.`,
      );
    default: {
      // Exhaustive: a fifth outcome added to the repo fails to compile here
      // rather than falling through to a 200.
      const never: never = outcome;
      throw new Error(`unhandled class write outcome: ${JSON.stringify(never)}`);
    }
  }
}

/** `UpdateGymClassTypeRequest` IS `CreateGymClassTypeRequest` today — the update
 *  is a replace, not a merge — so this takes the one type rather than a union of
 *  two names for it. Both call sites still pass their own named type, which is
 *  what keeps the day they diverge a compile error here rather than a silent
 *  widening. */
function typeInput(req: CreateGymClassTypeRequest): repo.ClassTypeInput {
  const description = req.description ?? "";
  return {
    name: req.name,
    // An empty box means "no description", not an empty one — a screen that then
    // rendered "" under a dangling heading is `closeGymDayRequestSchema`'s
    // lesson, one table over.
    description: description.length === 0 ? null : description,
    minutes: req.minutes,
    places: req.places ?? null,
    coachUserId: req.coachUserId ?? null,
    colour: req.colour,
    openGym: req.openGym ?? false,
  };
}

export async function createClassType(
  deps: ClassesDeps,
  userId: string,
  gymId: string,
  req: CreateGymClassTypeRequest,
): Promise<GymClassesResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "schedule.manage");
  throwOnFailure(
    await repo.createClassType(deps.sql, { ...typeInput(req), gymId, actorUserId: userId }),
  );
  return await readOr404(deps, gymId);
}

export async function updateClassType(
  deps: ClassesDeps,
  userId: string,
  gymId: string,
  classTypeId: string,
  req: UpdateGymClassTypeRequest,
): Promise<GymClassesResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "schedule.manage");
  throwOnFailure(
    await repo.updateClassType(deps.sql, {
      ...typeInput(req),
      gymId,
      classTypeId,
      actorUserId: userId,
      now: deps.now(),
    }),
  );
  return await readOr404(deps, gymId);
}

export async function archiveClassType(
  deps: ClassesDeps,
  userId: string,
  gymId: string,
  classTypeId: string,
): Promise<GymClassesResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "schedule.manage");
  throwOnFailure(
    await repo.archiveClassType(deps.sql, {
      gymId,
      classTypeId,
      actorUserId: userId,
      now: deps.now(),
    }),
  );
  return await readOr404(deps, gymId);
}

export async function createSchedule(
  deps: ClassesDeps,
  userId: string,
  gymId: string,
  classTypeId: string,
  req: CreateGymClassScheduleRequest,
): Promise<GymClassesResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "schedule.manage");
  throwOnFailure(
    await repo.createSchedule(deps.sql, {
      gymId,
      classTypeId,
      weekdays: req.weekdays,
      startMinute: req.startMinute,
      startsOn: requireCalendarDate(req.startsOn, "startsOn"),
      endsOn:
        req.endsOn === undefined || req.endsOn === null
          ? null
          : requireCalendarDate(req.endsOn, "endsOn"),
      actorUserId: userId,
      now: deps.now(),
    }),
  );
  return await readOr404(deps, gymId);
}

export async function endSchedule(
  deps: ClassesDeps,
  userId: string,
  gymId: string,
  scheduleId: string,
): Promise<GymClassesResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "schedule.manage");
  throwOnFailure(
    await repo.endSchedule(deps.sql, {
      gymId,
      scheduleId,
      actorUserId: userId,
      now: deps.now(),
    }),
  );
  return await readOr404(deps, gymId);
}
