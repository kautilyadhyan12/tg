// WHAT THE MEMBERS LIST SAYS ABOUT THE MEMBERSHIPS ITS PEOPLE HOLD (spec Part 3 §13.2,
// §18.2; ROADMAP 23a-i).
//
// The list's Status, Membership, Renews-or-ends and Payment columns read the gym's own
// words. Somebody given a membership here holds a fact the app knows, so for them the four
// columns, the Filter, the counts and the download read that fact instead, worked out by
// the one rule (`heldOnList` in `@app/shared`) on the gym's own day. Everybody else reads
// as before.
import type { Sql, TransactionSql } from "postgres";
import { HELD_PAYMENT_WORDS, HELD_STATUS_WORDS, heldListWords, heldOnList, type HeldOnList } from "@app/shared";
import { inUseForList, overForList, type ListHeld } from "./heldRepo.js";

export interface HeldShown {
  shown: HeldOnList;
  /** The record has no address. */
  noEmail: boolean;
}

const IN_USE: readonly HeldOnList["status"][] = ["active", "frozen", "upcoming"];

/** Each record whose columns the app answers, by its id: the records named, or every
 *  current record of the gym (null). `today` is the gym's own day.
 *
 *  Two reads at ONE moment: on the pool they share a read-only snapshot, so a membership
 *  cancelled between them is not handed to the rule as both in use and over. Inside a
 *  caller's own transaction they run as they stand: a write there holds the gym's lock,
 *  which every change to a membership takes first. */
export async function heldOnListOf(
  sql: Sql | TransactionSql,
  gymId: string,
  today: string,
  entryIds: readonly string[] | null,
): Promise<Map<string, HeldShown>> {
  if ("savepoint" in sql) return await bothReads(sql, gymId, today, entryIds);
  return await sql.begin("isolation level repeatable read read only", (tx) => bothReads(tx, gymId, today, entryIds));
}

/** The memberships stored in use say most people's answer by themselves. The second read is
 *  for the rest: the people with nothing stored in use, and the few whose every membership
 *  stored in use the clock has ended since anybody wrote to it, who are judged with the one
 *  stored over that finished last and what the list's own word names. */
async function bothReads(
  sql: Sql | TransactionSql,
  gymId: string,
  today: string,
  entryIds: readonly string[] | null,
): Promise<Map<string, HeldShown>> {
  const byEntry = new Map<string, { noEmail: boolean; held: ListHeld[] }>();
  for (const row of await inUseForList(sql, gymId, entryIds)) {
    const mine = byEntry.get(row.entryId);
    if (mine === undefined) byEntry.set(row.entryId, { noEmail: row.noEmail, held: [row.held] });
    else mine.held.push(row.held);
  }
  const out = new Map<string, HeldShown>();
  const ended: string[] = [];
  for (const [entryId, mine] of byEntry) {
    const shown = heldOnList({ held: mine.held, listedUnheld: null, today });
    if (shown !== null && IN_USE.includes(shown.status)) out.set(entryId, { shown, noEmail: mine.noEmail });
    else ended.push(entryId);
  }
  for (const row of await overForList(sql, gymId, entryIds, ended, today)) {
    const held = [...(byEntry.get(row.entryId)?.held ?? []), ...(row.held === null ? [] : [row.held])];
    const shown = heldOnList({ held, listedUnheld: row.listedUnheld, today });
    if (shown !== null) out.set(row.entryId, { shown, noEmail: row.noEmail });
  }
  return out;
}

/** A word as every comparison of one of the list's words folds it. */
const fold = (word: string): string => word.trim().toLowerCase();

/** The three word filters as the list's routes fold them; null is "not asked". */
export interface AskedWords {
  statuses: readonly string[] | null;
  membershipTypes: readonly string[] | null;
  paymentStatuses: readonly string[] | null;
}

/** Which of the people the app answers for pass the word filters asked: every kind asked
 *  must match, and "" is the people with none of that kind, as it is for the list's words. */
