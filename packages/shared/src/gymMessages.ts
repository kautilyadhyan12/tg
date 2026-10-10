// A GYM'S MESSAGES TO ITS MEMBERS, IN THE APP (spec Part 3 §16.1–16.2; ROADMAP 20a).
//
// The worst thing this could do to a real person: a message from a gym to somebody it
// removed, or the same message many times because a job ran twice. `gymMessageDue` is
// the ONE rule that decides what is sent, and it is pure: the worker gathers the facts
// and writes what this returns, one row an occasion.
import { z } from "zod";
import { gymContactSchema } from "./gymContact.js";
import { instantSchema } from "./time.js";

/** Every kind of automatic message, in the order one is picked when several are due on
 *  one day: money and dates that will pass first, a come-back last. */
export const GYM_MESSAGE_KINDS = [
  "payment_overdue",
  "membership_ending",
  "trial_ending",
  "trial_check_in",
  "welcome",
  "birthday",
  "milestone",
  "miss_you",
] as const;
export const gymMessageKindSchema = z.enum(GYM_MESSAGE_KINDS);
export type GymMessageKind = z.infer<typeof gymMessageKindSchema>;

/** A message staff typed for the people they chose (ROADMAP 20f-i). It is no automatic
 *  kind: the rule below never makes one, and it is not in the day's one automatic message. */
export const GYM_GROUP_MESSAGE_KIND = "group";
/** Every kind a member's inbox can hold. */
export const gymInboxKindSchema = z.enum([...GYM_MESSAGE_KINDS, GYM_GROUP_MESSAGE_KIND]);
export type GymInboxKind = z.infer<typeof gymInboxKindSchema>;

/** The kinds a person cannot switch off (§16.2: "except a payment notice"). */
export const GYM_MESSAGE_ALWAYS_ON: readonly GymMessageKind[] = ["payment_overdue"];

/** A message is in the inbox for this many days. */
export const GYM_MESSAGE_KEPT_DAYS = 30;
/** The most messages one read of an inbox carries, newest first. */
export const GYM_INBOX_MAX = 100;
/** The longest a message's words can be. */
export const GYM_MESSAGE_BODY_MAX = 500;
/** How long a message is, as a person counts it and as the table's own check does: an
 *  emoji is one, though JavaScript's `length` (and Zod's `max`) call it two. */
export function gymMessageLength(body: string): number {
  return Array.from(body).length;
}
/** A cheer or a come-back line is pinned for this many days (RULINGS 2026-09-07). */
export const GYM_PINNED_NOTE_DAYS = 7;

/** Messages go out from 08:00 up to 21:00 on the gym's own clock. */
export const GYM_MESSAGE_DAY_STARTS_HOUR = 8;
export const GYM_MESSAGE_DAY_ENDS_HOUR = 21;
/** A Welcome still goes this many days after joining (a join at night waits for morning). */
export const GYM_MESSAGE_WELCOME_DAYS = 3;
/** A trial check-in still goes one day late. */
export const GYM_MESSAGE_CHECK_IN_LATE_DAYS = 1;

/** We miss you waits until the gym has checked somebody in on this many days since the
 *  person's last visit: half the gym's days, rounded up. A gym that stopped using check-in,
 *  or was shut for those days, has not seen anybody, so nobody there is told they were missed. */
export function missYouGymDays(missYouDays: number): number {
  return Math.ceil(missYouDays / 2);
}

/** The numbers a gym can change (20b); these are the starting values of §16.2. */
export interface GymMessageNumbers {
  /** Trial check-in: on this day of a trial, the first day being day 1. */
  trialCheckInDay: number;
  /** Trial ending: this many days before its last day. */
  trialEndingDays: number;
  /** We miss you: after this many days with no visit. */
  missYouDays: number;
  /** Membership ending: this many days before its last day. */
  membershipEndingDays: number;
  /** Payment overdue: this many days after a bill's due date. */
  paymentOverdueDays: number;
  /** Milestone: on each of these visits. */
  milestones: readonly number[];
}
export const GYM_MESSAGE_STARTING_NUMBERS: GymMessageNumbers = {
  trialCheckInDay: 2,
  trialEndingDays: 2,
  missYouDays: 10,
  membershipEndingDays: 7,
  paymentOverdueDays: 3,
  milestones: [50, 100],
};
/** Every kind is on until a gym switches it off (20b). */
export const GYM_MESSAGE_STARTING_ON: Record<GymMessageKind, boolean> = {
  payment_overdue: true,
  membership_ending: true,
  trial_ending: true,
  trial_check_in: true,
  welcome: true,
  birthday: true,
  milestone: true,
  miss_you: true,
};

