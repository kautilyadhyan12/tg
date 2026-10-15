// Staff activity (ROADMAP Stage 2 item 4d; Kd, RULINGS 2026-09-25): which worker did what
// and when, for the gym's owner. It reads the notes the server already keeps and writes
// nothing.
//
// The owner alone: `staff.manage` is the one privilege no other role can hold, the same
// that guards the Staff tab.
import type { Sql } from "postgres";
import { STAFF_ACTIVITY_PAGE, orgWords, staffActivityResponseSchema, type StaffActivityQuery, type StaffActivityResponse } from "@app/shared";
import { requirePrivilege } from "../service.js";
import type { OrgRow } from "../repo.js";
import * as repo from "./repo.js";
import { STAFF_ACTIONS, STAFF_LINES } from "./words.js";

export interface StaffActivityDeps {
  sql: Sql;
  now: () => Date;
}

/** Whoever may read this gym's staff activity: its owner. */
export async function requireReader(deps: StaffActivityDeps, userId: string, gymId: string): Promise<OrgRow> {
  const { org } = await requirePrivilege(deps, gymId, userId, "staff.manage");
  return org;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a note is about, and where its name is kept. */
function subjectOf(note: repo.NoteRow): { kind: repo.SubjectKind; id: string } | null {
  const entryId = note.meta["entryId"];
  const byEntry = typeof entryId === "string" ? ({ kind: "entry", id: entryId } as const) : null;
  const id = note.targetId;
  if (id === null) return byEntry;
  // Notes whose target is not the person they are about.
  if (note.action === "org.waiver_signed") return byEntry;
  if (note.action === "leaderboard.taken_off" || note.action === "leaderboard.put_back") return { kind: "user", id };
  switch (note.targetType) {
    case "member_list_entry":
      return { kind: "entry", id };
    case "gym_member":
      return { kind: "member", id };
    case "user":
    case "gym_staff":
      return { kind: "user", id };
    case "lead":
      return { kind: "lead", id };
    case "staff_invite":
      return { kind: "invite", id };
    case "challenge":
      return { kind: "challenge", id };
    case "event":
      return { kind: "event", id };
    case "member_tag":
      return { kind: "tag", id };
    case "gym_code":
      return { kind: "code", id };
    case "checkin_device":
      return { kind: "device", id };
    case "gym_class_schedule":
      return { kind: "schedule", id };
    case "gym_class_session":
      return { kind: "session", id };
    case "gym_class_booking":
      return { kind: "booking", id };
    case "gym_pt_appointment":
      return byEntry ?? { kind: "pt", id };
    case "gym_attendance":
      return { kind: "visit", id };
    case "gym_join_application":
      return { kind: "application", id };
    default:
      return byEntry;
  }
}

/** A changed class can name its weekly slot rather than the one class. */
const alsoAsked = (s: { kind: repo.SubjectKind; id: string }): { kind: repo.SubjectKind; id: string } | null =>
  s.kind === "session" ? { kind: "schedule", id: s.id } : null;

function encodeCursor(note: repo.NoteRow): string {
  return `${note.at}_${note.id}`;
}

function decodeCursor(after: string | undefined): { at: string; id: string } | null {
  if (after === undefined) return null;
  const cut = after.lastIndexOf("_");
  return { at: after.slice(0, cut), id: after.slice(cut + 1) };
}

/** The gym's own today, on its own calendar. */
function todayAt(timezone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export async function getStaffActivity(deps: StaffActivityDeps, org: OrgRow, query: StaffActivityQuery): Promise<StaffActivityResponse> {
  const workers = await repo.readWorkers(deps.sql, org.id);
  const notes = await repo.readPage(deps.sql, {
    gymId: org.id,
    timezone: org.timezone,
    actions: STAFF_ACTIONS,
    worker: query.worker ?? null,
    from: query.from ?? null,
    to: query.to ?? null,
    after: decodeCursor(query.after),
    limit: STAFF_ACTIVITY_PAGE + 1,
  });
  const page = notes.slice(0, STAFF_ACTIVITY_PAGE);

  const ids = new Map<repo.SubjectKind, string[]>();
  const ask = (s: { kind: repo.SubjectKind; id: string } | null): void => {
    if (s === null || !UUID.test(s.id)) return;
    const list = ids.get(s.kind) ?? [];
    if (!list.includes(s.id)) list.push(s.id);
    ids.set(s.kind, list);
  };
  for (const note of page) {
    const subject = subjectOf(note);
    ask(subject);
    if (subject !== null) ask(alsoAsked(subject));
  }
  const formerStaff = workers.filter((w) => !w.current).map((w) => w.userId);
  const names = ids.size === 0 ? new Map<string, string>() : await repo.readNames(deps.sql, org.id, ids, formerStaff);

  const words = orgWords(org.orgType);
  const lines = page.map((note) => {
    const subject = subjectOf(note);
    const second = subject === null ? null : alsoAsked(subject);
    const about = subject === null ? null : (names.get(`${subject.kind}:${subject.id}`) ?? (second === null ? null : (names.get(`${second.kind}:${second.id}`) ?? null)));
    const say = STAFF_LINES[note.action];
    const line = say === undefined ? "Made a change" : say({ meta: note.meta, about, words, currency: org.currencyDisplay });
    return { id: note.id, day: note.day, minute: note.minute, workerId: note.actorId, worker: note.actorName, line };
  });

  const last = page[page.length - 1];
  return staffActivityResponseSchema.parse({
    lines,
    next: notes.length > STAFF_ACTIVITY_PAGE && last !== undefined ? encodeCursor(last) : null,
    workers,
    today: todayAt(org.timezone, deps.now()),
  });
}

