// Keeping the list by hand (Part 3 §9.9, §11.6; ROADMAP 3a-iv): what staff type,
// cleaned by the same rules as a file's cells, and what joining two records keeps.
// Pure, so every case is a row in a table test.
import type { CountryCode } from "libphonenumber-js/max";
import {
  MEMBER_LIST_BY_HAND_WORDS,
  MEMBER_LIST_EXTRA_FIELD_PREFIX,
  MEMBER_LIST_FIELD_WORDS,
  MEMBER_LIST_MAX_EXTRA_CHARS,
  MEMBER_LIST_MAX_NAME_CHARS,
  MEMBER_LIST_MAX_STATUS_CHARS,
  authEmailSchema,
  memberListCardTypedWords,
  type MemberListEntryPatch,
  type MemberListField,
} from "@app/shared";
import { tidyCell } from "./cells.js";
import { dayOf } from "./dates.js";
import { cleanMemberNumber, cut } from "./fields.js";
import { cardShapedCell, withoutCardNumbers } from "./neverKeep.js";
import { readPhone } from "./phone.js";

/** Everything one record holds that staff can see and change. */
export interface EntryValues {
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
  status: string | null;
  membershipType: string | null;
  joinedOn: string | null;
  endsOn: string | null;
  endsOnKind: "ends" | "renews" | null;
  paymentStatus: string | null;
  dateOfBirth: string | null;
  extra: Record<string, string>;
}

export const EMPTY_VALUES: EntryValues = {
  fullName: "",
  email: null,
  phone: null,
  memberNumber: null,
  status: null,
  membershipType: null,
  joinedOn: null,
  endsOn: null,
  endsOnKind: null,
  paymentStatus: null,
  dateOfBirth: null,
  extra: {},
};

export type ByHandRefusalCode = keyof typeof MEMBER_LIST_BY_HAND_WORDS | "card_number";

export interface ByHandRefusal {
  code: ByHandRefusalCode;
  message: string;
}

export type Applied =
  | {
      ok: true;
      values: EntryValues;
      /** Field names (§11.4) whose value this change really moved, for the hand-edit
       *  marks. The four identity fields are never here: an upload cannot write over
       *  them, it can only disagree about who the person is. */
      edited: string[];
      /** Which of the four identity fields moved; any of them gives a new key. */
      identityFields: MemberListField[];
    }
  | { ok: false; refusal: ByHandRefusal };

export interface TypedContext {
  /** The gym's country, for a phone typed without its country code. */
  country: CountryCode | null;
  /** The gym's own columns, key to heading. A key not here is refused. */
  fields: ReadonlyMap<string, string>;
}

const refuse = (code: keyof typeof MEMBER_LIST_BY_HAND_WORDS): Applied => ({
  ok: false,
  refusal: { code, message: MEMBER_LIST_BY_HAND_WORDS[code] },
});

const refuseCard = (field: string): Applied => ({
  ok: false,
  refusal: { code: "card_number", message: memberListCardTypedWords(field) },
});

/** §11.2: a card number typed into any field is refused — the whole field a card,
 *  or a card written inside it. */
export const holdsCard = (text: string): boolean => cardShapedCell(text) || withoutCardNumbers(text).removed > 0;

const WORD_FIELDS = ["status", "membershipType", "paymentStatus"] as const;
const DAY_FIELDS = ["joinedOn", "endsOn", "dateOfBirth"] as const;

/** A `YYYY-MM-DD` that is a real calendar day, or null. */
function realDay(text: string): string | null {
  const [y, m, d] = text.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return null;
  return dayOf(y, m, d) === text ? text : null;
}

/** The fields the hand-edit marks and the merge are about: everything but the four
 *  that make the identity key. `endsOnKind` rides with `endsOn`. */
const MARKED_FIELDS = ["status", "membershipType", "joinedOn", "endsOn", "paymentStatus", "dateOfBirth"] as const satisfies readonly MemberListField[];

/** The four fields `identityKey` is built from. */
const IDENTITY_FIELDS = ["fullName", "email", "phone", "memberNumber"] as const satisfies readonly MemberListField[];

function editedBetween(before: EntryValues, after: EntryValues): string[] {
  const edited: string[] = [];
  for (const field of MARKED_FIELDS) {
    const moved = field === "endsOn" ? before.endsOn !== after.endsOn || before.endsOnKind !== after.endsOnKind : before[field] !== after[field];
    if (moved) edited.push(field);
  }
  for (const [key, value] of Object.entries(after.extra)) {
    if ((before.extra[key] ?? "") !== value) edited.push(`${MEMBER_LIST_EXTRA_FIELD_PREFIX}${key}`);
  }
  return edited;
}

/** Apply what staff typed to a stored record (EMPTY_VALUES for "Add member"). A
 *  field left out is left alone; `null` or "" empties it. Every typed value goes
 *  through the file's own rule for that field, and one that cannot be kept refuses
 *  the whole change rather than being dropped silently. */
