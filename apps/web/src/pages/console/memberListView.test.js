import { describe, expect, it } from 'vitest';
import {
  datesToCheck,
  dayWords,
  doneWords,
  guardNumber,
  importedColumnCount,
  missingOf,
  missingStatusLine,
  missingTitle,
  neverKeptLines,
  roleOfColumn,
  someNames,
  summaryOf,
  typedMatches,
  warningTitle,
  withColumnRole,
  withDateOrder,
} from './memberListView';

const WORDS = { people: 'members', person: 'member' };

const mapping = {
  sheet: null, headerRow: 0, fullName: 0, firstName: null, lastName: null, email: [1, 5], phone: [2], memberNumber: null,
  status: 3, membershipType: null, joinedOn: null, endsOn: null, paymentStatus: null, dateOfBirth: null, dontKeep: [4], dateOrder: [],
};
const SINGLE = ['fullName', 'firstName', 'lastName', 'memberNumber', 'status', 'membershipType', 'joinedOn', 'endsOn', 'paymentStatus', 'dateOfBirth'];

describe('which column holds what', () => {
  it.each([
    [0, 'fullName'],
    [1, 'email'],
    [5, 'email'],
    [2, 'phone'],
    [3, 'status'],
    [4, 'dontKeep'],
    [6, 'extra'],
  ])('column %i reads as %s', (index, role) => {
    expect(roleOfColumn(mapping, index)).toBe(role);
  });

  it.each([
    ["a single field moves, and its old column becomes the gym's own", 6, 'status', (m) => m.status === 6 && roleOfColumn(m, 3) === 'extra'],
    ['a field to a column that held another field frees that field', 3, 'membershipType', (m) => m.membershipType === 3 && m.status === null],
    ['an email column is added after the others, in order', 6, 'email', (m) => JSON.stringify(m.email) === '[1,5,6]'],
    ['one of two email columns to phone leaves the other email', 5, 'phone', (m) => JSON.stringify(m.email) === '[1]' && JSON.stringify(m.phone) === '[2,5]'],
    ['a field to "don\'t import"', 0, 'dontKeep', (m) => m.fullName === null && m.dontKeep.includes(0)],
    ['"don\'t import" back to a field', 4, 'memberNumber', (m) => m.memberNumber === 4 && !m.dontKeep.includes(4)],
    ["a field to the gym's own column is in no field and not dropped", 3, 'extra', (m) => m.status === null && !m.dontKeep.includes(3)],
    ['the same role again changes nothing', 1, 'email', (m) => JSON.stringify(m) === JSON.stringify(mapping)],
  ])('%s', (_name, index, role, holds) => {
    const next = withColumnRole(mapping, index, role);
    expect(roleOfColumn(next, index)).toBe(role);
    expect(holds(next)).toBe(true);
    // A column is never in two places at once.
    for (let i = 0; i < 7; i += 1) {
      const places =
        SINGLE.filter((f) => next[f] === i).length +
        next.email.filter((c) => c === i).length +
        next.phone.filter((c) => c === i).length +
        next.dontKeep.filter((c) => c === i).length;
      expect(places).toBeLessThanOrEqual(1);
    }
    expect(mapping.email).toEqual([1, 5]);
  });

  it("a date flip replaces that column's own order only", () => {
    const once = withDateOrder(mapping, 7, 'monthFirst');
    const twice = withDateOrder(withDateOrder(once, 8, 'dayFirst'), 7, 'dayFirst');
    expect(twice.dateOrder).toEqual([{ column: 8, order: 'dayFirst' }, { column: 7, order: 'dayFirst' }]);
  });

  it('counts the columns that will be imported: not the never-kept, not "don\'t import"', () => {
    const columns = [0, 1, 2, 3, 4, 5, 6].map((index) => ({ index, neverKept: index === 6 ? 'payment_card' : null }));
    expect(importedColumnCount(columns, mapping)).toBe(5);
  });

  it('names never-kept columns once per reason', () => {
    const columns = [
      { index: 0, header: 'Card', neverKept: 'payment_card' },
      { index: 1, header: null, neverKept: 'payment_card' },
      { index: 2, header: 'Doctor notes', neverKept: 'medical' },
      { index: 3, header: 'Email', neverKept: null },
    ];
    expect(neverKeptLines(columns)).toEqual([
      { reason: 'payment_card', title: 'Card numbers not imported', columns: 'Card, Column 2' },
      { reason: 'medical', title: 'Health notes not imported', columns: 'Doctor notes' },
    ]);
  });
});

