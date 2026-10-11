import {
  AT_RISK_AWAY_MAX_DAYS,
  AT_RISK_QUIET_DAYS,
  AT_RISK_WEEKS,
  AT_RISK_WEEKS_CAME,
  GYM_COME_BACK_LINES,
  GYM_COME_BACK_WAIT_DAYS,
  GYM_MESSAGE_BODY_MAX,
  GYM_MESSAGE_KEPT_DAYS,
  GYM_NUDGE_PRESETS,
  gymMessageLength,
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
  return `${words.peopleCap} who used to come and have stopped: they have not come in for ${days(settings.quietDays)} or more, after coming in at least ${String(settings.weeksCame)} of their last ${String(AT_RISK_WEEKS)} weeks.`;
}

/** The two pickers' choices, as each option reads. */
export const QUIET_CHOICES = AT_RISK_QUIET_DAYS.map((n) => ({ value: n, label: days(n) }));
export const WEEKS_CHOICES = AT_RISK_WEEKS_CAME.map((n) => ({ value: n, label: `${String(n)} of their last ${String(AT_RISK_WEEKS)} weeks` }));

/** The count above the list, or the sentence for an empty one. It claims nothing about
 *  anybody the list holds back (away too long, frozen, the staff). */
export function atRiskHeadline(list, orgType) {
  const words = orgWords(orgType);
  if (list.total === 0) return 'Nobody has stopped coming.';
  return list.total === 1 ? `1 ${words.person} has stopped coming.` : `${list.total.toLocaleString('en')} ${words.people} have stopped coming.`;
}

/** Said under a list cut short. */
export function atRiskMore(list) {
  if (list.total <= list.people.length) return null;
  return `Showing the first ${list.people.length.toLocaleString('en')} of ${list.total.toLocaleString('en')}, the most regular first.`;
}

export const AT_RISK_FOOTNOTE = `Coming in means a check-in, or a class or personal training session that staff marked as attended. Somebody who last came in more than ${String(AT_RISK_AWAY_MAX_DAYS)} days ago is not listed. Neither is anybody whose membership is frozen or has ended, nor your own staff.`;

/** What the gym's own check-ins allow the list to say: null when it is simply the list,
 *  or a sentence, whether the list is still drawn under it, and the button's place. */
export function checkinNote(list, gymName) {
  const quiet = list.settings.quietDays;
  if (list.checkin === 'none') {
    return {
      kind: 'none',
      showList: false,
      line: `This list is worked out from who comes in, and nobody has been checked in at ${gymName} yet. Once people are checked in at the front desk or by staff, anybody who stops coming is listed here.`,
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
    const last = list.lastCheckinOn === null ? '' : ` The last day anybody came in was ${shortDay(list.lastCheckinOn)}.`;
    const lately = typeof list.checkinDaysLately === 'number' ? list.checkinDaysLately : 0;
    // About DAYS, against this gym's own usual: a gym open three days a week never reads this.
    const how =
      lately === 0
        ? `Nobody came in over the last ${days(quiet)}.`
        : `People came in on only ${String(lately)} of the last ${days(quiet)}, far fewer than is usual at ${gymName}.`;
    return {
      kind: 'stopped',
      // With nobody to list, this note is the whole answer: no "Nobody has stopped coming".
      showList: list.total > 0,
      line: `${how}${last} Anybody who stopped coming in that time is not listed, because the list cannot tell them from everybody else.`,
    };
  }
  return null;
}

/** One row's two lines of facts. */
export function rowFacts(person) {
  return {
    last: `Last came in ${shortDay(person.lastVisitOn)}, ${days(person.daysAway)} ago`,
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
export function messageBoxNote(first, canWrite = false) {
  return `Pick one message for ${first}${canWrite ? ', or write your own' : ''}. They see it in their Inbox in the app. They can't reply to it.`;
}

/** Who may write their own words to a member: whoever may send a message from Members. */
export function canWriteOwn(privileges) {
  return Array.isArray(privileges) && privileges.includes('members.confirm');
}

/** The choice under the four ready-made lines. */
export const OWN_CHOICE = 'own';
export const OWN_LABEL = 'Write your own message';
export const OWN_RULES = `Up to ${String(GYM_MESSAGE_BODY_MAX)} characters. No web links and no @. It stays in their Inbox for ${String(GYM_MESSAGE_KEPT_DAYS)} days.`;

/** How many characters are left, as the server counts them, and whether it can be sent. */
export function ownWordsLeft(text) {
  const used = gymMessageLength(typeof text === 'string' ? text.trim() : '');
  const left = GYM_MESSAGE_BODY_MAX - used;
  return { left, ok: used > 0 && left >= 0, line: left >= 0 ? `${count(left, 'character', 'characters')} left` : `${count(-left, 'character', 'characters')} too many` };
}

/** A message as a row quotes it: the whole of a short one, the start of a long one. */
export function quoted(words) {
  const text = typeof words === 'string' ? words.replace(/\s+/g, ' ').trim() : '';
  return text.length <= 120 ? text : `${text.slice(0, 117).trimEnd()}…`;
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
    return { kind: 'shared', line: 'More than one person uses this record in the app, so a message cannot go to one of them. Their phone and email are on their page.' };
  }
  const own = typeof person.lastMessage?.body === 'string' && person.lastMessage.body !== '' ? quoted(person.lastMessage.body) : null;
  const words = own ?? messageLine(person.lastMessage?.preset);
  const sentOn = person.lastMessage === null ? null : dayAt(person.lastMessage.sentAt, timezone);
  const wait = person.messageableAt === null ? Number.NaN : Date.parse(person.messageableAt);
  if (Number.isFinite(wait) && wait > now) {
    const again = dayAt(person.messageableAt, timezone);
    const said = words === null ? 'A message was sent' : `Sent “${words}”`;
    return {
      kind: 'sent',
      line: `${said}${sentOn === null ? '' : ` on ${sentOn}`}. You can send another${again === null ? ` in ${String(GYM_COME_BACK_WAIT_DAYS)} days` : ` from ${again}`}.`,
    };
  }
  return {
    kind: 'send',
    disabled: readOnly,
    earlier: sentOn === null ? null : `Last message sent on ${sentOn}.`,
  };
}
