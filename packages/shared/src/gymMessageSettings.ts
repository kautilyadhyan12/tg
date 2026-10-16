// A GYM'S OWN SETTINGS FOR ITS AUTOMATIC MESSAGES, AND A MEMBER'S SWITCHES (spec Part 3
// §16.2; ROADMAP 20b-i, 20b-ii). The gym sets, for each kind: on or off, its number, and one
// line of its own. A member switches a kind off for one gym.
import { z } from "zod";
import { GYM_MESSAGE_REMINDER_HOURS_CHOICES, GYM_MESSAGE_REMINDER_LOOK_AHEAD_HOURS } from "./gymClassReminders.js";
import { groupMessageProblem, tidyGroupMessage } from "./gymGroupMessages.js";
import {
  GYM_MESSAGE_KINDS,
  GYM_MESSAGE_STARTING_NUMBERS,
  GYM_MESSAGE_STARTING_ON,
  gymMessageKindSchema,
  gymMessageLength,
  reviewLinkSchema,
  type GymMessageKind,
  type GymMessageNumbers,
} from "./gymMessages.js";

/** The kinds a gym sets, in the order its Settings box lists them: a member's time at the
 *  gym first, then the ones that come round. */
export const GYM_MESSAGE_SETTING_KINDS = [
  "welcome",
  "trial_check_in",
  "trial_ending",
  "membership_ending",
  "payment_overdue",
  "class_reminder",
  "birthday",
  "milestone",
  "miss_you",
  "review",
] as const satisfies readonly GymMessageKind[];
export const gymMessageSettingKindSchema = z.enum(GYM_MESSAGE_SETTING_KINDS);
export type GymMessageSettingKind = z.infer<typeof gymMessageSettingKindSchema>;

/** The kinds a member can switch off for one gym. Welcome has no switch: it is sent once,
 *  on joining, before anybody could reach one. A payment notice has none either (§16.2). */
export const GYM_MESSAGE_MEMBER_SWITCH_KINDS = ["trial_check_in", "trial_ending", "membership_ending", "class_reminder", "birthday", "milestone", "miss_you", "review"] as const satisfies readonly GymMessageKind[];
export const gymMessageMemberSwitchKindSchema = z.enum(GYM_MESSAGE_MEMBER_SWITCH_KINDS);
export type GymMessageMemberSwitchKind = z.infer<typeof gymMessageMemberSwitchKindSchema>;

/** The visits a gym can mark, and the waits before We miss you: picked, never typed. */
export const GYM_MESSAGE_MILESTONE_CHOICES = [10, 25, 50, 100, 250, 500, 1000] as const;
export const GYM_MESSAGE_MISS_YOU_CHOICES = [7, 10, 14, 21, 30] as const;
/** The day of a trial its check-in goes on, the first day being day 1. */
export const GYM_MESSAGE_TRIAL_CHECK_IN_CHOICES = [2, 3, 4, 5, 7] as const;
/** How many days before a trial's last day, and a membership's, its ending is said. */
export const GYM_MESSAGE_TRIAL_ENDING_CHOICES = [1, 2, 3] as const;
export const GYM_MESSAGE_MEMBERSHIP_ENDING_CHOICES = [3, 7, 14, 30] as const;
/** How many visits somebody has made before they are asked for a review. */
export const GYM_MESSAGE_REVIEW_CHOICES = [5, 10, 20, 30, 50] as const;
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
  /** The class reminder's number. */
  hours: number | null;
  /** Ask for a review's number of visits, and the gym's review link. */
  visits: number | null;
  link: string | null;
}

export interface GymMessageSettings {
  on: Record<GymMessageKind, boolean>;
  numbers: GymMessageNumbers;
  ownLines: Partial<Record<GymMessageKind, string>>;
  /** The gym's review link. Without one Ask for a review is off, whatever its switch says. */
  reviewLink: string | null;
}

const positive = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 1;

/** What the rule and the words read, from a gym's rows over the starting values. A number
 *  that is not one is left at its start, never guessed. */