describe('dates', () => {
  it('says a day the way people write it', () => {
    expect(dayWords('2026-04-03')).toBe('3 April 2026');
    expect(dayWords('1990-12-25')).toBe('25 December 1990');
  });

  it.each([
    ['country', true],
    ['chosen', true],
    ['file', false],
    ['none', false],
  ])('a column read by %s is shown to check: %s', (from, shown) => {
    const preview = {
      columns: [{ index: 3, header: 'Joined' }],
      dateColumns: [{ column: 3, field: 'joinedOn', order: 'dayFirst', from, example: { raw: '03/04/2026', read: '2026-04-03' }, notRead: 0 }],
    };
    expect(datesToCheck(preview)).toEqual(
      shown ? [{ column: 3, order: 'dayFirst', example: '03/04/2026 = 3 April 2026', columnName: 'Joined' }] : [],
    );
  });
});

const list = (over = {}) => ({ new: 0, changed: 0, unchanged: 0, gone: 0, alreadyInApp: 0, canBeInvited: 0, noEmail: 0, returning: 0, ...over });
const calm = { entriesGoing: 0, listSize: 0, membersLeaving: 0, membersListedNow: 0, needsTick: false, mostOfListWouldGo: false };
const pv = (over = {}) => ({ mode: 'whole_list', list: list(), members: { leaving: 0, listedNow: 0 }, guard: calm, statuses: [], ...over });