/** Why a message that has an occasion is not sent now. */
export const GYM_MESSAGE_HELD_REASONS = [
  "gym_lapsed",
  "removed",
  "former",
  "gym_off",
  "person_off",
  "already_sent",
  "another_today",
  "night",
] as const;
export type GymMessageHeldReason = (typeof GYM_MESSAGE_HELD_REASONS)[number];

/** Everything the rule reads. Days are `YYYY-MM-DD` on the gym's own calendar. */
export interface GymMessageFacts {
  gym: {
    /** Not closed. */
    open: boolean;
    /** On a plan (a trial counts). */
    live: boolean;
    today: string;
    /** The hour on the gym's clock, 0 to 23. */
    hour: number;
    on: Record<GymMessageKind, boolean>;
    numbers: GymMessageNumbers;
    /** The days the desk or staff checked anybody in, up to today. */
    visitDays: readonly string[];
  };
  person: {
    /** A live member of the gym in the app, with an account that is not deleted. */
    member: boolean;
    /** Their record on the gym's list is a former one. */
    former: boolean;
    /** One of the gym's own staff: no Welcome to their own gym. */
    staff: boolean;
    /** The kinds they switched off. */
    off: readonly GymMessageKind[];
    joinedOn: string | null;
    /** The day they joined in UTC: it names the Welcome's occasion, so a gym that changes
     *  its time zone cannot make one join into two occasions. */
    joinedUtcOn: string | null;
    trial: { startsOn: string; endsOn: string } | null;
    /** The last day of a membership that is not a trial and will not renew. */
    membershipEndsOn: string | null;
    bills: readonly { id: string; dueOn: string; paid: boolean }[];
    /** `MM-DD`. */
    birthday: string | null;
    /** The days they have visited, one a day. */
    visits: number;
    /** How many of those days are today or yesterday: 0, 1 or 2. */
    recentVisitDays: number;
    lastVisitOn: string | null;
  };
  /** What they were already sent by this gym: every row of today, and every row of an
   *  occasion that could come up again. */
  sent: readonly { kind: GymMessageKind; occasion: string; day: string }[];
}

