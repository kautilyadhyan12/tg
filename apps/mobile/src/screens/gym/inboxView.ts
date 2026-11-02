import { inboxAge, reviewLinkSchema, unreadBadge, type GymInboxMessage } from "@app/shared";

// A member's inbox from their place, as the phone draws it (spec Part 3 §16.1; ROADMAP Stage 5 item 18a). The words
// are the browser's own, from @app/shared; this file only adds what the phone draws differently.

export const inboxPath = (gymId: string) => `/v1/orgs/${encodeURIComponent(gymId)}/inbox`;
export const inboxReadPath = (gymId: string) => `${inboxPath(gymId)}/read`;
export const inboxSwitchPath = (gymId: string) => `${inboxPath(gymId)}/switches`;

export const INBOX_NOT_READ = "Couldn’t load your messages.";
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

/** New messages at all the person's places together: the Gym tab's dot is lit while there are any. */
export function newMessagesAt(orgs: readonly { isMember: boolean; newMessages: number }[]): number {
  return orgs.filter((org) => org.isMember).reduce((sum, org) => sum + org.newMessages, 0);
}
