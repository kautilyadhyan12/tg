// WHO "REMOVE BY STATUS" REMOVES (5b-iii; RULINGS 2026-09-23). Pure.
//
// The gym ticks its own words in Filter ("Cancelled"); the app members whose record
// carries them are taken out of the gym in the app. Their records stay on the list.
//
// Which record is a member's: the one they joined with (their invitation), when it is
// current — that record alone decides. A member who joined with a record that has come
// off the list is "no longer listed" and belongs to that group, not this one. A member
// with no such record is reached by address: then EVERY current record holding their
// proved email or stated phone must carry the words. A mother sharing one address with
// a son marked Cancelled keeps her gym; a word on somebody else's record never removes
// anybody.
//
// Only paid seats: the owner, staff and free places are never in the group.
import { createHash } from "node:crypto";
import type { WordFilters } from "../invites/repo.js";

export interface RecordWords {
  status: string | null;
  membershipType: string | null;
  paymentStatus: string | null;
}

export interface MemberForWords {
  userId: string;
  fullName: string;
  email: string | null;
  joinedAt: Date;
  seatCounted: boolean;
  /** The record they joined with, or null when they joined without one. */
  joined: { current: boolean; words: RecordWords } | null;
  /** With no joined record: every current record reaching them by proved email or
   *  stated phone. Empty for a member who joined with a record. */
  reaching: RecordWords[];
}

/** A word as `GET /entries` folds it: case and spaces down; no word is "". */
const fold = (word: string | null): string => (word ?? "").trim().toLowerCase();

const allows = (asked: readonly string[] | null, word: string | null): boolean => asked === null || asked.includes(fold(word));

/** Whether one record carries the words: every kind asked for, ANDed, as the Filter reads. */
export function carriesWords(words: RecordWords, filters: WordFilters): boolean {
  return (
    allows(filters.statuses, words.status) &&
    allows(filters.membershipTypes, words.membershipType) &&
    allows(filters.paymentStatuses, words.paymentStatus)
  );
}

/** Whether this member is removed by these words. */
export function removedByWords(member: MemberForWords, filters: WordFilters): boolean {
  if (!member.seatCounted) return false;
  if (member.joined !== null) return member.joined.current && carriesWords(member.joined.words, filters);
  return member.reaching.length > 0 && member.reaching.every((record) => carriesWords(record, filters));
}

const byNameThenId = (a: MemberForWords, b: MemberForWords): number =>
  a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;

/** The members these words remove, by name. */
export function byWordsGroup<M extends MemberForWords>(members: readonly M[], filters: WordFilters): M[] {
  return members.filter((member) => removedByWords(member, filters)).sort(byNameThenId);
}

/** The set's fingerprint: the gym, the words (sorted, "none asked" told apart from any
 *  list) and the user ids in id order. */
export function byWordsDigest(gymId: string, filters: WordFilters, userIds: readonly string[]): string {
  const sorted = (words: readonly string[] | null) => (words === null ? null : [...words].sort());
  const words = JSON.stringify([sorted(filters.statuses), sorted(filters.membershipTypes), sorted(filters.paymentStatuses)]);
  const ids = [...userIds].sort();
  return createHash("sha256").update([gymId, "by_words", words, ...ids].join("\n"), "utf8").digest("hex");
}
