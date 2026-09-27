import { describe, expect, it } from 'vitest';
import { LEAD_FILE_WORDS } from '@app/shared';
import { addButton, groupsOf, mappingProblem, roleOf, skippedLines, someNames, withRole } from './leadFileView';

const MAPPING = { sheet: 0, headerRow: 0, fullName: 0, firstName: null, lastName: null, email: [1], phone: [2], source: 3, notes: null };
const person = (row, fullName) => ({ row, fullName, email: `${row}@example.com`, phone: null, source: 'other' });
const preview = (over = {}) => ({
  mapping: MAPPING,
  counts: { dataRows: 3, noContact: 0, noName: 0, twiceInFile: 0, add: 2, alreadyLead: 0, alreadyMember: 0 },
  add: [person(2, 'Ann Bell'), person(3, 'Bo Cox')],
  alreadyLead: [],
  alreadyMember: [],
  twiceInFile: [],
  room: 10000,
  ...over,
});

describe('a column given a role', () => {
  it('takes a single role from the column that had it', () => {
    const next = withRole(MAPPING, 4, 'source');
    expect(next.source).toBe(4);
    expect(roleOf(next, 3)).toBe('');
  });
  it('adds a second email column after the first, and Not used takes it off', () => {
    const next = withRole(MAPPING, 4, 'email');
    expect(next.email).toEqual([1, 4]);
    expect(withRole(next, 1, '').email).toEqual([4]);
  });
  it('a name is read one way: a full name clears first and last, and the other way round', () => {
    const split = withRole(withRole(MAPPING, 5, 'firstName'), 6, 'lastName');
    expect(split).toMatchObject({ fullName: null, firstName: 5, lastName: 6 });
    expect(withRole(split, 0, 'fullName')).toMatchObject({ fullName: 0, firstName: null, lastName: null });
  });
  it('a column moved from email to notes is no longer an email column', () => {
    const next = withRole(MAPPING, 1, 'notes');
    expect(next.email).toEqual([]);
    expect(next.notes).toBe(1);
    expect(mappingProblem(next)).toBeNull();
    expect(mappingProblem(withRole(next, 2, ''))).toBe(LEAD_FILE_WORDS.needs_contact);
    expect(mappingProblem({ ...MAPPING, fullName: null })).toBe(LEAD_FILE_WORDS.needs_name);
  });
});

describe('names in a line', () => {
  it.each([
    [[], ''],
    [[person(2, 'Ann Bell')], 'Ann Bell'],
    [[person(2, 'Ann Bell'), person(3, 'Bo Cox')], 'Ann Bell and Bo Cox'],
    [[person(2, 'Ann Bell'), person(3, 'Bo Cox'), person(4, 'Cy Dent')], 'Ann Bell, Bo Cox and Cy Dent'],
    [[person(2, 'A'), person(3, 'B'), person(4, 'C'), person(5, 'D')], 'A, B, C and 1 more'],
  ])('%j → %s', (people, words) => {
    expect(someNames(people)).toBe(words);
  });
});

describe('the groups and the skipped rows', () => {
  it('names only the groups with people, in order, and the same person twice as a line', () => {
    const p = preview({
      alreadyMember: [person(4, 'Kate Moss')],
      twiceInFile: [person(5, 'Nia O.')],
      counts: { dataRows: 7, noContact: 1, noName: 0, twiceInFile: 2, add: 2, alreadyLead: 0, alreadyMember: 1 },
    });
    expect(groupsOf(p).map((g) => [g.title, g.people.length])).toEqual([
      ['New leads', 2],
      ['Already members', 1],
      ['Repeated in the file', 1],
    ]);
    expect(skippedLines(p)).toEqual([LEAD_FILE_WORDS.no_contact(1), LEAD_FILE_WORDS.twice_in_file(1)]);
  });
});

describe('the Add button', () => {
  it('is pressed only with the columns checked, somebody to add, room for them and the box ticked', () => {
    const p = preview();
    expect(addButton({ preview: p, mapping: MAPPING, ticked: true, readOnly: false })).toEqual({ label: 'Add 2 leads', enabled: true, why: null });
    expect(addButton({ preview: p, mapping: MAPPING, ticked: false, readOnly: false })).toMatchObject({ enabled: false, why: 'Tick the box above first.' });
    expect(addButton({ preview: p, mapping: withRole(MAPPING, 3, ''), ticked: true, readOnly: false }).enabled).toBe(false);
    expect(addButton({ preview: p, mapping: MAPPING, ticked: true, readOnly: true }).enabled).toBe(false);
    expect(addButton({ preview: preview({ room: 1 }), mapping: MAPPING, ticked: true, readOnly: false })).toMatchObject({
      enabled: false,
      why: LEAD_FILE_WORDS.full(1, 2),
    });
    const none = preview({ add: [], counts: { ...p.counts, add: 0 } });
    expect(addButton({ preview: none, mapping: MAPPING, ticked: true, readOnly: false })).toMatchObject({ enabled: false, why: LEAD_FILE_WORDS.nothing_to_add });
    expect(addButton({ preview: preview({ add: [person(2, 'Ann Bell')], counts: { ...p.counts, add: 1 } }), mapping: MAPPING, ticked: true, readOnly: false }).label).toBe(
      'Add 1 lead',
    );
  });
});