export function heldPassing(held: ReadonlyMap<string, HeldShown>, asked: AskedWords): string[] {
  const passes = (wanted: readonly string[] | null, words: readonly string[]): boolean =>
    wanted === null || (words.length === 0 ? wanted.includes("") : words.some((word) => wanted.includes(fold(word))));
  const ids: string[] = [];
  for (const [entryId, { shown }] of held) {
    const words = heldListWords(shown);
    if (
      passes(asked.statuses, [words.status]) &&
      passes(asked.membershipTypes, words.memberships) &&
      passes(asked.paymentStatuses, words.payment === null ? [] : [words.payment])
    ) {
      ids.push(entryId);
    }
  }
  return ids;
}

/** One of the list's chips: a word and the three numbers under it. */
export interface WordCount {
  label: string;
  count: number;
  inApp: number;
  canBeInvited: number;
  noEmail: number;
}

/** The Filter's order for the app's own words: the states of a membership, then what is
 *  owed first. Membership names go by the alphabet. */
const STATUS_ORDER = (["active", "frozen", "upcoming", "ended", "cancelled"] as const).map((status) => fold(HELD_STATUS_WORDS[status]));
const PAYMENT_ORDER = [HELD_PAYMENT_WORDS.due, HELD_PAYMENT_WORDS.later, HELD_PAYMENT_WORDS.paid, HELD_PAYMENT_WORDS.free].map(fold);

function ordered(chips: Map<string, WordCount>, order: readonly string[] | null): WordCount[] {
  const place = (key: string): number => (order === null ? 0 : order.includes(key) ? order.indexOf(key) : order.length);
  return [...chips.entries()]
    .sort(([a], [b]) => place(a) - place(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([, chip]) => chip);
}

/** The chips of the people the app answers for, by kind, in the Filter's order. A person
 *  with two memberships is under both names. */
export function heldChips(
  held: ReadonlyMap<string, HeldShown>,
  inAppEntryIds: ReadonlySet<string>,
): { statuses: WordCount[]; membershipTypes: WordCount[]; paymentStatuses: WordCount[] } {
  const kinds = { statuses: new Map<string, WordCount>(), membershipTypes: new Map<string, WordCount>(), paymentStatuses: new Map<string, WordCount>() };
  const add = (into: Map<string, WordCount>, label: string, inApp: boolean, noEmail: boolean): void => {
    const key = fold(label);
    const chip = into.get(key) ?? { label, count: 0, inApp: 0, canBeInvited: 0, noEmail: 0 };
    chip.count += 1;
    if (inApp) chip.inApp += 1;
    if (!inApp && !noEmail) chip.canBeInvited += 1;
    if (noEmail) chip.noEmail += 1;
    into.set(key, chip);
  };
  for (const [entryId, { shown, noEmail }] of held) {
    const inApp = inAppEntryIds.has(entryId);
    const words = heldListWords(shown);
    add(kinds.statuses, words.status, inApp, noEmail);
    for (const name of words.memberships) add(kinds.membershipTypes, name, inApp, noEmail);
    add(kinds.paymentStatuses, words.payment ?? "", inApp, noEmail);
  }
  return {
    statuses: ordered(kinds.statuses, STATUS_ORDER),
    membershipTypes: ordered(kinds.membershipTypes, null),
    paymentStatuses: ordered(kinds.paymentStatuses, PAYMENT_ORDER),
  };
}

/** The app's chips and the list's own, as one set: a word both have is one chip, in the
 *  app's spelling, with the numbers added up. The app's words come first, then the list's
 *  in their own order, cut to `max`. The people with no word of a kind stay where the list
 *  has them, or come last where only the app has any. */
export function mergeChips(app: readonly WordCount[], own: readonly WordCount[], max: number): WordCount[] {
  const merged = new Map<string, WordCount>();
  const none = (chip: WordCount): boolean => chip.label === "";
  for (const chip of [...app.filter((c) => !none(c)), ...own, ...app.filter(none)]) {
    const key = fold(chip.label);
    const had = merged.get(key);
    if (had === undefined) {
      merged.set(key, { ...chip });
    } else {
      had.count += chip.count;
      had.inApp += chip.inApp;
      had.canBeInvited += chip.canBeInvited;
      had.noEmail += chip.noEmail;
    }
  }
  return [...merged.values()].slice(0, max);
}
