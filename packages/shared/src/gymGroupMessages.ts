// A GYM'S MESSAGE TO THE PEOPLE STAFF CHOSE (spec Part 3 §16.8; ROADMAP 20f-i).
//
// The worst thing this could do to a real person: a gym's words in the inbox of somebody
// who was not ticked, who is another gym's, who was removed, or who switched these
// messages off. The server decides who is sent it (`groupMessagePlan`, in the api); this
// file holds what staff may type and the shapes that cross the wire.
import { z } from "zod";
import { memberListSelectionSchema } from "./memberList.js";
import { GYM_MESSAGE_BODY_MAX, gymMessageLength } from "./gymMessages.js";

/** How many group messages a gym may send on one day of its own calendar. */
export const GYM_GROUP_MESSAGES_A_DAY = 3;
/** How many names of each kind the box carries; the rest are counted. */
export const GYM_GROUP_MESSAGE_BOX_NAMES_MAX = 100;

// ── WHAT STAFF MAY TYPE ──

/** Characters nobody sees that are part of how a word or a picture is written, and are
 *  kept: the two joiners (an emoji of several parts, and Hindi, Bengali and Persian
 *  spelling) and the tag characters of a flag such as England's. */
const JOINERS = /[\u200c\u200d\u{E0020}-\u{E007F}]/gu;

/** The words as kept: one kind of line break, nothing a screen cannot draw, no space at
 *  either end of a line, and never more than one empty line together. */
export function tidyGroupMessage(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]/g, " ")
    .replace(/[\p{Cc}\p{Cf}]/gu, (c) => (c === "\n" || c.search(JOINERS) === 0 ? c : ""))
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** How long a message is, as a person counts it and as the table does: an emoji is one. */
export function groupMessageLength(tidied: string): number {
  return gymMessageLength(tidied);
}

/** Endings that are a web address wherever they stand. Left out on purpose, because they
 *  are words people end a sentence before ("see you there.it starts at 6"): in, it, me, to. */
const ADDRESS_ENDINGS = new Set(
  "com net org io co uk ca au nz ie app ly info biz gg xyz tv cc dev online fit gym club shop store site link ai us de".split(" "),
);