export interface GymMessageOccasion {
  kind: GymMessageKind;
  /** One message is ever sent for (gym, person, kind, occasion). */
  occasion: string;
}
export interface GymMessageDue {
  /** The one message to send now, or none. */
  send: GymMessageOccasion | null;
  /** Each occasion not sent, and why. */
  held: (GymMessageOccasion & { reason: GymMessageHeldReason })[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A calendar day as a count of days, or null for anything that is not a real day. */
function dayNumber(day: string | null): number | null {
  if (day === null || !DAY.test(day)) return null;
  const ms = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  const back = new Date(ms).toISOString().slice(0, 10);
  return back === day ? Math.round(ms / 86_400_000) : null;
}
/** Days from `from` to `to`; null when either is not a day. */
function daysBetween(from: string | null, to: string | null): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}
const isLeap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Is `today` this person's birthday? A 29 February birthday is kept on 28 February in
 *  a year with no 29th. */
function isBirthday(birthday: string, today: string): boolean {
  const monthDay = today.slice(5);
  if (birthday === monthDay) return true;
  return birthday === "02-29" && monthDay === "02-28" && !isLeap(Number(today.slice(0, 4)));
}

/** What there is an occasion for today, whatever else is true, in the order of
 *  `GYM_MESSAGE_KINDS`. A fact that cannot be read gives no occasion. */
export function gymMessageOccasions(facts: GymMessageFacts): GymMessageOccasion[] {
  const { gym, person } = facts;
  const { numbers, today } = gym;
  if (dayNumber(today) === null) return [];
  const found: GymMessageOccasion[] = [];

  for (const bill of person.bills) {
    const late = daysBetween(bill.dueOn, today);
    if (!bill.paid && late !== null && late >= numbers.paymentOverdueDays) found.push({ kind: "payment_overdue", occasion: `bill:${bill.id}` });
  }

  const toEnd = daysBetween(today, person.membershipEndsOn);
  if (toEnd !== null && toEnd >= 0 && toEnd <= numbers.membershipEndingDays) {
    found.push({ kind: "membership_ending", occasion: `ends:${String(person.membershipEndsOn)}` });
  }

  if (person.trial !== null) {
    const { startsOn, endsOn } = person.trial;
    const left = daysBetween(today, endsOn);
    const into = daysBetween(startsOn, today);
    if (left !== null && into !== null && into >= 0 && left >= 0) {
      if (left <= numbers.trialEndingDays) found.push({ kind: "trial_ending", occasion: `trial:${startsOn}` });
      const day = into + 1;
      if (day >= numbers.trialCheckInDay && day <= numbers.trialCheckInDay + GYM_MESSAGE_CHECK_IN_LATE_DAYS) {
        found.push({ kind: "trial_check_in", occasion: `trial:${startsOn}` });
      }
    }
  }

  const sinceJoined = daysBetween(person.joinedOn, today);
  if (!person.staff && sinceJoined !== null && sinceJoined >= 0 && sinceJoined < GYM_MESSAGE_WELCOME_DAYS && dayNumber(person.joinedUtcOn) !== null) {
    found.push({ kind: "welcome", occasion: `joined:${String(person.joinedUtcOn)}` });
  }

  if (person.birthday !== null && isBirthday(person.birthday, today)) found.push({ kind: "birthday", occasion: `birthday:${today.slice(0, 4)}` });

  const sinceVisit = daysBetween(person.lastVisitOn, today);
  if (sinceVisit !== null && sinceVisit >= 0) {
    // The newest milestone reached by a visit of today or yesterday: a visit made at night
    // and another before the morning's first run must not step over it.
    const recent = Number.isInteger(person.recentVisitDays) ? Math.min(Math.max(person.recentVisitDays, 0), 2) : 0;
    const reached = numbers.milestones.filter((m) => m <= person.visits && m > person.visits - recent);
    if (sinceVisit <= 1 && reached.length > 0) found.push({ kind: "milestone", occasion: `visits:${String(Math.max(...reached))}` });
    const lastVisitOn = person.lastVisitOn ?? "";
    const gymDaysSince = new Set(gym.visitDays.filter((day) => dayNumber(day) !== null && day > lastVisitOn && day <= today)).size;
    if (!person.staff && sinceVisit >= numbers.missYouDays && gymDaysSince >= missYouGymDays(numbers.missYouDays)) {
      found.push({ kind: "miss_you", occasion: `absent:${lastVisitOn}` });
    }
  }

  return found.sort((a, b) => GYM_MESSAGE_KINDS.indexOf(a.kind) - GYM_MESSAGE_KINDS.indexOf(b.kind));
}

/** Why this occasion is not sent now, or null when it may be. `picked`: another message
 *  was already picked for this person in this same run. */
function heldReason(occasion: GymMessageOccasion, facts: GymMessageFacts, picked: boolean): GymMessageHeldReason | null {
  const { gym, person, sent } = facts;
  if (!gym.open || !gym.live) return "gym_lapsed";
  if (!person.member) return "removed";
  if (person.former) return "former";
  if (!gym.on[occasion.kind]) return "gym_off";
  if (person.off.includes(occasion.kind) && !GYM_MESSAGE_ALWAYS_ON.includes(occasion.kind)) return "person_off";
  if (sent.some((row) => row.kind === occasion.kind && row.occasion === occasion.occasion)) return "already_sent";
  if (picked || sent.some((row) => row.day === gym.today)) return "another_today";
  const hour = Number.isInteger(gym.hour) ? gym.hour : -1;
  if (hour < GYM_MESSAGE_DAY_STARTS_HOUR || hour >= GYM_MESSAGE_DAY_ENDS_HOUR) return "night";
  return null;
}

/** THE RULE: the one message to send this person now, and why each other is not sent.
 *  At most one a day; run again with what it sent, it sends nothing. */
export function gymMessageDue(facts: GymMessageFacts): GymMessageDue {
  const due: GymMessageDue = { send: null, held: [] };
  for (const occasion of gymMessageOccasions(facts)) {
    const reason = heldReason(occasion, facts, due.send !== null);
    if (reason === null) due.send = occasion;
    else due.held.push({ ...occasion, reason });
  }
  return due;
}

// ── THE WORDS ──

/** A first name to greet somebody by, from the name on their account, or null where it
 *  holds none (an address, or nothing a person would be called). */
export function greetingName(displayName: string | null): string | null {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  if (first.length === 0 || first.length > 40 || first.includes("@") || !/\p{L}/u.test(first)) return null;
  return first;
}

/** Welcome, as sent. Fixed words with the gym's name and the person's first name. */
export function welcomeMessage(gymName: string, displayName: string | null): string {
  const name = greetingName(displayName);
  const gym = gymName.trim();
  return (name === null ? `Welcome to ${gym}.` : `Welcome to ${gym}, ${name}.`) + " We're glad you joined. Messages from us will show up here.";
}

/** The fixed words of each kind this app sends, before the gym's own line. Null for a kind
 *  that has no words yet, and for a milestone whose occasion names no number. */
function fixedWords(send: GymMessageOccasion, gym: string, displayName: string | null): string | null {
  if (send.kind === "welcome") return welcomeMessage(gym, displayName);
  const name = greetingName(displayName);
  if (send.kind === "birthday") return (name === null ? "Happy birthday!" : `Happy birthday, ${name}!`) + ` From everyone at ${gym}.`;
  if (send.kind === "miss_you") return `We haven't seen you at ${gym} for a while${name === null ? "" : `, ${name}`}. We hope to see you soon.`;
  if (send.kind === "milestone") {
    const visits = /^visits:([1-9][0-9]{0,5})$/.exec(send.occasion)?.[1];
    if (visits === undefined) return null;
    return `That's ${Number(visits).toLocaleString("en")} visits to ${gym}${name === null ? "" : `, ${name}`}. Well done.`;
  }
  return null;
}

/** A message as sent: the fixed words, then the gym's own line for that kind on a line of
 *  its own. Null for a kind with no words yet: nothing is sent for it. */
export function automaticMessage(send: GymMessageOccasion, gymName: string, displayName: string | null, ownLine: string | null): string | null {
  const fixed = fixedWords(send, gymName.trim(), displayName);
  if (fixed === null) return null;
  const line = (ownLine ?? "").trim();
  return line === "" ? fixed : [fixed, line].join("\n");
}

/** The four come-back lines a gym can send (Kd's, 2026-09-07), as the member reads them. */
export const GYM_COME_BACK_LINES: Record<string, string> = {
  miss_you: "We miss you — hope to see you soon.",
  door_open: "The door's always open when you're ready.",
  start_again: "Starting again is easier than you think.",
  checking_in: "Just checking in — how's it going?",
};

// ── THE INBOX, AS A MEMBER READS IT ──

export const gymInboxMessageSchema = z.object({
  id: z.string().uuid(),
  kind: gymInboxKindSchema,
  // Counted as the rule that let it be sent counts it: a shorter limit here and one long
  // message would make the whole inbox unreadable.
  body: z
    .string()
    .min(1)
    .refine((body) => gymMessageLength(body) <= GYM_MESSAGE_BODY_MAX, { message: "too_long" }),
  sentAt: instantSchema,
  /** False until the member has opened the inbox with it in. */
  read: z.boolean(),
});
export type GymInboxMessage = z.infer<typeof gymInboxMessageSchema>;

export const gymInboxResponseSchema = z.object({
  gymId: z.string().uuid(),
  gymName: z.string(),
  /** `paused`: the gym is closed or on no plan, and its members are shown no messages. */
  status: z.enum(["shown", "paused"]),
  messages: z.array(gymInboxMessageSchema).max(GYM_INBOX_MAX),
  unread: z.number().int().min(0),
  asOf: instantSchema,
  /** The gym's phone and email for its members (ROADMAP 20a-iii), since they cannot reply
   *  here. Both null for a paused gym and from an api too old to send them. */
  contact: gymContactSchema.default({ phone: null, email: null }),
  /** False once the member has switched this gym's messages to groups off (ROADMAP 20f-i). */
  groupMessages: z.boolean().default(true),
  /** The automatic kinds the member has switched off for this gym (ROADMAP 20b-i). */
  off: z.array(gymMessageKindSchema).default([]),
});
export type GymInboxResponse = z.infer<typeof gymInboxResponseSchema>;

/** Mark as read every message sent up to this instant: the `asOf` of the read the member
 *  was shown, so a message that arrived after it stays new. */
export const markGymInboxReadRequestSchema = z.object({ upTo: instantSchema }).strict();
export type MarkGymInboxReadRequest = z.infer<typeof markGymInboxReadRequestSchema>;

export const markGymInboxReadResponseSchema = z.object({ unread: z.number().int().min(0) });
export type MarkGymInboxReadResponse = z.infer<typeof markGymInboxReadResponseSchema>;
