import { GYM_COME_BACK_LINES, GYM_MESSAGE_KEPT_DAYS, GYM_MESSAGE_KIND_NAMES, GYM_PINNED_NOTE_DAYS, gymContactTel, orgWords } from '@app/shared';
import { cheerLine } from '../../utils/cheerPresets';
import { cheerAge } from './gymMembershipView';
import { placeFor } from '../../pages/console/consolePlaces';
import { viewerPrivileges } from '../../pages/console/consoleView';

// WHAT THE MEMBER'S INBOX SAYS (spec Part 3 §16.1; ROADMAP 20a). Pure: the screen draws
// what these return.

/** The Inbox tab's count of new messages, or null when there is none to show. */
export function unreadBadge(unread) {
  if (!Number.isInteger(unread) || unread <= 0) return null;
  return unread > 99 ? '99+' : String(unread);
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

function noteFrom(sent, text, now) {
  if (sent === null || typeof sent !== 'object' || text === null) return null;
  const at = Date.parse(typeof sent.sentAt === 'string' ? sent.sentAt : '');
  if (Number.isNaN(at) || at > now || now - at >= GYM_PINNED_NOTE_DAYS * 86_400_000) return null;
  return { text, at, when: cheerAge(sent.sentAt, now) };
}

/** The gym's one pinned note: the newer of its cheer and its come-back line, for seven
 *  days (RULINGS 2026-09-07: a new one replaces the old). Null when there is none, or
 *  when this bundle has no words for it. */
export function pinnedNote(gym, now = Date.now()) {
  const cheer = noteFrom(gym?.latestCheer ?? null, cheerLine(gym?.latestCheer?.preset)?.text ?? null, now);
  const preset = gym?.latestNudge?.preset;
  const comeBack = noteFrom(
    gym?.latestNudge ?? null,
    typeof preset === 'string' && Object.hasOwn(GYM_COME_BACK_LINES, preset) ? GYM_COME_BACK_LINES[preset] : null,
    now,
  );
  const newest = [cheer, comeBack].filter((n) => n !== null).sort((a, b) => b.at - a.at)[0];
  return newest === undefined ? null : { text: newest.text, when: newest.when };
}

/** One message as the list draws it. */
export function messageRow(message, now = Date.now()) {
  return { id: message.id, body: message.body, when: cheerAge(message.sentAt, now), isNew: !message.read };
}

/** The line under an inbox with nothing in it. */
export function emptyInbox(gymName) {
  return `No messages from ${gymName} yet. When they send you one, it shows up here.`;
}

/** Said under every inbox, so nothing about it is a surprise. */
export const INBOX_NOTE = `Messages stay here for ${GYM_MESSAGE_KEPT_DAYS} days. You can't reply to them here.`;

/** The member's own switch for the gym's messages to groups (ROADMAP 20f-i). */
export function groupSwitch(gym, on) {
  const it = orgWords(gym.orgType).itToMembers;
  return {
    label: `News and notices from ${gym.name}`,
    line: on
      ? `Messages the ${it} sends to many people at once, like a closed day or a new class.`
      : `Off. You won't get these. Messages about your own membership still come.`,
  };
}

/** The member's own switches for the gym's automatic messages (ROADMAP 20b-i), one a kind
 *  they can switch off. `off`: the kinds the server says are off. */
export function kindSwitches(gym, off) {
  const isOff = (kind) => Array.isArray(off) && off.includes(kind);
  const row = (kind, label, line) => ({ kind, label, on: !isOff(kind), line: isOff(kind) ? `Off. ${gym.name} won't send you this.` : line });
  return [
    row('birthday', GYM_MESSAGE_KIND_NAMES.birthday, `A message from ${gym.name} on your birthday.`),
    row('milestone', GYM_MESSAGE_KIND_NAMES.milestone, 'A message when you reach a number of visits, like your 50th.'),
    row('miss_you', GYM_MESSAGE_KIND_NAMES.miss_you, "A message if you haven't been in for a while."),
  ];
}

/** The button that opens the switches. */
export function switchesHeading(gym) {
  return `Choose what ${gym.name} can send you`;
}

/** The button under that note: "Contact the gym", in the organisation's own word. */
export function contactButton(orgType) {
  return `Contact the ${orgWords(orgType).itToMembers}`;
}

/** How the member reaches the gym (ROADMAP 20a-iii): a link that calls and a link that
 *  writes, each only if the gym added it, or the one line said when it added neither. */
export function contactView(contact, gymName) {
  const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
  const phone = text(contact?.phone);
  const email = text(contact?.email);
  const ways = [];
  if (phone !== null) ways.push({ kind: 'phone', label: `Call ${phone}`, href: gymContactTel(phone) });
  if (email !== null) ways.push({ kind: 'email', label: `Email ${email}`, href: `mailto:${email}` });
  return { ways, none: ways.length === 0 ? `${gymName} hasn't added a phone number or email yet.` : null };
}

/** Where somebody who may change the gym's details adds them, or null for a member who
 *  may not: the line above then stands alone. */
export function contactSetUp(gym) {
  return placeFor(gym?.slug, viewerPrivileges(gym), 'memberContact');
}

/** A gym that is closed, or not on a plan: its members are shown no messages. */
export function pausedInbox(gymName) {
  return `${gymName} isn't sending messages in the app right now.`;
}