export function gymMessageSettingsFrom(rows: readonly GymMessageSettingRow[]): GymMessageSettings {
  const on = { ...GYM_MESSAGE_STARTING_ON };
  const numbers = { ...GYM_MESSAGE_STARTING_NUMBERS };
  const ownLines: Partial<Record<GymMessageKind, string>> = {};
  let reviewLink: string | null = null;
  for (const row of rows) {
    on[row.kind] = row.on;
    if (row.ownLine !== null && row.ownLine.trim() !== "") ownLines[row.kind] = row.ownLine;
    if (row.kind === "miss_you" && positive(row.days)) numbers.missYouDays = row.days;
    if (row.kind === "trial_check_in" && positive(row.days)) numbers.trialCheckInDay = row.days;
    if (row.kind === "trial_ending" && positive(row.days)) numbers.trialEndingDays = row.days;
    if (row.kind === "membership_ending" && positive(row.days)) numbers.membershipEndingDays = row.days;
    if (row.kind === "class_reminder" && positive(row.hours) && row.hours <= GYM_MESSAGE_REMINDER_LOOK_AHEAD_HOURS) numbers.classReminderHours = row.hours;
    if (row.kind === "review" && positive(row.visits)) numbers.reviewVisits = row.visits;
    if (row.kind === "review" && row.link !== null) {
      const link = reviewLinkSchema.safeParse(row.link);
      reviewLink = link.success ? link.data : null;
    }
    if (row.kind === "milestone" && row.milestones !== null && row.milestones.length > 0 && row.milestones.every(positive)) {
      numbers.milestones = [...row.milestones].sort((a, b) => a - b);
    }
  }
  // Nothing to send without a link the rule takes: the switch alone never sends one.
  if (reviewLink === null) on.review = false;
  return { on, numbers, ownLines, reviewLink };
}

// ── THE WIRE ──

const ownLineSchema = z.string().max(GYM_MESSAGE_OWN_LINE_MAX * 4).nullable();
const milestonesSchema = z
  .array(z.number().int().refine((n) => (GYM_MESSAGE_MILESTONE_CHOICES as readonly number[]).includes(n), { message: "not_a_choice" }))
  .min(1)
  .max(GYM_MESSAGE_MILESTONE_CHOICES.length)
  .refine((list) => new Set(list).size === list.length, { message: "twice" });
const oneOf = (choices: readonly number[]) => z.number().int().refine((n) => choices.includes(n), { message: "not_a_choice" });
const missYouDaysSchema = oneOf(GYM_MESSAGE_MISS_YOU_CHOICES);

/** The kinds whose number is a count of days, with the name it has in `GymMessageNumbers`
 *  and on the wire. */
export const GYM_MESSAGE_DAYS_OF = {
  trial_check_in: "trialCheckInDay",
  trial_ending: "trialEndingDays",
  membership_ending: "membershipEndingDays",
  miss_you: "missYouDays",
} as const satisfies Partial<Record<GymMessageKind, keyof GymMessageNumbers>>;

/** A box's settings as they were read: the server's own stamp of the last save, "" for none.
 *  Sent back on Save, so a save made since by somebody else refuses it. */
export const settingsVersionSchema = z.string().max(64);

/** Said when a save is refused because the settings were saved since the page read them. */
export const SETTINGS_CHANGED_WORDS = "These settings were changed since you opened them. Nothing was saved: check them and save again.";

export const gymMessageSettingSchema = z.object({ kind: gymMessageSettingKindSchema, on: z.boolean(), ownLine: ownLineSchema }).strict();
export type GymMessageSetting = z.infer<typeof gymMessageSettingSchema>;

/** Save: the kinds the page knows, each once, and its numbers. A kind left out keeps what
 *  it has, and so does a number left out: a page loaded before 20b-ii sends four kinds and
 *  two numbers, and its save still holds. */
