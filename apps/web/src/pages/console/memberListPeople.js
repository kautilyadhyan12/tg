import {
  HELD_PAYMENT_WORDS,
  HELD_STATUS_WORDS,
  MEMBER_APP_FILTER_ORDER,
  MEMBER_APP_FILTER_WORDS,
  MEMBER_APP_WORDS,
  MEMBER_INVITE_WORDS,
  MEMBER_LIST_MERGE_FILLS,
  MEMBER_LIST_MERGE_KEEPS_OWN,
  MEMBER_LIST_TICKED_MAX,
  GYM_GROUP_MESSAGE_WORDS,
  GYM_MESSAGE_BODY_MAX,
  groupMessageLength,
  MEMBER_TAGS_MAX_PER_PERSON,
  heldNamesLine,
  turns18On,
  underAgeOn,
} from '@app/shared';
import { dayWords } from './memberListView';

// The gym's own list on the Members screen (ROADMAP 5b-i; spec Part 3 §9.14, §11.5,
// §11.6): what a row and a person's page say, and what a filter or a form sends. The
// server decides everything; these only turn its answers into words and staff's
// choices into a request.

/** The kinds of chip, each one of the gym's own lists of words. */
export const CHIP_KINDS = [
  { kind: 'status', from: 'statuses', title: 'Status', none: 'No status' },
  { kind: 'membershipType', from: 'membershipTypes', title: 'Membership', none: 'No membership' },
  { kind: 'paymentStatus', from: 'paymentStatuses', title: 'Payment status', none: 'No payment status' },
];

export const EMPTY_FILTERS = {
  records: 'current',
  /** App words ticked (spec Part 3 §18.4); none is everybody. */
  app: [],
  status: [],
  membershipType: [],
  paymentStatus: [],
  /** One of the gym's tags, { id, name }, or null (5d-ii): members or past members. */
  tag: null,
  query: '',
};

/** A chip's words: the gym's own spelling, or "No status" for the people with none. */
export function chipText(label, none) {
  return label === '' ? none : label;
}

/** Tick or untick one word of one kind. Words are compared as the server compares
 *  them, case and spaces folded, so a chip is never ticked twice. */
export function toggleWord(filters, kind, label) {
  const fold = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const had = filters[kind].some((w) => fold(w) === fold(label));
  return { ...filters, [kind]: had ? filters[kind].filter((w) => fold(w) !== fold(label)) : [...filters[kind], label] };
}

export function isTicked(filters, kind, label) {
  const fold = (s) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return filters[kind].some((w) => fold(w) === fold(label));
}

/** The query string for `GET …/entries`: a word filter ticked twice goes as two keys,
 *  and "" (no status) is sent as an empty value, which the server reads as "none". */
export function entriesQueryString(filters, cursor) {
  const params = new URLSearchParams();
  if (filters.records !== 'current') params.append('records', filters.records);
  if (filters.records === 'current') {
    for (const word of filters.app) params.append('app', word);
    for (const { kind } of CHIP_KINDS) for (const word of filters[kind]) params.append(kind, word);
  }
  if (filters.tag !== null) params.append('tag', filters.tag.id);
  const query = filters.query.trim();
  if (query !== '') params.append('query', query);
  if (cursor) params.append('cursor', cursor);
  return params.toString();
}

/** What is ticked, one pill each for the "Showing:" line, each with the filters as
 *  they would be without it. The search is not here: it has its own box. */
export function activeFilters(filters, words) {
  const tag = filters.tag === null ? [] : [{ key: `tag:${filters.tag.id}`, text: `Tag: ${filters.tag.name}`, without: { ...filters, tag: null } }];
  if (filters.records === 'former') {
    return [{ key: 'records', text: `Past ${words.people}`, without: { ...filters, records: 'current' } }, ...tag];
  }
  const out = [];
  for (const { kind, none } of CHIP_KINDS) {
    for (const label of filters[kind]) {
      out.push({ key: `${kind}:${label}`, text: chipText(label, none), without: toggleWord(filters, kind, label) });
    }
  }
  for (const word of MEMBER_APP_FILTER_ORDER) {
    if (filters.app.includes(word)) {
      out.push({ key: `app:${word}`, text: MEMBER_APP_FILTER_WORDS[word], without: toggleApp(filters, word) });
    }
  }
  return [...out, ...tag];
}

export function filtersAreEmpty(filters) {
  return (
    filters.tag === null &&
    filters.app.length === 0 &&
    filters.query.trim() === '' &&
    CHIP_KINDS.every(({ kind }) => filters[kind].length === 0)
  );
}

/** Today in the gym's own time zone, 'YYYY-MM-DD', as the server decides a birthday; the
 *  reader's own calendar if the zone cannot be read. */
export function gymToday(timeZone, now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    const pad = (n) => String(n).padStart(2, '0');
    return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
}

