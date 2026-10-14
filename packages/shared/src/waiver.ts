// A GYM'S WAIVER, SIGNED IN THE APP — ROADMAP Stage 2 item 3e-i; RULINGS 2026-10-08.
//
// The gym writes its own waiver; the words are the gym's, never ours. A person reads it
// and agrees by typing their full name, when they join or afterwards. Every wording a gym
// saves is kept and numbered, and a signature names the wording the person was shown, so
// changing the words asks everybody again.
import { z } from "zod";

export const WAIVER_MAX_CHARS = 30_000;
export const WAIVER_NAME_MIN_CHARS = 2;
export const WAIVER_NAME_MAX_CHARS = 100;

/** Characters Postgres refuses or a screen cannot show: controls other than a new line and a tab. */
const CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
/** In a name, what nobody can see and what turns its letters round: the soft hyphen, the
 *  zero-width space, the direction marks, overrides and isolates, the word joiner and the
 *  byte-order mark, and the letters a screen draws as a blank (the Hangul fillers and two
 *  Khmer vowels). The two zero-width joiners stay: some names are spelled with them. */
const UNSEEN_IN_A_NAME = /[\u00AD\u115F\u1160\u17B4\u17B5\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\u3164\uFEFF\uFFA0]/gu;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/gu;

/** The gym's words as kept: line ends made one kind, nothing a database refuses, and no
 *  space left at either end. A language's own direction marks are the gym's words. */
export const cleanWaiverText = (text: string): string => text.replace(/\r\n?/g, "\n").replace(CONTROLS, "").trim();

/** The name a person types to sign: spaces tidied, and nothing kept that a database
 *  refuses, nobody can see, or would draw it backwards. */
export const cleanSignedName = (name: string): string => name.replace(CONTROLS, "").replace(UNSEEN_IN_A_NAME, "").replace(/\s+/g, " ").trim();

/** A name is two letters or digits at least, counted as people count them and never as
 *  JavaScript measures a string. */
const isAName = (name: string): boolean => (name.match(LETTER_OR_DIGIT) ?? []).length >= WAIVER_NAME_MIN_CHARS;

export const waiverTextSchema = z
  .string()
  .max(WAIVER_MAX_CHARS * 2)
  .transform(cleanWaiverText)
  .pipe(z.string().min(1).max(WAIVER_MAX_CHARS));

export const signedNameSchema = z
  .string()
  .max(WAIVER_NAME_MAX_CHARS * 2)
  .transform(cleanSignedName)
  .pipe(z.string().max(WAIVER_NAME_MAX_CHARS).refine(isAName));

/** A waiver as a person reads it. */
export const waiverToReadSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().min(1),
    text: z.string().min(1).max(WAIVER_MAX_CHARS),
  })
  .strict();
export type WaiverToRead = z.infer<typeof waiverToReadSchema>;

/** A signature as shown to the person who made it, or to the gym's staff. */
export const waiverSignedSchema = z.object({ name: z.string(), at: z.string() }).strict();
export type WaiverSigned = z.infer<typeof waiverSignedSchema>;

// ── The gym's side (Settings, `org.manage`) ──

export const saveGymWaiverBodySchema = z.object({ text: waiverTextSchema }).strict();
export type SaveGymWaiverBody = z.infer<typeof saveGymWaiverBodySchema>;

export const gymWaiverResponseSchema = z
  .object({
    /** The newest wording the gym saved, or null where it never saved one. */
    waiver: waiverToReadSchema.extend({ savedAt: z.string() }).strict().nullable(),
    /** People are asked to sign it. False where the gym has none, or stopped using it. */
    inUse: z.boolean(),
    /** How many people use the app through this gym, and how many of them have signed
     *  the newest wording. */
    people: z.number().int().min(0),
    signed: z.number().int().min(0),
    /** How many people on the gym's list signed the newest wording at the desk (3e-ii). */
    atDesk: z.number().int().min(0).default(0),
  })
  .strict();
export type GymWaiverResponse = z.infer<typeof gymWaiverResponseSchema>;

// ── The person's side ──

export const myWaiverResponseSchema = z
  .object({
    gymName: z.string(),
    /** The gym's time zone, so the day a signature was made is written as the gym's own. */
    timezone: z.string().optional(),
    /** The waiver the gym asks for today, or null where it asks for none. */
    waiver: waiverToReadSchema.nullable(),
    /** The person's own signature of THAT wording, or null. */
    signed: waiverSignedSchema.nullable(),
  })
  .strict();
export type MyWaiverResponse = z.infer<typeof myWaiverResponseSchema>;

/** What a person sends to sign: the wording they were shown, and their name as typed. */
export const signWaiverBodySchema = z.object({ waiverId: z.string().uuid(), name: signedNameSchema }).strict();
export type SignWaiverBody = z.infer<typeof signWaiverBodySchema>;

export const signWaiverResponseSchema = z.object({ signed: waiverSignedSchema }).strict();
export type SignWaiverResponse = z.infer<typeof signWaiverResponseSchema>;

