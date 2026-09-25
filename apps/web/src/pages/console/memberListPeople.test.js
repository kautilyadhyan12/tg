// The gym's own list on the Members screen (ROADMAP 5b-i): what a filter sends, what a
// row says about an invitation, and what a form sends back.
import { describe, expect, it } from 'vitest';
import {
  memberInvitePreviewQuerySchema,
  memberInviteRequestSchema,
  memberListEntryDetailSchema,
  memberListEntriesQuerySchema,
  MEMBER_INVITE_EMAIL_REASON_WORDS,
} from '@app/shared';
import {
  EMPTY_FILTERS,
  activeFilters,
  compareRecords,
  entriesQueryString,
  formFrom,
  gymToday,
  handEditedWords,
  inputFrom,
  invitationView,
  inviteBody,
  inviteQueryString,
  patchFrom,
  personInviteAction,
  rowWords,
  skippedLines,
  toggleWord,
} from './memberListPeople';
import { FIELD_LABELS } from './memberListView';

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

  it('keeps the three kinds apart and sends the in-app choice and the search', () => {
    let f = toggleWord(EMPTY_FILTERS, 'membershipType', 'Gold');
    f = toggleWord(f, 'paymentStatus', 'Overdue');
    f = { ...f, app: 'not_in_app', query: '  ada ' };
    expect(serverReads(entriesQueryString(f))).toEqual({
      filter: 'not_in_app',
      membershipType: 'Gold',
      paymentStatus: 'Overdue',
      query: 'ada',
    });
  });

  it('asks for past members only, and never mixes in chips that count the current list', () => {
    const f = { ...toggleWord(EMPTY_FILTERS, 'status', 'Active'), app: 'in_app', records: 'former' };
    expect(serverReads(entriesQueryString(f))).toEqual({ records: 'former' });
  });

  it('passes the cursor back as it came', () => {
    expect(serverReads(entriesQueryString(EMPTY_FILTERS, 'opaque:1')).cursor).toBe('opaque:1');
  });
});