/** "3 October 2026" from a timestamp, in the reader's own calendar. */
export function whenWords(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The day a note was written, on the gym's own calendar: "8 October 2026". */
export function noteDay(iso, timeZone) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const options = { day: 'numeric', month: 'long', year: 'numeric' };
  try {
    return at.toLocaleDateString('en-GB', timeZone ? { ...options, timeZone } : options);
  } catch {
    return at.toLocaleDateString('en-GB', options);
  }
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-03" → "3 Oct", with the year when it is not `today`'s ("3 Oct 2027"). */
export function shortDay(day, today = null) {
  const [y, m, d] = day.split('-').map(Number);
  const year = today !== null && today.slice(0, 4) === String(y) ? '' : ` ${String(y)}`;
  return `${String(d)} ${SHORT_MONTHS[m - 1]}${year}`;
}

/** A timestamp's day in the reader's own calendar, 'YYYY-MM-DD'. */
function localDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (x) => String(x).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "26 Sep" from a timestamp, with the year when it is not `today`'s. */
export function shortWhen(iso, today = null) {
  const day = localDay(iso);
  return day === null ? '' : shortDay(day, today);
}

/** The end or renewal date in the heading's own word: "Renews 3 Oct", "Ends 30 Sep",
 *  and "Ended 31 Aug" once the gym's day is past it. */
export function endsWords(entry, today = null) {
  if (entry.endsOn === null) return null;
  if (today !== null && entry.endsOn < today) return `Ended ${shortDay(entry.endsOn, today)}`;
  return `${entry.endsOnKind === 'renews' ? 'Renews' : 'Ends'} ${shortDay(entry.endsOn, today)}`;
}

/** What the list says today about somebody an import leaves out, each of the gym's own
 *  words with what it is — "Status: Cancelled · Ended 31 Aug · Membership: Gold · Payment:
 *  Unpaid" — and how they came onto the list when it was not an import ("Added manually ·
 *  20 Sep"), so staff can tell who has left (Kd, 2026-09-27: "how can a gym simply decide
 *  they are member or have left just by looking at names"; 2026-09-29: "cancelled gold paid
 *  … gym will get confused … something meaningful"). The end date stands beside the status,
 *  so a Cancelled or Expired reads with when (Kd, 2026-09-29: "Status: Cancelled should show
 *  when was cancelled"); the app knows it only when the file gives one. */
export function goneWords(person, today = null) {
  const on = person.onList;
  const facts = [
    person.wasStatus ? `Status: ${person.wasStatus}` : null,
    endsWords(on, today),
    on.membershipType ? `Membership: ${on.membershipType}` : null,
    on.paymentStatus ? `Payment: ${on.paymentStatus}` : null,
  ].filter((w) => w !== null && w !== '');
  const when = shortWhen(on.addedAt, today);
  const added = on.source === 'typed' ? `Added manually · ${when}` : on.source === 'member' ? `Added from the app · ${when}` : null;
  return { facts: facts.join(' · '), added };
}

/** When somebody the list says is under 18 can be invited, and what to do if the date
 *  is wrong (Kd, 2026-09-27: "now if gyms update can they join?"). */
export function underAgeWhen(dateOfBirth) {
  const from = dateOfBirth === null ? null : turns18On(dateOfBirth);
  const fix = 'If the date of birth is incorrect, select Edit to update it.';
  return from === null ? fix : `They can be invited from ${dayWords(from)}, when they turn 18. ${fix}`;
}

/** The day someone became a past member, "3 Sep 2026", or null. */
export function pastSince(entry) {
  const day = entry.formerAt === null ? null : localDay(entry.formerAt);
  return day === null ? null : shortDay(day);
}

/** "Mum", "Mum and Dan", "A, B and C". */
export function listNames(names) {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Past member since 3 Sep 2026" — "Past client since" for a studio (spec Part 3 §18.3). */
export function pastWords(entry, person = 'member') {
  const since = pastSince(entry);
  return since === null ? null : `Past ${person} since ${since}`;
}

/** The day of a membership held in the app, in the Renews-or-ends column's words; null
 *  where there is none to say (one that ended on no day the app knows). */
function heldDayWords(day, today) {
  if (day === null || day === undefined) return null;
  if (day.on === null) return null;
  const on = shortDay(day.on, today);
  switch (day.what) {
    case 'renews':
      return `Renews ${on}`;
    case 'ends':
      return `Ends ${on}`;
    case 'starts':
      return `Starts ${on}`;
    case 'frozen':
      return `Frozen since ${on}`;
    case 'ended':
      return `Ended ${on}`;
    case 'cancelled':
      return `Cancelled ${on}`;
    default:
      return null;
  }
}

/** A row's Status, Membership, Renews-or-ends and Payment (23a-i). Somebody who holds a
 *  membership in the app reads what it says (`entry.held`, worked out by the server);
 *  everybody else reads the gym's own words. `owes`: the server says a payment is due,
 *  which is money owed today; one whose day has not come is "Not due yet" and not owed. */
export function rowCells(entry, today = null) {
  const held = entry.held ?? null;
  if (held === null) {
    const word = (w) => (w === null || w === undefined || w === '' ? null : w);
    return { status: word(entry.status), membership: word(entry.membershipType), ends: endsWords(entry, today), payment: word(entry.paymentStatus), owes: false };
  }
  const pay = held.payment;
  return {
    status: HELD_STATUS_WORDS[held.status] ?? null,
    membership: heldNamesLine(held.memberships),
    ends: heldDayWords(held.day, today),
    payment: pay === null ? null : HELD_PAYMENT_WORDS[pay.state],
    owes: pay !== null && pay.state === 'due',
  };
}

/** What the list says about the person in one line, as a phone's row shows it. */
export function rowWords(entry, today = null, person = 'member') {
  if (entry.formerAt !== null) return [pastWords(entry, person)].filter((w) => w !== null);
  const cells = rowCells(entry, today);
  return [cells.status, cells.membership, cells.ends, cells.payment].filter((w) => w !== null && w !== '');
}

export function contactWords(entry) {
  return entry.email ?? entry.phone ?? 'No email or phone';
}

/** Add member's warning (5b-iv-b): its heading, with the name as staff typed it. */
export function mayBeOnListWords(typedName) {
  const name = (typedName ?? '').trim();
  return `${name === '' ? 'This person' : name} may already be on your list`;
}

/** A record the warning names: every detail that tells two people apart, in one line. */
export function matchDetailWords(match) {
  const parts = [match.email, match.phone, match.memberNumber === null ? null : `Member number ${match.memberNumber}`].filter(
    (part) => part !== null && part !== '',
  );
  return parts.length === 0 ? 'No email or phone' : parts.join(' · ');
}

/** Tick or untick one App word. */
export function toggleApp(filters, word) {
  return { ...filters, app: filters.app.includes(word) ? filters.app.filter((w) => w !== word) : [...filters.app, word] };
}

const APP_TAGS = { green: 'c-tag-good', amber: 'c-tag-warn', red: 'c-tag-bad', grey: 'c-tag-plain' };

/** The server's App word as a screen shows it (§18.4): the word and its colour; `note`,
 *  a red or amber line that asks staff to check something, shown on the list under the
 *  whole row; and `plain`, the line that only explains ("Invitation sent · 22 Sep"),
 *  shown on the person's own page and never on the list (Kd, 2026-09-27: the list
 *  showed too much). */
export function appView(app, today = null) {
  const line = app.line === null ? null : app.at === null ? app.line : `${app.line} · ${shortWhen(app.at, today)}`;
  return {
    text: MEMBER_APP_WORDS[app.word],
    tag: APP_TAGS[app.tone],
    plain: app.lineTone === 'plain' ? line : null,
    note: app.lineTone === 'plain' ? null : line,
    noteTone: app.lineTone,
  };
}

/** The same word for a person's page, in the shape its tag reads. */
export function invitationView(entry, today = null) {
  const view = appView(entry.app, today);
  const tone = { green: 'green', amber: 'orange', red: 'red', grey: 'plain' }[entry.app.tone];
  // The one reason that needs something done in another place (`sentencePlace`): the
  // invitation is waiting and its newest email did not go because of the gym's name.
  const email = entry.invitation?.state === 'pending' ? entry.invitation.email : null;
  // Somebody waiting for a place reads the full plan's line instead ("Invited"): no button there.
  const waiting = entry.app.word !== 'not_in_app' || (entry.invitation?.waitingSince ?? null) !== null;
  const named = !waiting && view.note !== null && email !== null && email.reason === 'gym_name' && (email.state === 'skipped' || email.state === 'failed');
  return { tag: view.text, tone, detail: view.note, line: view.plain, place: named ? 'gymName' : null };
}

// ── Invite (5b-ii; §9.12, §11.5) ─────────────────────────────────────────────

const n = (x) => x.toLocaleString('en');

/** The query string for Invite's count: only the gym's own words choose who is
 *  invited, as the server's Invite reads them. */
export function inviteQueryString(filters) {
  const params = new URLSearchParams();
  for (const { kind } of CHIP_KINDS) for (const word of filters[kind]) params.append(kind, word);
  return params.toString();
}

/** The preview's value for exactly the people it showed, sent back with the press: the
 *  server invites nobody if the people it would reach now are any others. */
function previewDigest(preview) {
  return typeof preview.digest === 'string' ? { expectedDigest: preview.digest } : {};
}

/** The press: the same words, the version and number the count showed, so a list that
 *  moved in between invites nobody, and staff's permission tick. */
export function inviteBody(filters, preview, permissionConfirmed) {
  const body = { version: preview.version, expectedCount: preview.reach, ...previewDigest(preview), permissionConfirmed };
  for (const { kind } of CHIP_KINDS) if (filters[kind].length > 0) body[kind] = [...filters[kind]];
  return body;
}

// ── The people selected (spec Part 3 §18.5) ──

/** The list's filter and search as the server reads them: what "Select all" means. The
 *  same keys `entriesQueryString` sends, so the people selected are the people shown. */
export function selectionFilter(filters) {
  const out = {};
  if (filters.records !== 'current') out.records = filters.records;
  if (filters.records === 'current') {
    if (filters.app.length > 0) out.app = [...filters.app];
    for (const { kind } of CHIP_KINDS) if (filters[kind].length > 0) out[kind] = [...filters[kind]];
  }
  if (filters.tag !== null) out.tag = filters.tag.id;
  const query = filters.query.trim();
  if (query !== '') out.query = query;
  return out;
}

/** The selection a press sends: the rows ticked, or everyone "Select all" chose with the
 *  count and digest the server gave. Null when nobody is selected. */
export function selectionOf(ticked, all) {
  if (all !== null) return { kind: 'all', filter: all.filter, count: all.count, digest: all.digest };
  if (ticked.size === 0) return null;
  return { kind: 'ticked', entryIds: [...ticked] };
}

/** The rows the heading's box ticks — every row loaded, up to the most that can be ticked
 *  one by one — and whether they are all ticked (or everyone, after Select all). Past
 *  that many rows, "Select all" is the way (round one of 5b-v-b-i, L4). */
export function pageTickState(loadedIds, ticked, all) {
  const pageIds = loadedIds.slice(0, MEMBER_LIST_TICKED_MAX);
  const pageTicked = all !== null || (pageIds.length > 0 && pageIds.every((id) => ticked.has(id)));
  return { pageIds, pageTicked };
}

/** Unticking one person after "Select all": the rows loaded stay ticked, as many as can
 *  be ticked one by one, without them. */
export function untickFromAll(loadedIds, id) {
  const next = new Set(loadedIds.slice(0, MEMBER_LIST_TICKED_MAX));
  next.delete(id);
  return next;
}

/** How many people are selected. */
export function selectedCount(ticked, all) {
  return all !== null ? all.count : ticked.size;
}

/** "3 selected". */
export function selectedWords(k) {
  return `${n(k)} selected`;
}

/** The press on the people selected: the version and number the count showed, and the tick. */
export function selectedInviteBody(selection, preview, permissionConfirmed) {
  return { selection, version: preview.version, expectedCount: preview.reach, ...previewDigest(preview), permissionConfirmed };
}

/** Invite's top line for the people selected, as `inviteSummary` says it for the list.
 *  Counted from how many were selected (`selected`), so it agrees with the bar behind it:
 *  anyone selected who has since left the list, or was never this gym's, is `gone` and
 *  counted among those not included (round one, L2). */
export function selectedInviteSummary(preview, words, selected) {
  const skipped = Object.values(preview.skipped).reduce((sum, k) => sum + k, 0);
  const total = Math.max(selected, preview.reach + skipped);
  const gone = total - preview.reach - skipped;
  const leftOut = skipped + gone;
  let gets;
  if (total === 0) gets = `None of the selected ${words.people} are on your list now`;
  else if (preview.reach === 0) gets = `No ${words.people} to invite`;
  else if (preview.reach === total)
    gets = total === 1 ? `1 selected ${words.person} will receive an invitation email` : `All ${n(total)} selected ${words.people} will receive an invitation email`;
  else gets = `${n(preview.reach)} of ${n(total)} selected ${words.people} will receive an invitation email`;
  const wont = leftOut === 0 ? null : `${n(leftOut)} not included`;
  const goneLine = gone === 0 ? null : `${n(gone)} ${gone === 1 ? 'is' : 'are'} no longer on your list`;
  return { gets, wont, leftOut, goneLine };
}

/** How many people a selection holds. */
export function selectionSize(selection) {
  return selection === null ? 0 : selection.kind === 'all' ? selection.count : selection.entryIds.length;
}

/** Who an Invite is for, in the gym's own words. */
export function inviteWho(filters) {
  const parts = CHIP_KINDS.filter(({ kind }) => filters[kind].length > 0).map(
    ({ kind, title, none }) => `${title}: ${filters[kind].map((w) => chipText(w, none)).join(' or ')}`,
  );
  return parts.length === 0 ? 'Everyone on your list' : parts.join(' · ');
}

/** Said when the list on screen is narrowed by something Invite does not read. */
export function inviteIgnores(filters) {
  return filters.query.trim() !== '' || filters.app.length > 0
    ? 'Recipients are chosen by your Status, Membership and Payment filters. Search and App filters don\'t apply.'
    : null;
}

/** Who an Invite leaves out, one line a reason, in the server's order; none for a zero. */
export function skippedLines(skipped) {
  const lines = [
    ['noEmail', skipped.noEmail, (k) => `${n(k)} without an email address`],
    ['underAge', skipped.underAge, (k) => `${n(k)} under 18`],
    ['inApp', skipped.inApp, (k) => `${n(k)} already in the app`],
    ['alreadyInvited', skipped.alreadyInvited, (k) => `${n(k)} already invited, or sharing an invited email address`],
    ['unsubscribed', skipped.unsubscribed, (k) => `${n(k)} unsubscribed from your emails`],
    ['bounced', skipped.bounced, (k) => `${n(k)} with an email address that bounces`],
    ['refused', skipped.refused, (k) => `${n(k)} with an email address our provider won't deliver to`],
    ['sharedAddress', skipped.sharedAddress, (k) => `${n(k)} with a shared email address such as info@`],
  ];
  return lines.filter(([, count]) => count > 0).map(([key, count, words]) => ({ key, text: words(count) }));
}

/** Invite's top line: of the people it looked at, how many get an email and how many
 *  don't, so the numbers always add up (Kd, 2026-09-27: "Everyone on your list" over
 *  "Invite 20" read as a contradiction). `leftOut` is null when everyone is reached. */
export function inviteSummary(preview, filters, words) {
  const leftOut = Object.values(preview.skipped).reduce((sum, k) => sum + k, 0);
  const total = preview.reach + leftOut;
  const chosen = CHIP_KINDS.some(({ kind }) => filters[kind].length > 0);
  let gets;
  if (total === 0) gets = chosen ? `No ${words.people} match your filters` : `There are no ${words.people} on your list yet`;
  else if (preview.reach === 0) gets = `No ${words.people} to invite`;
  else if (preview.reach === total) gets = total === 1 ? `1 ${words.person} will receive an invitation email` : `All ${n(total)} ${words.people} will receive an invitation email`;
  else gets = `${n(preview.reach)} of ${n(total)} ${words.people} will receive an invitation email`;
  const wont = leftOut === 0 ? null : `${n(leftOut)} not included`;
  return { gets, wont, leftOut };
}

/** Why Invite leaves one person out, in the words their own row and page use (§18.4,
 *  §18.6), and what staff can do about it, when there is something. */
export function inviteWhyNot(person, today = null) {
  switch (person.reason) {
    case 'noEmail':
      return { text: 'No email address', hint: 'Add an email address to invite them.' };
    case 'underAge':
      return {
        text: person.turns18On === null ? 'Under 18' : `Under 18 (can be invited from ${shortDay(person.turns18On, today)})`,
        hint: 'If the date of birth is incorrect, update it on their page.',
      };
    case 'inApp':
      // In the app with nothing to add, or the row's own line: a family's shared email
      // carries its own advice; a relative in the app with this email needs another address.
      if (person.app.word === 'in_app' && person.app.line === null) return { text: 'Already in the app', hint: null };
      return {
        text: person.app.line ?? 'Someone else uses the app with this email address.',
        hint: person.app.word === 'in_app' ? null : 'Add a separate email address to invite them.',
      };
    case 'alreadyInvited': {
      if (person.sameAddressAs !== null) {
        return { text: `Shares an email address with ${person.sameAddressAs}, who is being invited`, hint: 'Add a separate email address to invite them.' };
      }
      const view = appView(person.app, today);
      return { text: view.note ?? view.plain ?? 'Already invited', hint: person.app.word === 'invited' ? 'To resend, open their page.' : null };
    }
    case 'unsubscribed':
      return { text: 'Unsubscribed from your emails', hint: null };
    case 'bounced':
      return { text: 'Email address bounces', hint: 'Confirm the address with them.' };
    case 'refused':
      return { text: "Our email provider won't deliver to this address", hint: 'Ask them for another email address.' };
    case 'sharedAddress':
      return { text: 'Shared email address (such as info@)', hint: 'Add their own email address to invite them.' };
    default:
      return { text: 'Not included', hint: null };
  }
}

/** Invite's list query: the gym's words, the group, and where the last page ended. */
export function invitePeopleQuery(filters, group, cursor = null) {
  const params = new URLSearchParams(inviteQueryString(filters));
  params.set('group', group);
  if (cursor !== null) params.set('cursor', String(cursor));
  return params.toString();
}

/** Why the gym cannot send at all yet, in words. `canSetAddress`: this member of staff
 *  may change the gym's details, so the screen puts a button under the sentence; anybody
 *  else is told who can. */
export function inviteBlockedWords(blocked, words, canSetAddress = true) {
  switch (blocked) {
    case 'no_postal_address':
      return canSetAddress
        ? `Add your ${words.it}'s postal address before you invite anyone. The law requires it in every invitation email.`
        : `Your ${words.it} has no postal address yet, so invitations can't be sent. Ask the owner to add it. The law requires it in every invitation email.`;
    case 'gym_not_on_plan':
      return `Your ${words.it} needs an active plan to send invitations.`;
    case 'gym_archived':
      return `This ${words.it} is closed, so it can't send invitations.`;
    case 'invites_off':
      return MEMBER_INVITE_WORDS.invites_off;
    case 'sending_stopped':
      return MEMBER_INVITE_WORDS.sending_stopped;
    default:
      return null;
  }
}

/** What a person's page offers about the invitation on `today` (the staff member's
 *  'YYYY-MM-DD'): `invite` (never invited, or every email so far was not sent), `again`
 *  (invited; for when the person asks), `under_age` (the list's date of birth says under
 *  18: nothing to press), or null. The server checks everything again on the gym's day. */
export function personInviteAction(entry, today) {
  if (entry.formerAt !== null || entry.inApp || entry.email === null) return null;
  const inv = entry.invitation;
  if (inv !== null && inv.state === 'accepted') return null;
  // The server refuses them whatever the button; the page says why instead.
  if (underAgeOn(entry.dateOfBirth, today)) return 'under_age';
  if (inv === null) return 'invite';
  if (inv.state === 'declined' && inv.notMeAt !== null) return null;
  // A stopped invitation: nothing goes to an address staff said is somebody else's; any
  // other is invited again, asked first (RULINGS 2026-09-26: "Invite again").
  if (inv.state === 'withdrawn') return inv.wrongPersonAt ? null : 'invite_again';
  const email = inv.email;
  if (inv.state === 'pending') {
    if (email === null) return 'invite';
    if (email.state === 'queued' || email.state === 'sending') return null;
    if (email.state === 'skipped' || (email.state === 'failed' && email.reason !== 'send_unknown')) return 'invite';
  }
  return 'again';
}

/** What inviting one person did, in a line for the top of their page. */
export function inviteOutcomeWords(outcome, again) {
  switch (outcome) {
    case 'queued':
      return again ? 'Invitation resent. It will arrive within a few minutes.' : 'Invitation sent. It will arrive within a few minutes.';
    case 'already_invited':
      return 'They have already been invited.';
    case 'already_queued':
      return 'An invitation to them is already being sent.';
    default:
      return null;
  }
}

/** The link in every invitation: it opens the app, and joining still needs a sign-in
 *  with the invited address. */
export function joinLink(origin, slug) {
  return `${origin}/join/${encodeURIComponent(slug)}`;
}

/** The invitation's words, to send another way (WhatsApp, a text, the gym's own email).
 *  They say what the email says: only the invited address gets in. */
export function inviteShareText({ gymName, link, email = null }) {
  const address = email === null ? `the email address ${gymName} has for you` : `this email address, ${email}`;
  return (
    `${gymName} has invited you to AI Home Gym, the app its members use.\n\n` +
    `To join ${gymName} in the app, open this link and sign in with ${address}:\n${link}\n\n` +
    `The invitation works only for someone who signs in with that address.`
  );
}

// ── The form ─────────────────────────────────────────────────────────────────

/** The fields of the form, in the order a person's page shows them. */
export const TEXT_FIELDS = [
  { key: 'fullName', label: 'Name', type: 'text', autoComplete: 'off' },
  { key: 'email', label: 'Email', type: 'email', autoComplete: 'off' },
  { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'off' },
  { key: 'memberNumber', label: 'Member number', type: 'text', autoComplete: 'off' },
];
export const WORD_FIELDS = [
  { key: 'status', label: 'Status', from: 'statuses' },
  { key: 'membershipType', label: 'Membership', from: 'membershipTypes' },
  { key: 'paymentStatus', label: 'Payment status', from: 'paymentStatuses' },
];
export const DAY_FIELDS = [
  { key: 'joinedOn', label: 'Join date' },
  { key: 'endsOn', label: 'End or renewal date' },
  { key: 'dateOfBirth', label: 'Date of birth' },
];
const STANDARD = [...TEXT_FIELDS, ...WORD_FIELDS, ...DAY_FIELDS].map((f) => f.key);

/** What a membership held in the app answers on the list (23a-i): status, membership, the
 *  renewal or end date, and payment. A page that shows the membership itself leaves the
 *  gym's own words for these out, so it never gives two answers (23a-ii): a person's
 *  Details and Edit where the app answers for them, and Add member where the gym has a
 *  price list to pick from. */
export const HELD_ANSWERS = ['status', 'membershipType', 'endsOn', 'paymentStatus'];
/** The app answers for this person: their row reads the memberships they hold here. */
export const appAnswers = (entry) => (entry?.held ?? null) !== null;
/** Add member asks who the person is first: name, email and phone, then their membership. */
export const WHO_FIELDS = ['fullName', 'email', 'phone'];

/** The form's starting values: the person's, or blank for "Add person". */
export function formFrom(entry, fields) {
  const form = { endsOnKind: entry?.endsOnKind ?? 'ends', extra: {} };
  for (const key of STANDARD) form[key] = entry?.[key] ?? '';
  for (const { key } of fields) form.extra[key] = entry?.extra.find((x) => x.key === key)?.value ?? '';
  return form;
}

const tidy = (value) => (typeof value === 'string' ? value.trim() : '');

/** "Add person": every box staff filled in. `without`: the boxes the form does not show,
 *  which send nothing whatever they hold. */
export function inputFrom(form, without = []) {
  const input = {};
  for (const key of STANDARD) {
    if (without.includes(key)) continue;
    const value = tidy(form[key]);
    if (value !== '') input[key] = value;
  }
  if (input.endsOn !== undefined) input.endsOnKind = form.endsOnKind;
  const extra = {};
  for (const [key, value] of Object.entries(form.extra)) if (tidy(value) !== '') extra[key] = tidy(value);
  if (Object.keys(extra).length > 0) input.extra = extra;
  return input;
}

/** "Change": only the boxes staff changed, an emptied box as null, so a field
 *  nobody touched is never sent and never marked as edited by hand. `without`: the boxes
 *  the form does not show, which change nothing. */
export function patchFrom(form, entry, fields, without = []) {
  const patch = {};
  for (const key of STANDARD) {
    if (without.includes(key)) continue;
    const now = tidy(form[key]);
    const was = entry[key] ?? '';
    if (now === was) continue;
    patch[key] = now === '' && key !== 'fullName' ? null : now;
  }
  const endsOn = tidy(form.endsOn);
  if (without.includes('endsOn')) {
    // The date box is not shown, so neither it nor its kind is sent.
  } else if (endsOn === '') {
    if (entry.endsOnKind !== null && patch.endsOn !== undefined) patch.endsOnKind = null;
  } else if (form.endsOnKind !== entry.endsOnKind) {
    patch.endsOnKind = form.endsOnKind;
  }
  const extra = {};
  for (const { key } of fields) {
    const now = tidy(form.extra[key]);
    const was = entry.extra.find((x) => x.key === key)?.value ?? '';
    if (now !== was) extra[key] = now;
  }
  if (Object.keys(extra).length > 0) patch.extra = extra;
  return patch;
}

/** The fields staff changed by hand, in words, for the person's page. */
export function handEditedWords(entry, fields, labels) {
  return entry.handEdited
    .map((name) => {
      if (name.startsWith('extra:')) return fields.find((f) => f.key === name.slice(6))?.label ?? null;
      return labels[name] ?? null;
    })
    .filter((w) => w !== null);
}

/** Merge duplicate's side-by-side view: every field of the two records in the same
 *  order, "—" where a record has none, and whether the two differ, so staff can tell
 *  one person on the list twice from two different people. The gym's custom fields
 *  follow, under their own headings; a detail neither record holds is left out. The two
 *  columns never change places (Kd at 5b-iv-a's click-through: Keep and Remove swapping
 *  sides was "really confusing"): `first` is the record the page is open on. */
export function compareRecords(first, second, fields, person = 'member') {
  const rows = [
    ...DETAILS(person).map(([key, label, read]) => [key, label, heldCell(key, read)]),
    ['app', 'In the app', (r) => (r.inApp ? 'Yes' : 'No')],
    ...fields.map((f) => [`extra:${f.key}`, f.label, (r) => extraOf(r, f.key)]),
  ];
  return rows
    .map(([key, label, read]) => {
      const a = read(first) || null;
      const b = read(second) || null;
      return { key, label, first: a ?? '—', second: b ?? '—', differs: a !== b, empty: a === null && b === null };
    })
    .filter((row) => !row.empty);
}

const extraOf = (r, key) => r.extra?.find((x) => x.key === key)?.value || null;
/** A record the app answers for is compared by what its person holds, as its row and its
 *  own page say it, never by the old file's four words (23a-ii). */
const HELD_CELLS = { status: 'status', membershipType: 'membership', endsOn: 'ends', paymentStatus: 'payment' };
const heldCell = (key, read) => (r) => (HELD_CELLS[key] !== undefined && appAnswers(r) ? rowCells(r)[HELD_CELLS[key]] : read(r));
const DETAILS = (person) => [
  ['fullName', 'Name', (r) => r.fullName || null],
  ['email', 'Email', (r) => r.email],
  ['phone', 'Phone', (r) => r.phone],
  ['memberNumber', 'Member number', (r) => r.memberNumber],
  ['dateOfBirth', 'Date of birth', (r) => (r.dateOfBirth === null ? null : dayWords(r.dateOfBirth))],
  ['joinedOn', 'Join date', (r) => (r.joinedOn === null ? null : dayWords(r.joinedOn))],
  ['status', 'Status', (r) => r.status],
  ['membershipType', 'Membership', (r) => r.membershipType],
  ['endsOn', 'End or renewal date', (r) => endsWords(r)],
  ['paymentStatus', 'Payment status', (r) => r.paymentStatus],
  ['list', 'On the list', (r) => (r.formerAt === null ? 'On the list' : `Past ${person}`)],
];

/** THE ONE RECORD A MERGE LEAVES, before staff press Merge: the server's own rule
 *  (RULINGS 2026-09-23, `MEMBER_LIST_MERGE_KEEPS_OWN` and `MEMBER_LIST_MERGE_FILLS`). The
 *  kept record's name, email, phone and member number stay as they are; each other detail
 *  and custom field is its own, or the other record's where its own is empty
 *  (`fromOther`); it is on the list if either was. `lost` is what the removed record holds
 *  that the merge does not keep, each with its reason in one line. Whether anybody is in the
 *  app is left out: the server says so itself when a merge would leave someone off the list. */
export function mergePreview(keep, remove, fields, person = 'member') {
  const rows = [];
  const lost = [];
  const read = Object.fromEntries(DETAILS(person).map(([key, label, get]) => [key, { label, get }]));
  const say = (v) => v || null;
  for (const key of MEMBER_LIST_MERGE_KEEPS_OWN) {
    const { label, get } = read[key];
    const own = say(get(keep));
    const other = say(get(remove));
    if (own !== null) rows.push({ key, label, value: own, fromOther: false });
    if (other !== null && other !== own) {
      lost.push({
        key,
        label,
        value: other,
        why: own === null ? `The kept record's name, email, phone and member number are never changed by a merge.` : `The kept record keeps its own ${label.toLowerCase()}.`,
      });
    }
  }
  for (const key of MEMBER_LIST_MERGE_FILLS) {
    const { label, get } = read[key];
    const own = say(get(keep));
    const other = say(get(remove));
    if (keep[key] === null && remove[key] !== null) rows.push({ key, label, value: other, fromOther: true });
    else if (own !== null) rows.push({ key, label, value: own, fromOther: false });
    if (keep[key] !== null && other !== null && other !== own) lost.push({ key, label, value: other, why: `The kept record keeps its own ${label.toLowerCase()}.` });
  }
  for (const f of fields) {
    const key = `extra:${f.key}`;
    const own = extraOf(keep, f.key);
    const other = extraOf(remove, f.key);
    if (own === null && other !== null) rows.push({ key, label: f.label, value: other, fromOther: true });
    else if (own !== null) rows.push({ key, label: f.label, value: own, fromOther: false });
    if (own !== null && other !== null && other !== own) lost.push({ key, label: f.label, value: other, why: `The kept record keeps its own ${f.label}.` });
  }
  rows.push({ key: 'list', label: 'On the list', value: keep.formerAt === null || remove.formerAt === null ? 'On the list' : `Past ${person}`, fromOther: false });
  // Where the app answers for either person, the old file's four words are not said here
  // either (23a-ii): the comparison above says what each holds, and a merge moves
  // memberships with their records.
  if (!appAnswers(keep) && !appAnswers(remove)) return { rows, lost, memberships: false };
  const said = (row) => !HELD_ANSWERS.includes(row.key);
  return { rows: rows.filter(said), lost: lost.filter(said), memberships: true };
}

/** What a write did, in a line for the top of the person's page. */
export function outcomeWords(outcome, words = { person: 'member', personCap: 'Member', people: 'members' }, app = undefined) {
  switch (outcome) {
    case 'added':
      return `${words.personCap} added.`;
    case 'revived':
      return `They were a past ${words.person} and are back on your list.`;
    case 'already_on_list':
      return 'They are already on your list.';
    case 'changed':
      return 'Changes saved.';
    case 'unchanged':
      return 'No changes to save.';
    case 'taken_off':
      return `Moved to past ${words.people}. Their details are kept.`;
    case 'removed_from_app':
      return `App access removed. They remain a past ${words.person}.`;
    case 'not_them':
      return 'App access removed. Nothing more is sent to that email address: update it with Edit before inviting again.';
    case 'already_taken_off':
      return `They are already a past ${words.person}.`;
    case 'restored':
      // Put back undoes both (RULINGS 2026-09-27), when the plan has a place for it.
      if (app === 'back') return 'Put back on your list, with their app access.';
      if (app === 'no_place') return "Put back on your list. Their app access wasn't given back because your plan has no free place: invite them again when one is free.";
      return 'Put back on your list.';
    case 'merged':
      return 'Records merged. This is the record you kept.';
    default:
      return null;
  }
}

// ── Review needed (5b-v-d-iv; RULINGS 2026-09-29) ──────────────────────────

/** The Members sign: "3 members need review", "1 member needs review". */
export function reviewSignWords(n, words) {
  return n === 1 ? `1 ${words.person} needs review` : `${n.toLocaleString('en')} ${words.people} need review`;
}

// ── Possible duplicates (5b-iv-a; RULINGS 2026-09-25, 2026-09-30) ──────────

/** The Members sign and the page's count: what is counted is PAIRS, so it says pairs
 *  ("possible duplicates", as HubSpot's tool does). Three records of one name are three
 *  pairs, and "3 members may be on your list twice" would be false. */
export function duplicatesSignWords(n) {
  return n === 1 ? '1 possible duplicate' : `${n.toLocaleString('en')} possible duplicates`;
}

/** Past the pairs kept ready (MEMBER_LIST_DUPLICATES_KEPT): which ones this page lists, and
 *  that the rest follow. */
export function duplicatesKeptWords(kept, total) {
  return `Showing the first ${kept.toLocaleString('en')} of ${total.toLocaleString('en')}. Merge them or choose Different people, and the next ones will show here.`;
}

/** What a pair's two records share: "Same name", "Same name and phone". */
export function pairWhyWords(pair) {
  const what = [pair.sameName ? 'name' : null, pair.samePhone ? 'phone' : null, pair.sameMemberNumber ? 'member number' : null].filter((w) => w !== null);
  if (what.length === 0) return '';
  const last = what.pop();
  return `Same ${what.length === 0 ? last : `${what.join(', ')} and ${last}`}`;
}

// ── Tags on the list (5d-ii; spec Part 3 §18.13) ──

/** The tag chips the Filter shows: the gym's tags somebody in this view holds, each with
 *  that count, and the one ticked even when nobody holds it now. */
export function tagChips(gymTags, filters) {
  const past = filters.records === 'former';
  return gymTags
    .map((tag) => ({ id: tag.id, name: tag.name, count: past ? tag.pastPeople : tag.people }))
    .filter((tag) => tag.count > 0 || filters.tag?.id === tag.id);
}

/** Tick a tag, or untick the one ticked: one tag at a time. */
export function toggleTag(filters, tag) {
  return { ...filters, tag: filters.tag?.id === tag.id ? null : { id: tag.id, name: tag.name } };
}

/** The filters after the gym's tags changed: a deleted tag is no longer a filter, and a
 *  renamed one shows its new name. The same object when nothing changed. */
export function filtersWithTags(filters, gymTags) {
  if (filters.tag === null) return filters;
  const now = gymTags.find((tag) => tag.id === filters.tag.id);
  if (now === undefined) return { ...filters, tag: null };
  return now.name === filters.tag.name ? filters : { ...filters, tag: { id: now.id, name: now.name } };
}

/** "12 members", "1 member and 2 past members", "nobody": who holds one of the gym's tags. */
export function tagHolders(tag, words) {
  const parts = [];
  if (tag.people > 0) parts.push(`${n(tag.people)} ${tag.people === 1 ? words.person : words.people}`);
  if (tag.pastPeople > 0) parts.push(`${n(tag.pastPeople)} past ${tag.pastPeople === 1 ? words.person : words.people}`);
  return parts.length === 0 ? 'nobody' : parts.join(' and ');
}

const people = (k) => (k === 1 ? '1 person' : `${n(k)} people`);

/** The box before a tag is added or taken off: its heading for who changes, its button,
 *  and one line for each group that won't change. */
export function tagBoxWords(preview) {
  const k = preview.changeCount;
  const add = preview.action === 'add';
  const name = preview.tag.name;
  const lines = {
    has_it: 'Already have this tag.',
    not_on_them: "Don't have this tag.",
    full: `Already have ${String(MEMBER_TAGS_MAX_PER_PERSON)} tags or more, the most one person can have. Take a tag off them first.`,
    gone: 'No longer on your list.',
  };
  const kept = preview.kept.reduce((sum, group) => sum + group.count, 0);
  return {
    heading: k === 0 ? null : add ? `${people(k)} will get the tag “${name}”` : `${people(k)} will lose the tag “${name}”`,
    nobody: add ? `Nobody you selected can get the tag “${name}”.` : `Nobody you selected has the tag “${name}”.`,
    button: k === 0 ? null : add ? `Add tag to ${people(k)}` : `Take tag off ${people(k)}`,
    keptHeading: kept === 0 ? null : `${n(kept)} won't change`,
    kept: preview.kept.map((group) => ({ key: group.reason, count: group.count, people: group.people, line: lines[group.reason] })),
    newTag: add && preview.tag.id === null ? `“${name}” is a new tag for your gym.` : null,
  };
}

/** What a press did: "“VIP” added to 12 people. 2 didn't change." */
export function tagDoneLine(done) {
  const kept = done.kept.reduce((sum, group) => sum + group.count, 0);
  const did = done.action === 'add' ? `“${done.tag.name}” added to ${people(done.changed)}.` : `“${done.tag.name}” taken off ${people(done.changed)}.`;
  return kept === 0 ? did : `${did} ${n(kept)} didn't change.`;
}

// ── A MESSAGE TO THE PEOPLE SELECTED (20f-i) ──

/** The box before a message goes: who gets it, its button, one line for each group that
 *  won't get it, and how many more the gym can send today. */
export function messageBoxWords(preview) {
  const k = preview.sendCount;
  const lines = {
    not_in_app: 'Not in the app yet. Messages are read in the app.',
    switched_off: 'Switched your messages off in their app.',
    shared: "Two app accounts are on this one person's page, so we can't tell whose inbox it is. Open their page to see both.",
    former: 'No longer a member.',
    gone: 'No longer on your list.',
  };
  const kept = preview.kept.reduce((sum, group) => sum + group.count, 0);
  const left = preview.leftToday;
  return {
    heading: k === 0 ? null : `${people(k)} will get this message`,
    nobody: 'Nobody you selected can get a message.',
    button: k === 0 || left === 0 ? null : `Send to ${people(k)}`,
    keptHeading: kept === 0 ? null : `${people(kept)} won't get it`,
    kept: preview.kept.map((group) => ({ key: group.reason, count: group.count, people: group.people, line: lines[group.reason] })),
    // What each reason opens, for staff to set it right (L7): Invite, or the person's page.
    invite: 'Invite them to the app',
    today:
      left === 0
        ? GYM_GROUP_MESSAGE_WORDS.day_full
        : left === 1
          ? 'You can send 1 more message to a group today.'
          : `You can send ${String(left)} more messages to groups today.`,
    full: left === 0,
  };
}

/** What a press did: "Message sent to 12 people. 2 didn't get it." */
export function messageDoneLine(done) {
  const kept = done.kept.reduce((sum, group) => sum + group.count, 0);
  const did = `Message sent to ${people(done.sent)}.`;
  return kept === 0 ? did : `${did} ${n(kept)} didn't get it.`;
}

/** When a message was sent, on the gym's own calendar and clock: "9 October 2026, 12:00"
 *  or "9 October 2026, 12:00 PM". */
export function sentWhen(iso, timeZone, clockFormat) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const options = { hour: '2-digit', minute: '2-digit', hour12: clockFormat === '12h' };
  let time;
  try {
    time = at.toLocaleTimeString(clockFormat === '12h' ? 'en-US' : 'en-GB', timeZone ? { ...options, timeZone } : options);
  } catch {
    time = at.toLocaleTimeString(clockFormat === '12h' ? 'en-US' : 'en-GB', options);
  }
  // "09:05 PM" reads as a 24-hour time at a glance: "9:05 PM".
  return `${noteDay(iso, timeZone)}, ${clockFormat === '12h' ? time.replace(/^0/, '') : time}`;
}

/** The gym's own calendar day of an instant, "2026-10-09". */
function gymDay(at, timeZone) {
  try {
    return at.toLocaleDateString('en-CA', timeZone ? { timeZone } : {});
  } catch {
    return at.toLocaleDateString('en-CA');
  }
}

/** The time a message was sent, on the gym's clock: "12:05" or "12:05 PM". */
export function sentTime(iso, timeZone, clockFormat) {
  const whole = sentWhen(iso, timeZone, clockFormat);
  return whole === '' ? '' : whole.slice(whole.lastIndexOf(', ') + 2);
}

/** The sent messages under a heading for each day of the gym's calendar, in the order
 *  given: "Today", "Yesterday", then "7 October" (with the year when it is not this one). */
export function sentByDay(messages, timeZone, now = new Date()) {
  const today = gymDay(now, timeZone);
  const yesterday = gymDay(new Date(now.getTime() - 86_400_000), timeZone);
  const days = [];
  for (const one of messages) {
    const at = new Date(one.sentAt);
    const key = Number.isNaN(at.getTime()) ? '' : gymDay(at, timeZone);
    let last = days[days.length - 1];
    if (last === undefined || last.key !== key) {
      const full = noteDay(one.sentAt, timeZone);
      const heading = key === today ? 'Today' : key === yesterday ? 'Yesterday' : key.slice(0, 4) === today.slice(0, 4) ? full.replace(/ \d{4}$/, '') : full;
      last = { key, heading, messages: [] };
      days.push(last);
    }
    last.messages.push(one);
  }
  return days;
}

/** "Nora Owner" → "NO"; one name → its first two letters; nothing → "". */
export function initialsOf(name) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = [...(parts[0] ?? '')];
  if (parts.length === 1) return first.slice(0, 2).join('').toUpperCase();
  return ((first[0] ?? '') + ([...(parts[parts.length - 1] ?? '')][0] ?? '')).toUpperCase();
}

/** The line at the top of Sent messages: how many more can go today. */
export function sentTodayWords(left) {
  if (left === 0) return GYM_GROUP_MESSAGE_WORDS.day_full;
  return left === 1 ? 'You can send 1 more message to a group today.' : `You can send ${String(left)} more messages to groups today.`;
}

/** The line in the box of names for the people who cannot be named any more. */
export function sentGoneWords(gone) {
  return gone === 1
    ? "1 more person got it and has since deleted their account, so we can't name them."
    : `${n(gone)} more people got it and have since deleted their accounts, so we can't name them.`;
}

/** "Sent to 1 person", "Sent to 1,200 people". */
export function sentToWords(count) {
  return `Sent to ${people(count)}`;
}

/** "120 of 500". */
export function messageCount(typed) {
  return `${n(groupMessageLength(typed))} of ${n(GYM_MESSAGE_BODY_MAX)}`;
}