export function applyTyped(stored: EntryValues, typed: MemberListEntryPatch, context: TypedContext): Applied {
  const next: EntryValues = { ...stored, extra: { ...stored.extra } };

  // Every field is tidied before it is asked the card question, so a card written with
  // no-break spaces, full-width digits or zero-width joiners is seen as one.
  if (typed.fullName !== undefined) {
    const name = tidyCell(typed.fullName);
    if (holdsCard(name)) return refuseCard(MEMBER_LIST_FIELD_WORDS.fullName);
    next.fullName = cut(name, MEMBER_LIST_MAX_NAME_CHARS);
  }

  if (typed.email !== undefined) {
    const text = tidyCell(typed.email ?? "");
    if (text === "") next.email = null;
    else {
      if (holdsCard(text)) return refuseCard(MEMBER_LIST_FIELD_WORDS.email);
      const parsed = authEmailSchema.safeParse(text);
      if (!parsed.success) return refuse("bad_email");
      next.email = parsed.data;
    }
  }

  if (typed.phone !== undefined) {
    const text = tidyCell(typed.phone ?? "");
    if (text === "") next.phone = null;
    else {
      if (holdsCard(text)) return refuseCard(MEMBER_LIST_FIELD_WORDS.phone);
      const read = readPhone(text, context.country);
      if (read.e164 === null) return refuse("bad_phone");
      next.phone = read.e164;
    }
  }

  if (typed.memberNumber !== undefined) {
    const text = tidyCell(typed.memberNumber ?? "");
    if (text === "") next.memberNumber = null;
    else {
      if (holdsCard(text)) return refuseCard(MEMBER_LIST_FIELD_WORDS.memberNumber);
      const read = cleanMemberNumber(text);
      if (read.card) return refuseCard(MEMBER_LIST_FIELD_WORDS.memberNumber);
      if (read.shortened) return refuse("bad_member_number");
      next.memberNumber = read.value;
    }
  }

  for (const field of WORD_FIELDS) {
    const value = typed[field];
    if (value === undefined) continue;
    const text = tidyCell(value ?? "");
    if (text === "") {
      next[field] = null;
      continue;
    }
    if (holdsCard(text)) return refuseCard(MEMBER_LIST_FIELD_WORDS[field]);
    next[field] = cut(text, MEMBER_LIST_MAX_STATUS_CHARS);
  }

  for (const field of DAY_FIELDS) {
    const value = typed[field];
    if (value === undefined) continue;
    if (value === null) {
      next[field] = null;
      continue;
    }
    const day = realDay(value);
    if (day === null) return refuse("bad_day");
    next[field] = day;
  }

  // The kind says "Ends" or "Renews" about a date, so it needs one; a new date keeps
  // the kind it had, and no date means no kind (the table's own CHECK).
  if (typed.endsOnKind !== undefined) next.endsOnKind = typed.endsOnKind;
  if (next.endsOn === null) {
    if (typed.endsOnKind !== undefined && typed.endsOnKind !== null) return refuse("ends_kind_without_day");
    next.endsOnKind = null;
  }

  for (const [key, value] of Object.entries(typed.extra ?? {})) {
    const label = context.fields.get(key);
    if (label === undefined) return refuse("unknown_field");
    const text = tidyCell(value);
    if (holdsCard(text)) return refuseCard(label);
    next.extra[key] = cut(text, MEMBER_LIST_MAX_EXTRA_CHARS);
  }

  if (next.email === null && next.phone === null) return refuse("needs_contact");

  return {
    ok: true,
    values: next,
    edited: editedBetween(stored, next),
    identityFields: IDENTITY_FIELDS.filter((field) => next[field] !== stored[field]),
  };
}

/** JOINING TWO RECORDS OF ONE PERSON: the kept record keeps every value it has and
 *  takes the other's only where its own is empty. Its four identity fields are never
 *  changed, so the next upload still finds it by them. */
export function mergeValues(keep: EntryValues, gone: EntryValues): { values: EntryValues; filled: string[] } {
  const values: EntryValues = { ...keep, extra: { ...keep.extra } };
  const filled: string[] = [];
  for (const field of MARKED_FIELDS) {
    if (field === "endsOn") {
      if (keep.endsOn === null && gone.endsOn !== null) {
        values.endsOn = gone.endsOn;
        values.endsOnKind = gone.endsOnKind;
        filled.push(field);
      }
      continue;
    }
    if (keep[field] === null && gone[field] !== null) {
      values[field] = gone[field];
      filled.push(field);
    }
  }
  for (const [key, value] of Object.entries(gone.extra)) {
    if ((keep.extra[key] ?? "") === "" && value !== "") {
      values.extra[key] = value;
      filled.push(`${MEMBER_LIST_EXTRA_FIELD_PREFIX}${key}`);
    }
  }
  return { values, filled };
}
