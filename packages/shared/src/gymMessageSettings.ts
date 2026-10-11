// A GYM'S OWN SETTINGS FOR ITS AUTOMATIC MESSAGES, AND A MEMBER'S SWITCHES (spec Part 3
// §16.2; ROADMAP 20b-i). The gym sets, for each kind: on or off, its number, and one line
// of its own. A member switches a kind off for one gym.
import { z } from "zod";
import { groupMessageProblem, tidyGroupMessage } from "./gymGroupMessages.js";
import {
  GYM_MESSAGE_KINDS,
  GYM_MESSAGE_STARTING_NUMBERS,
  GYM_MESSAGE_STARTING_ON,
  gymMessageKindSchema,
  gymMessageLength,
  type GymMessageKind,
  type GymMessageNumbers,
} from "./gymMessages.js";

/** The kinds a gym sets today, in the order its Settings box lists them. The other four
 *  (a trial's two, a membership ending, a payment overdue) join with 20b-ii. */
export const GYM_MESSAGE_SETTING_KINDS = ["welcome", "birthday", "milestone", "miss_you"] as const satisfies readonly GymMessageKind[];
export const gymMessageSettingKindSchema = z.enum(GYM_MESSAGE_SETTING_KINDS);
export type GymMessageSettingKind = z.infer<typeof gymMessageSettingKindSchema>;

/** The kinds a member can switch off for one gym. Welcome has no switch: it is sent once,
 *  on joining, before anybody could reach one. */
export const GYM_MESSAGE_MEMBER_SWITCH_KINDS = ["birthday", "milestone", "miss_you"] as const satisfies readonly GymMessageKind[];
export const gymMessageMemberSwitchKindSchema = z.enum(GYM_MESSAGE_MEMBER_SWITCH_KINDS);
export type GymMessageMemberSwitchKind = z.infer<typeof gymMessageMemberSwitchKindSchema>;

/** The visits a gym can mark, and the waits before We miss you: picked, never typed. */
export const GYM_MESSAGE_MILESTONE_CHOICES = [10, 25, 50, 100, 250, 500, 1000] as const;
export const GYM_MESSAGE_MISS_YOU_CHOICES = [7, 10, 14, 21, 30] as const;
/** The longest a gym's own line can be. */
export const GYM_MESSAGE_OWN_LINE_MAX = 140;

// ── THE GYM'S OWN LINE ──

/** The line as kept: one line, tidied as a message to a group is. */
export function tidyOwnLine(text: string): string {
  return tidyGroupMessage(text).replace(/\n+/g, " ");
}

export const GYM_MESSAGE_OWN_LINE_PROBLEMS = ["too_long", "link", "at"] as const;
export type GymMessageOwnLineProblem = (typeof GYM_MESSAGE_OWN_LINE_PROBLEMS)[number];

/** Why this line cannot be kept, or null. Read after `tidyOwnLine`; an empty line is no
 *  line and is fine. The same rule for a web address and an @ as a message to a group. */
export function ownLineProblem(tidied: string): GymMessageOwnLineProblem | null {
  if (tidied === "") return null;
  if (gymMessageLength(tidied) > GYM_MESSAGE_OWN_LINE_MAX) return "too_long";
  const problem = groupMessageProblem(tidied);
  return problem === "link" || problem === "at" ? problem : null;
}

export const GYM_MESSAGE_OWN_LINE_WORDS: Record<GymMessageOwnLineProblem, string> = {
  too_long: `Your own line can be up to ${String(GYM_MESSAGE_OWN_LINE_MAX)} characters. Make it shorter and try again.`,
  link: "Your own line can't have a web address in it. Take the link out and try again. If it isn't a link, put a space after the full stop.",
  at: "Your own line can't have an @ in it, so no email addresses or social media names. Take it out and try again.",
};

/** The server's refusal for words the bad-words check of Updates holds. */
export function ownLineBadWords(words: readonly string[]): string {
  return words.length === 1
    ? `We can't keep a line with this word in it: ${words[0] ?? ""}. Take it out and try again.`
    : `We can't keep a line with these words in it: ${words.join(", ")}. Take them out and try again.`;
}

// ── WHAT IS KEPT, AND WHAT THE RULE READS FROM IT ──

/** One kind's row as the table keeps it. A kind with no row has its starting values. */
export interface GymMessageSettingRow {
  kind: GymMessageKind;
  on: boolean;
  ownLine: string | null;
  days: number | null;
  milestones: readonly number[] | null;
}

