import { inboxAge, reviewLinkSchema, unreadBadge, type GymInboxMessage } from "@app/shared";

// A member's inbox from their place, as the phone draws it (spec Part 3 §16.1; ROADMAP Stage 5 item 18a). The words
// are the browser's own, from @app/shared; this file only adds what the phone draws differently.

export const inboxPath = (gymId: string) => `/v1/orgs/${encodeURIComponent(gymId)}/inbox`;
export const inboxReadPath = (gymId: string) => `${inboxPath(gymId)}/read`;
export const inboxSwitchPath = (gymId: string) => `${inboxPath(gymId)}/switches`;

export const INBOX_NOT_READ = "Couldn’t load your messages.";
export const LINK_NOT_OPENED = "No app on this phone can open that.";
export const SWITCH_NOT_SAVED = "We couldn’t change that. Please try again.";

export interface InboxRow {
  id: string;
  body: string;
  when: string | null;
  isNew: boolean;
  /** The gym's review page, for Ask for a review; null for every other message. */
  link: string | null;
}

/** One message as the list draws it. Only a plain https page is ever a button: the server's own rule, read again. */
export function inboxRow(message: GymInboxMessage, nowMs: number): InboxRow {
  const link = message.kind === "review" && reviewLinkSchema.safeParse(message.link).success ? message.link : null;
  return { id: message.id, body: message.body, when: inboxAge(message.sentAt, nowMs), isNew: !message.read, link };
}

/** The Inbox button's words: "Inbox", or "Inbox (3)" with new messages waiting. */
export function inboxButtonLabel(unread: number): string {
  const badge = unreadBadge(unread);
  return badge === null ? "Inbox" : `Inbox (${badge})`;
}

/** What a screen reader hears for a place's Inbox button. */
export function inboxButtonSay(gymName: string, unread: number): string {
  const badge = unreadBadge(unread);
  if (badge === null) return `Inbox at ${gymName}`;
  return `Inbox at ${gymName}, ${unread === 1 ? "1 new message" : `${badge} new messages`}`;
}

/** Each place's count of new messages, as the dot and the Inbox buttons read it. `counts`: from the newest read of
 *  the places to answer, numbered `applied`; `said`: what an Inbox said since, with the number of reads started then. */
export interface UnreadCounts {
  applied: number;
  counts: Readonly<Record<string, number>>;
  said: Readonly<Record<string, { unread: number; after: number }>>;
}

export const NO_COUNTS: UnreadCounts = { applied: 0, counts: {}, said: {} };

/** A read of the places answered: an older read than one already taken changes nothing, and what an Inbox said after
 *  this read started stays, for the read's count was worked out before it. */
export function placesAnswered(was: UnreadCounts, number: number, orgs: readonly { id: string; isMember: boolean; newMessages: number }[]): UnreadCounts {
  if (number < was.applied) return was;
  return {
    applied: number,
    counts: Object.fromEntries(orgs.filter((org) => org.isMember).map((org) => [org.id, org.newMessages])),
    said: Object.fromEntries(Object.entries(was.said).filter(([, one]) => one.after >= number)),
  };
}

/** A place's Inbox said its count; `started`: the reads of the places started by then. */
export function inboxAnswered(was: UnreadCounts, gymId: string, unread: number, started: number): UnreadCounts {
  return { ...was, said: { ...was.said, [gymId]: { unread, after: started } } };
}

/** A place's count, or null before the places are read. */
export function placeUnread(now: UnreadCounts, gymId: string): number | null {
  return now.said[gymId]?.unread ?? now.counts[gymId] ?? null;
}

/** All the places' new messages together: the Gym tab's dot is lit while there are any. */
export function allUnread(now: UnreadCounts): number {
  return Object.keys(now.counts).reduce((sum, gymId) => sum + (placeUnread(now, gymId) ?? 0), 0);
}
