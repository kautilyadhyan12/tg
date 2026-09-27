import { MEMBER_APP_FILTER_ORDER, MEMBER_APP_FILTER_WORDS, MEMBER_APP_WORDS, MEMBER_INVITE_WORDS, turns18On, underAgeOn } from '@app/shared';
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
  const query = filters.query.trim();
  if (query !== '') params.append('query', query);
  if (cursor) params.append('cursor', cursor);
  return params.toString();
}

/** What is ticked, one pill each for the "Showing:" line, each with the filters as
 *  they would be without it. The search is not here: it has its own box. */
export function activeFilters(filters, words) {
  if (filters.records === 'former') {
    return [{ key: 'records', text: `Past ${words.people}`, without: { ...filters, records: 'current' } }];
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
  return out;
}

export function filtersAreEmpty(filters) {
  return (
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

/** What the list says today about somebody an import leaves out, in the gym's own words —
 *  "Cancelled · Gold · Ended 31 Aug · Unpaid" — and how they came onto the list when it
 *  was not an import ("Added by hand · 20 Sep"), so staff can tell who has left (Kd,
 *  2026-09-27: "how can a gym simply decide they are member or have left just by looking
 *  at names"). */
export function goneWords(person, today = null) {
  const on = person.onList;
  const facts = [person.wasStatus, on.membershipType, endsWords(on, today), on.paymentStatus].filter((w) => w !== null && w !== '');
  const when = shortWhen(on.addedAt, today);
  const added = on.source === 'typed' ? `Added by hand · ${when}` : on.source === 'member' ? `Added when they joined the app · ${when}` : null;
  return { facts: facts.join(' · '), added };
}

/** When somebody the list says is under 18 can be invited, and what to do if the date
 *  is wrong (Kd, 2026-09-27: "now if gyms update can they join?"). */
export function underAgeWhen(dateOfBirth) {
  const from = dateOfBirth === null ? null : turns18On(dateOfBirth);
  const fix = 'If the date of birth is wrong, press Edit to change it.';
  return from === null ? fix : `They can be invited from ${dayWords(from)}, when they turn 18. ${fix}`;
}

/** The day someone became a past member, "3 Sep 2026", or null. */
export function pastSince(entry) {
  const day = entry.formerAt === null ? null : localDay(entry.formerAt);
  return day === null ? null : shortDay(day);
}

/** "Past member since 3 Sep 2026" (spec Part 3 §18.3). */
export function pastWords(entry) {
  const since = pastSince(entry);
  return since === null ? null : `Past member since ${since}`;
}

/** The gym's own words about the person in one line, as a phone's row shows them. */
export function rowWords(entry, today = null) {
  if (entry.formerAt !== null) return [pastWords(entry)].filter((w) => w !== null);
  return [entry.status, entry.membershipType, endsWords(entry, today), entry.paymentStatus].filter((w) => w !== null && w !== '');
}

export function contactWords(entry) {
  return entry.email ?? entry.phone ?? 'No email or phone';
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
  return { tag: view.text, tone, detail: view.note, line: view.plain };
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

/** The press: the same words, the version and number the count showed, so a list that
 *  moved in between invites nobody, and staff's permission tick. */
export function inviteBody(filters, preview, permissionConfirmed) {
  const body = { version: preview.version, expectedCount: preview.reach, permissionConfirmed };
  for (const { kind } of CHIP_KINDS) if (filters[kind].length > 0) body[kind] = [...filters[kind]];
  return body;
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
    ? "Only Status, Membership and Payment choose who is invited. The search and the app filter don't."
    : null;
}

/** Who an Invite leaves out, one line a reason, in the server's order; none for a zero. */
export function skippedLines(skipped) {
  const lines = [
    ['noEmail', skipped.noEmail, (k) => `${n(k)} ${k === 1 ? 'has' : 'have'} no email address`],
    ['underAge', skipped.underAge, (k) => `${n(k)} ${k === 1 ? 'is' : 'are'} under 18 by the date of birth on your list`],
    ['inApp', skipped.inApp, (k) => `${n(k)} already ${k === 1 ? 'uses' : 'use'} the app`],
    ['alreadyInvited', skipped.alreadyInvited, (k) => `${n(k)} ${k === 1 ? 'was' : 'were'} invited before, or ${k === 1 ? 'shares' : 'share'} an email with someone who was`],
    ['unsubscribed', skipped.unsubscribed, (k) => `${n(k)} asked not to get your emails`],
    ['bounced', skipped.bounced, (k) => (k === 1 ? '1 has an address that bounces' : `${n(k)} have addresses that bounce`)],
    ['refused', skipped.refused, (k) => `${n(k)} ${k === 1 ? 'has an address' : 'have addresses'} our email service won't deliver to`],
    ['sharedAddress', skipped.sharedAddress, (k) => `${n(k)} ${k === 1 ? 'has a shared address' : 'have shared addresses'} such as info@`],
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
  const group = chosen ? 'you chose' : 'on your list';
  let gets;
  if (total === 0) gets = chosen ? 'Nobody on your list matches what you chose.' : 'Nobody is on your list yet.';
  else if (total === 1) gets = `The 1 ${words.person} ${group} ${preview.reach === 1 ? 'will' : "won't"} get an email invitation.`;
  else if (preview.reach === total) gets = `All ${n(total)} ${words.people} ${group} will get an email invitation.`;
  else if (preview.reach === 0) gets = `None of the ${n(total)} ${words.people} ${group} will get an email invitation.`;
  else gets = `${n(preview.reach)} of the ${n(total)} ${words.people} ${group} will get an email invitation.`;
  const wont = leftOut === 0 || preview.reach === 0 ? null : `${n(leftOut)} won't.`;
  return { gets, wont, leftOut };
}

/** Why Invite leaves one person out, in the words their own row and page use (§18.4,
 *  §18.6), and what staff can do about it, when there is something. */
export function inviteWhyNot(person, today = null) {
  switch (person.reason) {
    case 'noEmail':
      return { text: 'No email address', hint: 'Add one on their page to invite them.' };
    case 'underAge':
      return {
        text: person.turns18On === null ? 'Under 18' : `Under 18 · can be invited from ${shortDay(person.turns18On, today)}`,
        hint: 'If the date of birth is wrong, change it on their page.',
      };
    case 'inApp':
      return person.app.word === 'in_app'
        ? { text: 'Already in the app', hint: null }
        : { text: person.app.line ?? 'Someone else uses the app with this email.', hint: 'Give them their own email address to invite them.' };
    case 'alreadyInvited': {
      if (person.sameAddressAs !== null) {
        return { text: `Same email as ${person.sameAddressAs}, who gets this invitation`, hint: 'Give them their own email address to invite them too.' };
      }
      const view = appView(person.app, today);
      return { text: view.note ?? view.plain ?? 'Invited before', hint: person.app.word === 'invited' ? 'To send it again, open their page.' : null };
    }
    case 'unsubscribed':
      return { text: 'Unsubscribed from your emails', hint: null };
    case 'bounced':
      return { text: 'Emails to this address bounce', hint: 'Check the address with them.' };
    case 'refused':
      return { text: "Our email service won't deliver to this address", hint: 'Check the address with them.' };
    case 'sharedAddress':
      return { text: 'A shared address, such as info@', hint: 'Add their own email to invite them.' };
    default:
      return { text: 'Not sent', hint: null };
  }
}

/** Invite's list query: the gym's words, the group, and where the last page ended. */
export function invitePeopleQuery(filters, group, cursor = null) {
  const params = new URLSearchParams(inviteQueryString(filters));
  params.set('group', group);
  if (cursor !== null) params.set('cursor', String(cursor));
  return params.toString();
}

/** Why the gym cannot send at all yet, in words. */
export function inviteBlockedWords(blocked, words) {
  switch (blocked) {
    case 'no_postal_address':
      return `Add your ${words.it}'s postal address in Settings first. Every invitation shows it, as the law requires.`;
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
      return again ? 'Invitation sent again. It goes out within a few minutes.' : 'Invited. The email goes out within a few minutes.';
    case 'already_invited':
      return 'This person was already invited.';
    case 'already_queued':
      return 'An email to them is already waiting to go.';
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

/** The form's starting values: the person's, or blank for "Add person". */
export function formFrom(entry, fields) {
  const form = { endsOnKind: entry?.endsOnKind ?? 'ends', extra: {} };
  for (const key of STANDARD) form[key] = entry?.[key] ?? '';
  for (const { key } of fields) form.extra[key] = entry?.extra.find((x) => x.key === key)?.value ?? '';
  return form;
}

const tidy = (value) => (typeof value === 'string' ? value.trim() : '');

/** "Add person": every box staff filled in. */
export function inputFrom(form) {
  const input = {};
  for (const key of STANDARD) {
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
 *  nobody touched is never sent and never marked as edited by hand. */
export function patchFrom(form, entry, fields) {
  const patch = {};
  for (const key of STANDARD) {
    const now = tidy(form[key]);
    const was = entry[key] ?? '';
    if (now === was) continue;
    patch[key] = now === '' && key !== 'fullName' ? null : now;
  }
  const endsOn = tidy(form.endsOn);
  if (endsOn === '') {
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
 *  follow, under their own headings; a detail neither record holds is left out. */
export function compareRecords(keep, remove, fields) {
  const day = (d) => (d === null ? null : dayWords(d));
  const onList = (r) => (r.formerAt === null ? 'On the list' : 'Past member');
  const extra = (r, key) => r.extra?.find((x) => x.key === key)?.value || null;
  const rows = [
    ['fullName', 'Name', (r) => r.fullName || null],
    ['email', 'Email', (r) => r.email],
    ['phone', 'Phone', (r) => r.phone],
    ['memberNumber', 'Member number', (r) => r.memberNumber],
    ['dateOfBirth', 'Date of birth', (r) => day(r.dateOfBirth)],
    ['joinedOn', 'Join date', (r) => day(r.joinedOn)],
    ['status', 'Status', (r) => r.status],
    ['membershipType', 'Membership', (r) => r.membershipType],
    ['endsOn', 'End or renewal date', (r) => endsWords(r)],
    ['paymentStatus', 'Payment status', (r) => r.paymentStatus],
    ['list', 'On the list', onList],
    ['app', 'Uses the app', (r) => (r.inApp ? 'Yes' : 'No')],
    ...fields.map((f) => [`extra:${f.key}`, f.label, (r) => extra(r, f.key)]),
  ];
  return rows
    .map(([key, label, read]) => {
      const k = read(keep) || null;
      const r = read(remove) || null;
      return { key, label, keep: k ?? '—', remove: r ?? '—', differs: k !== r, empty: k === null && r === null };
    })
    .filter((row) => !row.empty);
}

/** What a write did, in a line for the top of the person's page. */
export function outcomeWords(outcome) {
  switch (outcome) {
    case 'added':
      return 'Added to your list.';
    case 'revived':
      return 'This person was a past member, and is back on your list.';
    case 'already_on_list':
      return 'This person is already on your list.';
    case 'changed':
      return 'Saved.';
    case 'unchanged':
      return 'Nothing changed.';
    case 'taken_off':
      return "Removed. They're a past member now, and their details are kept.";
    case 'removed_from_app':
      return 'Removed from the app. Their record stays with your past members.';
    case 'not_them':
      return 'Taken out of the app. Check the email address on this record, then invite them again.';
    case 'already_taken_off':
      return 'This person was already removed from your list.';
    case 'restored':
      return 'Back on your list.';
    case 'merged':
      return 'Merged. This is the record you kept.';
    default:
      return null;
  }
}
