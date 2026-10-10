// THE AUTOMATIC MESSAGES ARE SENT (spec Part 3 §16.2; ROADMAP 20a, 20b-i).
//
// `gymMessageDue` in `@app/shared` decides; this gathers what it reads and writes what it
// returns, a gym at a time. A gym is read first with nothing held; only a gym with
// something to send has its row held, and is read again under it, so two runs at one
// instant take turns and the second finds the first's rows. `worker.ts` runs it on a
// schedule and `tools/member-messages.ts` by hand; a second run writes nothing.
//
// Four kinds are sent: Welcome, Birthday, Visit milestone and We miss you. The other four
// are in the rule and are given no facts here until 20b-ii reads memberships and bills.
import {
  GYM_MESSAGE_DAY_ENDS_HOUR,
  GYM_MESSAGE_DAY_STARTS_HOUR,
  GYM_MESSAGE_KEPT_DAYS,
  GYM_MESSAGE_WELCOME_DAYS,
  automaticMessage,
  gymMessageDue,
  gymMessageSettingsFrom,
  type GymMessageFacts,
  type GymMessageSettings,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { lockGym } from "../memberList/repo.js";
import * as repo from "./repo.js";
import { settingRows } from "./settingsRepo.js";

export interface SendMessagesDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}

/** How far back the read looks for joiners who have since left, in days of 24 hours; the
 *  rule keeps the days of the gym's calendar. */
const LOOK_BACK_DAYS = GYM_MESSAGE_WELCOME_DAYS;
/** How many of the gym's own check-in days the rule is handed: more than the longest wait
 *  before We miss you. */
const GYM_VISIT_DAYS = 120;

function factsFor(gym: repo.GymNow, settings: GymMessageSettings, visitDays: readonly string[], person: repo.MessagePerson): GymMessageFacts {
  return {
    gym: { open: gym.open, live: gym.live, today: gym.today, hour: gym.hour, on: settings.on, numbers: settings.numbers, visitDays },
    person: {
      member: person.member,
      former: person.former,
      staff: person.staff,
      off: person.off,
      joinedOn: person.joinedOn,
      joinedUtcOn: person.joinedUtcOn,
      trial: null,
      membershipEndsOn: null,
      bills: [],
      birthday: person.birthday,
      visits: person.visits,
      recentVisitDays: person.recentVisitDays,
      lastVisitOn: person.lastVisitOn,
    },
    sent: person.sent,
  };
}

/** Sends every automatic message that is due now. A gym that fails is logged and the
 *  rest still get theirs; the run then throws, so the job shows failed. `gymIds` is for
 *  tests on a shared database. */
export async function sendDueMessages(deps: SendMessagesDeps, opts: { now?: Date; gymIds?: readonly string[] } = {}): Promise<{ gyms: number; sent: number }> {
  const now = opts.now ?? new Date();
  const gymIds = await repo.gymsWithPeople(deps.sql, opts.gymIds ?? null);
  let sent = 0;
  const failed: string[] = [];
  for (const gymId of gymIds) {
    try {
      sent += await sendForGym(deps.sql, gymId, now);
    } catch (err) {
      failed.push(gymId);
      deps.log.error({ event: "member_messages.gym_failed", gymId, errName: err instanceof Error ? err.name : typeof err }, "member messages failed for a gym");
    }
  }
  // Counts only: who was sent what is in the table, never in a log.
  if (sent > 0) deps.log.info({ event: "member_messages.sent", gyms: gymIds.length, sent }, "member messages sent");
  if (failed.length > 0) throw new Error(`member messages failed for ${String(failed.length)} of ${String(gymIds.length)} gyms`);
  return { gyms: gymIds.length, sent };
}

/** What one gym is due now, from one read of it. */
async function dueForGym(sql: Sql | TransactionSql, gymId: string, now: Date): Promise<{ gym: repo.GymNow; due: repo.NewMessage[] } | null> {
  const gym = await repo.gymNow(sql, gymId, now);
  if (gym === null) return null;
  // The rule holds every message of a gym that is closed, on no plan or asleep: its people
  // are not read at all.
  if (!gym.open || !gym.live || gym.hour < GYM_MESSAGE_DAY_STARTS_HOUR || gym.hour >= GYM_MESSAGE_DAY_ENDS_HOUR) return { gym, due: [] };
  const settings = gymMessageSettingsFrom(await settingRows(sql, gymId));
  const visitDays = await repo.gymVisitDays(sql, gymId, gym.today, GYM_VISIT_DAYS);
  const due: repo.NewMessage[] = [];
  // One person may have two stays in the read (removed, then back): what the first
  // is sent, the second must see.
  const sentNow = new Map<string, repo.MessagePerson["sent"]>();
  for (const person of await repo.peopleForMessages(sql, gymId, now, gym.today, LOOK_BACK_DAYS)) {
    const before = sentNow.get(person.userId) ?? [];
    const { send } = gymMessageDue(factsFor(gym, settings, visitDays, { ...person, sent: [...person.sent, ...before] }));
    if (send === null) continue;
    const body = automaticMessage(send, gym.name, person.displayName, settings.ownLines[send.kind] ?? null);
    if (body === null) continue;
    due.push({ gymId, userId: person.userId, kind: send.kind, occasion: send.occasion, body, gymDay: gym.today });
    sentNow.set(person.userId, [...before, { ...send, day: gym.today }]);
  }
  return { gym, due };
}

/** One gym's due messages. Written with the gym's row held, from a read made under it: the
 *  first read only says whether there is anything to hold the row for. */
async function sendForGym(sql: Sql, gymId: string, now: Date): Promise<number> {
  const first = await dueForGym(sql, gymId, now);
  if (first === null || first.due.length === 0) return 0;
  return await sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const held = await dueForGym(tx, gymId, now);
    if (held === null) return 0;
    return repo.insertMessages(tx, held.due, now, GYM_MESSAGE_KEPT_DAYS);
  });
}
