// Which heading means which field (spec Part 3 §9.5). Every word below was seen
// in a real product's help pages or sample export on 2026-09-19 — Gymdesk, Zen
// Planner, Clubworx, Arketa, WellnessLiving, GymMaster, Magicline, Dynamics 365,
// Google Contacts, Mailchimp, Square, Stripe.
//
// **ENGLISH ONLY** (Kd, 2026-09-20): the app is for English-speaking countries,
// so an English heading is the only one guessed. A file whose headings are in
// another language is not refused and nothing of it is guessed wrong — its
// columns come back unmapped with three of their own cells each, and staff say
// which is which. The PEOPLE in an English gym's file are another matter: a
// member called José Álvarez or Zoë Müller is read, matched and invited like
// anyone else, in whatever alphabet their name is written.
//
// This list is a guess-assist over a mapping staff always see, never the
// contract: a wrong guess is shown beside three of the column's own cells.
//
// A heading is matched by WHOLE WORDS it holds, not by being one: "Member Email
// Address" holds "email address", "Secondary Email" holds "email". That is what
// makes the two never-lists necessary — an emergency contact's number is not the
// member's, and "Email status: subscribed" is not a membership — and what makes
// the ranking below necessary: a file often has three email columns.
//
// Believing a heading is only half of it. Nothing here is trusted until the
// column's own cells agree (`columns.ts`): a heading is a hint, its cells decide.
import type { MemberListField } from "@app/shared";
import { tidyCell } from "./cells.js";

/** Punctuation between the words of a heading. A heading is one line of a
 *  spreadsheet, so anything here is a separator, never part of a word. */
