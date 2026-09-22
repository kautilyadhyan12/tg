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

/** The same, but the PLURAL and possessive form counts as the word.
 *
 *  **THIS IS WHAT THE NEVER-LISTS ARE MATCHED WITH, AND IT IS NOT A NICETY**
 *  (review of PR #90, Critical 2). `normaliseHeader` turns an apostrophe into a
 *  space, so "Father’s Name" becomes `father s name` and DOES hold "father" —
 *  but "Fathers Name", which is how a gym's export really writes it, becomes
 *  `fathers name` and holds nothing. `Guardians Email`, `Parents Phone`,
 *  `Mothers Mobile` and `Fathers Date of Birth` all walked past the list that
 *  decides who gets invited, and the member was given the guardian's address.
 *  Matching the plural here rather than stripping the "s" in `normaliseHeader`
 *  keeps the apostrophe form working, which stripping would break. */
const holdsOrPlural = (header: string, word: string): boolean => holds(header, word) || holds(header, `${word}s`);

/** For the never-keep rules next door, which read the same headings in the same
 *  shape and need the same plural: one reading of a heading, not two (§11.2). */
export const holdsWord = holdsOrPlural;
/** …and the strict form, where a heading must BE the word and not merely hold
 *  it (the bare-PIN rule). */
export const isWord = (header: string, word: string): boolean => header === word;

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

  // The five fields Part 2 of the re-plan added (§11.1, §11.3). Every word here
  // was read on a real product's own page: Gymdesk's supported import fields
  // ("Date of Birth", "Status", "Member Type", "Join Date", "Cancellation
  // Date") and GymMaster's data-transfer page ("Birthdate", "Joining date",
  // "Membership start date", "Next Billing Date", "Cancellation date"), both
  // read 2026-09-22, beside the products already cited at the top of this file.
  ...[
    "membership type",
    "member type",
    "membership plan",
    "membership name",
    "membership",
    "plan",
    "plan name",
    "package",
    "package name",
    "subscription",
    "subscription plan",
    "contract type",
    "programme",
    "program",
    "tier",
    "service",
    "scheme",
  ].map((word) => ({ word, field: "membershipType" as const, rank: 0 })),
  // Weaker: a gym that sells one thing often calls the column one of these,
  // and a gym that sells many calls it something above.
  ...["category", "type", "product", "product name"].map((word) => ({ word, field: "membershipType" as const, rank: 1 })),

  ...[
    "join date",
    "joined",
    "joined date",
    "joining date",
    "date joined",
    "joined on",
    "date of joining",
    "doj",
    "start date",
    "membership start date",
    "start",
    "from date",
    "signup date",
    "sign up date",
    "registration date",
    "date registered",
    "enrolment date",
    "enrollment date",
    "member since",
  ].map((word) => ({ word, field: "joinedOn" as const, rank: 0 })),

  ...[
    "end date",
    "membership end date",
    "expiry date",
    "expiry",
    "expires",
    "expires on",
    "expiration date",
    "expiration",
    "membership expiry",
    "valid till",
    "valid until",
    "valid upto",
    "valid up to",
    "paid till",
    "paid until",
    "till date",
    "to date",
    "renewal date",
    "renewal",
    "renews on",
    "renews",
    "next billing date",
    "next payment date",
    "next due date",
    "due date",
    "cancellation date",
    "cancelled date",
    "end",
  ].map((word) => ({ word, field: "endsOn" as const, rank: 0 })),

  ...["payment status", "payment state", "paid status", "fee status", "fees status", "billing status", "invoice status", "dues status", "dues", "payment"].map(
    (word) => ({ word, field: "paymentStatus" as const, rank: 0 }),
  ),
  // Weaker, and for the same reason "Active" is weaker than "Status": "Paid" is
  // the STATE and not the field, so a column of yes and no under it reads
  // "Paid" and "Not paid" rather than "Yes" and "No" (`standsFor`).
  ...["paid", "unpaid", "outstanding", "overdue"].map((word) => ({ word, field: "paymentStatus" as const, rank: 1 })),

  ...["date of birth", "dob", "d o b", "birth date", "birthdate", "birthday", "date of birth dd mm yyyy", "born on"].map((word) => ({
    word,
    field: "dateOfBirth" as const,
    rank: 0,
  })),
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
/** What a gym CHARGES is not what a gym SELLS. Without this, "Product Price"
 *  and "Plan Amount" would become the membership type, and a column of prices
 *  would be shown as a gym's own list of memberships. */
const NEVER_TYPE = ["price", "amount", "fee", "fees", "cost", "rate", "value", "total", "balance", "discount", "tax", "gst", "currency"];
/** Words that say a column is the spare one of its kind. A trailing "1" is
 *  taken off by `normaliseHeader`, so any digit left is a 2nd or a 3rd. */
const NOT_MAIN_WORDS = ["secondary", "alternate", "alternative", "other", "work", "office", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Whether the end-or-renewal column's heading said the membership ENDS on
 *  that day or RENEWS on it (§11.1), so a screen says "Renews 3 Oct" rather
 *  than deciding for the gym. A heading that says neither gives neither. */
const RENEWS_WORDS = ["renewal", "renewal date", "renews", "renews on", "next renewal", "next billing date", "next payment date", "next due date", "due date"];
const ENDS_WORDS = [
  "end",
  "end date",
  "membership end date",
  "expiry",
  "expiry date",
  "membership expiry",
  "expires",
  "expires on",
  "expiration",
  "expiration date",
  "valid till",
  "valid until",
  "valid upto",
  "valid up to",
  "paid till",
  "paid until",
  "till date",
  "to date",
  "cancellation date",
  "cancelled date",
];

export function endsOrRenews(raw: string | null): "ends" | "renews" | null {
  if (raw === null || raw === "") return null;
  const header = normaliseHeader(raw);
  if (RENEWS_WORDS.some((word) => holds(header, word))) return "renews";
  if (ENDS_WORDS.some((word) => holds(header, word))) return "ends";
  return null;
}

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

/** Every field that is a fact about the MEMBER. A heading that names somebody
 *  else — an emergency contact, a parent, a nominee — can be none of them.
 *  §11.1 carries 9.5's structural rule to every field Part 2 added: a guardian's
 *  date of birth is not the member's, just as their phone never was. */
const CONTACT_FIELDS: readonly MemberListField[] = [
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "membershipType",
  "joinedOn",
  "endsOn",
  "paymentStatus",
  "dateOfBirth",
];

/** What one heading says. */
export function readHeader(raw: string): HeaderReading {
  const header = normaliseHeader(raw);
  const never = new Set<MemberListField>();
  // Every never-list is matched on the plural too (`holdsOrPlural`): these are
  // the lists that REFUSE a column, so a form they miss is a wrong take, while
  // a form the WORDS list above misses is only a column staff map by hand.
  if (NEVER_CONTACT.some((word) => holdsOrPlural(header, word))) for (const field of CONTACT_FIELDS) never.add(field);
  if (NEVER_STATUS.some((word) => holdsOrPlural(header, word))) never.add("status");
  if (NEVER_TYPE.some((word) => holdsOrPlural(header, word))) never.add("membershipType");

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