export const gymMessageSettingsRequestSchema = z
  .object({
    messages: z
      .array(gymMessageSettingSchema)
      .min(1)
      .max(GYM_MESSAGE_SETTING_KINDS.length)
      .refine((list) => new Set(list.map((m) => m.kind)).size === list.length, { message: "twice" }),
    missYouDays: missYouDaysSchema,
    milestones: milestonesSchema,
    trialCheckInDay: oneOf(GYM_MESSAGE_TRIAL_CHECK_IN_CHOICES).optional(),
    trialEndingDays: oneOf(GYM_MESSAGE_TRIAL_ENDING_CHOICES).optional(),
    membershipEndingDays: oneOf(GYM_MESSAGE_MEMBERSHIP_ENDING_CHOICES).optional(),
    classReminderHours: oneOf(GYM_MESSAGE_REMINDER_HOURS_CHOICES).optional(),
    reviewVisits: oneOf(GYM_MESSAGE_REVIEW_CHOICES).optional(),
    /** Null takes the link away. Left out, the link kept stays. */
    reviewLink: reviewLinkSchema.nullable().optional(),
    /** The settings as the page read them (`version` of the read): saved since, the save is
     *  refused, so a second tab never puts back what another save changed. */
    version: settingsVersionSchema,
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
  trialCheckInDay: z.number().int().min(1),
  trialEndingDays: z.number().int().min(1),
  membershipEndingDays: z.number().int().min(1),
  /** The gym's price list has a trial on it, or somebody still holds one. With neither
   *  nobody is on a trial, so the two trial messages are sent to nobody. */
  trialOnList: z.boolean(),
  /** The gym's price list has anything on it, or somebody still holds a membership. With
   *  neither, Membership ending and Payment overdue are sent to nobody. */
  priceList: z.boolean(),
  /** A payment was recorded in the app in the last `GYM_MESSAGE_PAYMENTS_DAYS`. Without
   *  one Payment overdue is sent to nobody. */
  payments: z.boolean(),
  /** The gym's grace period for a bill, as the Bills box keeps it. The box works out the
   *  day the notice goes from it with `paymentNoticeAfterDays`, as the sender does. */
  billsOverdueDays: z.number().int().min(0),
  classReminderHours: z.number().int().min(1),
  /** The gym has a class on its calendar from today on, or a trainer who offers personal
   *  training. With neither nobody has a booking, so the class reminder is sent to nobody. */
  bookings: z.boolean(),
  reviewVisits: z.number().int().min(1),
  reviewLink: reviewLinkSchema.nullable(),
  /** When these were last saved, as the server keeps it; a save sends it back. */
  version: settingsVersionSchema,
});
export type GymMessageSettingsResponse = z.infer<typeof gymMessageSettingsResponseSchema>;
/** How far back `checkIn` looks. */
export const GYM_MESSAGE_CHECK_IN_DAYS = 30;

/** The two switches a member is shown (Kd, RULINGS 2026-10-11): what is about their own
 *  membership and bookings, and the gym's news and greetings. Every kind a member can switch
 *  off is in one of them; the gym's messages to many people at once go with `news`. */
export const GYM_MESSAGE_MEMBER_SWITCH_GROUPS = {
  membership: ["trial_ending", "membership_ending", "class_reminder"],
  news: ["trial_check_in", "birthday", "milestone", "miss_you", "review"],
} as const satisfies Record<string, readonly GymMessageMemberSwitchKind[]>;
export const gymMessageMemberSwitchGroupSchema = z.enum(["membership", "news"]);
export type GymMessageMemberSwitchGroup = z.infer<typeof gymMessageMemberSwitchGroupSchema>;

/** A member's own switch at one gym: for one kind, or for a whole group at once. */
export const gymMessageSwitchRequestSchema = z.union([
  z.object({ kind: gymMessageMemberSwitchKindSchema, on: z.boolean() }).strict(),
  z.object({ group: gymMessageMemberSwitchGroupSchema, on: z.boolean() }).strict(),
]);
export type GymMessageSwitchRequest = z.infer<typeof gymMessageSwitchRequestSchema>;
export const gymMessageSwitchResponseSchema = z.object({
  off: z.array(gymMessageKindSchema).max(GYM_MESSAGE_KINDS.length),
  /** False once the gym's messages to many people at once are off for them. Not said by an
   *  api older than the two groups. */
  groupMessages: z.boolean().optional(),
});
export type GymMessageSwitchResponse = z.infer<typeof gymMessageSwitchResponseSchema>;

// ── THE WORDS BOTH SCREENS USE, SO ONE KIND HAS ONE NAME ──

export const GYM_MESSAGE_KIND_NAMES: Record<GymMessageSettingKind, string> = {
  welcome: "Welcome",
  trial_check_in: "Trial check-in",
  trial_ending: "Trial ending",
  membership_ending: "Membership ending",
  payment_overdue: "Payment overdue",
  class_reminder: "Class reminder",
  birthday: "Birthday",
  milestone: "Visit milestone",
  miss_you: "We miss you",
  review: "Ask for a review",
};