export interface GymMessageSettings {
  on: Record<GymMessageKind, boolean>;
  numbers: GymMessageNumbers;
  ownLines: Partial<Record<GymMessageKind, string>>;
}

const positive = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 1;

/** What the rule and the words read, from a gym's rows over the starting values. A number
 *  that is not one is left at its start, never guessed. */
export function gymMessageSettingsFrom(rows: readonly GymMessageSettingRow[]): GymMessageSettings {
  const on = { ...GYM_MESSAGE_STARTING_ON };
  const numbers = { ...GYM_MESSAGE_STARTING_NUMBERS };
  const ownLines: Partial<Record<GymMessageKind, string>> = {};
  for (const row of rows) {
    on[row.kind] = row.on;
    if (row.ownLine !== null && row.ownLine.trim() !== "") ownLines[row.kind] = row.ownLine;
    if (row.kind === "miss_you" && positive(row.days)) numbers.missYouDays = row.days;
    if (row.kind === "milestone" && row.milestones !== null && row.milestones.length > 0 && row.milestones.every(positive)) {
      numbers.milestones = [...row.milestones].sort((a, b) => a - b);
    }
  }
  return { on, numbers, ownLines };
}

// ── THE WIRE ──

const ownLineSchema = z.string().max(GYM_MESSAGE_OWN_LINE_MAX * 4).nullable();
const milestonesSchema = z
  .array(z.number().int().refine((n) => (GYM_MESSAGE_MILESTONE_CHOICES as readonly number[]).includes(n), { message: "not_a_choice" }))
  .min(1)
  .max(GYM_MESSAGE_MILESTONE_CHOICES.length)
  .refine((list) => new Set(list).size === list.length, { message: "twice" });
const missYouDaysSchema = z.number().int().refine((n) => (GYM_MESSAGE_MISS_YOU_CHOICES as readonly number[]).includes(n), { message: "not_a_choice" });

export const gymMessageSettingSchema = z.object({ kind: gymMessageSettingKindSchema, on: z.boolean(), ownLine: ownLineSchema }).strict();
export type GymMessageSetting = z.infer<typeof gymMessageSettingSchema>;

/** Save: every kind the gym sets, each once, and the two numbers, every time. */
export const gymMessageSettingsRequestSchema = z
  .object({
    messages: z
      .array(gymMessageSettingSchema)
      .length(GYM_MESSAGE_SETTING_KINDS.length)
      .refine((list) => new Set(list.map((m) => m.kind)).size === list.length, { message: "twice" }),
    missYouDays: missYouDaysSchema,
    milestones: milestonesSchema,
  })
  .strict();
export type GymMessageSettingsRequest = z.infer<typeof gymMessageSettingsRequestSchema>;

export const gymMessageSettingsResponseSchema = z.object({
  messages: z.array(gymMessageSettingSchema).length(GYM_MESSAGE_SETTING_KINDS.length),
  missYouDays: z.number().int().min(1),
  milestones: z.array(z.number().int().min(1)).min(1),
  /** The desk or staff checked somebody in during the last 30 days. Without it nobody has a
   *  visit to count, so Milestone and We miss you are sent to nobody. */
  checkIn: z.boolean(),
});
export type GymMessageSettingsResponse = z.infer<typeof gymMessageSettingsResponseSchema>;
/** How far back `checkIn` looks. */
export const GYM_MESSAGE_CHECK_IN_DAYS = 30;

/** A member's own switch for one kind at one gym. */
export const gymMessageSwitchRequestSchema = z.object({ kind: gymMessageMemberSwitchKindSchema, on: z.boolean() }).strict();
export type GymMessageSwitchRequest = z.infer<typeof gymMessageSwitchRequestSchema>;
export const gymMessageSwitchResponseSchema = z.object({ off: z.array(gymMessageKindSchema).max(GYM_MESSAGE_KINDS.length) });
export type GymMessageSwitchResponse = z.infer<typeof gymMessageSwitchResponseSchema>;

// ── THE WORDS BOTH SCREENS USE, SO ONE KIND HAS ONE NAME ──

export const GYM_MESSAGE_KIND_NAMES: Record<GymMessageSettingKind, string> = {
  welcome: "Welcome",
  birthday: "Birthday",
  milestone: "Visit milestone",
  miss_you: "We miss you",
};
