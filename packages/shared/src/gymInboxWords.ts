import { GYM_CHEER_PRESETS, type GymCheerPreset } from "./orgs.js";
import { gymContactTel, type GymContact } from "./gymContact.js";
import { GYM_MESSAGE_KEPT_DAYS, GYM_PINNED_NOTE_DAYS, GYM_COME_BACK_LINES } from "./gymMessages.js";
import { GYM_MESSAGE_MEMBER_SWITCH_GROUPS, type GymMessageMemberSwitchGroup } from "./gymMessageSettings.js";
import { orgWords } from "./orgWords.js";

// WHAT A MEMBER'S INBOX SAYS (spec Part 3 §16.1), the same words in the browser and on the phone.
// Pure: each screen draws what these return.

/** The four cheer lines a gym can send (Kd approved them, 2026-09-05). No line holds a number:
 *  the line is stored as a code and read later, when a number would be out of date. */
export const GYM_CHEER_LINES: Record<GymCheerPreset, { emoji: string; text: string }> = {
  keep_going: { emoji: "💪", text: "Great week — keep it going." },
  on_a_roll: { emoji: "🔥", text: "You're on a roll." },
  consistency: { emoji: "👏", text: "Nice consistency — we see you." },
  strong_streak: { emoji: "🏆", text: "Strong streak." },
};

/** A cheer's words, or null for a code these words do not know. */
export function gymCheerText(preset: unknown): string | null {
  const code = GYM_CHEER_PRESETS.find((known) => known === preset);
  return code === undefined ? null : GYM_CHEER_LINES[code].text;
}

/** A come-back line's words, or null for a code these words do not know. */
export function gymComeBackText(preset: unknown): string | null {
  return typeof preset === "string" && Object.hasOwn(GYM_COME_BACK_LINES, preset) ? (GYM_COME_BACK_LINES[preset] ?? null) : null;
}

/** "just now", "3 hours ago", "2 days ago"; null for a time that cannot be read or is ahead. */
export function inboxAge(sentAt: unknown, now: number): string | null {
  const at = Date.parse(typeof sentAt === "string" ? sentAt : "");
  if (Number.isNaN(at) || !Number.isFinite(now)) return null;
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 0) return null;
  if (minutes < 60) return "just now";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${String(hours)} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${String(days)} days ago`;
}

interface SentNote {
  sentAt: string;
  preset: string;
}

/** The gym's one pinned note: the newer of its cheer and its come-back line, for seven days
 *  (RULINGS 2026-09-07: a new one replaces the old). Null when there is none. */
export function inboxPinnedNote(
  latestCheer: SentNote | null | undefined,
  latestNudge: SentNote | null | undefined,
  now: number,
): { text: string; when: string | null } | null {
  const note = (sent: SentNote | null | undefined, text: string | null) => {
    if (sent == null || text === null) return null;
    const at = Date.parse(sent.sentAt);
    if (Number.isNaN(at) || at > now || now - at >= GYM_PINNED_NOTE_DAYS * 86_400_000) return null;
    return { text, at, when: inboxAge(sent.sentAt, now) };
  };
  const notes = [note(latestCheer, gymCheerText(latestCheer?.preset)), note(latestNudge, gymComeBackText(latestNudge?.preset))];
  let newest: { text: string; at: number; when: string | null } | null = null;
  for (const n of notes) if (n !== null && (newest === null || n.at > newest.at)) newest = n;
  return newest === null ? null : { text: newest.text, when: newest.when };
}

/** A count of new messages as a badge shows it, or null for none. */
export function unreadBadge(unread: unknown): string | null {
  if (typeof unread !== "number" || !Number.isInteger(unread) || unread <= 0) return null;
  return unread > 99 ? "99+" : String(unread);
}

/** The line under an inbox with nothing in it. */
export function emptyInboxLine(gymName: string): string {
  return `No messages from ${gymName} yet. When they send you one, it shows up here.`;
}

/** Said under every inbox, so nothing about it is a surprise. */
export const INBOX_NOTE = `Messages stay here for ${String(GYM_MESSAGE_KEPT_DAYS)} days. You can't reply to them here.`;

/** A gym that is closed, or not on a plan: its members are shown no messages. */
export function pausedInboxLine(gymName: string): string {
  return `${gymName} isn't sending messages in the app right now.`;
}

export interface MemberSwitchRow {
  group: GymMessageMemberSwitchGroup;
  label: string;
  on: boolean;
  line: string;
}

/** The member's two switches for one gym (Kd, RULINGS 2026-10-11): what is about their own
 *  membership and bookings, and the gym's news and greetings. A switch is on only while
 *  everything in it is: `off` is the automatic kinds the server says are off,
 *  `groupMessages` whether the gym's messages to many people still come. */
export function memberMessageSwitches(gymName: string, orgType: unknown, off: readonly string[], groupMessages: boolean): MemberSwitchRow[] {
  const isOff = (kind: string) => off.includes(kind);
  const it = orgWords(orgType).itToMembers;
  const membership = GYM_MESSAGE_MEMBER_SWITCH_GROUPS.membership.map((kind) => !isOff(kind));
  const news = [groupMessages, ...GYM_MESSAGE_MEMBER_SWITCH_GROUPS.news.map((kind) => !isOff(kind))];
  const membershipOn = membership.every(Boolean);
  const newsOn = news.every(Boolean);
  // Only part of a group off (set one kind at a time, before there were two switches): the
  // switch reads off, and says that some still come.
  const SOME = "Some of these are off. Press to get them all.";
  return [
    {
      group: "membership",
      label: "About your membership and bookings",
      on: membershipOn,
      line: membershipOn
        ? "A message before a trial or a membership of yours ends, and a reminder before a class or a personal training session you booked."
        : membership.some(Boolean)
          ? SOME
          : `Off. ${gymName} won't send you these. A message about a payment you owe is still sent.`,
    },
    {
      group: "news",
      label: `News and greetings from ${gymName}`,
      on: newsOn,
      line: newsOn
        ? `Messages the ${it} sends to many people at once, like a closed day or a new class, and its greetings: how your trial is going, your birthday, a number of visits you reach, a note if you haven't been in for a while, and once, a request for a review.`
        : news.some(Boolean)
          ? SOME
          : `Off. You won't get these. Messages about your own membership and bookings still come if that switch is on.`,
    },
  ];
}

/** The button that opens the switches. */
export function memberSwitchesHeading(gymName: string): string {
  return `Choose what ${gymName} can send you`;
}

/** "Contact the gym", in the organisation's own word. */
export function contactGymLabel(orgType: unknown): string {
  return `Contact the ${orgWords(orgType).itToMembers}`;
}

export interface ContactWay {
  kind: "phone" | "email";
  label: string;
  href: string;
}

/** How the member reaches the gym: a link that calls and a link that writes, each only if the
 *  gym added it, or the one line said when it added neither. */
export function gymContactWays(contact: Partial<GymContact> | null | undefined, gymName: string): { ways: ContactWay[]; none: string | null } {
  const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
  const phone = text(contact?.phone);
  const email = text(contact?.email);
  const ways: ContactWay[] = [];
  if (phone !== null) ways.push({ kind: "phone", label: `Call ${phone}`, href: gymContactTel(phone) });
  if (email !== null) ways.push({ kind: "email", label: `Email ${email}`, href: `mailto:${email}` });
  return { ways, none: ways.length === 0 ? `${gymName} hasn't added a phone number or email yet.` : null };
}
