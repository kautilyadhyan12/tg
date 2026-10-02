// THE FRONT DESK'S WORDS AND RULES (spec Part 3 §12.3; ROADMAP 16b-i). Pure: the page draws
// what these answer, and the tests read them without a browser.
//
// The worst thing the desk screen could do is leave one member's name and payment word up
// for the next person in the queue, so an answer is shown for RESULT_SHOW_MS and then the
// screen goes back to "Scan your pass", and a new scan clears the old answer at once.
import { CHECKIN_WORDS } from '@app/shared';
import { visitTimeLabel } from '../../components/gym/attendanceView';

/** How long one answer stays on the desk. */
export const RESULT_SHOW_MS = 5000;
/** The camera reads the same QR many times a second: one read of a code in this time. */
export const CAMERA_SAME_CODE_MS = 3000;
/** The longest thing the scan takes (`CHECKIN_READ_MAX`): longer typing is not a scan. */
export const DESK_READ_MAX = 64;

/** What the desk remembers about itself to show at the top: the gym's and the device's
 *  names, never the key (an httpOnly cookie the page cannot read). */
export const DESK_NAMES_KEY = 'checkinDesk';

/** The token in the set-up link's `#` part: 43 letters, digits, `-` and `_`. */
export function tokenFromHash(hash) {
  if (typeof hash !== 'string') return null;
  const token = hash.startsWith('#') ? hash.slice(1) : hash;
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/** What the scanner typed, ready to send, or null when there is nothing to send. */
export function readyCode(typed) {
  if (typeof typed !== 'string') return null;
  const code = typed.trim();
  if (code === '' || code.length > DESK_READ_MAX) return null;
  return code;
}

/** The gym's own words on the person's record, for the orange line under a green tick.
 *  Never a reason to refuse: it is for staff to see. */
export function noticeLine(notice) {
  if (notice === null || typeof notice !== 'object') return null;
  const parts = [];
  if (typeof notice.status === 'string' && notice.status.trim() !== '') parts.push(`Status: ${notice.status.trim()}`);
  if (typeof notice.payment === 'string' && notice.payment.trim() !== '') parts.push(`Payment: ${notice.payment.trim()}`);
  if (notice.onList === false) parts.push('Not on your list');
  return parts.length === 0 ? null : parts.join(' · ');
}

/** One scan's answer, as the desk shows it: `tone` is the colour (good · plain · bad ·
 *  warn), `title` the big words, `name` the person on a green tick, `notice` the orange
 *  line. */
export function deskAnswer(answer) {
  switch (answer?.result) {
    case 'checked_in':
      return { tone: 'good', title: 'Checked in', name: answer.person.name, notice: noticeLine(answer.notice) };
    case 'already': {
      const time = visitTimeLabel(answer.firstAt, answer.timezone, answer.clockFormat);
      return {
        tone: 'good',
        title: time === '' ? 'Already checked in' : `Already checked in at ${time}`,
        name: answer.person.name,
        notice: noticeLine(answer.notice),
      };
    }
    case 'fresh_pass_needed':
      return { tone: 'plain', title: 'Show a fresh pass', name: null, notice: null, hint: 'Open your pass in the app again, then scan it.' };
    case 'not_a_member':
      return { tone: 'bad', title: `Not a member of ${answer.gymName}`, name: null, notice: null };
    case 'see_staff':
      return { tone: 'warn', title: 'Please see a member of staff', name: null, notice: null };
    default:
      return deskTrouble(null);
  }
}

/** A scan the server refused or never answered. `stop` is true when this device can no
 *  longer check anybody in, and the screen says so until it is set up again. */
export function deskTrouble(err) {
  const status = err?.response?.status;
  const code = err?.response?.data?.error;
  const message = err?.response?.data?.message;
  if (status === 401 || code === 'device_not_recognised') {
    return { tone: 'bad', title: "This device can't check people in", message: CHECKIN_WORDS.device_not_recognised, stop: true };
  }
  if (err?.isContractError === true) {
    return { tone: 'warn', title: 'Please scan again', message: CHECKIN_WORDS.checkin_unavailable, stop: false };
  }
  if (err?.response === undefined && err !== null && err !== undefined) {
    return { tone: 'warn', title: 'No connection', message: 'Check the internet connection, then scan again.', stop: false };
  }
  const known = {
    key_tags_slow: CHECKIN_WORDS.key_tags_slow,
    key_tags_paused: CHECKIN_WORDS.key_tags_paused,
    passes_off: CHECKIN_WORDS.passes_off,
    checkin_unavailable: CHECKIN_WORDS.checkin_unavailable,
  };
  if (typeof code === 'string' && code in known) {
    return { tone: 'warn', title: 'Please wait', message: known[code], stop: false };
  }
  if (status === 429) {
    return { tone: 'warn', title: 'Please wait', message: typeof message === 'string' ? message : CHECKIN_WORDS.key_tags_slow, stop: false };
  }
  return { tone: 'warn', title: 'Please scan again', message: CHECKIN_WORDS.checkin_unavailable, stop: false };
}

/** The set-up link that could not be opened. */
export function claimTrouble(err) {
  const code = err?.response?.data?.error;
  if (code === 'link_not_valid' || err?.response?.status === 404) return CHECKIN_WORDS.link_not_valid;
  if (err?.response === undefined) return "Couldn't reach the server. Check the internet connection, then open the link again.";
  return CHECKIN_WORDS.checkin_unavailable;
}

/** The desk's own names, read from the browser; null when there are none or storage is
 *  blocked (a private window). */
export function readDeskNames(storage) {
  try {
    const raw = storage?.getItem(DESK_NAMES_KEY);
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.gymName !== 'string' || typeof parsed?.deviceName !== 'string') return null;
    return { gymName: parsed.gymName, deviceName: parsed.deviceName };
  } catch {
    return null;
  }
}

export function writeDeskNames(storage, names) {
  try {
    if (names === null) storage?.removeItem(DESK_NAMES_KEY);
    else storage?.setItem(DESK_NAMES_KEY, JSON.stringify({ gymName: names.gymName, deviceName: names.deviceName }));
  } catch {
    // Storage blocked: the desk still works, without its names at the top.
  }
}
