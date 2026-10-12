// The At risk page (spec Part 3 §16.4; ROADMAP 20d-i): the people who used to come and
// have stopped, for staff holding `members.read`; the gym's two numbers, changed by
// whoever holds `org.manage`; the gym's own words to one of them, by `members.confirm`.
//
// Each `require…` is asked by the route BEFORE its rate limit, so somebody refused uses up
// nobody's allowance; the work after it is for a gym whose asker has been checked.
import type { Sql, TransactionSql } from "postgres";
import {
  AT_RISK_MAX,
  GYM_COME_BACK_WAIT_DAYS,
  GYM_GROUP_MESSAGE_PROBLEM_WORDS,
  GYM_GROUP_MESSAGE_WORDS,
  GYM_MESSAGE_KEPT_DAYS,
  atRiskCheckin,
  atRiskDaysLately,
  atRiskMessageResponseSchema,
  atRiskOf,
  atRiskOrder,
  atRiskResponseSchema,
  atRiskSettingsResponseSchema,
  groupMessageProblem,
  orgWords,
  tidyGroupMessage,
  type AtRiskMessageRequest,
  type AtRiskMessageResponse,
  type AtRiskPerson,
  type AtRiskResponse,
  type AtRiskSettings,
  type AtRiskSettingsResponse,
  type HeldMembershipShown,
  type OrgType,
} from "@app/shared";
import { heldOnListOf } from "../memberships/onList.js";
import * as groupRepo from "../messages/groupRepo.js";
import { gymNow } from "../messages/repo.js";
import { badWordsIn } from "../posts/badWords.js";
import { insertAudit, lockOrgRow } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import * as repo from "./repo.js";

export interface AtRiskDeps {
  sql: Sql;
  now: () => Date;
}

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");

/** What the Members list reads for somebody who is not expected: their membership is
 *  frozen, or it is over and Reports already counts them as left. */
const NOT_EXPECTED: readonly HeldMembershipShown[] = ["frozen", "ended", "cancelled"];

/** Whoever may read this gym's At risk list; anybody else is refused. */
export async function requireReader(deps: AtRiskDeps, userId: string, gymId: string): Promise<void> {
  await requirePrivilege(deps, gymId, userId, "members.read");
}

/** Whoever may change the gym's two numbers, at a gym on a plan. */
export async function requireSettingsWriter(deps: AtRiskDeps, userId: string, gymId: string): Promise<void> {
  await requireWritablePrivilege(deps, gymId, userId, "org.manage");
}

/** Whoever may write to members (as a message to a group), at a gym on a plan. */
export async function requireMessageWriter(deps: AtRiskDeps, userId: string, gymId: string): Promise<{ orgType: OrgType }> {
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");
  return { orgType: org.orgType };
}

/** Everybody at risk at this gym now, in the list's order, with what the gym's own
 *  check-ins allow. No message is read here. Every read is on the connection given: a
 *  caller holding the gym's row hands over its own transaction, never the pool. */
async function findAtRisk(sql: Sql | TransactionSql, gymId: string, now: Date): Promise<{ clock: repo.AtRiskClock; people: AtRiskPerson[] }> {
  const clock = await repo.readClock(sql, gymId, now);
  if (clock === null) throw notFound();
  const { today, settings, gymDays } = clock;
  const found: AtRiskPerson[] = [];
  for (const person of await repo.readCandidates(sql, gymId, today, settings.quietDays)) {
    if (person.staff) continue;
    const risk = atRiskOf({ today, quietDays: settings.quietDays, weeksCame: settings.weeksCame, visitDays: person.visitDays, gymDays });
    if (!risk.atRisk) continue;
    const one = person.entryId === null ? person.userId : person.holders.length === 1 ? (person.holders[0] ?? null) : null;
    found.push({
      entryId: person.entryId,
      userId: one,
      app: one !== null ? "one" : person.holders.length > 1 ? "shared" : "none",
      name: person.name,
      lastVisitOn: risk.lastVisitOn,
      daysAway: risk.daysAway,
      weeksCame: risk.weeksCame,
      lastMessage: null,
      messageableAt: null,
    });
  }
  const entryIds = found.flatMap((p) => (p.entryId === null ? [] : [p.entryId]));
  const held = entryIds.length === 0 ? new Map<string, never>() : await heldOnListOf(sql, gymId, today, entryIds);
  const people = found.filter((p) => {
    const shown = p.entryId === null ? undefined : held.get(p.entryId)?.shown;
    return shown === undefined || !NOT_EXPECTED.includes(shown.status);
  });
  people.sort(atRiskOrder);
  return { clock, people };
}

/** The list, for a gym whose reader has been checked. */
export async function getAtRisk(deps: AtRiskDeps, gymId: string): Promise<AtRiskResponse> {
  const now = deps.now();
  const { clock, people: everybody } = await findAtRisk(deps.sql, gymId, now);
  const { today, settings, gymDays } = clock;
  const people = everybody.slice(0, AT_RISK_MAX);
  const messages = await repo.readLastMessages(deps.sql, gymId, people.flatMap((p) => (p.userId === null ? [] : [p.userId])), now);
  for (const person of people) {
    const last = person.userId === null ? undefined : messages.get(person.userId);
    if (last === undefined) continue;
    person.lastMessage = { preset: last.preset, body: last.body, sentAt: last.sentAt.toISOString() };
    person.messageableAt = last.messageableAt === null ? null : last.messageableAt.toISOString();
  }
  return atRiskResponseSchema.parse({
    settings,
    today,
    checkin: atRiskCheckin({ today, quietDays: settings.quietDays, firstCheckinOn: clock.firstCheckinOn, gymDays }),
    firstCheckinOn: clock.firstCheckinOn,
    lastCheckinOn: clock.lastCheckinOn,
    checkinDaysLately: atRiskDaysLately(gymDays, today, settings.quietDays),
    total: everybody.length,
    people,
  });
}

