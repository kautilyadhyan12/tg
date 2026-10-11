// The At risk page (spec Part 3 §16.4; ROADMAP 20d-i): the people who used to come and
// have stopped, for staff holding `members.read`; the gym's two numbers, changed by
// whoever holds `org.manage`.
import type { Sql } from "postgres";
import {
  AT_RISK_MAX,
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
    person.lastMessage = { preset: last.preset, sentAt: last.sentAt.toISOString() };
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
