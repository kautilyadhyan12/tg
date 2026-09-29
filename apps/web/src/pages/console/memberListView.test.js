import { describe, expect, it } from 'vitest';
import {
  dateReading,
  datesToCheck,
  dayWords,
  doneWords,
  guardNumber,
  addedHere,
  handEditWords,
  marksBody,
  importedColumnCount,
  missingOf,
  missingStatusLine,
  missingTitle,
  neverKeptLines,
  skippedLine,
  skippedTitle,
  fileMissingOf,
  roleOfColumn,
  someNames,
  summaryOf,
  typedMatches,
  warningRowLine,
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
      shown
        ? [{ column: 3, order: 'dayFirst', read: '03/04/2026 is read as 3 April 2026', other: 'Change to 4 March 2026', columnName: 'Joined' }]
        : [],
    );
  });

  it.each([
    ['day first', { raw: '03/04/2024', read: '2024-04-03' }, '03/04/2024 is read as 3 April 2024', 'Change to 4 March 2024'],
    ['month first', { raw: '03/04/2024', read: '2024-03-04' }, '03/04/2024 is read as 4 March 2024', 'Change to 3 April 2024'],
    ['the same day both ways', { raw: '05/05/2024', read: '2024-05-05' }, '05/05/2024 is read as 5 May 2024', 'Change to 5 May 2024'],
    ['no other reading', { raw: '04/13/2024', read: '2024-04-13' }, '04/13/2024 is read as 13 April 2024', 'Switch day and month'],
  ])('says what a date was read as, and names the other reading (%s)', (_what, example, read, other) => {
    expect(dateReading(example)).toEqual({ read, other });
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
    ['five missing', pv({ list: list({ gone: 5 }), guard: { ...calm, entriesGoing: 5, listSize: 40 } }), { n: 5, listSize: 40, needsTick: false, statuses: [], group: 'gone' }],
    ['app members leaving with no entry gone', pv({ members: { leaving: 2, listedNow: 3 } }), { n: 2, listSize: 0, needsTick: false, statuses: [], group: 'members_leaving' }],
    ['the wrong-file check with nobody counted', pv({ guard: { ...calm, membersLeaving: 12, needsTick: true } }), { n: 12, listSize: 0, needsTick: true, statuses: [], group: 'members_leaving' }],
    ['an add asks nothing', pv({ mode: 'add', list: list({ gone: 5 }) }), null],
  ])('missing: %s', (_name, preview, want) => {
    expect(missingOf(preview)).toEqual(want);
  });

  it('people with no status are "No status", the Filter\'s own word, never a blank', () => {
    expect(missingStatusLine({ statuses: [{ label: 'Active', n: 2 }, { label: '', n: 1 }] })).toBe('Status: Active 2 · No status 1');
    expect(missingStatusLine({ statuses: [{ label: '', n: 3 }] })).toBe('Status: No status 3');
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
    expect(missingStatusLine(missing)).toBe('Status: Frozen 9 · Expired 3');
    expect(missingStatusLine({ ...missing, statuses: [] })).toBe('');
  });

  it.each([
    [{ n: 1, listSize: 40, needsTick: false }, "1 member isn't in this file"],
    [{ n: 2, listSize: 0, needsTick: false, group: 'members_leaving' }, "2 members who use the app aren't in this file"],
    [{ n: 1, listSize: 0, needsTick: false, group: 'members_leaving' }, "1 member who uses the app isn't in this file"],
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

// Kd, 2026-09-29, at 5b-v-d-ii's click-through: "Row 12: no email or phone … will not be
// understood by a human" and "Replace what staff typed for 1 person … have no context".
// Every line says whose row or whose details, what, and what happens.
// Kd, 2026-09-29, at 5b-v-d-ii's click-through, of "9 phone numbers look unusual":
// "asking to check but no option to check or correct or see what is even wrong".
describe('the rows each warning is about', () => {
  const row = (over) => ({ row: 6, name: 'Di Park', column: 'Mobile', cell: '00000000000', sameAsRow: null, ...over });
  it.each([
    ['phones_unusual', row(), 'Row 6, Di Park: Mobile “00000000000”'],
    ['phones_need_country', row({ column: 'Phone', cell: '07911 123457' }), 'Row 6, Di Park: Phone “07911 123457”'],
    ['shortened_by_excel', row({ column: 'Member No', cell: '1.23457E+15' }), 'Row 6, Di Park: Member No “1.23457E+15”'],
    ['dates_not_read', row({ column: 'Joined', cell: 'sometime in March' }), 'Row 6, Di Park: Joined “sometime in March”'],
    ['cells_cut', row({ column: 'Notes', cell: 'Knee injury cleared…' }), 'Row 6, Di Park: Notes “Knee injury cleared…”'],
    ['question_marks_in_names', row({ name: '?ukasz Nowak', column: null, cell: null }), 'Row 6, ?ukasz Nowak'],
    ['garbled_names', row({ name: 'H‚lŠne Dupont', column: null, cell: null }), 'Row 6, H‚lŠne Dupont'],
    ['card_cells_dropped', row({ column: 'Notes', cell: null }), 'Row 6, Di Park: a card number in Notes was removed'],
    ['shared_emails', row({ column: null, cell: 'family@example.com', sameAsRow: 9 }), 'Row 6, Di Park: family@example.com, also on row 9'],
    ['placeholders', row({ column: null, cell: 'desk@gym.example' }), 'Row 6, Di Park: desk@gym.example left out'],
    // A row with no name is found by its number alone.
    ['phones_unusual', row({ name: '' }), 'Row 6: Mobile “00000000000”'],
    // A cell the server would not quote is named by its column.
    ['dates_not_read', row({ column: 'Joined', cell: null }), 'Row 6, Di Park in Joined'],
  ])('%s %o', (code, w, words) => {
    expect(warningRowLine(code, w)).toBe(words);
  });
});

describe('rows a file leaves out, in words a front desk reads', () => {
  it.each([
    [{ row: 12, reason: 'no_contact', name: 'Walk-in Guest', sameAsRow: null }, "Row 12, Walk-in Guest: no email or phone number, so they can't be matched or invited. Add one to your file to import them."],
    [{ row: 12, reason: 'no_contact', name: '', sameAsRow: null }, "Row 12: no email or phone number, so they can't be matched or invited. Add one to your file to import them."],
    [{ row: 13, reason: 'duplicate', name: 'Ethan Brooks', sameAsRow: 10 }, "Row 13, Ethan Brooks: the same person as row 10, so they're imported once."],
    [{ row: 13, reason: 'duplicate', name: '', sameAsRow: 10 }, "Row 13: the same person as row 10, so they're imported once."],
    // A preview staged before rows carried a name or the row they repeat still reads.
    [{ row: 13, reason: 'duplicate' }, "Row 13: the same person as an earlier row, so they're imported once."],
    [{ row: 12, reason: 'no_contact' }, "Row 12: no email or phone number, so they can't be matched or invited. Add one to your file to import them."],
  ])('%o', (s, words) => {
    expect(skippedLine(s)).toBe(words);
  });

  it.each([
    [1, "1 row wasn't imported"],
    [2, "2 rows weren't imported"],
    [1200, "1,200 rows weren't imported"],
  ])('%i: %s', (n, words) => {
    expect(skippedTitle(n)).toBe(words);
  });
});

describe('details staff typed that a file would replace: whose, what, and the tick', () => {
  const WORDS = { people: 'members', person: 'member' };
  it.each([
    [
      'one person, one field',
      { entries: 1, fields: ['phone number'], names: ['Olivia Bennett'] },
      { lead: "Olivia Bennett's phone number was changed by your staff in this app. This file has a different one.", names: [], tick: 'Use the phone number from this file' },
    ],
    [
      'one person, two fields',
      { entries: 1, fields: ['phone number', 'status'], names: ['Olivia Bennett'] },
      { lead: "Olivia Bennett's phone number and status were changed by your staff in this app. This file has different ones.", names: [], tick: 'Use the phone number and status from this file' },
    ],
    [
      'one person with no name on the list',
      { entries: 1, fields: ['email'], names: [''] },
      { lead: "One member's email was changed by your staff in this app. This file has a different one.", names: [], tick: 'Use the email from this file' },
    ],
    [
      'several people, three fields',
      { entries: 4, fields: ['email', 'phone number', 'Locker'], names: ['Ada Lee', 'Bo Chen', 'Cy Diaz', 'Di Evans'] },
      {
        lead: 'Your staff changed the email, phone number and Locker of 4 members in this app. This file has different ones:',
        names: ['Ada Lee', 'Bo Chen', 'Cy Diaz', 'Di Evans'],
        tick: 'Use the email, phone number and Locker from this file for all 4',
      },
    ],
    [
      'a preview staged before names were sent',
      { entries: 3, fields: ['status'] },
      { lead: 'Your staff changed the status of 3 members in this app. This file has different ones.', names: [], tick: 'Use the status from this file for all 3' },
    ],
    [
      'a refusal, which never names a person',
      { entries: 3, fields: ['status'], names: [] },
      { lead: 'Your staff changed the status of 3 members in this app. This file has different ones.', names: [], tick: 'Use the status from this file for all 3' },
    ],
  ])('%s', (_, handEdits, said) => {
    expect(handEditWords(handEdits, WORDS)).toEqual(said);
  });

  it("a studio's clients are clients", () => {
    expect(handEditWords({ entries: 2, fields: ['status'], names: ['A', 'B'] }, { people: 'clients', person: 'client' }).lead).toBe(
      'Your staff changed the status of 2 clients in this app. This file has different ones:',
    );
  });
});

// WHO LEAVES (5b-v-d-i, amended 2026-09-29 by Kd: "manually added one should not be in the
// same list … by default added … untick or untick all"). Every class of person against
// every answer: the file's own people follow the card (They've left: the ticked, or all
// when none is ticked; They're still members: nobody); people added here follow their own
// tick, kept unless unticked, whatever the card says.
describe('who leaves: the one rule', () => {
  const on = (source) => ({ membershipType: null, endsOn: null, endsOnKind: null, paymentStatus: null, source, addedAt: '2026-09-29T09:00:00.000Z' });
  const Leo = { entryId: 'leo', onList: on('upload') };
  const Ana = { entryId: 'ana', onList: on('upload') };
  const Priya = { entryId: 'priya', onList: on('typed') };
  const Tom = { entryId: 'tom', onList: on('member') };
  const missing = { digest: 'd', people: [Leo, Ana, Priya, Tom] };
  const set = (...ids) => new Set(ids);
  const bothKept = set('priya', 'tom');

  it('who counts as added here: by hand or from the app, never a file record', () => {
    expect([Leo, Priya, Tom].map(addedHere)).toEqual([false, true, true]);
    expect(addedHere({ entryId: 'x', onList: null })).toBe(false);
  });

  it.each([
    // [what, left ticks, answer, kept, who leaves]
    ["They've left, nobody ticked: all the file's people, none added here", set(), 'left', bothKept, ['leo', 'ana']],
    ["They've left, Leo ticked: only Leo", set('leo'), 'left', bothKept, ['leo']],
    ["They've left, both ticked: both", set('leo', 'ana'), 'left', bothKept, ['leo', 'ana']],
    ["They're still members: nobody", set(), 'keep', bothKept, []],
    ["They're still members, Leo ticked: still nobody", set('leo'), 'keep', bothKept, []],
    ["They're still members, Priya unticked: Priya only", set(), 'keep', set('tom'), ['priya']],
    ["They've left, nobody ticked, everyone added here unticked: all four", set(), 'left', set(), ['leo', 'ana', 'priya', 'tom']],
    ["They've left, Ana ticked, Tom unticked: Ana and Tom", set('ana'), 'left', set('priya'), ['ana', 'tom']],
    ['no answer yet (only people added here are missing), Tom unticked: Tom', set(), null, set('priya'), ['tom']],
    ['no answer, everyone added here kept: nobody', set(), null, bothKept, []],
    // A tick in `left` on somebody added here means nothing: only their own tick counts.
    ["They've left with Priya in `left`: the file's two, Priya kept", set('priya'), 'left', bothKept, ['leo', 'ana']],
  ])('%s', (_, left, answer, kept, leaving) => {
    const body = marksBody(missing, left, answer, kept);
    expect(body.left).toEqual(leaving);
    expect(body.stay).toEqual(missing.people.map((p) => p.entryId).filter((id) => !leaving.includes(id)));
    expect(body.missingDigest).toBe('d');
  });

  it('with no ticks of their own given, people added here stay', () => {
    expect(marksBody(missing, set(), 'left').left).toEqual(['leo', 'ana']);
  });
});

// The buckets as the server sends them (`reconcile.ts` statusBreakdown): one per status folded
// (spaces and case ignored), labelled with the spelling first seen, and "" for everyone with
// no status. The people added here are taken out by the same fold (round one, High-1).
describe("the card's numbers once the people added here are counted apart", () => {
  const missing = (n, statuses) => ({ n, listSize: 13, needsTick: false, group: 'gone', statuses });
  it.each([
    ["nobody added here: the preview's own figures", missing(6, [{ label: 'Active', n: 1 }, { label: 'Cancelled', n: 5 }]), [], { n: 6, statuses: [{ label: 'Active', n: 1 }, { label: 'Cancelled', n: 5 }] }],
    ['Priya, Active, added here: one fewer, and Active gone from the line', missing(6, [{ label: 'Active', n: 1 }, { label: 'Cancelled', n: 4 }, { label: 'Expired', n: 1 }]), [{ wasStatus: 'Active' }], { n: 5, statuses: [{ label: 'Cancelled', n: 4 }, { label: 'Expired', n: 1 }] }],
    [
      'someone added from the app has no status: out of the "" bucket',
      missing(3, [{ label: 'Cancelled', n: 2 }, { label: '', n: 1 }]),
      [{ wasStatus: null }],
      { n: 2, statuses: [{ label: 'Cancelled', n: 2 }] },
    ],
    [
      'typed as "active", the file wrote "Active": out of the Active bucket',
      missing(4, [{ label: 'Cancelled', n: 2 }, { label: '', n: 1 }, { label: 'Active', n: 1 }]),
      [{ wasStatus: null }, { wasStatus: 'active' }],
      { n: 2, statuses: [{ label: 'Cancelled', n: 2 }] },
    ],
    ['spaces around a word fold too', missing(2, [{ label: 'Frozen', n: 2 }]), [{ wasStatus: ' Frozen ' }], { n: 1, statuses: [{ label: 'Frozen', n: 1 }] }],
    ['an empty word is no status', missing(2, [{ label: 'Frozen', n: 1 }, { label: '', n: 1 }]), [{ wasStatus: '  ' }], { n: 1, statuses: [{ label: 'Frozen', n: 1 }] }],
    ['everyone is added here: none left for the card', missing(6, [{ label: '', n: 6 }]), Array.from({ length: 6 }, () => ({ wasStatus: null })), { n: 0, statuses: [] }],
  ])('%s', (_, from, hand, want) => {
    expect(fileMissingOf(from, hand)).toEqual({ ...from, ...want });
  });

  it('the line under the card adds up to its heading', () => {
    const from = missing(4, [{ label: 'Cancelled', n: 2 }, { label: '', n: 1 }, { label: 'Active', n: 1 }]);
    const card = fileMissingOf(from, [{ wasStatus: null }, { wasStatus: 'ACTIVE' }]);
    expect(card.statuses.reduce((sum, st) => sum + st.n, 0)).toBe(card.n);
    expect(missingStatusLine(card)).toBe('Status: Cancelled 2');
  });
});
