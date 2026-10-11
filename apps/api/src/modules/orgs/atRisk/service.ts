// The At risk page (spec Part 3 §16.4; ROADMAP 20d-i): the people who used to come and
// have stopped, for staff holding `members.read`; the gym's two numbers, changed by
// whoever holds `org.manage`.
import type { Sql } from "postgres";
import {
  AT_RISK_MAX,
  GYM_COME_BACK_WAIT_DAYS,
  GYM_GROUP_MESSAGE_PROBLEM_WORDS,
  GYM_GROUP_MESSAGE_WORDS,
  GYM_MESSAGE_KEPT_DAYS,
  atRiskMessageResponseSchema,
  groupMessageProblem,
  orgWords,
  tidyGroupMessage,
  type AtRiskMessageRequest,
  type AtRiskMessageResponse,
  atRiskCheckin,
  atRiskOf,
  atRiskOrder,
  atRiskResponseSchema,
  atRiskSettingsResponseSchema,
  type AtRiskPerson,
  type AtRiskResponse,
  type AtRiskSettings,
  type AtRiskSettingsResponse,
  type HeldMembershipShown,
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

/** The list, for a gym whose reader has been checked. */
export async function getAtRisk(deps: AtRiskDeps, gymId: string): Promise<AtRiskResponse> {
  const now = deps.now();
  const clock = await repo.readClock(deps.sql, gymId, now);
  if (clock === null) throw notFound();
  const { today, settings, gymDays } = clock;
  const found: AtRiskPerson[] = [];
  for (const person of await repo.readCandidates(deps.sql, gymId, today, settings.quietDays)) {
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
  const held = entryIds.length === 0 ? new Map<string, never>() : await heldOnListOf(deps.sql, gymId, today, entryIds);
  const expected = found.filter((p) => {
    const shown = p.entryId === null ? undefined : held.get(p.entryId)?.shown;
    return shown === undefined || !NOT_EXPECTED.includes(shown.status);
  });
  expected.sort(atRiskOrder);
  const people = expected.slice(0, AT_RISK_MAX);
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
    total: expected.length,
    people,
  });
}

/** The gym's two numbers, set by whoever holds `org.manage` at a gym on a plan. Saved
 *  twice it is saved once. */
export async function setSettings(deps: AtRiskDeps, staffId: string, gymId: string, settings: AtRiskSettings): Promise<AtRiskSettingsResponse> {
  await requireWritablePrivilege(deps, gymId, staffId, "org.manage");
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

/** The gym's own words to ONE person in its app, from the At risk list.
 *
 *  Whoever may write to members (`members.confirm`, as a message to a group) at a gym on a
 *  plan. The words are checked as a group's are. It is kept as a sent message is, so the
 *  member reads it in their Inbox and Sent messages lists it, and it is not one of the
 *  day's three messages to groups. It goes only to a live member who has not switched the
 *  gym's messages off, and only when no come-back message, ready-made or written, went to
 *  them inside the wait. The same box pressed twice sends once. */
export async function sendOwnMessage(deps: AtRiskDeps, staffId: string, gymId: string, request: AtRiskMessageRequest): Promise<AtRiskMessageResponse> {
  const { org } = await requireWritablePrivilege(deps, gymId, staffId, "members.confirm");
  const words = orgWords(org.orgType);
  const body = tidyGroupMessage(request.body);
  const problem = groupMessageProblem(body);
  if (problem !== null) throw new OrgsError(400, `group_message_${problem}`, GYM_GROUP_MESSAGE_PROBLEM_WORDS[problem]);
  const bad = badWordsIn(body);
  if (bad.length > 0) throw new OrgsError(400, "group_message_bad_words", GYM_GROUP_MESSAGE_WORDS.bad_words(bad));
  return await deps.sql.begin(async (tx): Promise<AtRiskMessageResponse> => {
    // The gym's row: a removal, a switch and another send wait, so the wait is read once.
    await lockOrgRow(tx, gymId);
    const now = deps.now();
    const gym = await gymNow(tx, gymId, now);
    if (gym === null) throw notFound();
    const before = await groupRepo.byKey(tx, gymId, request.key);
    if (before !== null) {
      // The same press again. With other words it is another message, and it has not gone.
      if (before.body !== body) throw new OrgsError(409, "group_message_earlier_sent", GYM_GROUP_MESSAGE_WORDS.earlier_sent(before.people));
      return atRiskMessageResponseSchema.parse({ message: { body, sentAt: now.toISOString() } });
    }
    const member = await repo.liveMember(tx, gymId, request.userId);
    // One sentence for "no such person" and "not your member", as the ready-made line says it.
    if (!member) throw new OrgsError(404, "member_not_found", `That person isn't a ${words.person} of this ${words.it}.`);
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
    if (written.sent === 0) throw new OrgsError(404, "member_not_found", `That person isn't a ${words.person} of this ${words.it}.`);
    // The words are in the message's own row, never in the audit log.
    await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.at_risk_message_sent", targetType: "user", targetId: request.userId, meta: { message: written.id } });
    return atRiskMessageResponseSchema.parse({ message: { body, sentAt: now.toISOString() } });
  });
}