describe('what a row says about the app and the invitation', () => {
  const inv = (over = {}) => ({
    state: 'pending',
    invitedAt: '2026-09-20T10:00:00.000Z',
    email: { state: 'sent', reason: null, at: '2026-09-20T10:01:00.000Z', result: 'delivered' },
    sentAgain: 0,
    waitingSince: null,
    notMeAt: null,
    ...over,
  });

  it.each([
    ['in the app', { inApp: true, invitation: inv({ state: 'accepted' }) }, 'Uses the app', 'green'],
    ['never invited', {}, 'Not invited', 'plain'],
    ['no email, never invited', { email: null }, 'No email', 'plain'],
    ['joined', { invitation: inv({ state: 'accepted' }) }, 'Joined', 'green'],
    ['declined', { invitation: inv({ state: 'declined' }) }, 'Declined', 'plain'],
    ['said Not me', { invitation: inv({ state: 'declined', notMeAt: '2026-09-21T10:00:00.000Z' }) }, 'Said "Not me"', 'red'],
    ['withdrawn', { invitation: inv({ state: 'withdrawn' }) }, 'Invitation stopped', 'plain'],
    ['waiting for a place', { invitation: inv({ waitingSince: '2026-09-21T10:00:00.000Z' }) }, 'Waiting for a place', 'orange'],
    ['email waiting', { invitation: inv({ email: { state: 'queued', reason: null, at: '2026-09-20T10:00:00.000Z', result: null } }) }, 'Invited · email waiting to go', 'plain'],
    ['delivered', { invitation: inv() }, 'Invited 20 September 2026', 'plain'],
    ['bounced', { invitation: inv({ email: { state: 'sent', reason: null, at: '2026-09-20T10:01:00.000Z', result: 'bounced' } }) }, "Invited · email didn't arrive", 'orange'],
    ['not sent', { invitation: inv({ email: { state: 'skipped', reason: 'shared_address', at: '2026-09-20T10:01:00.000Z', result: null } }) }, 'Invited · email not sent', 'orange'],
  ])('%s', (_name, over, tag, tone) => {
    const view = invitationView(entry(over));
    expect(view.tag).toBe(tag);
    expect(view.tone).toBe(tone);
  });

  it("gives the server's own reason for an email that did not go", () => {
    const view = invitationView(
      entry({ invitation: inv({ email: { state: 'skipped', reason: 'shared_address', at: '2026-09-20T10:01:00.000Z', result: null } }) }),
    );
    expect(view.detail).toBe(MEMBER_INVITE_EMAIL_REASON_WORDS.shared_address);
  });

  it('says nothing about an invitation on a past member who never had one', () => {
    expect(invitationView(entry({ formerAt: '2026-09-01T10:00:00.000Z' }))).toBeNull();
  });

  it("names the gym's own words on the row, and when a past member was taken off", () => {
    expect(rowWords(entry())).toEqual(['Active', 'Gold', 'Renews 3 October 2026']);
    expect(rowWords(entry({ formerAt: '2026-09-01T10:00:00.000Z' }))).toEqual(['Removed from list 1 September 2026']);
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

  it('names each ticked word, "no status" in words, and the app choice; each pill takes off only itself', () => {
    let f = toggleWord(EMPTY_FILTERS, 'status', 'Frozen');
    f = toggleWord(f, 'status', '');
    f = { ...toggleWord(f, 'membershipType', 'Gold'), app: 'not_in_app', query: 'ada' };
    const pills = activeFilters(f, WORDS);
    expect(pills.map((p) => p.text)).toEqual(['Frozen', 'No status', 'Gold', 'Not in the app']);
    expect(pills[0].without.status).toEqual(['']);
    expect(pills[0].without.membershipType).toEqual(['Gold']);
    expect(pills[3].without.app).toBe('all');
    expect(pills[3].without.query).toBe('ada');
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
      'Name', 'Email', 'Phone', 'Member number', 'Date of birth', 'Join date', 'Status', 'Membership', 'End or renewal date', 'On the list', 'Uses the app', 'Locker',
    ]);
    expect(row('fullName')).toMatchObject({ keep: 'Ada Lovelace', remove: 'Ada Lovelace', differs: false });
    expect(row('dateOfBirth')).toMatchObject({ keep: '12 March 1990', remove: '12 March 1990', differs: false });
    expect(row('email')).toMatchObject({ remove: 'ada.old@members.example', differs: true });
    expect(row('phone')).toMatchObject({ keep: '+447700900123', remove: '—', differs: true });
    expect(row('memberNumber')).toMatchObject({ keep: 'M-1', remove: '—', differs: true });
    expect(row('list')).toMatchObject({ keep: 'On the list', remove: 'Past member', differs: true });
    expect(row('app')).toMatchObject({ keep: 'Yes', remove: 'No', differs: true });
    expect(row('paymentStatus')).toBeUndefined();
    expect(row('extra:locker')).toMatchObject({ keep: '12', remove: '—', differs: true });
    // A custom field neither record holds is left out.
    expect(row('extra:notes_2')).toBeUndefined();
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
    ['invitation stopped', { invitation: inv({ state: 'withdrawn' }) }, 'again'],
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
  it('with nothing ticked, everyone: no words at all', () => {
    expect(inviteQueryString(EMPTY_FILTERS)).toBe('');
    expect(inviteBody(EMPTY_FILTERS, { version: 1, reach: 3 }, false)).toEqual({ version: 1, expectedCount: 3, permissionConfirmed: false });
  });
});

describe('who an Invite leaves out, in words', () => {
  it('one line a reason, zeros left out, one person said as one', () => {
    const lines = skippedLines({ noEmail: 1, underAge: 3, inApp: 0, alreadyInvited: 2, unsubscribed: 0, bounced: 1, refused: 0, sharedAddress: 1 });
    expect(lines.map((line) => line.text)).toEqual([
      '1 has no email address',
      '3 are under 18 by the date of birth on your list',
      '2 were invited before',
      '1 has an address that bounces',
      '1 has a shared address such as info@',
    ]);
  });
});
describe('a row for somebody the list says is under 18', () => {
  it('reads "Under 18" when never invited, and as before without a date to judge by', () => {
    expect(invitationView(entry({ dateOfBirth: '2010-03-14' }), '2026-09-25')?.tag).toBe('Under 18');
    expect(invitationView(entry({ dateOfBirth: '2008-09-25' }), '2026-09-25')?.tag).toBe('Not invited');
    expect(invitationView(entry({ dateOfBirth: '2010-03-14' }))?.tag).toBe('Not invited');
  });

  const pending = { state: 'pending', invitedAt: '2026-09-20T10:00:00.000Z', email: { state: 'sent', reason: null, at: '2026-09-20T10:01:00.000Z', result: 'delivered' }, sentAgain: 0, waitingSince: null, notMeAt: null };
  it("reads \"Under 18\" even when the address's invitation is a parent's, or came before the date was corrected", () => {
    expect(invitationView(entry({ dateOfBirth: '2010-03-14', invitation: pending }), '2026-09-25')?.tag).toBe('Under 18');
    expect(invitationView(entry({ dateOfBirth: '2010-03-14', invitation: { ...pending, state: 'withdrawn' } }), '2026-09-25')?.tag).toBe('Under 18');
  });
  it('still says Joined, or Uses the app, for somebody already in', () => {
    expect(invitationView(entry({ dateOfBirth: '2010-03-14', invitation: { ...pending, state: 'accepted' } }), '2026-09-25')?.tag).toBe('Joined');
    expect(invitationView(entry({ dateOfBirth: '2010-03-14', inApp: true }), '2026-09-25')?.tag).toBe('Uses the app');
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