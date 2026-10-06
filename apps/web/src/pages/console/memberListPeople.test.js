// The gym's own list on the Members screen (ROADMAP 5b-i): what a filter sends, what a
// row says about an invitation, and what a form sends back.
import { describe, expect, it } from 'vitest';
import {
  MEMBER_APP_WORDS,
  memberInvitePreviewQuerySchema,
  memberInviteRequestSchema,
  memberListEntryDetailSchema,
  memberListEntriesQuerySchema,
  memberListFilterSchema,
} from '@app/shared';
import {
  EMPTY_FILTERS,
  activeFilters,
  appView,
  compareRecords,
  mergePreview,
  entriesQueryString,
  formFrom,
  goneWords,
  gymToday,
  handEditedWords,
  inputFrom,
  invitationView,
  inviteBody,
  inviteQueryString,
  matchDetailWords,
  mayBeOnListWords,
  patchFrom,
  personInviteAction,
  pageTickState,
  rowCells,
  rowWords,
  selectedInviteSummary,
  selectionFilter,
  skippedLines,
  toggleApp,
  toggleWord,
  untickFromAll,
} from './memberListPeople';
import { FIELD_LABELS } from './memberListView';
import CONTRACT from '../../../../../packages/shared/test/fixtures/mergeContract.json';

const FIELDS = [
  { key: 'locker', label: 'Locker' },
  { key: 'notes_2', label: 'Coach' },
];

const entry = (over = {}) =>
  memberListEntryDetailSchema.parse({
    entryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fullName: 'Ada Lovelace',
    email: 'ada@members.example',
    phone: '+447700900123',
    memberNumber: null,
    status: 'Active',
    membershipType: 'Gold',
    joinedOn: '2025-01-04',
    endsOn: '2026-10-03',
    endsOnKind: 'renews',
    paymentStatus: null,
    dateOfBirth: null,
    formerAt: null,
    source: 'upload',
    inApp: false,
    invitation: null,
    app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' },
    extra: [{ key: 'locker', label: 'Locker', value: '12' }],
    handEdited: [],
    members: [],
    ...over,
  });

