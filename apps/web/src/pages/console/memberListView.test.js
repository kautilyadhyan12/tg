import { describe, expect, it } from 'vitest';
import { countLines, dayWords, guardNumber, resultLine, roleOfColumn, typedMatches, withColumnRole, withDateOrder } from './memberListView';

const mapping = {
  sheet: null, headerRow: 0, fullName: 0, firstName: null, lastName: null, email: [1, 5], phone: [2], memberNumber: null,
  status: 3, membershipType: null, joinedOn: null, endsOn: null, paymentStatus: null, dateOfBirth: null, dontKeep: [4], dateOrder: [],
};

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
    // [column, new role, what else must follow]
    ['a single field moves, and its old column becomes the gym\'s own', 6, 'status', (m) => m.status === 6 && roleOfColumn(m, 3) === 'extra'],
    ['a field to a column that held another field frees that field', 3, 'membershipType', (m) => m.membershipType === 3 && m.status === null],
    ['an email column is added after the others, in order', 6, 'email', (m) => JSON.stringify(m.email) === '[1,5,6]'],
    ['one of two email columns to phone leaves the other email', 5, 'phone', (m) => JSON.stringify(m.email) === '[1]' && JSON.stringify(m.phone) === '[2,5]'],
    ['a field to "don\'t keep"', 0, 'dontKeep', (m) => m.fullName === null && m.dontKeep.includes(0)],
    ['"don\'t keep" back to a field', 4, 'memberNumber', (m) => m.memberNumber === 4 && !m.dontKeep.includes(4)],
    ['a field to the gym\'s own column is in no field and not dropped', 3, 'extra', (m) => m.status === null && !m.dontKeep.includes(3)],
    ['the same role again changes nothing', 1, 'email', (m) => JSON.stringify(m) === JSON.stringify(mapping)],
  ])('%s', (_name, index, role, holds) => {
    const next = withColumnRole(mapping, index, role);
    expect(roleOfColumn(next, index)).toBe(role);
    expect(holds(next)).toBe(true);
    // A column is never in two places at once.
    for (let i = 0; i < 7; i += 1) {
      const places = ['fullName', 'firstName', 'lastName', 'memberNumber', 'status', 'membershipType', 'joinedOn', 'endsOn', 'paymentStatus', 'dateOfBirth']
        .filter((f) => next[f] === i).length + next.email.filter((c) => c === i).length + next.phone.filter((c) => c === i).length + next.dontKeep.filter((c) => c === i).length;
      expect(places).toBeLessThanOrEqual(1);
    }
    expect(mapping.email).toEqual([1, 5]);
  });

  it('a date flip replaces that column\'s own order only', () => {
    const once = withDateOrder(mapping, 7, 'monthFirst');
    const twice = withDateOrder(withDateOrder(once, 8, 'dayFirst'), 7, 'dayFirst');
    expect(twice.dateOrder).toEqual([{ column: 8, order: 'dayFirst' }, { column: 7, order: 'dayFirst' }]);
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

describe('the words', () => {
  it('says a day the way people write it', () => {
    expect(dayWords('2026-04-03')).toBe('3 April 2026');
    expect(dayWords('1990-12-25')).toBe('25 December 1990');
  });

  it('never says "no longer on your list" for an add', () => {
    const confirmed = {
      applied: { new: 2, changed: 0, unchanged: 0, gone: 4, alreadyInApp: 0, canBeInvited: 2, noEmail: 0, returning: 0 },
      members: { leaving: 0, listedNow: 0 },
    };
    expect(resultLine(confirmed, 'add')).toBe('2 new');
    expect(resultLine(confirmed, 'whole_list')).toBe('2 new · 4 no longer on your list');
    expect(resultLine({ ...confirmed, members: { leaving: 1, listedNow: 5 } }, 'whole_list')).toBe(
      '2 new · 4 no longer on your list · 1 app member no longer on your list',
    );
  });

  it('counts each group, and the new ones by what can happen to them', () => {
    const lines = countLines(
      {
        mode: 'whole_list',
        list: { new: 5, changed: 2, unchanged: 0, gone: 1, alreadyInApp: 1, canBeInvited: 3, noEmail: 1, returning: 2 },
        members: { leaving: 0, listedNow: 0 },
        fieldChanges: [{ field: 'endsOn', count: 2 }],
        extraChanges: [{ key: 'locker', label: 'Locker', count: 1 }],
      },
      { people: 'members' },
    );
    expect(lines.map((l) => [l.group, l.text, l.detail])).toEqual([
      ['new', '5 new', '1 already in the app · 3 could be invited · 1 with no email address · 2 were on your list before'],
      ['changed', '2 changed', 'end or renewal date 2 · Locker 1'],
      ['gone', '1 no longer on your list', 'Kept as former records, not deleted.'],
    ]);
  });
});
