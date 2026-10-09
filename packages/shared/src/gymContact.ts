// HOW MEMBERS REACH THEIR GYM (ROADMAP 20a-iii; spec Part 3 §16.1): the phone number and
// email address a gym types in Settings for its members to see in the app. Neither is the
// owner's mobile for payments (`billingMobile`) nor the address leads reply to; a gym
// types what it wants its members to read, and nothing is copied in for it.
import { z } from "zod";

/** The longest phone number kept, as typed with its spaces and brackets. */
export const GYM_CONTACT_PHONE_MAX_CHARS = 30;
/** The longest email address kept. */
export const GYM_CONTACT_EMAIL_MAX_CHARS = 254;

/** Why a typed phone number is not kept. */
export type GymContactPhoneProblem = "bad_contact_phone" | "two_contact_phones";

const tidyPhone = (typed: string): string => typed.replace(/\s+/g, " ").trim();
const digitsOf = (text: string): string => text.replace(/[^0-9]/g, "");

/** What is wrong with a phone number as a gym types it, or null for one that is kept.
 *
 *  A number has 6 to 15 digits (15 is the longest a country code and number can be). It
 *  starts with a digit, a `+` or one opening bracket, and a `+` stands only at the very
 *  start or straight after that bracket: "+44 20…", "(+91) 98765…", "(212) 555…". After
 *  that it holds nothing but digits, spaces, brackets, hyphens, dots and slashes.
 *
 *  A slash after seven or more digits is a second number or a second line ("2345678 /
 *  2345679", "0376-2301234/35"), and a link can call only one, so it is refused in its own
 *  words. A slash after an area code ("030/901820") is one number. */
export function gymContactPhoneProblem(typed: string): GymContactPhoneProblem | null {
  const tidy = tidyPhone(typed);
  if (tidy.length > GYM_CONTACT_PHONE_MAX_CHARS) return "bad_contact_phone";
  if (!/^(\+|\(\+?)?[0-9][0-9 ()./-]*$/.test(tidy)) return "bad_contact_phone";
  const digits = digitsOf(tidy).length;
  if (digits < 6 || digits > 15) return "bad_contact_phone";
  const slash = tidy.indexOf("/");
  if (slash !== -1 && digitsOf(tidy.slice(0, slash)).length >= 7) return "two_contact_phones";
  return null;
}

/** A phone number as a gym types it, tidied: spaces run together and trimmed. Null for
 *  anything `gymContactPhoneProblem` refuses. */
export function cleanGymContactPhone(typed: string): string | null {
  return gymContactPhoneProblem(typed) === null ? tidyPhone(typed) : null;
}

const emailSchema = z.string().max(GYM_CONTACT_EMAIL_MAX_CHARS).email();

/** An email address as a gym types it, trimmed. Null for anything that is not one. */
export function cleanGymContactEmail(typed: string): string | null {
  const parsed = emailSchema.safeParse(typed.trim());
  return parsed.success ? parsed.data : null;
}

/** What a link that calls the number holds: its digits, and the `+` it started with. A
 *  number with a country code drops the "(0)" written after it for callers inside the
 *  country: "+44 (0)20 7946 0958" is dialled +44 20 7946 0958. */
export function gymContactTel(phone: string): string {
  const tidy = phone.trim();
  const abroad = /^\(?\+/.test(tidy);
  return `tel:${abroad ? "+" : ""}${digitsOf(abroad ? tidy.replace(/\(\s*0\s*\)/g, "") : tidy)}`;
}

/** The server's refusals, as the Settings box prints them. */
export const GYM_CONTACT_WORDS = {
  bad_contact_phone: "Check the phone number. Use digits, with spaces or a + at the start if you like.",
  two_contact_phones: "Add one phone number only. Members press it to call you.",
  bad_contact_email: "Check the email address.",
} as const;

/** A gym's phone and email as its members read them; null for one it has not added. */
export const gymContactSchema = z.object({ phone: z.string().nullable(), email: z.string().nullable() });
export type GymContact = z.infer<typeof gymContactSchema>;
