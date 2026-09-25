// The gym's own list on the Members screen (ROADMAP 5b-i): what a filter sends, what a
// row says about an invitation, and what a form sends back.
import { describe, expect, it } from 'vitest';
import { memberListEntryDetailSchema, memberListEntriesQuerySchema, MEMBER_INVITE_EMAIL_REASON_WORDS } from '@app/shared';
import {
  EMPTY_FILTERS,
  entriesQueryString,
  formFrom,
  handEditedWords,
  inputFrom,
  invitationView,
  patchFrom,
  rowWords,
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
    expect(rowWords(entry({ formerAt: '2026-09-01T10:00:00.000Z' }))).toEqual(['Taken off 1 September 2026']);
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
