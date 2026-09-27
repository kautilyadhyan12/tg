// The facts `appWord` decides from, gathered for a set of the list's records (spec Part 3
// §18.4): who in the app each record reaches, its address's invitation and opt-out, the
// plan's places and the gym's own day. A page, a person's page and the Filter's counts
// all come through here, so they cannot disagree.
import type { MemberAppFilter, MemberAppView, MemberAppWordCount } from "@app/shared";
import { MEMBER_APP_FILTER_ORDER } from "@app/shared";
import { displayNameFromEmail } from "../../auth/service.js";
import { dayInTz } from "../../gamification/streak.js";
import { emailHmac } from "../invites/address.js";
import * as invitesRepo from "../invites/repo.js";
import { invitationsOf } from "../invites/service.js";
import type { InviteSettings } from "../invites/settings.js";
import { gymSeatCap } from "../repo.js";
import { appFact, type AppPerson, type AppReasonKind } from "./appWord.js";
import type { MemberAgainstList, SqlOrTx } from "./repo.js";
import * as repo from "./repo.js";

/** One record, as much of it as the word needs. */
export interface AppRow {
  id: string;
  fullName: string;
  email: string | null;
  dateOfBirth: string | null;
  former: boolean;
}

/** A record's App word, and the reason behind it. */
export interface AppFact {
  view: MemberAppView;
  reason: AppReasonKind;
}

/** The App word of each record, in the order given. `members` is the gym's live members
 *  by §9.7's match: all of them, or at least every one this set's contacts reach. */
export async function appViewsOf(
  sql: SqlOrTx,
  settings: InviteSettings | null,
  gymId: string,
  rows: readonly AppRow[],
  members: readonly MemberAgainstList[],
  now: Date,
): Promise<MemberAppView[]> {
  return (await appFactsOf(sql, settings, gymId, rows, members, now)).map((fact) => fact.view);
}

/** `appViewsOf`, with each record's reason. */
export async function appFactsOf(
  sql: SqlOrTx,
  settings: InviteSettings | null,
  gymId: string,
  rows: readonly AppRow[],
  members: readonly MemberAgainstList[],
  now: Date,
): Promise<AppFact[]> {
  if (rows.length === 0) return [];
  const [invitations, optedOut, timeZone, cap] = await Promise.all([
    // The word never reads how many times an invitation was sent again.
    invitationsOf(sql, settings, gymId, rows, { countSentAgain: false }),
    optOutsOf(sql, settings, gymId, rows),
    repo.gymTimeZone(sql, gymId),
    gymSeatCap(sql, gymId),
  ]);
  const today = dayInTz(now, timeZone);

  const current = new Map<string, AppPerson[]>();
  const former = new Map<string, AppPerson[]>();
  // Each address someone in the app has proved, with the records they are matched to.
  const heldBy = new Map<string, { entryId: string; name: string }[]>();
  for (const member of members) {
    const person: AppPerson = {
      name: member.fullName,
      madeFromAddress: member.accountEmail === null ? null : displayNameFromEmail(member.accountEmail),
      confirmed: member.entryId !== null && member.nameConfirmedEntryId === member.entryId,
    };
    if (member.entryId !== null) add(current, member.entryId, person);
    if (member.formerEntryId !== null) add(former, member.formerEntryId, person);
    if (member.email !== null && member.entryId !== null) {
      add(heldBy, member.email.toLowerCase(), { entryId: member.entryId, name: member.entryFullName ?? member.fullName });
    }
  }

  return rows.map((row, at) => {
    const email = row.email?.toLowerCase() ?? null;
    const other = email === null ? undefined : heldBy.get(email)?.find((held) => held.entryId !== row.id);
    return appFact({
      fullName: row.fullName,
      email: row.email,
      dateOfBirth: row.dateOfBirth,
      former: row.former,
      inApp: (row.former ? former : current).get(row.id) ?? [],
      sharedWith: other?.name ?? null,
      invitation: invitations[at] ?? null,
      optedOut: optedOut[at] ?? null,
      cap,
      today,
    });
  });
}

/** The App choices a person answers to: their word; "not_invited" or "removed" for those
 *  two reasons; and "needs_check" when their line asks staff to check something. */
export function appChoices({ view, reason }: AppFact): MemberAppFilter[] {
  const choices: MemberAppFilter[] = [view.word];
  if (reason === "not_invited" || reason === "removed") choices.push(reason);
  if (view.lineTone !== "plain") choices.push("needs_check");
  return choices;
}

/** How many of the gym's current members each App choice holds, in the Filter's order,
 *  and the choices of each (for the Filter's own page). */
export async function currentAppWords(
  sql: SqlOrTx,
  settings: InviteSettings | null,
  gymId: string,
  members: readonly MemberAgainstList[],
  now: Date,
): Promise<{ counts: MemberAppWordCount[]; choices: Map<string, MemberAppFilter[]> }> {
  const rows = await repo.appRows(sql, gymId);
  const facts = await appFactsOf(sql, settings, gymId, rows, members, now);
  const choices = new Map<string, MemberAppFilter[]>();
  const tally = new Map<MemberAppFilter, number>();
  facts.forEach((fact, at) => {
    const row = rows[at];
    if (row === undefined) return;
    const mine = appChoices(fact);
    choices.set(row.id, mine);
    for (const choice of mine) tally.set(choice, (tally.get(choice) ?? 0) + 1);
  });
  const counts = MEMBER_APP_FILTER_ORDER.flatMap((word) => {
    const count = tally.get(word) ?? 0;
    return count === 0 ? [] : [{ word, count }];
  });
  return { counts, choices };
}

function add<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** This gym's unsubscribe or spam mark on each record's address. */
async function optOutsOf(
  sql: SqlOrTx,
  settings: InviteSettings | null,
  gymId: string,
  rows: readonly AppRow[],
): Promise<("unsubscribed" | "complained" | null)[]> {
  if (settings === null) return rows.map(() => null);
  const hmacs = rows.map((row) => (row.email === null ? null : emailHmac(settings.hmacKey, row.email)));
  const found = await invitesRepo.suppressionsFor(
    sql,
    gymId,
    hmacs.flatMap((hmac) => (hmac === null ? [] : [hmac])),
  );
  return hmacs.map((hmac) => {
    const reason = hmac === null ? undefined : found.get(hmac);
    return reason === "unsubscribed" || reason === "complained" ? reason : null;
  });
}