const SCHEME = /[a-z][a-z0-9+.-]*:\/\//iu;
const WWW = /(?<![\p{L}\p{N}])www\.[\p{L}\p{N}]/iu;
/** Words joined by dots: the name, its last part, and a slash after it if there is one. */
const DOTTED = /(?<![\p{L}\p{N}.])([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*)\.(\p{L}{2,})(?:(\/\S)|(?![\p{L}\p{N}]))/gu;

/** A web address, by its shape first: a scheme, a "www.", or words joined by dots with a
 *  slash after them ("wa.me/44…"). The list of endings is only the backstop, for an
 *  address typed bare ("ironhouse.com"). A capital straight after a small letter and a
 *  full stop is a new sentence with its space missing ("at the desk.Online classes"),
 *  never an address. */
function hasLink(text: string): boolean {
  if (SCHEME.test(text) || WWW.test(text)) return true;
  for (const match of text.matchAll(DOTTED)) {
    const [, name = "", ending = "", slash] = match;
    if (/\p{Ll}$/u.test(name) && /^\p{Lu}/u.test(ending)) continue;
    if (slash !== undefined || ADDRESS_ENDINGS.has(ending.toLowerCase())) return true;
    // The last part is no ending ("in", left out on purpose): one before it may be
    // ("ironhouse.co.in"). The first part is the name itself, never an ending.
    const parts = name.split(".");
    if (parts.some((part, at) => at > 0 && ADDRESS_ENDINGS.has(part.toLowerCase()) && !(/\p{Ll}$/u.test(parts[at - 1] ?? "") && /^\p{Lu}/u.test(part)))) return true;
  }
  return false;
}

/** The text the checks read: look-alike characters as the plain ones they are read as (a
 *  full-width dot or @, a small @, an ideographic full stop), and the kept joiners out, so
 *  none of them can split an address. Only the checks read it; the words kept are as typed. */
function forChecks(tidied: string): string {
  return tidied.normalize("NFKC").replace(/[。｡]/g, ".").replace(JOINERS, "");
}

export const GYM_GROUP_MESSAGE_PROBLEMS = ["empty", "too_long", "link", "at"] as const;
export type GymGroupMessageProblem = (typeof GYM_GROUP_MESSAGE_PROBLEMS)[number];

/** Why these words cannot be sent, or null. Read after `tidyGroupMessage`. */
export function groupMessageProblem(tidied: string): GymGroupMessageProblem | null {
  const read = forChecks(tidied);
  if (read.trim() === "") return "empty";
  if (groupMessageLength(tidied) > GYM_MESSAGE_BODY_MAX) return "too_long";
  if (read.includes("@")) return "at";
  if (hasLink(read)) return "link";
  return null;
}

/** What staff read under the box when the words cannot go. */
export const GYM_GROUP_MESSAGE_PROBLEM_WORDS: Record<GymGroupMessageProblem, string> = {
  empty: "Write your message first.",
  too_long: `A message can be up to ${String(GYM_MESSAGE_BODY_MAX)} characters. Make it shorter and try again.`,
  link: "A message can't have a web address in it. Take the link out and try again. If it isn't a link, put a space after the full stop.",
  at: "A message can't have an @ in it, so no email addresses or social media names. Take it out and try again.",
};

/** The other refusals, by the code the server answers with. */
export const GYM_GROUP_MESSAGE_WORDS = {
  bad_words: (words: readonly string[]): string =>
    words.length === 1
      ? `We can't send a message with this word in it: ${words[0] ?? ""}. Take it out and try again.`
      : `We can't send a message with these words in it: ${words.join(", ")}. Take them out and try again.`,
  day_full: `You've sent ${String(GYM_GROUP_MESSAGES_A_DAY)} messages to groups today, which is the most for one day. You can send again tomorrow.`,
  people_changed: "The people who will get this changed while you were writing. Nothing was sent. Check the names again, then send.",
  nobody: "Nobody you selected can get a message, so nothing was sent.",
  earlier_sent: (people: number): string =>
    `Your earlier message was already sent to ${people === 1 ? "1 person" : `${people.toLocaleString("en")} people`}. This one was not sent. Press Send again to send it as well.`,
} as const;

// ── WHO GETS IT, AND WHO DOESN'T ──

/** Why somebody selected is sent nothing. `gone`: the record is no longer on this gym's
 *  list at all, so it has no name to show. */
export const GYM_GROUP_MESSAGE_KEPT_REASONS = ["not_in_app", "switched_off", "shared", "former", "gone"] as const;
export const gymGroupMessageKeptReasonSchema = z.enum(GYM_GROUP_MESSAGE_KEPT_REASONS);
export type GymGroupMessageKeptReason = z.infer<typeof gymGroupMessageKeptReasonSchema>;

export const gymGroupMessagePersonSchema = z.object({ entryId: z.string().uuid(), name: z.string() }).strict();
export type GymGroupMessagePerson = z.infer<typeof gymGroupMessagePersonSchema>;

export const gymGroupMessagePreviewRequestSchema = z.object({ selection: memberListSelectionSchema }).strict();
export type GymGroupMessagePreviewRequest = z.infer<typeof gymGroupMessagePreviewRequestSchema>;

export const gymGroupMessagePreviewSchema = z
  .object({
    selected: z.number().int().min(0),
    /** Everybody who will get it, and the first of their names. */
    sendCount: z.number().int().min(0),
    send: z.array(gymGroupMessagePersonSchema).max(GYM_GROUP_MESSAGE_BOX_NAMES_MAX),
    kept: z.array(
      z
        .object({
          reason: gymGroupMessageKeptReasonSchema,
          count: z.number().int().min(1),
          people: z.array(gymGroupMessagePersonSchema).max(GYM_GROUP_MESSAGE_BOX_NAMES_MAX),
        })
        .strict(),
    ),
    /** How many more group messages the gym can send today. */
    leftToday: z.number().int().min(0).max(GYM_GROUP_MESSAGES_A_DAY),
  })
  .strict();
export type GymGroupMessagePreview = z.infer<typeof gymGroupMessagePreviewSchema>;

export const gymGroupMessagePreviewResponseSchema = z.object({ preview: gymGroupMessagePreviewSchema }).strict();

/** The press. `sendCount` is the number the box's button named: a different number of
 *  people now and nothing is sent. `key` is made once for a box, so a second press of it
 *  sends nothing more. */
export const gymGroupMessageSendRequestSchema = z
  .object({
    selection: memberListSelectionSchema,
    // Longer than a message, so that one over the limit is told so in a sentence.
    body: z.string().max(GYM_MESSAGE_BODY_MAX * 8),
    sendCount: z.number().int().min(1),
    key: z.string().uuid(),
  })
  .strict();
export type GymGroupMessageSendRequest = z.infer<typeof gymGroupMessageSendRequestSchema>;

export const gymGroupMessageDoneSchema = z
  .object({
    sent: z.number().int().min(0),
    kept: z.array(z.object({ reason: gymGroupMessageKeptReasonSchema, count: z.number().int().min(1) }).strict()),
    leftToday: z.number().int().min(0).max(GYM_GROUP_MESSAGES_A_DAY),
  })
  .strict();
export type GymGroupMessageDone = z.infer<typeof gymGroupMessageDoneSchema>;

export const gymGroupMessageDoneResponseSchema = z.object({ done: gymGroupMessageDoneSchema }).strict();

// ── THE MEMBER'S OWN SWITCH ──

export const gymGroupMessagesSwitchRequestSchema = z.object({ on: z.boolean() }).strict();
export type GymGroupMessagesSwitchRequest = z.infer<typeof gymGroupMessagesSwitchRequestSchema>;

export const gymGroupMessagesSwitchResponseSchema = z.object({ groupMessages: z.boolean() }).strict();
export type GymGroupMessagesSwitchResponse = z.infer<typeof gymGroupMessagesSwitchResponseSchema>;
