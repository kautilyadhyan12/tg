// SETTINGS → CHECK-IN DEVICES, its words (spec Part 3 §12.3; ROADMAP 16b-i). Pure, so the
// tests read every state without a browser.
import { CHECKIN_DEVICE_NAME_MAX, CHECKIN_DEVICES_MAX } from '@app/shared';
import { visitTimeLabel } from '../../components/gym/attendanceView';

/** The gym's calendar day of an instant, `YYYY-MM-DD`, or null when it cannot be read. */
function gymDay(at, timezone) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
    return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : null;
  } catch {
    return null;
  }
}

/** A moment on the gym's clock: "14:05" today, "2 Oct, 14:05" another day, with the year
 *  when it is not this year. Empty when it cannot be read. */
export function momentLabel(iso, { timezone, clockFormat }, now = new Date()) {
  const at = new Date(iso);
  if (typeof iso !== 'string' || Number.isNaN(at.getTime())) return '';
  const time = visitTimeLabel(iso, timezone, clockFormat);
  const day = gymDay(at, timezone);
  if (time === '' || day === null) return '';
  const today = gymDay(now, timezone);
  if (day === today) return time;
  const sameYear = today !== null && today.slice(0, 4) === day.slice(0, 4);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(at);
  return `${date}, ${time}`;
}

/** The closed box's line: how many devices, and how many can check people in. */
export function devicesSummary(devices) {
  if (!Array.isArray(devices) || devices.length === 0) return 'No devices yet';
  const on = devices.filter((d) => d.state === 'on').length;
  const count = devices.length === 1 ? '1 device' : `${String(devices.length)} devices`;
  return `${count} · ${String(on)} on`;
}

/** One device's tag and the line beside it. */
export function deviceState(device, clock, now = new Date()) {
  if (device.state === 'waiting') {
    const until = device.linkExpiresAt === null ? '' : momentLabel(device.linkExpiresAt, clock, now);
    return {
      tag: 'Waiting',
      tone: 'plain',
      line: until === '' ? 'Waiting for its link to be opened on the device.' : `Waiting for its link to be opened on the device. The link works until ${until}.`,
    };
  }
  if (device.state === 'on') {
    const seen = device.lastSeenAt === null ? '' : momentLabel(device.lastSeenAt, clock, now);
    return { tag: 'On', tone: 'good', line: seen === '' ? 'Checking people in. Not used yet.' : `Checking people in. Last scan ${seen}.` };
  }
  return { tag: 'Off', tone: 'off', line: 'Not checking anybody in. Make a new link to use it again.' };
}

/** The amber line for a device that is not taking key tags for a while (RULINGS 2026-10-02). */
export function keyTagPauseLine(device, clock, now = new Date()) {
  if (device.state !== 'on' || typeof device.keyTagsPausedUntil !== 'string') return null;
  const until = momentLabel(device.keyTagsPausedUntil, clock, now);
  const when = until === '' ? 'for a few minutes' : `until ${until}`;
  return `Not taking key tags ${when}: too many numbers were scanned that nobody on your list has. Passes still work.`;
}

/** Why a new device's name cannot be saved, or null. */
export function deviceNameProblem(name) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '') return 'Give the device a name, such as Front desk.';
  if (trimmed.length > CHECKIN_DEVICE_NAME_MAX) return `A name can be up to ${String(CHECKIN_DEVICE_NAME_MAX)} characters.`;
  return null;
}

export function canAddDevice(devices) {
  return !Array.isArray(devices) || devices.length < CHECKIN_DEVICES_MAX;
}

/** The question before a press that stops a device checking people in. */
export function confirmQuestion(kind, device) {
  if (kind === 'off') {
    return `Switch off ${device.name}? It stops checking people in at once. You can turn it back on with a new link.`;
  }
  return `Make a new link for ${device.name}? It stops checking people in until the new link is opened on it.`;
}