/** How many people the list names now, for Overview's Last 7 days box. Null where the
 *  page itself would not be showing a list: check-in never used, only just begun, or
 *  stopped. A nought there would read as "nobody has stopped coming". */
export async function countAtRisk(sql: Sql, gymId: string, now: Date): Promise<number | null> {
  const { clock, people } = await findAtRisk(sql, gymId, now);
  const checkin = atRiskCheckin({ today: clock.today, quietDays: clock.settings.quietDays, firstCheckinOn: clock.firstCheckinOn, gymDays: clock.gymDays });
  return checkin === "in_use" ? people.length : null;
}

/** The gym's two numbers, for a gym whose writer has been checked. Saved twice it is saved
 *  once. */
export async function setSettings(deps: AtRiskDeps, staffId: string, gymId: string, settings: AtRiskSettings): Promise<AtRiskSettingsResponse> {
  await deps.sql.begin(async (tx) => {
    await lockOrgRow(tx, gymId);
    const was = await repo.writeSettings(tx, gymId, settings);
    if (was === null) throw notFound();
    if (was.quietDays === settings.quietDays && was.weeksCame === settings.weeksCame) return;
    await insertAudit(tx, {
      actorUserId: staffId,
      gymId,
      action: "org.at_risk_settings_changed",
      targetType: "gym",
      targetId: gymId,
      meta: { quietDays: String(settings.quietDays), weeksCame: String(settings.weeksCame) },
    });
  });
  return atRiskSettingsResponseSchema.parse({ settings });
}

/** The gym's own words to ONE person on its At risk list, for a gym whose writer has been
 *  checked.
 *
 *  The words are checked as a group's are. It is kept as a sent message is, so the member
 *  reads it in their Inbox and Sent messages lists it, and it is not one of the day's three
 *  messages to groups. It goes only to somebody the list names at that moment who can be
 *  written to (one live account, the gym's messages not switched off), and only when no
 *  come-back message, ready-made or written, went to them inside the wait. A box's key is
 *  that box's: pressed twice it sends once, and it never answers for another person. */
export async function sendOwnMessage(deps: AtRiskDeps, staffId: string, gymId: string, org: { orgType: OrgType }, request: AtRiskMessageRequest): Promise<AtRiskMessageResponse> {
  const words = orgWords(org.orgType);
  const body = tidyGroupMessage(request.body);
  const problem = groupMessageProblem(body);
  if (problem !== null) throw new OrgsError(400, `group_message_${problem}`, GYM_GROUP_MESSAGE_PROBLEM_WORDS[problem]);
  const bad = badWordsIn(body);
  if (bad.length > 0) throw new OrgsError(400, "group_message_bad_words", GYM_GROUP_MESSAGE_WORDS.bad_words(bad));
  const notTheirs = (): OrgsError => new OrgsError(404, "member_not_found", `That person isn't a ${words.person} of this ${words.it}.`);
  return await deps.sql.begin(async (tx): Promise<AtRiskMessageResponse> => {
    // The gym's row: a removal, a switch and another send wait, so the wait is read once.
    await lockOrgRow(tx, gymId);
    const now = deps.now();
    const gym = await gymNow(tx, gymId, now);
    if (gym === null) throw notFound();
    const before = await groupRepo.sentByKey(tx, gymId, request.key);
    if (before !== null) {
      // The same press again. For another person, or with other words, it is another
      // message, and it has not gone.
      if (!before.onePerson || !before.userIds.includes(request.userId)) {
        throw new OrgsError(409, "message_key_used", "That message was already sent to somebody else. Nothing more was sent. Close the box and open it again to write a new one.");
      }
      if (before.body !== body) throw new OrgsError(409, "group_message_earlier_sent", GYM_GROUP_MESSAGE_WORDS.earlier_sent(before.userIds.length));
      return atRiskMessageResponseSchema.parse({ message: { body, sentAt: before.sentAt.toISOString() } });
    }
    // One sentence for "no such person" and "not your member", as the ready-made line says it.
    if (!(await repo.liveMember(tx, gymId, request.userId))) throw notTheirs();
    // Only somebody the list names now: this is no second way to write to everybody.
    const { people } = await findAtRisk(tx, gymId, now);
    if (!people.some((person) => person.userId === request.userId)) {
      throw new OrgsError(409, "member_not_at_risk", `This ${words.person} isn't on your At risk list now, so nothing was sent. To write to them, use Send message on the ${words.peopleCap} page.`);
    }
    if (await groupRepo.groupMessagesOff(tx, gymId, request.userId)) {
      throw new OrgsError(409, "member_messages_off", `This ${words.person} has switched off messages from your ${words.it}, so your own message can't be sent. You can still send one of the ready-made lines.`);
    }
    if (await repo.comeBackTooSoon(tx, gymId, request.userId)) {
      throw new OrgsError(409, "nudge_already_sent", `This ${words.person} has already been sent a message in the last ${String(GYM_COME_BACK_WAIT_DAYS)} days.`);
    }
    const written = await groupRepo.insertGroupMessage(
      tx,
      { gymId, sentBy: staffId, body, gymDay: gym.today, sendKey: request.key, userIds: [request.userId], onePerson: true },
      now,
      GYM_MESSAGE_KEPT_DAYS,
    );
    if (written.sent === 0) throw notTheirs();
    // The words are in the message's own row, never in the audit log.
    await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.at_risk_message_sent", targetType: "user", targetId: request.userId, meta: { message: written.id } });
    return atRiskMessageResponseSchema.parse({ message: { body, sentAt: now.toISOString() } });
  });
}
