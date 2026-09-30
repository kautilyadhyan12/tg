/**
 * REVIEW NEEDED (ROADMAP 5b-v-d-iv; RULINGS 2026-09-29): what an import found wrong on a
 * person stays on their record until staff fix it. Pure: the confirm, an edit and It's
 * correct each hand in what the record holds and get back what it holds next.
 *
 * A record keeps two lists of `problem:field` items. `needsReview` is what is still to
 * look at. `reviewChecked` is what staff pressed It's correct on, kept only while that
 * field's value stays as it was, so next month's file does not mark it again.
 */
import {
  MEMBER_LIST_EXTRA_FIELD_PREFIX,
  memberListReviewKey,
  type MemberListExtraField,
  type MemberListReviewItem,
  type MemberListRow,
} from "@app/shared";
import type { CarriedFields, KeptField, ListEntry, ReconciledPerson } from "./reconcile.js";

export interface ReviewState {
  needsReview: readonly string[];
  reviewChecked: readonly string[];
}

export const NO_REVIEW: ReviewState = { needsReview: [], reviewChecked: [] };

/** The field an item is about: everything after the problem's name. */
export function reviewFieldOf(key: string): string {
  const at = key.indexOf(":");
  return at < 0 ? "" : key.slice(at + 1);
}

function unique(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

/** One person an import writes. `found` is what the file had wrong in their cells, each
 *  field already named as the record names it; `carried` every field the import writes for
 *  them; `moved` the fields whose value it changes. `now` is null for a new record. */
export function reviewAfterImport(
  now: ReviewState | null,
  file: { found: readonly MemberListReviewItem[]; carried: ReadonlySet<string>; moved: ReadonlySet<string> },
): ReviewState {
  const before = now ?? NO_REVIEW;
  // A check holds while the value it was about is still there.
  const reviewChecked = before.reviewChecked.filter((key) => !file.moved.has(reviewFieldOf(key)));
  const checked = new Set(reviewChecked);
  const found = file.found
    .filter((item) => file.carried.has(item.field))
    .map(memberListReviewKey)
    .filter((key) => !checked.has(key));
  // A field the file writes is judged by this file alone; any other keeps its marks.
  const kept = before.needsReview.filter((key) => !file.carried.has(reviewFieldOf(key)));
  return { needsReview: unique([...kept, ...found]), reviewChecked: unique(reviewChecked) };
}

/** Staff changed these fields by hand: whatever the file had wrong there is theirs now. */
export function reviewAfterEdit(now: ReviewState, edited: readonly string[]): ReviewState {
  const fields = new Set(edited);
  const keep = (key: string): boolean => !fields.has(reviewFieldOf(key));
  return { needsReview: now.needsReview.filter(keep), reviewChecked: now.reviewChecked.filter(keep) };
}

/** Two records of one person joined: the kept record's values stay and only its empty fields
 *  are filled from the other (`filled`). A filled field's problems are the other record's,
 *  carried with the value; the kept record's own on that field go with its empty value. */
export function reviewAfterMerge(keep: ReviewState, gone: ReviewState, filled: readonly string[]): ReviewState {
  const fields = new Set(filled);
  const kept = reviewAfterEdit(keep, filled);
  const carried = (key: string): boolean => fields.has(reviewFieldOf(key));
  return {
    needsReview: unique([...kept.needsReview, ...gone.needsReview.filter(carried)]),
    reviewChecked: unique([...kept.reviewChecked, ...gone.reviewChecked.filter(carried)]),
  };
}

/** It's correct: the item leaves the review and is remembered as checked. Pressing it on
 *  an item already gone changes nothing. */
export function reviewAfterChecked(now: ReviewState, item: MemberListReviewItem): ReviewState {
  const key = memberListReviewKey(item);
  if (!now.needsReview.includes(key)) return { needsReview: [...now.needsReview], reviewChecked: [...now.reviewChecked] };
  return {
    needsReview: now.needsReview.filter((each) => each !== key),
    reviewChecked: unique([...now.reviewChecked, key]),
  };
}

/** Whether two states hold the same items, so an unchanged record is not written. */
export function sameReview(a: ReviewState, b: ReviewState): boolean {
  const same = (x: readonly string[], y: readonly string[]): boolean =>
    x.length === y.length && x.every((key) => y.includes(key));
  return same(a.needsReview, b.needsReview) && same(a.reviewChecked, b.reviewChecked);
}

/** The standard fields an import may write, as `CarriedFields` names them. */
const CARRIED_FIELDS: readonly (keyof CarriedFields)[] = [
  "fullName",
  "email",
  "phone",
  "memberNumber",
  "status",
  "membershipType",
  "joinedOn",
  "endsOn",
  "paymentStatus",
  "dateOfBirth",
];

/** Everyone an import writes and the marks each record will hold, leaving out every
 *  record whose marks stay as they are. A problem is kept only on a field the import
 *  really writes: a column the gym does not keep marks nobody. */
export function importReviews(input: {
  rows: readonly MemberListRow[];
  added: readonly ReconciledPerson[];
  held: readonly ReconciledPerson[];
  entries: readonly ListEntry[];
  /** The file's own columns, in the order a row's cells and its review name them. */
  fileFields: readonly MemberListExtraField[];
  kept: readonly KeptField[];
  carries: CarriedFields;
}): { identityKey: string; review: ReviewState }[] {
  const carried = new Set<string>([
    ...CARRIED_FIELDS.filter((field) => input.carries[field]),
    ...input.kept.map((field) => `${MEMBER_LIST_EXTRA_FIELD_PREFIX}${field.key}`),
  ]);
  // The file names one of its own columns by its key; the record, by the gym's.
  const gymKeyOf = new Map<string, string>();
  for (const field of input.kept) {
    const fileField = input.fileFields[field.at];
    if (fileField !== undefined) gymKeyOf.set(`${MEMBER_LIST_EXTRA_FIELD_PREFIX}${fileField.key}`, `${MEMBER_LIST_EXTRA_FIELD_PREFIX}${field.key}`);
  }
  const foundFor = (person: ReconciledPerson): MemberListReviewItem[] => {
    const row = person.at === null ? undefined : input.rows[person.at];
    if (row === undefined) throw new Error(`a person the import writes has no place in the file (row ${String(person.row)})`);
    return row.review.flatMap((item) => {
      if (!item.field.startsWith(MEMBER_LIST_EXTRA_FIELD_PREFIX)) return [item];
      const field = gymKeyOf.get(item.field);
      return field === undefined ? [] : [{ problem: item.problem, field }];
    });
  };
  const byId = new Map(input.entries.map((entry) => [entry.id, entry]));
  const out: { identityKey: string; review: ReviewState }[] = [];
  for (const person of input.added) {
    const review = reviewAfterImport(null, { found: foundFor(person), carried, moved: new Set() });
    if (!sameReview(review, NO_REVIEW)) out.push({ identityKey: person.identityKey, review });
  }
  for (const person of input.held) {
    const entry = person.entryId === null ? undefined : byId.get(person.entryId);
    if (entry === undefined) throw new Error(`a record the import writes was not read with the list (row ${String(person.row)})`);
    const review = reviewAfterImport(entry.review, { found: foundFor(person), carried, moved: new Set(person.moved) });
    if (!sameReview(review, entry.review)) out.push({ identityKey: person.identityKey, review });
  }
  return out;
}
