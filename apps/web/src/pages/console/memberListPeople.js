import { MEMBER_INVITE_EMAIL_REASON_WORDS, MEMBER_INVITE_EMAIL_RESULT_WORDS, MEMBER_INVITE_WORDS } from '@app/shared';
import { dayWords } from './memberListView';

// The gym's own list on the Members screen (ROADMAP 5b-i; spec Part 3 §9.14, §11.5,
// §11.6): what a row and a person's page say, and what a filter or a form sends. The
// server decides everything; these only turn its answers into words and staff's
// choices into a request.

/** The kinds of chip, each one of the gym's own lists of words. */
export const CHIP_KINDS = [
  { kind: 'status', from: 'statuses', title: 'Status', none: 'No status' },
  { kind: 'membershipType', from: 'membershipTypes', title: 'Membership', none: 'No membership' },
  { kind: 'paymentStatus', from: 'paymentStatuses', title: 'Payment', none: 'No payment status' },
];

export const EMPTY_FILTERS = {
  records: 'current',
  app: 'all',
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
    if (filters.app !== 'all') params.append('filter', filters.app);
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
  if (filters.app !== 'all') {
    out.push({ key: 'app', text: filters.app === 'in_app' ? 'In the app' : 'Not in the app', without: { ...filters, app: 'all' } });
  }
  return out;
}

export function filtersAreEmpty(filters) {
  return (
    filters.app === 'all' &&
    filters.query.trim() === '' &&
    CHIP_KINDS.every(({ kind }) => filters[kind].length === 0)
  );
}

/** "3 October 2026" from a timestamp, in the reader's own calendar. */
export function whenWords(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The end or renewal date in the heading's own word. */
export function endsWords(entry) {
  if (entry.endsOn === null) return null;
  return `${entry.endsOnKind === 'renews' ? 'Renews' : 'Ends'} ${dayWords(entry.endsOn)}`;
}

/** The row's second line: the gym's own words about the person. */
export function rowWords(entry) {
  if (entry.formerAt !== null) return [`Removed from list ${whenWords(entry.formerAt)}`];
  return [entry.status, entry.membershipType, endsWords(entry)].filter((w) => w !== null && w !== '');
}

export function contactWords(entry) {
  return entry.email ?? entry.phone ?? 'No email or phone';
}

/** Where the person stands with the app, as a short tag and, when something went
 *  wrong with an email, the server's own sentence about it. */
export function invitationView(entry) {
  const inv = entry.invitation;
  if (entry.inApp) return { tag: 'Uses the app', tone: 'green', detail: null };
  if (inv === null) {
    if (entry.formerAt !== null) return null;
    return entry.email === null
      ? { tag: 'No email', tone: 'plain', detail: null }
      : { tag: 'Not invited', tone: 'plain', detail: null };
  }
  if (inv.state === 'accepted') return { tag: 'Joined', tone: 'green', detail: null };
  if (inv.state === 'declined') {
    return inv.notMeAt !== null
      ? { tag: 'Said "Not me"', tone: 'red', detail: MEMBER_INVITE_WORDS.said_not_me }
      : { tag: 'Declined', tone: 'plain', detail: null };
  }
  if (inv.state === 'withdrawn') return { tag: 'Invitation stopped', tone: 'plain', detail: null };
  if (inv.waitingSince !== null) return { tag: 'Waiting for a place', tone: 'orange', detail: null };
  const email = inv.email;
  const invited = `Invited ${whenWords(inv.invitedAt)}`;
  if (email === null) return { tag: invited, tone: 'plain', detail: null };
  if (email.state === 'queued' || email.state === 'sending') return { tag: 'Invited · email waiting to go', tone: 'plain', detail: null };
  if (email.state === 'sent') {
    if (email.result === null || email.result === 'delivered') return { tag: invited, tone: 'plain', detail: null };
    return { tag: "Invited · email didn't arrive", tone: 'orange', detail: MEMBER_INVITE_EMAIL_RESULT_WORDS[email.result] };
  }
  const detail = email.reason === null ? null : MEMBER_INVITE_EMAIL_REASON_WORDS[email.reason];
  return { tag: 'Invited · email not sent', tone: 'orange', detail };
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
      return 'Removed from your list. The record is kept as a past member.';
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