describe('what the review shows', () => {
  it.each([
    ['only new people: one big number', pv({ list: list({ new: 30 }) }), { hero: 30, tiles: ['new'], nothing: false }],
    ['new and updated: tiles', pv({ list: list({ new: 3, changed: 6 }) }), { hero: null, tiles: ['new', 'changed'], nothing: false }],
    ['missing people are never a tile: new alone is still the big number', pv({ list: list({ new: 3, gone: 5 }) }), { hero: 3, tiles: ['new'], nothing: false }],
    ['only missing: no tile at all (the question says it)', pv({ list: list({ gone: 5, unchanged: 5 }) }), { hero: null, tiles: [], nothing: true }],
    ['an add shows no missing either', pv({ mode: 'add', list: list({ new: 2, gone: 5 }) }), { hero: 2, tiles: ['new'], nothing: false }],
    ['the same list again: nothing', pv({ list: list({ unchanged: 30 }) }), { hero: null, tiles: [], nothing: true }],
  ])('%s', (_name, preview, want) => {
    const s = summaryOf(preview);
    expect({ hero: s.hero, tiles: s.tiles.map((t) => t.group), nothing: s.nothing }).toEqual(want);
  });

  it.each([
    ['nobody missing', pv({ list: list({ new: 30 }) }), null],
    ['five missing', pv({ list: list({ gone: 5 }), guard: { ...calm, entriesGoing: 5, listSize: 40 } }), { n: 5, listSize: 40, needsTick: false, statuses: [] }],
    ['app members leaving with no entry gone', pv({ members: { leaving: 2, listedNow: 3 } }), { n: 2, listSize: 0, needsTick: false, statuses: [] }],
    ['the wrong-file check with nobody counted', pv({ guard: { ...calm, membersLeaving: 12, needsTick: true } }), { n: 12, listSize: 0, needsTick: true, statuses: [] }],
    ['an add asks nothing', pv({ mode: 'add', list: list({ gone: 5 }) }), null],
  ])('missing: %s', (_name, preview, want) => {
    expect(missingOf(preview)).toEqual(want);
  });

  it("names the statuses of who is missing, so an export of only Active members shows itself", () => {
    const status = (label, gone, rest = 0) => ({ label, count: rest, new: 0, changed: 0, unchanged: rest, gone });
    const missing = missingOf(
      pv({ list: list({ gone: 12 }), guard: { ...calm, entriesGoing: 12, listSize: 50 }, statuses: [status('Active', 0, 38), status('Frozen', 9), status('Expired', 3)] }),
    );
    expect(missing.statuses).toEqual([
      { label: 'Frozen', n: 9 },
      { label: 'Expired', n: 3 },
    ]);
    expect(missingStatusLine(missing)).toBe('Frozen 9 · Expired 3');
    expect(missingStatusLine({ ...missing, statuses: [] })).toBe('');
  });

  it.each([
    [{ n: 1, listSize: 40, needsTick: false }, "1 member isn't in this file"],
    [{ n: 5, listSize: 40, needsTick: false }, "5 members aren't in this file"],
    [{ n: 25, listSize: 30, needsTick: true }, "25 of your 30 members aren't in this file"],
    [{ n: 1200, listSize: 1500, needsTick: true }, "1,200 of your 1,500 members aren't in this file"],
  ])('%j → %s', (missing, words) => {
    expect(missingTitle(missing, missing.needsTick, WORDS)).toBe(words);
  });

  it('lists a few names and says how many more', () => {
    expect(someNames(['Ben Cole', 'Amy Shaw', 'Raj Patel'], 5)).toBe('Ben Cole, Amy Shaw, Raj Patel and 2 more');
    expect(someNames(['Ben Cole', 'Amy Shaw'], 2)).toBe('Ben Cole, Amy Shaw');
    expect(someNames([], 5)).toBe('');
  });

  it.each([
    [{ code: 'phones_unusual', rows: 1 }, '1 phone number looks unusual'],
    [{ code: 'phones_unusual', rows: 30 }, '30 phone numbers look unusual'],
    [{ code: 'shared_emails', rows: 2 }, '2 people share an email'],
    [{ code: 'dates_not_read', rows: 1 }, "1 date couldn't be read"],
    [{ code: 'card_cells_dropped', rows: 3 }, '3 card numbers removed'],
    [{ code: 'placeholders', rows: 4, values: ['desk@gym.example'] }, 'Front-desk details left out of 4 rows'],
    [{ code: 'other_sheets_ignored', sheets: ['Staff'] }, 'Only one sheet was read'],
    [{ code: 'extra_columns_left_out', columns: 2 }, '2 columns on the right left out'],
  ])('%j → %s', (w, words) => {
    expect(warningTitle(w)).toBe(words);
  });
});

describe('the typed number', () => {
  const guard = { entriesGoing: 1200, listSize: 1500, membersLeaving: 3, membersListedNow: 9, needsTick: true, mostOfListWouldGo: true };
  it.each([
    ['1200', true],
    ['1,200', true],
    [' 1200 ', true],
    ['120', false],
    ['12000', false],
    ['', false],
    ['1200abc', false],
    ['-1200', false],
    ['1200.0', false],
  ])('%j → %s', (typed, ok) => {
    expect(typedMatches(typed, guard)).toBe(ok);
  });

  it('asks for the app members when nobody else comes off', () => {
    expect(guardNumber({ ...guard, entriesGoing: 0 })).toBe(3);
  });
});

describe('the finished screen', () => {
  const done = (applied, alreadyConfirmed = false) => ({ applied: list(applied), alreadyConfirmed });
  it.each([
    [done({ new: 30 }), { title: '30 members imported', detail: '' }],
    [done({ new: 1 }), { title: '1 member imported', detail: '' }],
    [done({ new: 3, changed: 6, gone: 2 }), { title: 'Your list is updated', detail: '3 new · 6 updated · 2 marked as past members' }],
    [done({ changed: 4 }), { title: 'Your list is updated', detail: '4 updated' }],
    [done({ unchanged: 30 }), { title: 'Nothing to change', detail: 'Your list already matches this file.' }],
    [done({ new: 30 }, true), { title: 'Already imported', detail: 'Nothing changed this time.' }],
  ])('%j', (confirmed, want) => {
    expect(doneWords(confirmed, WORDS)).toEqual(want);
  });
});