const PUNCTUATION = /[_\-.,/\\()[\]:#*'\u2018\u2019\u00b4`"]+/g;
const COMBINING_MARKS = /[\u0300-\u036f]/g;
/** "Email 1" and "Phone — primary" are the first column of their kind, not
 *  another one; Google Contacts and Mailchimp both write them. */
const FIRST_OF_ITS_KIND = /\s(1|primary)$/;

/** A heading in the one shape the lists below are written in: joined
 *  characters, lower case, no accents, punctuation as spaces, and no "1" or
 *  "primary" on the end. */
export function normaliseHeader(raw: string): string {
  const folded = tidyCell(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .normalize("NFC")
    .replace(PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim();
  return folded.replace(FIRST_OF_ITS_KIND, "");
}

/** Whether a normalised heading holds `word` as whole words. */
const holds = (header: string, word: string): boolean => ` ${header} `.includes(` ${word} `);

interface HeaderWord {
  word: string;
  field: MemberListField;
  /** Which of several columns of the same field is preferred: lowest wins. */
  rank: number;
}

/** A mobile is the number a gym texts and the one a member gives us; a shared
 *  home or work line is the last resort. */
const MOBILE = 0;
const ANY_PHONE = 1;
const HOME_PHONE = 2;
const WORK_PHONE = 3;
/** Anything a heading says is not the main one of its kind ranks after every
 *  column that does not say so, whatever its own word was. */
const NOT_THE_MAIN_ONE = 10;
/** A heading that IS its word — "Email" — ranks before one that merely HOLDS
 *  it — "Nominee Email", "Father's Name", "Agent Email". No list of words can
 *  ever name everyone a form asks about beside the member, so this is what
 *  holds where the never-list below has not heard of the word: whatever the
 *  qualifier is, the plain column wins. */
const SAYS_MORE_THAN_THE_WORD = 5;

const WORDS: readonly HeaderWord[] = [
  ...["first name", "firstname", "member firstname", "given name", "fname", "first", "forename"].map((word) => ({ word, field: "firstName" as const, rank: 0 })),
  ...["last name", "lastname", "family name", "lname", "surname", "last"].map((word) => ({ word, field: "lastName" as const, rank: 0 })),
  ...["full name", "name", "member name", "client name", "customer name", "display name"].map((word) => ({ word, field: "fullName" as const, rank: 0 })),
  // The bare word is the one a gym means when it has only one email column.
  ...["email", "e mail"].map((word) => ({ word, field: "email" as const, rank: 0 })),
  ...["email address", "e mail address", "email addresses", "email id", "mail", "primary email", "e mail 1 value"].map((word) => ({
    word,
    field: "email" as const,
    rank: 1,
  })),
  ...["mobile", "mobile phone", "mobile number", "cell", "cell phone", "cellphone", "whatsapp"].map((word) => ({ word, field: "phone" as const, rank: MOBILE })),
  ...["phone", "phone number", "phone numbers", "contact number", "contact no", "telephone", "telephone number", "tel", "phone 1 value"].map((word) => ({
    word,
    field: "phone" as const,
    rank: ANY_PHONE,
  })),
  ...["home phone", "home phone number"].map((word) => ({ word, field: "phone" as const, rank: HOME_PHONE })),
  ...["work phone", "business phone"].map((word) => ({ word, field: "phone" as const, rank: WORK_PHONE })),
  ...[
    "member id",
    "member no",
    "member number",
    "membership no",
    "client number",
    "customer number",
    "membership number",
    "membership id",
    "client id",
    "customer id",
    "check in code",
    "barcode",
    "barcode id",
    "key tag",
    "keyfob",
    "fob",
    "card number",
    "reference id",
    "external id",
    "id",
  ].map((word) => ({ word, field: "memberNumber" as const, rank: 0 })),
  ...["status", "member status", "membership status", "account status", "client status"].map((word) => ({
    word,
    field: "status" as const,
    rank: 0,
  })),
  // Weaker: a column headed "State" is as often an address as a membership, and
  // one headed "Active" is usually a yes or a no. Taken only where no column
  // says "status", and always shown to staff with its own words beside it.
  ...["state", "active"].map((word) => ({ word, field: "status" as const, rank: 1 })),
];

/** An emergency contact's number is not the member's, and a salesperson is not
 *  a member either (§9.5). A heading holding any of these is never the name,
 *  the email or the phone — not by its heading, and not by its cells.
 *
 *  THIS IS THE LIST THAT DECIDES WHO GETS INVITED. An address read from the
 *  wrong column is an invitation sent to somebody who is not a member, and the
 *  gym's invitation is its yes (§9.2 rule 11) — so that person would join the
 *  gym. The words below are the ones a membership form asks for BESIDE the
 *  member: an emergency contact and a next of kin, the parent or guardian a
 *  junior membership needs, the family a family membership covers, the friend
 *  who referred them, the doctor or physio a clinic's file names, and the
 *  employer, sponsor or corporate account that pays. A column refused by this
 *  list is still SHOWN to staff, with what its heading claimed (`headerSays`),
 *  so a gym that really does keep members under one of these words can map it
 *  by hand. */
const NEVER_CONTACT = [
  "emergency",
  "guardian",
  "parent",
  "spouse",
  "partner",
  "next of kin",
  "kin",
  "nominee",
  "father",
  "mother",
  "husband",
  "wife",
  "son",
  "daughter",
  "brother",
  "sister",
  "relative",
  "family member",
  "friend",
  "guarantor",
  "sponsor",
  "reference",
  "referred",
  "referrer",
  "witness",
  "attendant",
  "caretaker",
  "carer",
  "doctor",
  "physician",
  "physio",
  "therapist",
  "trainer",
  "coach",
  "agent",
  "broker",
  "manager",
  "contact person",
  "corporate",
  "sales",
  "staff",
  "employee",
  "company",
  "employer",
];
/** "Payment status: paid" and "Email status: subscribed" are not memberships.
 *  `e mail` is the same word after `normaliseHeader` has run on "E-mail". */
const NEVER_STATUS = ["payment", "billing", "invoice", "marketing", "email", "e mail", "sms", "waiver", "card", "subscription to"];
/** Words that say a column is the spare one of its kind. A trailing "1" is
 *  taken off by `normaliseHeader`, so any digit left is a 2nd or a 3rd. */
const NOT_MAIN_WORDS = ["secondary", "alternate", "alternative", "other", "work", "office", "2", "3", "4", "5", "6", "7", "8", "9"];

export interface HeaderReading {
  /** The field the heading names, by the longest word it holds. Null where it
   *  names none, or names two fields with words of the same length. */
  field: MemberListField | null;
  rank: number;
  /** The word it was matched by, which the Magicline rule below reads. */
  word: string | null;
  /** Whether it holds any known heading word at all — what tells a row of
   *  headings from a row of people, whatever the never-lists say afterwards. */
  isHeaderWord: boolean;
  /** Fields this heading may NEVER be, whatever its cells hold. */
  never: ReadonlySet<MemberListField>;
}

const CONTACT_FIELDS: readonly MemberListField[] = ["fullName", "firstName", "lastName", "email", "phone"];

/** What one heading says. */
export function readHeader(raw: string): HeaderReading {
  const header = normaliseHeader(raw);
  const never = new Set<MemberListField>();
  if (NEVER_CONTACT.some((word) => holds(header, word))) for (const field of CONTACT_FIELDS) never.add(field);
  if (NEVER_STATUS.some((word) => holds(header, word))) never.add("status");

  let best: HeaderWord | null = null;
  let tied = false;
  for (const entry of WORDS) {
    if (!holds(header, entry.word)) continue;
    if (best === null || entry.word.length > best.word.length) {
      best = entry;
      tied = false;
    } else if (entry.word.length === best.word.length && entry.field !== best.field) tied = true;
  }
  if (best === null) return { field: null, rank: 0, word: null, isHeaderWord: false, never };
  const spare = NOT_MAIN_WORDS.some((word) => holds(header, word));
  return {
    field: tied ? null : best.field,
    rank: best.rank + (header === best.word ? 0 : SAYS_MORE_THAN_THE_WORD) + (spare ? NOT_THE_MAIN_ONE : 0),
    word: best.word,
    isHeaderWord: true,
    never,
  };
}
