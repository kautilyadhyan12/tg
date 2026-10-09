// THE AUTOMATIC MESSAGES ARE SENT (spec Part 3 §16.2; ROADMAP 20a).
//
// `gymMessageDue` in `@app/shared` decides; this gathers what it reads and writes what it
// returns, a gym at a time with the gym's row held, so two runs at one instant take turns
// and the second finds the first's rows. `worker.ts` runs it on a schedule and
// `tools/member-messages.ts` by hand; a second run writes nothing.
//
// 20a sends ONE kind, Welcome. The other seven are in the rule and are given no facts
// here until 20b reads memberships, bills, birthdays and visits for them.
import {
  GYM_MESSAGE_KEPT_DAYS,
  GYM_MESSAGE_STARTING_NUMBERS,
  GYM_MESSAGE_STARTING_ON,
  GYM_MESSAGE_WELCOME_DAYS,
  gymMessageDue,
  welcomeMessage,
  type GymMessageFacts,
  type GymMessageOccasion,
} from "@app/shared";
import type { Sql } from "postgres";
import { lockGym } from "../memberList/repo.js";
import * as repo from "./repo.js";

export interface SendMessagesDeps {
  sql: Sql;
  log: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
}

/** How far back the read looks for joiners, in days of 24 hours; the rule keeps the
 *  days of the gym's calendar. */
const LOOK_BACK_DAYS = GYM_MESSAGE_WELCOME_DAYS;

function factsFor(gym: repo.GymNow, person: repo.NewPerson): GymMessageFacts {
  return {
    gym: { open: gym.open, live: gym.live, today: gym.today, hour: gym.hour, on: GYM_MESSAGE_STARTING_ON, numbers: GYM_MESSAGE_STARTING_NUMBERS },
    person: {
      member: person.member,
      former: person.former,
      staff: person.staff,
      off: [],
      joinedOn: person.joinedOn,
      joinedUtcOn: person.joinedUtcOn,
      trial: null,
      membershipEndsOn: null,
      bills: [],
      birthday: null,
      visits: 0,
      lastVisitOn: null,
    },
    sent: person.sent,
  };
}

/** The words of a message, as sent. Only a kind this job sends has any. */
function wordsFor(send: GymMessageOccasion, gym: repo.GymNow, person: repo.NewPerson): string | null {
  return send.kind === "welcome" ? welcomeMessage(gym.name, person.displayName) : null;
}

/** Sends every automatic message that is due now. A gym that fails is logged and the
 *  rest still get theirs; the run then throws, so the job shows failed. `gymIds` is for
 *  tests on a shared database. */
export async function sendDueMessages(deps: SendMessagesDeps, opts: { now?: Date; gymIds?: readonly string[] } = {}): Promise<{ gyms: number; sent: number }> {
  const now = opts.now ?? new Date();
  const gymIds = await repo.gymsWithNewPeople(deps.sql, now, LOOK_BACK_DAYS, opts.gymIds ?? null);
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

/** One gym's due messages, written with the gym's row held. */
function sendForGym(sql: Sql, gymId: string, now: Date): Promise<number> {
  return sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const gym = await repo.gymNow(tx, gymId, now);
    if (gym === null) return 0;
    const due: repo.NewMessage[] = [];
    // One person may have two stays in the read (removed, then back): what the first
    // is sent, the second must see.
    const sentNow = new Map<string, repo.NewPerson["sent"]>();
    for (const person of await repo.newPeople(tx, gymId, now, LOOK_BACK_DAYS)) {
      const before = sentNow.get(person.userId) ?? [];
      const { send } = gymMessageDue(factsFor(gym, { ...person, sent: [...person.sent, ...before] }));
      if (send === null) continue;
      const body = wordsFor(send, gym, person);
      if (body === null) continue;
      due.push({ gymId, userId: person.userId, kind: send.kind, occasion: send.occasion, body, gymDay: gym.today });
      sentNow.set(person.userId, [...before, { ...send, day: gym.today }]);
    }
    return repo.insertMessages(tx, due, now, GYM_MESSAGE_KEPT_DAYS);
  });
}
