import {
  INBOX_NOTE as SHARED_INBOX_NOTE,
  contactGymLabel,
  emptyInboxLine,
  gymContactWays,
  inboxPinnedNote,
  memberMessageSwitches,
  memberSwitchesHeading,
  pausedInboxLine,
  reviewLinkSchema,
  unreadBadge as sharedUnreadBadge,
} from '@app/shared';
import { cheerAge } from './gymMembershipView';
import { placeFor } from '../../pages/console/consolePlaces';
import { viewerPrivileges } from '../../pages/console/consoleView';

// WHAT THE MEMBER'S INBOX SAYS (spec Part 3 §16.1; ROADMAP 20a). Pure: the screen draws
// what these return.

/** The Inbox tab's count of new messages, or null when there is none to show. */
export function unreadBadge(unread) {
  return sharedUnreadBadge(unread);
}

/** Does any of the person's gyms hold a new message for them? The menu's dot beside My
 *  Gyms reads this (ROADMAP 20a-ii); the count is the server's, the inbox's own. */
export function hasNewMessages(gyms) {
  return (Array.isArray(gyms) ? gyms : []).some((gym) => unreadBadge(gym?.newMessages) !== null);
}

/** What a screen reader hears for a gym's button at the top of My Gyms. */
export function gymButtonName(name, unread) {
  const badge = unreadBadge(unread);
  if (badge === null) return name;
  return unread === 1 ? `${name}, 1 new message` : `${name}, ${badge} new messages`;
}

/** What a screen reader hears for the tab. */
export function inboxTabName(unread) {
  const badge = unreadBadge(unread);
  if (badge === null) return 'Inbox';
  return unread === 1 ? 'Inbox, 1 new message' : `Inbox, ${badge} new messages`;
}

/** The gym's one pinned note: the newer of its cheer and its come-back line, for seven
 *  days (RULINGS 2026-09-07: a new one replaces the old). Null when there is none, or
 *  when there are no words for it. */
export function pinnedNote(gym, now = Date.now()) {
  return inboxPinnedNote(gym?.latestCheer ?? null, gym?.latestNudge ?? null, now);
}

/** One message as the list draws it. */
export function messageRow(message, now = Date.now()) {
  // Only a plain https web page is ever a button: the server's own rule, read again here.
  const link = message.kind === 'review' && reviewLinkSchema.safeParse(message.link).success ? message.link : null;
  return { id: message.id, body: message.body, when: cheerAge(message.sentAt, now), isNew: !message.read, link, linkLabel: link === null ? null : 'Leave a review' };
}

/** The line under an inbox with nothing in it. */
export function emptyInbox(gymName) {
  return emptyInboxLine(gymName);
}

/** Said under every inbox, so nothing about it is a surprise. */
export const INBOX_NOTE = SHARED_INBOX_NOTE;

/** The member's two switches for one gym (Kd, RULINGS 2026-10-11), the same words as the phone. */
export function memberSwitches(gym, off, groupMessages) {
  return memberMessageSwitches(gym.name, gym.orgType, Array.isArray(off) ? off : [], groupMessages !== false);
}

/** The button that opens the switches. */
export function switchesHeading(gym) {
  return memberSwitchesHeading(gym.name);
}

/** The button under that note: "Contact the gym", in the organisation's own word. */
export function contactButton(orgType) {
  return contactGymLabel(orgType);
}

/** How the member reaches the gym (ROADMAP 20a-iii): a link that calls and a link that
 *  writes, each only if the gym added it, or the one line said when it added neither. */
export function contactView(contact, gymName) {
  return gymContactWays(contact, gymName);
}

/** Where somebody who may change the gym's details adds them, or null for a member who
 *  may not: the line above then stands alone. */
export function contactSetUp(gym) {
  return placeFor(gym?.slug, viewerPrivileges(gym), 'memberContact');
}

/** A gym that is closed, or not on a plan: its members are shown no messages. */
export function pausedInbox(gymName) {
  return pausedInboxLine(gymName);
}