/** Read a query string back the way the server does: repeated keys become a list. */
function serverReads(qs) {
  const out = {};
  for (const [k, v] of new URLSearchParams(qs)) {
    if (k in out) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return memberListEntriesQuerySchema.parse(out);
}

describe('the query a filter sends', () => {
  it('sends nothing for the whole list', () => {
    expect(entriesQueryString(EMPTY_FILTERS)).toBe('');
  });

  it('sends a word ticked twice as two keys, which the server reads as a list', () => {
    let f = toggleWord(EMPTY_FILTERS, 'status', 'Active');
    f = toggleWord(f, 'status', 'Frozen');
    expect(serverReads(entriesQueryString(f)).status).toEqual(['Active', 'Frozen']);
  });

  it('sends "no status" as an empty value, which is how the server names the people with none', () => {
    const f = toggleWord(EMPTY_FILTERS, 'status', '');
    expect(entriesQueryString(f)).toBe('status=');
    expect(serverReads(entriesQueryString(f)).status).toBe('');
  });

  it('unticks a word ticked in another case or spacing, as the server folds them', () => {
    const f = toggleWord(toggleWord(EMPTY_FILTERS, 'status', 'Active'), 'status', ' active ');
    expect(f.status).toEqual([]);
  });

  it('keeps the three kinds apart and sends the App words and the search', () => {
    let f = toggleWord(EMPTY_FILTERS, 'membershipType', 'Gold');
    f = toggleWord(f, 'paymentStatus', 'Overdue');
    f = { ...toggleApp(toggleApp(f, 'invited'), 'needs_check'), query: '  ada ' };
    expect(serverReads(entriesQueryString(f))).toEqual({
      app: ['invited', 'needs_check'],
      membershipType: 'Gold',
      paymentStatus: 'Overdue',
      query: 'ada',
    });
    expect(toggleApp(f, 'invited').app).toEqual(['needs_check']);
  });

  it('asks for past members only, and never mixes in chips that count the current list', () => {
    const f = { ...toggleWord(EMPTY_FILTERS, 'status', 'Active'), app: ['in_app'], records: 'former' };
    expect(serverReads(entriesQueryString(f))).toEqual({ records: 'former' });
  });

  it('passes the cursor back as it came', () => {
    expect(serverReads(entriesQueryString(EMPTY_FILTERS, 'opaque:1')).cursor).toBe('opaque:1');
  });
});

describe("how a row shows the server's App word (spec Part 3 §18.4)", () => {
  const app = (over) => ({ at: null, line: null, lineTone: 'plain', ...over });
  const TODAY = '2026-09-27';

  it.each([
    ['in the app', app({ word: 'in_app', tone: 'green' }), { text: 'In the app', tag: 'c-tag-good', plain: null, note: null }],
    [
      'in the app under another name: a line to check, under the row',
      app({ word: 'in_app', tone: 'green', line: 'Signed up in the app as Dan Wu. Check this is them.', lineTone: 'amber' }),
      { text: 'In the app', tag: 'c-tag-good', plain: null, note: 'Signed up in the app as Dan Wu. Check this is them.' },
    ],
    [
      'wrong email: a red line to check',
      app({ word: 'not_in_app', tone: 'grey', line: 'Whoever gets email at x says they are not Jacob.', lineTone: 'red' }),
      { text: 'Not in the app', tag: 'c-tag-plain', plain: null, note: 'Whoever gets email at x says they are not Jacob.' },
    ],
    [
      'removed, the day on their page',
      app({ word: 'not_in_app', tone: 'grey', line: 'Removed from app', at: '2026-09-26T09:30:00.000Z' }),
      { text: 'Not in the app', tag: 'c-tag-plain', plain: 'Removed from app · 26 Sep', note: null },
    ],
    [
      'invited, the day on their page',
      app({ word: 'invited', tone: 'grey', line: 'Invitation sent', at: '2026-09-22T10:00:00.000Z' }),
      { text: 'Invited', tag: 'c-tag-plain', plain: 'Invitation sent · 22 Sep', note: null },
    ],
    ['no email, on their page', app({ word: 'not_in_app', tone: 'grey', line: 'No email address' }), { text: 'Not in the app', tag: 'c-tag-plain', plain: 'No email address', note: null }],
    [
      'an email that went and did not arrive: an amber line to check',
      app({ word: 'invited', tone: 'grey', line: "This email bounced: the address doesn't take email. Check it with the person.", lineTone: 'amber' }),
      { text: 'Invited', tag: 'c-tag-plain', plain: null, note: "This email bounced: the address doesn't take email. Check it with the person." },
    ],
    [
      'an invitation email that never went: not in the app, with an amber line to check',
      app({ word: 'not_in_app', tone: 'grey', line: "The invitation email wasn't sent: emails to this address bounce.", lineTone: 'amber' }),
      { text: 'Not in the app', tag: 'c-tag-plain', plain: null, note: "The invitation email wasn't sent: emails to this address bounce." },
    ],
    [
      'a removal last year keeps its year',
      app({ word: 'not_in_app', tone: 'grey', line: 'Removed from app', at: '2025-03-02T12:00:00.000Z' }),
      { text: 'Not in the app', tag: 'c-tag-plain', plain: 'Removed from app · 2 Mar 2025', note: null },
    ],
  ])('%s', (_name, given, expected) => {
    const view = appView(given, TODAY);
    expect({ text: view.text, tag: view.tag, plain: view.plain, note: view.note }).toEqual(expected);
  });

  it('each of the three words has its own text and a tag colour', () => {
    for (const word of ['in_app', 'invited', 'not_in_app']) {
      for (const tone of ['green', 'amber', 'red', 'grey']) {
        const view = appView(app({ word, tone }), TODAY);
        expect(view.text, word).toBe(MEMBER_APP_WORDS[word]);
        expect(view.tag, `${word} ${tone}`).toMatch(/^c-tag-(good|warn|bad|plain)$/);
      }
    }
  });

  it("a person's page reads the same word", () => {
    const view = invitationView(entry({ app: app({ word: 'not_in_app', tone: 'grey', line: 'Check the address.', lineTone: 'red' }) }), TODAY);
    expect(view).toEqual({ tag: 'Not in the app', tone: 'plain', detail: 'Check the address.', line: null });
  });

  it("names the gym's own words on the row, and since when a past member is one", () => {
    expect(rowWords(entry({ paymentStatus: 'Paid' }), TODAY)).toEqual(['Active', 'Gold', 'Renews 3 Oct', 'Paid']);
    expect(rowWords(entry({ endsOn: '2026-08-31', endsOnKind: 'ends' }), TODAY)).toEqual(['Active', 'Gold', 'Ended 31 Aug']);
    expect(rowWords(entry({ endsOn: '2027-01-31', endsOnKind: 'ends' }), TODAY)).toEqual(['Active', 'Gold', 'Ends 31 Jan 2027']);
    expect(rowWords(entry({ formerAt: '2026-09-03T10:00:00.000Z' }), TODAY)).toEqual(['Past member since 3 Sep 2026']);
  });
});

// 23a-i. The worst thing a row could say: "Paid", from the gym's old file, about somebody
// who owes on a membership they hold here.
describe('a row for somebody who holds a membership in the app (23a-i)', () => {
  const TODAY = '2026-09-27';
  const held = (over = {}) => ({ status: 'active', memberships: ['Gold Monthly'], day: { what: 'renews', on: '2026-11-06' }, payment: { state: 'paid' }, ...over });

  it("reads what the membership says, never the record's own words", () => {
    const e = entry({ status: 'Expired', membershipType: 'Gold', paymentStatus: 'Paid', held: held({ payment: { state: 'due', since: '2026-09-20' } }) });
    expect(rowCells(e, TODAY)).toEqual({ status: 'Active', membership: 'Gold Monthly', ends: 'Renews 6 Nov', payment: 'Payment due', owes: true });
    expect(rowWords(e, TODAY)).toEqual(['Active', 'Gold Monthly', 'Renews 6 Nov', 'Payment due']);
  });

  it("says every state in the words of the person's own page", () => {
    // [what the server says they hold, the four cells, a payment is owed now]
    const cases = [
      [held(), ['Active', 'Gold Monthly', 'Renews 6 Nov', 'Paid'], false],
      [held({ memberships: ['Gold Monthly', 'PT 10'] }), ['Active', 'Gold Monthly +1', 'Renews 6 Nov', 'Paid'], false],
      [held({ memberships: ['A', 'B', 'C'] }), ['Active', 'A +2', 'Renews 6 Nov', 'Paid'], false],
      [held({ day: { what: 'ends', on: '2027-01-03' } }), ['Active', 'Gold Monthly', 'Ends 3 Jan 2027', 'Paid'], false],
      [held({ day: null, payment: { state: 'free' } }), ['Active', 'Gold Monthly', null, 'Free'], false],
      [held({ status: 'frozen', day: { what: 'frozen', on: '2026-09-09' }, payment: { state: 'due', since: null } }), ['Frozen', 'Gold Monthly', 'Frozen since 9 Sep', 'Payment due'], true],
      // A payment whose day has not come is not owed: never the word staff chase people by.
      [held({ status: 'upcoming', day: { what: 'starts', on: '2026-10-20' }, payment: { state: 'later', on: '2026-10-20' } }), ['Not started', 'Gold Monthly', 'Starts 20 Oct', 'Not due yet'], false],
      [held({ memberships: ['Gold Monthly', 'Annual'], payment: { state: 'later', on: '2026-10-20' } }), ['Active', 'Gold Monthly +1', 'Renews 6 Nov', 'Not due yet'], false],
      [held({ payment: { state: 'due', since: TODAY } }), ['Active', 'Gold Monthly', 'Renews 6 Nov', 'Payment due'], true],
      [held({ status: 'cancelled', day: { what: 'cancelled', on: '2026-09-03' }, payment: null }), ['Cancelled', 'Gold Monthly', 'Cancelled 3 Sep', null], false],
      [held({ status: 'ended', day: { what: 'ended', on: '2026-08-31' }, payment: null }), ['Ended', 'Gold Monthly', 'Ended 31 Aug', null], false],
      [held({ status: 'ended', day: { what: 'ended', on: null }, payment: null }), ['Ended', 'Gold Monthly', null, null], false],
    ];
    for (const [says, [status, membership, ends, payment], owes] of cases) {
      expect(rowCells(entry({ held: says }), TODAY), JSON.stringify(says)).toEqual({ status, membership, ends, payment, owes });
    }
  });

  it("reads the gym's own words for somebody who holds nothing here, an empty one as none", () => {
    expect(rowCells(entry({ paymentStatus: 'Paid' }), TODAY)).toEqual({ status: 'Active', membership: 'Gold', ends: 'Renews 3 Oct', payment: 'Paid', owes: false });
    expect(rowCells(entry({ status: null, membershipType: '', endsOn: null, endsOnKind: null }), TODAY)).toEqual({ status: null, membership: null, ends: null, payment: null, owes: false });
  });
});

describe('what the form sends', () => {
  it('sends only the boxes staff changed, so nothing untouched is marked as changed by hand', () => {
    const e = entry();
    const form = { ...formFrom(e, FIELDS), phone: '+447700900999' };
    expect(patchFrom(form, e, FIELDS)).toEqual({ phone: '+447700900999' });
  });

  it('sends nothing when nothing changed, spaces included', () => {
    const e = entry();
    const form = { ...formFrom(e, FIELDS), fullName: '  Ada Lovelace ' };
    expect(patchFrom(form, e, FIELDS)).toEqual({});
  });

  it('empties a cleared box with null, and clears the end date with its word', () => {
    const e = entry();
    const form = { ...formFrom(e, FIELDS), email: '', endsOn: '' };
    expect(patchFrom(form, e, FIELDS)).toEqual({ email: null, endsOn: null, endsOnKind: null });
  });

  it('sends a changed "ends or renews" on its own', () => {
    const e = entry();
    const form = { ...formFrom(e, FIELDS), endsOnKind: 'ends' };
    expect(patchFrom(form, e, FIELDS)).toEqual({ endsOnKind: 'ends' });
  });

  it("sends a change to the gym's own column under its own key, and \"\" to empty it", () => {
    const e = entry();
    const form = formFrom(e, FIELDS);
    form.extra = { locker: '', notes_2: 'Sam' };
    expect(patchFrom(form, e, FIELDS)).toEqual({ extra: { locker: '', notes_2: 'Sam' } });
  });

  it('adds with every box filled in and none of the empty ones', () => {
    const form = { ...formFrom(null, FIELDS), fullName: ' Bea ', email: 'bea@members.example', endsOn: '2027-01-01', endsOnKind: 'renews' };
    form.extra.locker = '7';
    expect(inputFrom(form)).toEqual({
      fullName: 'Bea',
      email: 'bea@members.example',
      endsOn: '2027-01-01',
      endsOnKind: 'renews',
      extra: { locker: '7' },
    });
  });

  it('names the fields changed by hand, the gym columns under their own heading', () => {
    expect(handEditedWords(entry({ handEdited: ['phone', 'extra:locker'] }), FIELDS, FIELD_LABELS)).toEqual(['Phone', 'Locker']);
  });
});

describe('the "Showing:" line', () => {
  const WORDS = { people: 'members', person: 'member' };

  it('names each ticked word, "no status" in words, and the App words; each pill takes off only itself', () => {
    let f = toggleWord(EMPTY_FILTERS, 'status', 'Frozen');
    f = toggleWord(f, 'status', '');
    f = { ...toggleWord(f, 'membershipType', 'Gold'), app: ['needs_check', 'in_app'], query: 'ada' };
    const pills = activeFilters(f, WORDS);
    expect(pills.map((p) => p.text)).toEqual(['Frozen', 'No status', 'Gold', 'In the app', 'Needs attention']);
    expect(pills[0].without.status).toEqual(['']);
    expect(pills[0].without.membershipType).toEqual(['Gold']);
    expect(pills[4].without.app).toEqual(['in_app']);
    expect(pills[4].without.query).toBe('ada');
  });

  it('shows past members as the one pill, since the other filters do not apply to them', () => {
    const f = { ...toggleWord(EMPTY_FILTERS, 'status', 'Frozen'), records: 'former' };
    const pills = activeFilters(f, WORDS);
    expect(pills.map((p) => p.text)).toEqual(['Past members']);
    expect(pills[0].without.records).toBe('current');
  });

  it('shows nothing for the whole list, a search alone included', () => {
    expect(activeFilters({ ...EMPTY_FILTERS, query: 'ada' }, WORDS)).toEqual([]);
  });
});

describe("Merge duplicate's side-by-side view", () => {
  it('lists every field of both records in one order, "—" for none, marks what differs, and leaves out what neither holds', () => {
    const a = entry({ memberNumber: 'M-1', dateOfBirth: '1990-03-12', inApp: true });
    const b = entry({ entryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'ada.old@members.example', phone: null, dateOfBirth: '1990-03-12', formerAt: '2026-08-01T10:00:00.000Z', extra: [] });
    const rows = compareRecords(a, b, FIELDS);
    const row = (key) => rows.find((r) => r.key === key);
    expect(rows.map((r) => r.label)).toEqual([
      'Name', 'Email', 'Phone', 'Member number', 'Date of birth', 'Join date', 'Status', 'Membership', 'End or renewal date', 'On the list', 'In the app', 'Locker',
    ]);
    expect(row('fullName')).toMatchObject({ first: 'Ada Lovelace', second: 'Ada Lovelace', differs: false });
    expect(row('dateOfBirth')).toMatchObject({ first: '12 March 1990', second: '12 March 1990', differs: false });
    expect(row('email')).toMatchObject({ second: 'ada.old@members.example', differs: true });
    expect(row('phone')).toMatchObject({ first: '+447700900123', second: '—', differs: true });
    expect(row('memberNumber')).toMatchObject({ first: 'M-1', second: '—', differs: true });
    expect(row('list')).toMatchObject({ first: 'On the list', second: 'Past member', differs: true });
    expect(row('app')).toMatchObject({ first: 'Yes', second: 'No', differs: true });
    expect(row('paymentStatus')).toBeUndefined();
    expect(row('extra:locker')).toMatchObject({ first: '12', second: '—', differs: true });
    // A custom field neither record holds is left out.
    expect(row('extra:notes_2')).toBeUndefined();
  });
});
describe("Merge duplicate's preview of the one record it leaves (the server's rule, RULINGS 2026-09-23)", () => {
  const keep = entry({
    email: 'ada@members.example',
    phone: null,
    memberNumber: null,
    status: 'Frozen',
    membershipType: null,
    joinedOn: '2025-01-04',
    endsOn: null,
    endsOnKind: null,
    paymentStatus: null,
    dateOfBirth: '1990-03-12',
    formerAt: '2026-08-01T10:00:00.000Z',
    extra: [{ key: 'locker', label: 'Locker', value: '' }],
  });
  const gone = entry({
    entryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    fullName: 'Lovelace, Ada',
    email: 'ada.old@members.example',
    phone: '+447700900999',
    memberNumber: 'M-7',
    status: 'Active',
    membershipType: 'Gold',
    joinedOn: '2024-06-01',
    endsOn: '2026-10-03',
    endsOnKind: 'renews',
    paymentStatus: 'Paid',
    dateOfBirth: '1990-03-12',
    formerAt: null,
    extra: [{ key: 'locker', label: 'Locker', value: '9' }],
  });
  const { rows, lost } = mergePreview(keep, gone, FIELDS);
  const after = Object.fromEntries(rows.map((r) => [r.key, [r.value, r.fromOther]]));
  const why = Object.fromEntries(lost.map((l) => [l.key, `${l.value} | ${l.why}`]));

  it("keeps the kept record's name, email, phone and member number, never the other's, and says what is lost", () => {
    expect(after.fullName).toEqual(['Ada Lovelace', false]);
    expect(after.email).toEqual(['ada@members.example', false]);
    // The kept record has no phone or member number: they stay empty, and the other's are named as lost.
    expect(after.phone).toBeUndefined();
    expect(after.memberNumber).toBeUndefined();
    expect(why.fullName).toBe("Lovelace, Ada | The kept record keeps its own name.");
    expect(why.email).toBe('ada.old@members.example | The kept record keeps its own email.');
    expect(why.phone).toBe("+447700900999 | The kept record's name, email, phone and member number are never changed by a merge.");
    expect(why.memberNumber).toBe("M-7 | The kept record's name, email, phone and member number are never changed by a merge.");
  });

  it('fills every other detail and custom field only where the kept record has none, and is on the list if either was', () => {
    expect(after.status).toEqual(['Frozen', false]);
    expect(after.membershipType).toEqual(['Gold', true]);
    expect(after.joinedOn).toEqual(['4 January 2025', false]);
    expect(after.endsOn[1]).toBe(true);
    expect(after.endsOn[0]).toMatch(/^Renews /);
    expect(after.paymentStatus).toEqual(['Paid', true]);
    expect(after.dateOfBirth).toEqual(['12 March 1990', false]);
    expect(after['extra:locker']).toEqual(['9', true]);
    expect(after.list).toEqual(['On the list', false]);
    expect(why.status).toBe('Active | The kept record keeps its own status.');
    expect(why.joinedOn).toBe('1 June 2024 | The kept record keeps its own join date.');
    // The same value on both is not lost; a value taken across is not lost.
    expect(why.dateOfBirth).toBeUndefined();
    expect(why.membershipType).toBeUndefined();
    expect(why['extra:locker']).toBeUndefined();
    expect(Object.keys(why).sort()).toEqual(['email', 'fullName', 'joinedOn', 'memberNumber', 'phone', 'status']);
  });

  it("shows exactly what the server's merge leaves (the contract its api test runs for real)", () => {
    const asEntry = (r, entryId) =>
      entry({ ...r, entryId, formerAt: null, extra: CONTRACT.fields.map((f) => ({ key: f.key, label: f.label, value: r.extra[f.key] ?? '' })) });
    const values = (preview) => preview.rows.map((r) => [r.key, r.value]);
    const shown = mergePreview(asEntry(CONTRACT.keep, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), asEntry(CONTRACT.gone, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), CONTRACT.fields);
    // The server's result, read the same way: a record merged with nothing is itself.
    const empty = asEntry({ fullName: '', email: null, phone: null, memberNumber: null, status: null, membershipType: null, joinedOn: null, endsOn: null, endsOnKind: null, paymentStatus: null, dateOfBirth: null, extra: {} }, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    const server = mergePreview(asEntry(CONTRACT.merged, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), empty, CONTRACT.fields);
    expect(values(shown)).toEqual(values(server));
  });

  it('two past members stay a past member', () => {
    const both = mergePreview({ ...keep, formerAt: '2026-08-01T10:00:00.000Z' }, { ...gone, formerAt: '2026-07-01T10:00:00.000Z' }, FIELDS);
    expect(both.rows.find((r) => r.key === 'list').value).toBe('Past member');
  });
});

describe("what a person's page offers about the invitation — every class", () => {
  const inv = (over = {}, email = { state: 'sent', reason: null, at: '2026-09-20T10:01:00.000Z', result: 'delivered' }) => ({
    state: 'pending',
    invitedAt: '2026-09-20T10:00:00.000Z',
    email,
    sentAgain: 0,
    waitingSince: null,
    notMeAt: null,
    ...over,
  });
  const at = '2026-09-20T10:01:00.000Z';
  it.each([
    ['never invited', {}, 'invite'],
    ['no email', { email: null }, null],
    ['a past member', { formerAt: '2026-09-01T10:00:00.000Z' }, null],
    ['already in the app', { inApp: true }, null],
    ['invited, email went', { invitation: inv() }, 'again'],
    ['invited, email waiting to go', { invitation: inv({}, { state: 'queued', reason: null, at, result: null }) }, null],
    ['invited, email being sent', { invitation: inv({}, { state: 'sending', reason: null, at, result: null }) }, null],
    ['invited, email skipped: invite queues the first email again', { invitation: inv({}, { state: 'skipped', reason: 'under_age', at, result: null }) }, 'invite'],
    ['invited, email given up after a week', { invitation: inv({}, { state: 'failed', reason: 'provider_unavailable', at, result: null }) }, 'invite'],
    ['invited, email may have gone', { invitation: inv({}, { state: 'failed', reason: 'send_unknown', at, result: null }) }, 'again'],
    ['invited, email bounced', { invitation: inv({}, { state: 'sent', reason: null, at, result: 'bounced' }) }, 'again'],
    ['invited, no email yet', { invitation: inv({}, null) }, 'invite'],
    ['waiting for a place', { invitation: inv({ waitingSince: at }) }, 'again'],
    ['joined', { invitation: inv({ state: 'accepted' }) }, null],
    ['declined', { invitation: inv({ state: 'declined' }) }, 'again'],
    ['said "Not me"', { invitation: inv({ state: 'declined', notMeAt: at }) }, null],
    // Stopped: invited again, asked first (RULINGS 2026-09-26), never "Send again … only
    // when they ask"; never at all to an address staff said is somebody else's.
    ['invitation stopped', { invitation: inv({ state: 'withdrawn' }) }, 'invite_again'],
    ['removed from the app', { invitation: inv({ state: 'withdrawn', removedAt: at }) }, 'invite_again'],
    ['someone else at the address removed', { invitation: inv({ state: 'withdrawn', addressRemovedAt: at }) }, 'invite_again'],
    ['staff said someone else uses the address', { invitation: inv({ state: 'withdrawn', wrongPersonAt: at }) }, null],
    ['16 by the list, never invited', { dateOfBirth: '2010-03-14' }, 'under_age'],
    ['turns 18 tomorrow', { dateOfBirth: '2008-09-26' }, 'under_age'],
    ['turned 18 today', { dateOfBirth: '2008-09-25' }, 'invite'],
    ['16 by the list, invited before the date was corrected', { dateOfBirth: '2010-03-14', invitation: inv() }, 'under_age'],
    ['16 by the list, but already joined', { dateOfBirth: '2010-03-14', invitation: inv({ state: 'accepted' }) }, null],
  ])('%s', (_name, over, action) => {
    expect(personInviteAction(entry(over), '2026-09-25')).toBe(action);
  });
});

describe('Invite: what the count asks and the press sends', () => {
  const ticked = { ...EMPTY_FILTERS, status: ['Active', ''], membershipType: ['Gold'], app: 'not_in_app', query: 'ada' };
  it("asks only by the gym's own words, the search and the app filter left out", () => {
    const read = memberInvitePreviewQuerySchema.parse(Object.fromEntries(
      [...new URLSearchParams(inviteQueryString(ticked)).keys()].map((key) => [key, new URLSearchParams(inviteQueryString(ticked)).getAll(key)]),
    ));
    expect(read).toEqual({ status: ['Active', ''], membershipType: ['Gold'] });
  });
  it('sends the same words, the version and the number shown, and the server takes it', () => {
    const body = inviteBody(ticked, { version: 9, reach: 214 }, true);
    expect(body).toEqual({ status: ['Active', ''], membershipType: ['Gold'], version: 9, expectedCount: 214, permissionConfirmed: true });
    expect(memberInviteRequestSchema.safeParse(body).success).toBe(true);
  });
  it('sends back the value the box came with for the people it showed, and the server takes it', () => {
    const digest = 'a1'.repeat(32);
    const body = inviteBody(ticked, { version: 9, reach: 214, digest }, true);
    expect(body).toEqual({ status: ['Active', ''], membershipType: ['Gold'], version: 9, expectedCount: 214, expectedDigest: digest, permissionConfirmed: true });
    expect(memberInviteRequestSchema.safeParse(body).success).toBe(true);
  });
  it('with nothing ticked, everyone: no words at all', () => {
    expect(inviteQueryString(EMPTY_FILTERS)).toBe('');
    expect(inviteBody(EMPTY_FILTERS, { version: 1, reach: 3 }, false)).toEqual({ version: 1, expectedCount: 3, permissionConfirmed: false });
  });
});

describe('who an Invite leaves out, in words', () => {
  it('one line a reason, zeros left out, one person said as one', () => {
    const lines = skippedLines({ noEmail: 1, underAge: 3, inApp: 0, alreadyInvited: 2, unsubscribed: 0, bounced: 1, refused: 0, sharedAddress: 1 });
    expect(lines.map((line) => line.text)).toEqual([
      '1 without an email address',
      '3 under 18',
      '2 already invited, or sharing an invited email address',
      '1 with an email address that bounces',
      '1 with a shared email address such as info@',
    ]);
  });
});
describe("the gym's own day for a birthday", () => {
  // 20:00 on 24 September in London is already 25 September in Auckland.
  const at = new Date('2026-09-24T20:00:00Z');
  it('is the gym\'s calendar day, not the reader\'s', () => {
    expect(gymToday('Pacific/Auckland', at)).toBe('2026-09-25');
    expect(gymToday('America/Los_Angeles', at)).toBe('2026-09-24');
  });
  it('falls back to the reader\'s own day for a zone it cannot read', () => {
    expect(gymToday('Not/AZone', at)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
// "Select all" sends the filter the list shows; a key lost on the way would select people
// the list did not show (round one of 5b-v-b-i, test gap 2).
describe('Select all sends exactly the filter the list is read with', () => {
  const read = (qs) => {
    const out = {};
    for (const [k, v] of new URLSearchParams(qs)) out[k] = k in out ? [].concat(out[k], v) : v;
    return out;
  };
  const cases = [
    ['nothing', EMPTY_FILTERS],
    ['one status', { ...EMPTY_FILTERS, status: ['Active'] }],
    ['two statuses and no status', { ...EMPTY_FILTERS, status: ['Active', ''] }],
    ['membership and payment', { ...EMPTY_FILTERS, membershipType: ['Gold'], paymentStatus: ['Overdue'] }],
    ['an App word', { ...EMPTY_FILTERS, app: ['invited'] }],
    ['two App words and a status', { ...EMPTY_FILTERS, app: ['in_app', 'needs_check'], status: ['Frozen'] }],
    ['a search', { ...EMPTY_FILTERS, query: ' park ' }],
    ['past members', { ...EMPTY_FILTERS, records: 'former' }],
    ['past members and a search', { ...EMPTY_FILTERS, records: 'former', query: 'hall' }],
  ];
  for (const [name, filters] of cases) {
    it(name, () => {
      const sent = selectionFilter(filters);
      expect(memberListFilterSchema.safeParse(sent).success).toBe(true);
      const asList = (v) => (v === undefined ? [] : [].concat(v));
      const listed = read(entriesQueryString(filters));
      for (const key of ['records', 'query', 'app', 'status', 'membershipType', 'paymentStatus']) {
        expect(asList(sent[key]), key).toEqual(asList(listed[key]));
      }
    });
  }
});

// Invite's headline for the people selected agrees with the bar behind it (round one, L2).
describe('Invite for the people selected counts everyone selected', () => {
  const skipped = { noEmail: 0, underAge: 0, inApp: 1, alreadyInvited: 0, unsubscribed: 0, bounced: 0, refused: 0, sharedAddress: 0 };
  const words = { people: 'members', person: 'member' };
  it('three selected, one invited, one in the app, one gone from the list', () => {
    const s = selectedInviteSummary({ version: 1, reach: 1, skipped, blocked: null }, words, 3);
    expect(s.gets).toBe('1 of 3 selected members will receive an invitation email');
    expect(s.wont).toBe('2 not included');
    expect(s.goneLine).toBe('1 is no longer on your list');
  });
  it('nobody gone: no such line', () => {
    const s = selectedInviteSummary({ version: 1, reach: 1, skipped, blocked: null }, words, 2);
    expect(s.gets).toBe('1 of 2 selected members will receive an invitation email');
    expect(s.goneLine).toBeNull();
  });
});

// Past 500 rows loaded, the heading ticks the first 500, counts as ticked so Select all is
// still offered, and unticking after Select all keeps at most 500 (round one, L4).
describe('the heading box past 500 rows', () => {
  const loaded = Array.from({ length: 600 }, (_, k) => `id-${String(k)}`);
  it('ticks the first 500 and reads as ticked', () => {
    const { pageIds } = pageTickState(loaded, new Set(), null);
    expect(pageIds).toHaveLength(500);
    expect(pageIds[499]).toBe('id-499');
    expect(pageTickState(loaded, new Set(pageIds), null).pageTicked).toBe(true);
  });
  it('one of the 500 unticked is not the page ticked', () => {
    const some = new Set(loaded.slice(1, 500));
    expect(pageTickState(loaded, some, null).pageTicked).toBe(false);
  });
  it('under 500 rows, every row counts', () => {
    const few = loaded.slice(0, 3);
    expect(pageTickState(few, new Set(few.slice(0, 2)), null).pageTicked).toBe(false);
    expect(pageTickState(few, new Set(few), null).pageTicked).toBe(true);
    expect(pageTickState([], new Set(), null).pageTicked).toBe(false);
  });
  it('after Select all everything reads as ticked, and unticking one keeps 499', () => {
    expect(pageTickState(loaded, new Set(), { count: 612 }).pageTicked).toBe(true);
    const next = untickFromAll(loaded, 'id-7');
    expect(next.size).toBe(499);
    expect(next.has('id-7')).toBe(false);
    expect(next.has('id-500')).toBe(false);
    // Unticking a row past the 500 still leaves 500, never 600.
    expect(untickFromAll(loaded, 'id-550').size).toBe(500);
  });
});

// Kd, 2026-09-29: "Status: Cancelled should show when was cancelled … same for the other
// scenario". The end date the file gave stands beside the status; none given, none shown.
describe('someone a file leaves out: the status with its date, then the rest', () => {
  const TODAY = '2026-09-29';
  const person = (wasStatus, onList) => ({
    wasStatus,
    onList: { membershipType: 'Gold', endsOn: null, endsOnKind: null, paymentStatus: 'Paid', source: 'upload', addedAt: '2026-01-05T10:00:00.000Z', ...onList },
  });
  it.each([
    ['Cancelled, ended', person('Cancelled', { endsOn: '2026-09-05', endsOnKind: 'ends' }), 'Status: Cancelled · Ended 5 Sep · Membership: Gold · Payment: Paid'],
    ['Expired, a renewal date passed', person('Expired', { endsOn: '2026-09-01', endsOnKind: 'renews' }), 'Status: Expired · Ended 1 Sep · Membership: Gold · Payment: Paid'],
    ['Active, renews', person('Active', { endsOn: '2026-10-04', endsOnKind: 'renews' }), 'Status: Active · Renews 4 Oct · Membership: Gold · Payment: Paid'],
    ['Frozen, ends next year', person('Frozen', { endsOn: '2027-01-02', endsOnKind: 'ends' }), 'Status: Frozen · Ends 2 Jan 2027 · Membership: Gold · Payment: Paid'],
    ['Cancelled, the file gave no date', person('Cancelled', {}), 'Status: Cancelled · Membership: Gold · Payment: Paid'],
    ['no status, a date', person(null, { endsOn: '2026-08-31', endsOnKind: 'ends' }), 'Ended 31 Aug · Membership: Gold · Payment: Paid'],
  ])('%s', (_, who, words) => {
    expect(goneWords(who, TODAY).facts).toBe(words);
  });
});

describe('Add member: may already be on your list (5b-iv-b)', () => {
  it('heads the warning with the name as typed, or This person when none was', () => {
    expect(mayBeOnListWords('  Liam Hughes ')).toBe('Liam Hughes may already be on your list');
    expect(mayBeOnListWords('')).toBe('This person may already be on your list');
    expect(mayBeOnListWords(undefined)).toBe('This person may already be on your list');
  });

  it('says every detail that tells two people apart, and says so when there is none', () => {
    const m = (over) => ({ email: null, phone: null, memberNumber: null, ...over });
    expect(matchDetailWords(m({ email: 'liam@members.example', phone: '+919876543210', memberNumber: 'GG-0042' }))).toBe(
      'liam@members.example · +919876543210 · Member number GG-0042',
    );
    expect(matchDetailWords(m({ memberNumber: 'GG-0042' }))).toBe('Member number GG-0042');
    expect(matchDetailWords(m({}))).toBe('No email or phone');
  });
});
