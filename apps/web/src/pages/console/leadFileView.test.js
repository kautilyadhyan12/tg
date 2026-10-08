import { describe, expect, it } from 'vitest';
import { LEAD_FILE_WORDS } from '@app/shared';
import { addButton, addedTitle, columnLines, exampleLine, heardLine, mappingProblem, notAddedRow, roleOf, unlistedNotAdded, warningLines, withRole } from './leadFileView';

const MAPPING = { sheet: 0, headerRow: 0, fullName: 0, firstName: null, lastName: null, email: [1], phone: [2], source: 3, notes: null };
const person = (row, fullName) => ({ row, fullName, email: `${row}@example.com`, phone: null, source: 'other', sourceWord: null });
const preview = (over = {}) => ({
  mapping: MAPPING,
  columns: [],
  counts: { dataRows: 3, noContact: 0, noName: 0, twiceInFile: 0, add: 2, alreadyLead: 0, alreadyMember: 0, notAdded: 0 },
  add: [person(2, 'Ann Bell'), person(3, 'Bo Cox')],
  notAdded: [],
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

describe('the words staff read', () => {
  it('the headline says how many people are added, or that nobody can be', () => {
    expect(addedTitle(preview())).toBe('2 people will be added to your leads');
    expect(addedTitle(preview({ counts: { ...preview().counts, add: 1 } }))).toBe('1 person will be added to your leads');
    expect(addedTitle(preview({ counts: { ...preview().counts, add: 0 } }))).toBe('Nobody in this file can be added');
  });

  it('where they heard of you is the saved choice, with the file word beside it', () => {
    expect(heardLine({ source: 'social', sourceWord: 'Instagram' })).toBe('Social media · Instagram');
    expect(heardLine({ source: 'walk_in', sourceWord: null })).toBe('Walked in');
  });

  it('each person not added says why, and a row with no name is called by its row', () => {
    expect(notAddedRow({ row: 4, fullName: 'Jo Lane', reason: 'already_lead', sameAs: null })).toEqual({
      name: 'Jo Lane',
      why: 'Already one of your leads — left as they are',
    });
    expect(notAddedRow({ row: 7, fullName: 'Nia O.', reason: 'repeated', sameAs: 'Nia Obi' }).why).toBe('Same email or phone as Nia Obi');
    expect(notAddedRow({ row: 9, fullName: '', reason: 'no_name', sameAs: null })).toEqual({ name: 'Row 9', why: 'No name' });
    expect(notAddedRow({ row: 8, fullName: 'Omar Pike', reason: 'no_contact', sameAs: null }).why).toBe('No email or phone number');
    expect(notAddedRow({ row: 3, fullName: 'Kate Moss', reason: 'already_member', sameAs: null }).why).toBe('Already a member');
  });

  it('rows past the ones listed are counted', () => {
    expect(unlistedNotAdded(preview({ counts: { ...preview().counts, notAdded: 205 }, notAdded: new Array(200).fill(null) }))).toBe(5);
    expect(unlistedNotAdded(preview())).toBe(0);
  });

  it("a column's cells are said as examples, never as the people it applies to", () => {
    expect(exampleLine({ samples: ['Asha', 'Ben', 'Cara'] })).toBe('e.g. Asha, Ben, Cara');
    expect(exampleLine({ samples: [] })).toBe('Empty');
  });

  it('the columns in three lines: read, not used, left out with the reason', () => {
    const columns = [
      { index: 0, header: 'Name', samples: [], guess: 'fullName', neverKept: null },
      { index: 1, header: 'Email', samples: [], guess: 'email', neverKept: null },
      { index: 2, header: 'Phone', samples: [], guess: 'phone', neverKept: null },
      { index: 3, header: 'Lead Source', samples: [], guess: 'source', neverKept: null },
      { index: 4, header: 'Opted to Receive Marketing', samples: [], guess: null, neverKept: null },
      { index: 5, header: 'Card Number', samples: [], guess: null, neverKept: 'payment_card' },
    ];
    expect(columnLines(preview({ columns }))).toEqual([
      { key: 'read', label: 'Read', text: 'Name, Email, Phone, Lead Source' },
      { key: 'unused', label: 'Not used', text: 'Opted to Receive Marketing' },
      { key: 'leftOut', label: 'Left out', text: 'Card Number (we never keep card numbers)' },
    ]);
  });
});

describe('the Add button', () => {
  it('is pressed only with the columns checked, somebody to add, room for them and the box ticked', () => {
    const p = preview();
    expect(addButton({ preview: p, mapping: MAPPING, ticked: true, readOnly: false })).toEqual({ label: 'Add 2 leads', enabled: true, why: null });
    expect(addButton({ preview: p, mapping: MAPPING, ticked: false, readOnly: false })).toMatchObject({ enabled: false, why: 'Tick the box above to add them.' });
    expect(addButton({ preview: p, mapping: withRole(MAPPING, 3, ''), ticked: true, readOnly: false }).enabled).toBe(false);
    expect(addButton({ preview: p, mapping: MAPPING, ticked: true, readOnly: true }).enabled).toBe(false);
    expect(addButton({ preview: preview({ room: 1 }), mapping: MAPPING, ticked: true, readOnly: false })).toMatchObject({
      enabled: false,
      why: LEAD_FILE_WORDS.full(1, 2),
    });
    const none = preview({ add: [], counts: { ...p.counts, add: 0 } });
    expect(addButton({ preview: none, mapping: MAPPING, ticked: true, readOnly: false }).enabled).toBe(false);
    expect(addButton({ preview: preview({ counts: { ...p.counts, add: 1 } }), mapping: MAPPING, ticked: true, readOnly: false }).label).toBe('Add 1 lead');
  });
});

// 23d-ii: the one warning that needs the gym's country names that place.
describe('the notes over a file of leads', () => {
  it("each warning's sentence, and the country's place on the one that asks for it", () => {
    const lines = warningLines({ warnings: [{ code: 'phones_need_country', rows: 2 }, { code: 'phones_unusual', rows: 1 }] });
    expect(lines).toEqual([
      {
        text: "2 phone numbers were left out because this gym has no country set. Set the gym's country, or write the numbers with their country code, and check again.",
        place: 'country',
      },
      { text: '1 phone number looks mistyped. It was kept as written.', place: null },
    ]);
  });
});
