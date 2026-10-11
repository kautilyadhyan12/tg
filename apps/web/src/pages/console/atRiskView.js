import {
  AT_RISK_AWAY_MAX_DAYS,
  AT_RISK_QUIET_DAYS,
  AT_RISK_WEEKS,
  AT_RISK_WEEKS_CAME,
  GYM_COME_BACK_LINES,
  GYM_NUDGE_PRESETS,
  GYM_PINNED_NOTE_DAYS,
  addDays,
  orgWords,
} from '@app/shared';

// THE AT RISK PAGE'S WORDS (spec Part 3 §16.4; ROADMAP 20d-i). Every sentence the page
// says is made here, from what the server sent; the page only draws them.

/** Who may open the page: whoever may see the gym's people. */
export function canSeeAtRisk(privileges) {
  return Array.isArray(privileges) && privileges.includes('members.read');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "22 Sep" for '2026-09-22'; the text itself for anything else. */
export function shortDay(day) {
  const m = typeof day === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(day) : null;
  const month = m === null ? undefined : MONTHS[Number(m[2]) - 1];
  return m === null || month === undefined ? String(day ?? '') : `${String(Number(m[3]))} ${month}`;
}

const count = (n, one, many) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
const days = (n) => count(n, 'day', 'days');

/** The line under the page's name: what puts somebody on the list. */
export function atRiskIntro(settings, orgType) {
  const words = orgWords(orgType);
  return `${words.peopleCap} who used to come and have stopped: no check-in for ${days(settings.quietDays)} or more, after coming in at least ${String(settings.weeksCame)} of their last ${String(AT_RISK_WEEKS)} weeks.`;
}

/** The two pickers' choices, as each option reads. */
export const QUIET_CHOICES = AT_RISK_QUIET_DAYS.map((n) => ({ value: n, label: days(n) }));
export const WEEKS_CHOICES = AT_RISK_WEEKS_CAME.map((n) => ({ value: n, label: `${String(n)} of their last ${String(AT_RISK_WEEKS)} weeks` }));

/** The count above the list, or the sentence for an empty one. */
export function atRiskHeadline(list, orgType) {
  const words = orgWords(orgType);
  if (list.total === 0) {
    return `Nobody has stopped coming. Every ${words.person} who was coming regularly has checked in within the last ${days(list.settings.quietDays)}.`;
  }
  return list.total === 1 ? `1 ${words.person} has stopped coming.` : `${list.total.toLocaleString('en')} ${words.people} have stopped coming.`;
}

/** Said under a list cut short. */
export function atRiskMore(list) {
  if (list.total <= list.people.length) return null;
  return `Showing the first ${list.people.length.toLocaleString('en')} of ${list.total.toLocaleString('en')}, the most regular first.`;
}

export const AT_RISK_FOOTNOTE = `Somebody who last checked in more than ${String(AT_RISK_AWAY_MAX_DAYS)} days ago is not listed. Neither is anybody whose membership is frozen or has ended, nor your own staff.`;

/** What the gym's own check-ins allow the list to say: null when it is simply the list,
 *  or a sentence, whether the list is still drawn under it, and the button's place. */
export function checkinNote(list, gymName) {
  const quiet = list.settings.quietDays;
  if (list.checkin === 'none') {
    return {
      kind: 'none',
      showList: false,
      line: `This list is worked out from check-ins, and nobody has been checked in at ${gymName} yet. Once people are checked in at the front desk or by staff, anybody who stops coming is listed here.`,
    };
  }
  if (list.checkin === 'new' && list.firstCheckinOn !== null) {
    return {
      kind: 'new',
      showList: false,
      line: `Check-in started on ${shortDay(list.firstCheckinOn)}. This list can show who has stopped coming from ${shortDay(addDays(list.firstCheckinOn, quiet))}, once there are ${days(quiet)} of check-ins.`,
    };
  }
  if (list.checkin === 'stopped') {
    const last = list.lastCheckinOn === null ? '' : ` The last check-in was on ${shortDay(list.lastCheckinOn)}.`;
    return {
      kind: 'stopped',
      showList: true,
      line: `Hardly anybody has been checked in over the last ${days(quiet)}.${last} Anybody who stopped coming in that time is not listed, because the list cannot tell them from everybody else.`,
    };
  }
  return null;
}

/** One row's two lines of facts. */
export function rowFacts(person) {
  return {
    last: `Last check-in ${shortDay(person.lastVisitOn)}, ${days(person.daysAway)} ago`,
    regular: `Came in ${String(person.weeksCame)} of their last ${String(AT_RISK_WEEKS)} weeks`,
  };
}

/** The name a row shows, and the first name a sentence uses. */
export function shownName(person, orgType) {
  const name = typeof person.name === 'string' ? person.name.trim() : '';
  if (name !== '') return { full: name, first: name.split(/\s+/)[0] ?? name };
  const words = orgWords(orgType);
  return { full: `${words.personCap} with no name`, first: `this ${words.person}` };
}

/** The four come-back lines, in the server's order; a code with no words is left out. */
export const MESSAGE_CHOICES = GYM_NUDGE_PRESETS.filter((preset) => Object.hasOwn(GYM_COME_BACK_LINES, preset)).map((preset) => ({
  preset,
  text: GYM_COME_BACK_LINES[preset],
}));

export function messageLine(preset) {
  return typeof preset === 'string' && Object.hasOwn(GYM_COME_BACK_LINES, preset) ? GYM_COME_BACK_LINES[preset] : null;
}

/** Said in the box before a message is sent. */
export function messageBoxNote(first) {
  return `Pick one message for ${first}. They see it at the top of their Inbox in the app for ${String(GYM_PINNED_NOTE_DAYS)} days. They can't reply to it.`;
}

/** A moment as a day on the gym's own calendar: "19 Oct". Null when it cannot be read. */
export function dayAt(instant, timezone) {
  const at = new Date(typeof instant === 'string' ? instant : '');
  if (Number.isNaN(at.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: timezone }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(at);
  }
}

/** What a row offers: a button to message them, a message already sent, or why nobody
 *  can be messaged, with whether their page is the next step.
 *
 *  `now` and `timezone` say whether another message may go yet, and on which day. */
export function rowAction(person, { orgType, timezone, readOnly = false, now = Date.now() } = {}) {
  const { first } = shownName(person, orgType);
  if (person.app === 'none') {
    return { kind: 'no_app', line: `Not in the app, so ${first} can't be messaged here. Their phone and email are on their page.` };
  }
  if (person.app === 'shared' || person.userId === null) {
    return { kind: 'shared', line: 'Two people use this record in the app, so a message cannot go to one of them. Their phone and email are on their page.' };
  }
  const words = messageLine(person.lastMessage?.preset);
  const sentOn = person.lastMessage === null ? null : dayAt(person.lastMessage.sentAt, timezone);
  const wait = person.messageableAt === null ? Number.NaN : Date.parse(person.messageableAt);
  if (Number.isFinite(wait) && wait > now) {
    const again = dayAt(person.messageableAt, timezone);
    const said = words === null ? 'A message was sent' : `Sent “${words}”`;
    return {
      kind: 'sent',
      line: `${said}${sentOn === null ? '' : ` on ${sentOn}`}. You can send another${again === null ? ` in ${String(GYM_PINNED_NOTE_DAYS)} days` : ` from ${again}`}.`,
    };
  }
  return {
    kind: 'send',
    disabled: readOnly,
    earlier: sentOn === null ? null : `Last message sent on ${sentOn}.`,
  };
}
