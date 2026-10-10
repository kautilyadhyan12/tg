import {
  GYM_MESSAGE_CHECK_IN_DAYS,
  GYM_MESSAGE_KIND_NAMES,
  GYM_MESSAGE_OWN_LINE_MAX,
  GYM_MESSAGE_OWN_LINE_WORDS,
  GYM_MESSAGE_SETTING_KINDS,
  automaticMessage,
  gymMessageLength,
  orgWords,
  ownLineProblem,
  tidyOwnLine,
} from '@app/shared';

// SETTINGS → AUTOMATIC MESSAGES (ROADMAP 20b-i). Pure: the box draws what these return.
// The rule for a gym's own line and the words of each message are the server's own, from
// `@app/shared`, so the box shows what a member will read and refuses what the server would.

export const MESSAGE_KINDS = GYM_MESSAGE_SETTING_KINDS;

/** The name a message is given in "What they'll read". */
const EXAMPLE_NAME = 'Maya';

/** The box's fields, from what the server holds. */
export function messageDraft(settings) {
  const by = Object.fromEntries((settings?.messages ?? []).map((m) => [m.kind, m]));
  return {
    on: Object.fromEntries(MESSAGE_KINDS.map((kind) => [kind, by[kind]?.on !== false])),
    lines: Object.fromEntries(MESSAGE_KINDS.map((kind) => [kind, typeof by[kind]?.ownLine === 'string' ? by[kind].ownLine : ''])),
    missYouDays: settings?.missYouDays ?? 10,
    milestones: [...(settings?.milestones ?? [50, 100])].sort((a, b) => a - b),
  };
}

const sameList = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);

/** Has anything been changed from what is kept? */
export function messageDraftChanged(draft, kept) {
  return (
    MESSAGE_KINDS.some((kind) => draft.on[kind] !== kept.on[kind] || tidyOwnLine(draft.lines[kind]) !== tidyOwnLine(kept.lines[kind])) ||
    draft.missYouDays !== kept.missYouDays ||
    !sameList(draft.milestones, kept.milestones)
  );
}

/** What is wrong with one message's fields, or null. */
export function messageProblem(kind, draft) {
  const problem = ownLineProblem(tidyOwnLine(draft.lines[kind]));
  if (problem !== null) return GYM_MESSAGE_OWN_LINE_WORDS[problem];
  if (kind === 'milestone' && draft.milestones.length === 0) return 'Tick at least one number of visits, or switch this message off.';
  return null;
}

/** True when nothing in the box stops a save. */
export function messageDraftFine(draft) {
  return MESSAGE_KINDS.every((kind) => messageProblem(kind, draft) === null);
}

/** What Save sends: every message and both numbers, every time. */
export function messageSettingsBody(draft) {
  return {
    messages: MESSAGE_KINDS.map((kind) => {
      const line = tidyOwnLine(draft.lines[kind]);
      return { kind, on: draft.on[kind], ownLine: line === '' ? null : line };
    }),
    missYouDays: draft.missYouDays,
    milestones: [...draft.milestones].sort((a, b) => a - b),
  };
}

/** A number of visits ticked or unticked. */
export function toggleMilestone(milestones, visits) {
  return (milestones.includes(visits) ? milestones.filter((n) => n !== visits) : [...milestones, visits]).sort((a, b) => a - b);
}

/** The message as a member called Maya will read it, the gym's own line under it. */
export function messagePreview(kind, gymName, draft) {
  const occasion = kind === 'milestone' ? `visits:${String(draft.milestones[0] ?? 50)}` : 'example';
  return automaticMessage({ kind, occasion }, gymName, EXAMPLE_NAME, tidyOwnLine(draft.lines[kind])) ?? '';
}

/** How many characters of the own line are used, as the server counts them. */
export function lineCount(draft, kind) {
  return `${String(gymMessageLength(tidyOwnLine(draft.lines[kind])))} of ${String(GYM_MESSAGE_OWN_LINE_MAX)}`;
}

export const messageName = (kind) => GYM_MESSAGE_KIND_NAMES[kind];

/** When each message is sent, said under its name. The two with a number end where the
 *  box puts its picker. */
export function messageWhen(kind, orgType) {
  const words = orgWords(orgType);
  if (kind === 'welcome') return `Sent when somebody joins your ${words.it} in the app.`;
  if (kind === 'birthday') return `Sent on a ${words.person}'s birthday, from the date of birth on your Members list. Somebody with no date of birth there gets none.`;
  if (kind === 'milestone') return `Sent when a ${words.person} reaches a number of visits you tick here.`;
  return `Sent once when a ${words.person} hasn't checked in for the number of days you pick here.`;
}

/** The two messages that count visits. */
export const needsCheckIn = (kind) => kind === 'milestone' || kind === 'miss_you';

/** Said on those two when nobody has been checked in lately. */
export function noCheckInNote(orgType) {
  return `This one counts check-ins. Nobody has been checked in at your ${orgWords(orgType).it} in the last ${String(GYM_MESSAGE_CHECK_IN_DAYS)} days, so nobody will get it yet.`;
}
/** Who can, for somebody who cannot open Attendance. */
export const NO_CHECK_IN_ASK = 'Staff who can open Attendance check people in there.';

/** The line beside the heading while the section is shut. */
export function messageSettingsSummary(kept) {
  if (kept === null) return '';
  const on = MESSAGE_KINDS.filter((kind) => kept.on[kind]).map(messageName);
  return on.length === 0 ? 'All switched off' : `On: ${on.join(' · ')}`;
}

/** Said above the messages: what these are, where they go, and what a member controls. */
export function messageSettingsNote(orgType) {
  const words = orgWords(orgType);
  return `The app sends these to your ${words.people} by itself. Each lands in their Inbox in the app. Nobody gets more than one a day, and none is sent at night. A ${words.person} can switch off Birthday, Visit milestone and We miss you for themselves.`;
}