/** Join carries the same two things, where the gym has a waiver. */
export const acceptInvitationBodySchema = z
  .object({ waiver: z.object({ id: z.string().uuid(), name: signedNameSchema }).strict().optional() })
  .strict();
export type AcceptInvitationBody = z.infer<typeof acceptInvitationBodySchema>;

export const WAIVER_WORDS = {
  /** Join or Sign, with no waiver sent, at a gym that asks for one. */
  waiver_needed: (gymName: string): string => `Read ${gymName}'s waiver, type your full name and tick the box to agree.`,
  /** The gym saved new words after the person's screen loaded. */
  waiver_changed: (gymName: string): string => `${gymName} has changed its waiver. Read the new one below, then agree to it.`,
  /** The gym stopped using its waiver after the person's screen loaded. */
  waiver_not_in_use: (gymName: string): string => `${gymName} is not asking for a waiver right now. There is nothing to sign.`,
  not_found: "We couldn't find that.",
  /** Stop, where the gym has no waiver in use. */
  nothing_to_stop: "You have no waiver in use.",
} as const;

/** A screen may send a signature: a name typed and the box ticked. */
export const waiverReadyToSign = (name: string, agreed: boolean): boolean => agreed && isAName(cleanSignedName(name));

/** The line under the agree box, the same on every screen that signs. */
export const WAIVER_AGREE_LABEL = "I have read this waiver and I agree to it.";

/** How many people are asked to sign when these words are saved, in Settings' own
 *  sentence; null where saving asks nobody (nothing changed, or nobody is in the app). */
export function waiverSaveAsks(input: { savedText: string | null; inUse: boolean; draft: string; people: number; signed: number }): string | null {
  const draft = cleanWaiverText(input.draft);
  if (draft === "" || input.people === 0) return null;
  const sameWords = input.savedText !== null && cleanWaiverText(input.savedText) === draft;
  if (sameWords) return input.inUse ? null : "People in the app who have not signed these words will be asked to sign.";
  const who = input.people === 1 ? "The 1 person in the app" : `All ${String(input.people)} people in the app`;
  // "Again" only where somebody has signed the words in use.
  return input.savedText !== null && input.inUse && input.signed > 0 ? `${who} will be asked to sign again, because the words have changed.` : `${who} will be asked to sign it.`;
}

// ── At the desk (3e-ii; a person's page, `members.confirm`) ──
// Staff open a person on the gym's list, hand the screen over, and the person — or, for
// somebody under 18, a parent or guardian — reads the waiver and types their own name.
// The signature is the record's, never an app account's.

export const deskSignerSchema = z.enum(["person", "guardian"]);
export type DeskSigner = z.infer<typeof deskSignerSchema>;

/** A signature made at the desk, as staff see it: who signed, the name typed, when, and
 *  the member of staff who opened the screen (null where they have since left). */
export const deskSignedSchema = z
  .object({ name: z.string(), signer: deskSignerSchema, at: z.string(), by: z.string().nullable() })
  .strict();
export type DeskSigned = z.infer<typeof deskSignedSchema>;

/** What the desk's box reads when it opens. */
export const deskWaiverResponseSchema = z
  .object({
    gymName: z.string(),
    /** The person on the list, as the gym wrote them. */
    personName: z.string(),
    timezone: z.string(),
    /** The waiver the gym asks for today, or null where it asks for none. */
    waiver: waiverToReadSchema.nullable(),
    /** Under 18 by the record's date of birth on the gym's own day; null where the record
     *  holds no date of birth. */
    minor: z.boolean().nullable(),
    /** This record's desk signature of THAT wording, or null. */
    signed: deskSignedSchema.nullable(),
  })
  .strict();
export type DeskWaiverResponse = z.infer<typeof deskWaiverResponseSchema>;

export const signAtDeskBodySchema = z.object({ waiverId: z.string().uuid(), signer: deskSignerSchema, name: signedNameSchema }).strict();
export type SignAtDeskBody = z.infer<typeof signAtDeskBodySchema>;

export const signAtDeskResponseSchema = z.object({ signed: deskSignedSchema }).strict();
export type SignAtDeskResponse = z.infer<typeof signAtDeskResponseSchema>;

export const WAIVER_DESK_WORDS = {
  /** The record says the person is under 18 and the box said they sign themselves. */
  guardian_needed: (name: string): string => `${name === "" ? "This person" : name} is under 18, so a parent or guardian signs for them.`,
  /** The record says the person is 18 or over and the box said a parent or guardian signs. */
  person_signs: (name: string): string => `${name === "" ? "This person" : name} is 18 or over, so they sign it themselves.`,
  /** The record is not on the list any more, or is another gym's. */
  person_not_found: "We couldn't find this person on your list.",
} as const;

/** Under 18 on `today` by a date of birth, both `YYYY-MM-DD` in the gym's own calendar;
 *  null where there is no date of birth. Somebody born on 29 February turns 18 on
 *  1 March in a year with no 29th. */
export function isUnder18(dateOfBirth: string | null, today: string): boolean | null {
  if (dateOfBirth === null) return null;
  const year = Number(dateOfBirth.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  return today < `${String(year + 18).padStart(4, "0")}${dateOfBirth.slice(4)}`;
}
