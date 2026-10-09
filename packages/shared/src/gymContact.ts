// HOW MEMBERS REACH THEIR GYM (ROADMAP 20a-iii; spec Part 3 §16.1): the phone number and
// email address a gym types in Settings for its members to see in the app. Neither is the
// owner's mobile for payments (`billingMobile`) nor the address leads reply to; a gym
// types what it wants its members to read, and nothing is copied in for it.
import { z } from "zod";

/** The longest phone number kept, as typed with its spaces and brackets. */
export const GYM_CONTACT_PHONE_MAX_CHARS = 30;
/** The longest email address kept. */
export const GYM_CONTACT_EMAIL_MAX_CHARS = 254;

/** A phone number as a gym types it, tidied: spaces run together and trimmed. Null for
 *  anything that is not one: a number has 6 to 15 digits (15 is the longest a country
 *  code and number can be), may start with one `+`, and holds nothing else but spaces,
 *  brackets, hyphens, dots and slashes. */
export function cleanGymContactPhone(typed: string): string | null {
  const tidy = typed.replace(/\s+/g, " ").trim();
  if (tidy.length > GYM_CONTACT_PHONE_MAX_CHARS) return null;
  if (!/^\+?[0-9 ()./-]+$/.test(tidy)) return null;
  const digits = tidy.replace(/[^0-9]/g, "").length;
  return digits >= 6 && digits <= 15 ? tidy : null;
}

const emailSchema = z.string().max(GYM_CONTACT_EMAIL_MAX_CHARS).email();

/** An email address as a gym types it, trimmed. Null for anything that is not one. */
export function cleanGymContactEmail(typed: string): string | null {
  const parsed = emailSchema.safeParse(typed.trim());
  return parsed.success ? parsed.data : null;
}

/** What a link that calls the number holds: its digits, and the `+` it started with. */
export function gymContactTel(phone: string): string {
  return `tel:${phone.trim().startsWith("+") ? "+" : ""}${phone.replace(/[^0-9]/g, "")}`;
}

/** The server's refusals, as the Settings box prints them. */
export const GYM_CONTACT_WORDS = {
  bad_contact_phone: "Check the phone number. Use digits, with spaces or a + at the start if you like.",
  bad_contact_email: "Check the email address.",
} as const;

/** A gym's phone and email as its members read them; null for one it has not added. */
export const gymContactSchema = z.object({ phone: z.string().nullable(), email: z.string().nullable() });
export type GymContact = z.infer<typeof gymContactSchema>;
