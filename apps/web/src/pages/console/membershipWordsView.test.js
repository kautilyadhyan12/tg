// The member list's memberships, their words (spec Part 3 §13.2; ROADMAP 17a-iii).
import { describe, expect, it } from 'vitest';
import {
  NAMES_PAGE,
  NAMES_SHOWN,
  afterImportSteps,
  againWords,
  archivedLine,
  asksPaid,
  boxLabels,
  boxProblem,
  boxWords,
  chooserWords,
  doneWords,
  formWordsFor,
  giveGroups,
  givenCount,
  groupNames,
  isRenewal,
  leftOut,
  linkBody,
  nameLine,
  notSetUp,
  packNote,
  paidQuestion,
  renewNote,
  personNote,
  renewLead,
  startTicks,
  tieButton,
  typeTies,
  undoWords,
  withSetUpCount,
} from './membershipWordsView';
import { datesLine } from './heldMembershipsView';

const GOLD = { id: '22222222-2222-4222-8222-000000000001', name: 'Gold Monthly', kind: 'recurring', priceMinor: 4999, currency: 'GBP', termCount: 1, termUnit: 'month', packClasses: null, packDays: null };
const person = (n, group, over = {}) => ({
  entryId: `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`,
  fullName: `Person ${String(n)}`,
  group,
  dated: true,
  renewsOn: null,
  endsOn: null,
  since: null,
  ...over,
});
const counts = (over = {}) => ({ settled: 0, due: 0, ask: 0, has: 0, full: 0, ended: 0, day: 0, past: 0, ...over });
const DIGEST = 'a'.repeat(64);
const preview = (over = {}) => ({ today: '2026-10-04', word: 'Gold', type: GOLD, ownName: false, digest: DIGEST, counts: counts(), people: [], ...over });
const ALL = { settled: true, due: true, ask: true };

describe("the member list's names are part of the gym's one list of memberships", () => {
  const SILVER = { ...GOLD, id: '22222222-2222-4222-8222-000000000002', name: 'Silver Monthly' };
  const name = (over = {}) => ({ word: 'Gold', people: 42, link: null, sameName: null, ...over });
  const counted = (over = {}) => name({ link: { typeId: GOLD.id, typeName: 'Gold Monthly', typeArchived: false, waiting: 0, ownName: false, ...over } });
  const own = (waiting) => name({ word: 'Gold Monthly', people: 3, sameName: { typeId: GOLD.id, typeName: 'Gold Monthly', waiting } });

  it('a name that is no type yet waits to be set up; one that is a type does not', () => {
    const words = [name(), counted({}), own(2), own(0), name({ word: 'Student', people: 2 })];
    expect(notSetUp(words).map((w) => w.word)).toEqual(['Gold', 'Student']);
    expect(nameLine(name())).toBe('“Gold” · 42 people');
    expect(nameLine(name({ word: 'Day guest', people: 1 }))).toBe('“Day guest” · 1 person');
    expect(nameLine(name({ people: 2100 }))).toBe('“Gold” · 2,100 people');
    expect(archivedLine(name())).toBeNull();
    // Its type was archived: it cannot be given, so it is to be set up again.
    const archived = counted({ typeArchived: true });
    expect(notSetUp([archived])).toEqual([archived]);
    expect(archivedLine(archived)).toBe('You set this up as Gold Monthly, which is now archived. Put Gold Monthly back, or set “Gold” up again.');
    expect(againWords(archived)).toEqual({
      question: "Set “Gold” up again? It will no longer count as Gold Monthly, which is archived. Nobody's membership changes.",
      confirm: 'Set it up again',
      done: "“Gold” no longer counts as Gold Monthly. Nobody's membership changed. Set it up below.",
    });
  });

  it('the closed section says how many names wait', () => {
    expect(withSetUpCount(undefined, [name()])).toBeUndefined();
    expect(withSetUpCount('Nothing for sale yet', [])).toBe('Nothing for sale yet');
    expect(withSetUpCount('Nothing for sale yet', [name(), name({ word: 'Silver' })])).toBe('Nothing for sale yet · 2 on your member list to set up');
    expect(withSetUpCount('4 membership types', [name(), counted({}), own(0)])).toBe('4 membership types · 1 on your member list to set up');
  });

  it("a type's row says which name on the list it is, and offers the people who do not have it", () => {
    expect(typeTies(GOLD, [name(), name({ word: 'Silver' })])).toEqual([]);
    expect(typeTies(SILVER, [counted({})])).toEqual([]);
    const all = counted({});
    expect(typeTies(GOLD, [all])).toEqual([{ word: all, text: 'On your member list this is “Gold” · 42 people.', give: false, renew: false, first: false, undo: true, own: false }]);
    // Some were given it and some were not, perhaps on purpose: the numbers, and a look at who can get it.
    const some = counted({ waiting: 3 });
    expect(typeTies(GOLD, [some])).toEqual([{ word: some, text: 'On your member list this is “Gold” · 42 people. 3 of them have never had it.', give: true, renew: false, first: false, undo: true, own: false }]);
    expect(tieButton(GOLD, typeTies(GOLD, [some])[0])).toEqual({ label: 'See who can get it', aria: 'See who with Gold on your member list can get Gold Monthly', main: false });
    expect(typeTies(GOLD, [counted({ waiting: 1 })])[0].text).toBe('On your member list this is “Gold” · 42 people. 1 of them has never had it.');
    // Nobody with the name has had it: they are offered it outright.
    const none = counted({ waiting: 42 });
    expect(typeTies(GOLD, [none])).toEqual([{ word: none, text: 'On your member list this is “Gold” · 42 people. They have never had it.', give: true, renew: false, first: true, undo: true, own: false }]);
    expect(tieButton(GOLD, typeTies(GOLD, [none])[0])).toEqual({ label: 'Give it to them', aria: 'Give Gold Monthly to the people with Gold on your member list', main: true });
    // Two names can be one type.
    expect(typeTies(GOLD, [all, counted({}), name({ word: 'Gold (old)', link: { typeId: GOLD.id, typeName: 'Gold Monthly', typeArchived: false, waiting: 0, ownName: false } })])).toHaveLength(3);
    // An archived type has no row to say it on.
    expect(typeTies(GOLD, [counted({ typeArchived: true })])).toEqual([]);
    expect(undoWords(all)).toEqual({
      button: "This isn't “Gold”",
      question: "Stop counting “Gold” on your member list as Gold Monthly? Nobody's membership changes: to take one away, cancel it on that person's page. “Gold” goes back under “not set up yet”.",
      confirm: 'Stop counting it',
      done: "Done. Nobody's membership changed. “Gold” is back under “not set up yet”.",
    });
  });

  it("a name that is a type's own name is never asked about: its row offers the people without it, or says nothing", () => {
    // Kd's click-through: "Gold Monthly" on the list beside a type called Gold Monthly.
    expect(typeTies(GOLD, [own(0)])).toEqual([]);
    const two = own(2);
    expect(typeTies(GOLD, [two])).toEqual([{ word: two, text: 'On your member list 3 people have Gold Monthly. 2 of them have never had it here.', give: true, renew: false, first: false, undo: false, own: true }]);
    expect(tieButton(GOLD, typeTies(GOLD, [two])[0])).toEqual({ label: 'See who can get it', aria: 'See who on your member list can get Gold Monthly', main: false });
    expect(typeTies(GOLD, [own(1)])[0].text).toBe('On your member list 3 people have Gold Monthly. 1 of them has never had it here.');
    // None of them has it: offered outright.
    const three = own(3);
    expect(typeTies(GOLD, [three])).toEqual([{ word: three, text: '3 people on your member list have Gold Monthly, but it is not on their pages yet.', give: true, renew: false, first: true, undo: false, own: true }]);
    expect(tieButton(GOLD, typeTies(GOLD, [three])[0])).toEqual({ label: 'Give it to them', aria: 'Give Gold Monthly to the people on your member list', main: true });
    const one = name({ word: 'Gold Monthly', people: 1, sameName: { typeId: GOLD.id, typeName: 'Gold Monthly', waiting: 1 } });
    expect(typeTies(GOLD, [one])[0].text).toBe('1 person on your member list has Gold Monthly, but it is not on their page yet.');
    // The same once the server holds it as counted: no "this is “Gold Monthly”", nothing to undo.
    // Whether a name is the type's own is the server's answer (`ownName`): the screen never
    // folds two names itself, so letters the two would fold differently cannot part them.
    const held = name({ word: 'GOLD MONTHLY', people: 3, link: { typeId: GOLD.id, typeName: 'Gold Monthly', typeArchived: false, waiting: 1, ownName: true } });
    expect(typeTies(GOLD, [held])).toEqual([{ word: held, text: 'On your member list 3 people have Gold Monthly. 1 of them has never had it here.', give: true, renew: false, first: false, undo: false, own: true }]);
    // The same spelling the server does NOT call the type's own is a name staff tied to it.
    const tied = { ...held, link: { ...held.link, ownName: false } };
    expect(typeTies(GOLD, [tied])[0]).toMatchObject({ undo: true, own: false, text: 'On your member list this is “GOLD MONTHLY” · 3 people. 1 of them has never had it.' });
    expect(typeTies(GOLD, [{ ...held, link: { ...held.link, waiting: 0 } }])).toEqual([]);
  });

  it('a membership that ended and has a later end date on the list can be renewed from its row', () => {
    const TERM = { ...GOLD, id: '22222222-2222-4222-8222-000000000003', name: '3 Months', kind: 'one_time', termCount: 3 };
    const term = (over) => name({ word: '3 Month Plan', people: 8, link: { typeId: TERM.id, typeName: '3 Months', typeArchived: false, waiting: 0, again: 0, ownName: false, ...over } });
    // Nobody waits: the row offers nothing.
    expect(typeTies(TERM, [term({})])[0]).toMatchObject({ give: false, renew: false });
    // Only renewals wait: the row says so in a whole sentence, and its button renews.
    const two = typeTies(TERM, [term({ again: 2 })])[0];
    expect(two.text).toBe("On your member list this is “3 Month Plan” · 8 people. 2 people's 3 Months has ended, and your member list now shows a later end date for them. You can renew it.");
    expect(two).toMatchObject({ give: true, renew: true, first: false });
    expect(tieButton(TERM, two)).toEqual({ label: 'Renew memberships', aria: 'Renew 3 Months for the people with 3 Month Plan on your member list', main: false });
    expect(typeTies(TERM, [term({ again: 1 })])[0].text).toBe("On your member list this is “3 Month Plan” · 8 people. 1 person's 3 Months has ended, and your member list now shows a later end date for them. You can renew it.");
    // Some never had it too: both are said, and the button is the usual one.
    const both = typeTies(TERM, [term({ waiting: 3, again: 2 })])[0];
    expect(both.text).toBe("On your member list this is “3 Month Plan” · 8 people. 3 of them have never had it. 2 people's 3 Months has ended, and your member list now shows a later end date for them. You can renew it.");
    expect(tieButton(TERM, both).label).toBe('See who can get it');
    // The type's own name on the list: a row appears for the renewals alone.
    const ownTerm = name({ word: '3 Months', people: 5, sameName: { typeId: TERM.id, typeName: '3 Months', waiting: 0, again: 1 } });
    const row = typeTies(TERM, [ownTerm])[0];
    expect(row.text).toBe("On your member list 5 people have 3 Months. 1 person's 3 Months has ended, and your member list now shows a later end date for them. You can renew it.");
    expect(tieButton(TERM, row)).toEqual({ label: 'Renew memberships', aria: 'Renew 3 Months for the people on your member list', main: false });
    // A reply from before the server sent the number reads as none.
    expect(typeTies(TERM, [name({ word: '3 Months', people: 5, sameName: { typeId: TERM.id, typeName: '3 Months', waiting: 0 } })])).toEqual([]);
  });

  it('a box of renewals says Renew from its heading to its button, and opens with its people ticked', () => {
    const TERM = { ...GOLD, name: '3 Months', kind: 'one_time', termCount: 3 };
    expect(personNote(person(1, 'ask', { endsOn: '2026-11-25', again: true }))).toBe('renewal, ends 25 November 2026');
    expect(personNote(person(2, 'ask', { endsOn: '2026-11-25', again: false }))).toBe('ends 25 November 2026');
    // Everybody the box can give it to held it before: a renewal.
    const all = preview({ type: TERM, word: '3 Month Plan', counts: counts({ ask: 2, has: 1, again: 2 }) });
    expect(isRenewal(all)).toBe(true);
    expect(boxWords(all, ALL, true)).toEqual({ heading: 'Renew 3 Months for 2 people?', button: 'Renew 3 Months for 2 people', nobody: null });
    expect(boxWords(all, { settled: false, due: false, ask: false }, true)).toEqual({ heading: 'Renew 3 Months for 2 people?', button: null, nobody: 'Tick who to renew.' });
    expect(renewLead(all)).toBe('Their 3 Months has ended, and your member list now shows a later end date for them. Each gets a new 3 Months up to the date beside their name.');
    expect(boxLabels(all)).toEqual({ gets: 'Who is renewed', not: "Who isn't" });
    expect(giveGroups(all)).toEqual([{ key: 'ask', title: '2 people to renew', detail: null }]);
    // The list's own later date says they renewed: they are ticked, though others already hold it.
    expect(startTicks(all)).toEqual({ settled: true, due: true, ask: true });
    // Said once, under the heading, not again under the names.
    expect(renewNote(all)).toBeNull();
    const one = preview({ type: TERM, counts: counts({ ask: 1, again: 1 }) });
    expect(boxWords(one, ALL, true).heading).toBe('Renew 3 Months for 1 person?');
    expect(renewLead(one)).toBe("This person's 3 Months has ended, and your member list now shows a later end date for them. They get a new 3 Months up to that date.");
    // A free membership has nothing to pay, and says so beside the renewal.
    const freeOnes = preview({ type: { ...TERM, priceMinor: 0 }, counts: counts({ settled: 2, again: 2 }) });
    expect(giveGroups(freeOnes)[0].title).toBe('2 people to renew · nothing to pay');

    // Mixed with somebody new, it stays the usual box, and says which of them are renewals.
    const mixed = preview({ type: TERM, word: '3 Month Plan', counts: counts({ ask: 3, has: 1, again: 2 }) });
    expect(isRenewal(mixed)).toBe(false);
    expect(boxWords(mixed, ALL, true)).toEqual({ heading: 'Give 3 Months to the people with “3 Month Plan” on your member list?', button: 'Give 3 Months to 3 people', nobody: null });
    expect(renewLead(mixed)).toBeNull();
    expect(boxLabels(mixed)).toEqual({ gets: 'Who gets it', not: "Who doesn't" });
    expect(giveGroups(mixed)[0]).toEqual({ key: 'ask', title: "3 people · your list doesn't say if they have paid", detail: 'Where your list has an end date for them they keep it; otherwise it starts today.' });
    expect(startTicks(mixed)).toEqual({ settled: false, due: false, ask: false });
    expect(renewNote(mixed)).toBe('2 of these people had 3 Months before and it has ended. Your member list now shows a later end date for them, so this renews it up to that date.');
    expect(renewNote(preview({ type: TERM, counts: counts({ ask: 3, again: 1 }) }))).toBe('1 of these people had 3 Months before and it has ended. Your member list now shows a later end date for them, so this renews it up to that date.');
    // A reply from before the server sent the number is no renewal.
    expect(isRenewal(preview({ type: TERM, counts: counts({ ask: 3 }) }))).toBe(false);
    expect(renewNote(preview({ type: TERM, counts: counts({ ask: 3 }) }))).toBeNull();
  });

  it('after an import, what is still to do about memberships is a sentence and a button each, the renewals first', () => {
    const TERM_ID = '22222222-2222-4222-8222-000000000003';
    const WORDS = { person: 'member', people: 'members' };
    const linked = (over) => name({ word: '3 Month Plan', people: 8, link: { typeId: TERM_ID, typeName: '3 Months', typeArchived: false, waiting: 0, again: 0, ownName: false, ...over } });
    // Nothing waits: nothing is said.
    expect(afterImportSteps([linked({})], WORDS)).toEqual([]);
    // A name that is not set up is not nagged about here: the gym may keep its memberships elsewhere.
    expect(afterImportSteps([name({ word: 'Silver' })], WORDS)).toEqual([]);
    expect(afterImportSteps([linked({ typeArchived: true, again: 2 })], WORDS)).toEqual([]);
    expect(afterImportSteps([linked({ again: 2 })], WORDS)).toEqual([
      { key: `renew-${TERM_ID}-3 Month Plan`, typeId: TERM_ID, word: '3 Month Plan', text: "2 members' 3 Months has ended, and your member list now shows a later end date for them.", button: 'Renew their memberships' },
    ]);
    expect(afterImportSteps([linked({ again: 1 })], WORDS)[0]).toMatchObject({ text: "1 member's 3 Months has ended, and your member list now shows a later end date for them.", button: 'Renew their membership' });
    // New people with a name that is set up, and the renewals before them.
    const both = afterImportSteps([linked({ waiting: 3, again: 2 }), name({ word: 'Gold Monthly', people: 4, sameName: { typeId: GOLD.id, typeName: 'Gold Monthly', waiting: 1, again: 0 } })], WORDS);
    expect(both.map((s) => s.button)).toEqual(['Renew their memberships', 'Give them 3 Months', 'Give them Gold Monthly']);
    expect(both[1].text).toBe('3 members have “3 Month Plan” on your member list and have not been given 3 Months yet.');
    expect(both[2].text).toBe('1 member has Gold Monthly on your member list, but it is not on their page yet.');
    // A studio's own word for its people.
    expect(afterImportSteps([linked({ again: 2 })], { person: 'client', people: 'clients' })[0].text).toBe("2 clients' 3 Months has ended, and your client list now shows a later end date for them.");
  });

  it('Set up asks whether it is one of the memberships above or a new one, and the form opens with its name', () => {
    expect(chooserWords(name())).toEqual({
      question: 'What is “Gold” at your gym?',
      existing: 'One of the memberships above',
      pick: 'Choose one',
      fresh: "A new membership. I'll add its price now.",
    });
    expect(formWordsFor(name())).toEqual({
      heading: 'Add “Gold” as a membership type',
      hint: '42 people on your member list have “Gold”. Add its price and how it is paid. Next you choose who gets it.',
    });
    expect(formWordsFor(name({ people: 1 })).hint).toBe('1 person on your member list has “Gold”. Add its price and how it is paid. Next you choose who gets it.');
  });
});

describe('the box names who gets it and who does not', () => {
  it('each person has the date they will read', () => {
    expect(personNote(person(1, 'settled', { renewsOn: '2026-11-14' }))).toBe('renews 14 November 2026');
    expect(personNote(person(1, 'settled', { endsOn: '2026-12-31' }))).toBe('ends 31 December 2026');
    expect(personNote(person(1, 'due', { since: '2026-09-03', renewsOn: '2026-10-03' }))).toBe('due since 3 September 2026');
    expect(personNote(person(1, 'ask', { dated: false, renewsOn: '2026-11-04' }))).toBe('starts today');
    expect(personNote(person(1, 'ask', { endsOn: '2026-12-31' }))).toBe('ends 31 December 2026');
    expect(personNote(person(1, 'ended', { endsOn: '2026-08-03' }))).toBe('ended 3 August 2026');
    expect(personNote(person(1, 'has'))).toBe('');
  });

  it('a group is a list of rows, one person each: three at first, then a page at a time', () => {
    const people = [1, 2, 3, 4, 5].map((n) => person(n, 'settled', { renewsOn: '2026-11-14' }));
    const p = preview({ counts: counts({ settled: 300 }), people });
    const few = groupNames(p, 'settled', NAMES_SHOWN);
    expect(few.rows).toEqual([
      { id: people[0].entryId, name: 'Person 1', note: 'Renews 14 November 2026' },
      { id: people[1].entryId, name: 'Person 2', note: 'Renews 14 November 2026' },
      { id: people[2].entryId, name: 'Person 3', note: 'Renews 14 November 2026' },
    ]);
    // 297 of the group are not on screen, and See all can show two of them: the server named five.
    expect(few.more).toBe(297);
    expect(few.waiting).toBe(2);
    const all = groupNames(p, 'settled', NAMES_PAGE);
    expect(all.rows).toHaveLength(5);
    expect(all.more).toBe(295);
    expect(all.waiting).toBe(0);
    // A short group has nothing more; a person with no name or no day still has a row.
    const short = preview({ counts: counts({ has: 2 }), people: [person(1, 'has'), person(2, 'has', { fullName: '' })] });
    expect(groupNames(short, 'has', NAMES_SHOWN)).toEqual({
      rows: [
        { id: short.people[0].entryId, name: 'Person 1', note: '' },
        { id: short.people[1].entryId, name: 'No name', note: '' },
      ],
      more: 0,
      waiting: 0,
    });
    expect(NAMES_PAGE).toBe(100);
  });

  it('only groups with somebody in them are drawn, each saying what its people will read', () => {
    expect(giveGroups(preview())).toEqual([]);
    const groups = giveGroups(preview({ counts: counts({ settled: 38, due: 4, ask: 1 }) }));
    expect(groups.map((g) => [g.key, g.title])).toEqual([
      ['settled', '38 people · paid up'],
      ['due', '4 people · payment due'],
      ['ask', "1 person · your list doesn't say if they have paid"],
    ]);
    expect(groups[0].detail).toContain('shows as paid until then');
    expect(groups[1].detail).toContain('"Payment due" from the month they are in now, never for the months before');
    expect(groups[2].detail).toBe('Your list has no renewal date for them, so their membership starts today.');
    // A type that ends keeps the list's end date, and one that is free has nothing to pay.
    const term = { ...GOLD, name: 'Three months', kind: 'one_time', termCount: 3 };
    expect(giveGroups(preview({ type: term, counts: counts({ ask: 2 }) }))[0].detail).toBe('Where your list has an end date for them they keep it; otherwise it starts today.');
    const freeGroup = giveGroups(preview({ type: { ...term, priceMinor: 0 }, counts: counts({ settled: 2 }) }))[0];
    expect(freeGroup.title).toBe('2 people · nothing to pay');
    expect(freeGroup.detail).toBe('Three months is free, so there is nothing to pay.');
  });

  it('everybody left out has a reason', () => {
    expect(leftOut(preview())).toEqual([]);
    expect(leftOut(preview({ counts: counts({ has: 3, ended: 1, full: 1, day: 2, past: 5 }) })).map((l) => l.text)).toEqual([
      '3 people already have Gold Monthly, or had it before.',
      '1 person: your list says their membership has ended.',
      '1 person already has as many memberships running as one person can.',
      "2 people: the date in your list can't be used. Add their membership on their own page.",
      '5 past members have “Gold” too. They are not on your list now, so they get nothing.',
    ]);
    expect(leftOut(preview({ counts: counts({ has: 1, past: 1 }) })).map((l) => l.text)).toEqual([
      '1 person already has Gold Monthly, or had it before.',
      '1 past member has “Gold” too. They are not on your list now, so they get nothing.',
    ]);
  });
});

describe('the button says how many, and nothing is sent that staff did not tick', () => {
  const p = preview({ counts: counts({ settled: 38, due: 4, ask: 6, has: 3 }) });

  it('counts only the ticked groups', () => {
    expect(givenCount(p, ALL)).toBe(48);
    expect(givenCount(p, { ...ALL, due: false })).toBe(44);
    expect(boxWords(p, ALL)).toEqual({ heading: 'Give Gold Monthly to the people with “Gold” on your member list?', button: 'Give Gold Monthly to 48 people', nobody: null });
    expect(boxWords(preview({ counts: counts({ settled: 1 }) }), ALL).button).toBe('Give Gold Monthly to 1 person');
    // Nobody ticked: the name can still be counted as the type, to give later.
    expect(boxWords(p, { settled: false, due: false, ask: false })).toEqual({
      heading: 'Give Gold Monthly to the people with “Gold” on your member list?',
      button: 'Count “Gold” as Gold Monthly',
      nobody: 'Tick who should get Gold Monthly. Or count “Gold” on your member list as Gold Monthly now, and give it to them later from this page.',
    });
    // Already counted as it: nothing to press until somebody is ticked.
    expect(boxWords(p, { settled: false, due: false, ask: false }, true)).toEqual({
      heading: 'Give Gold Monthly to the people with “Gold” on your member list?',
      button: null,
      nobody: 'Tick who should get Gold Monthly.',
    });
    // Nobody can be given it at all: the name can still be counted, once.
    const nobody = preview({ counts: counts({ has: 2, ended: 1 }) });
    expect(boxWords(nobody, ALL)).toMatchObject({ button: 'Count “Gold” as Gold Monthly', nobody: 'Nobody on your member list can be given Gold Monthly now. You can still count “Gold” on your member list as Gold Monthly.' });
    expect(boxWords(nobody, ALL, true)).toMatchObject({ button: null, nobody: 'Nobody on your member list can be given Gold Monthly now.' });
  });

  it('the box opens with everybody ticked the first time, and with nobody ticked where some already have it', () => {
    expect(startTicks(preview({ counts: counts({ settled: 4, due: 1, ask: 1 }) }))).toEqual({ settled: true, due: true, ask: true });
    // Some have it: the rest may have been left out on purpose.
    expect(startTicks(preview({ counts: counts({ settled: 1, due: 60, has: 300 }) }))).toEqual({ settled: false, due: false, ask: false });
  });

  it("where the list's name is the type's own name it is said once, and with nobody ticked there is nothing to press", () => {
    const own = preview({ word: 'GOLD MONTHLY', ownName: true, counts: counts({ settled: 2, has: 1 }) });
    expect(boxWords(own, ALL)).toEqual({ heading: 'Give Gold Monthly to the people who have it on your member list?', button: 'Give Gold Monthly to 2 people', nobody: null });
    expect(boxWords(own, { settled: false, due: false, ask: false })).toEqual({
      heading: 'Give Gold Monthly to the people who have it on your member list?',
      button: null,
      nobody: 'Tick who should get Gold Monthly.',
    });
    expect(boxWords(preview({ word: 'Gold Monthly', ownName: true, counts: counts({ ended: 1 }) }), ALL)).toEqual({
      heading: 'Give Gold Monthly to the people who have it on your member list?',
      button: null,
      nobody: 'Nobody on your member list can be given Gold Monthly now.',
    });
  });

  it('asks whether they paid only where somebody ticked needs the answer, and waits for it', () => {
    expect(asksPaid(p, ALL)).toBe(true);
    expect(asksPaid(p, { ...ALL, ask: false })).toBe(false);
    expect(asksPaid(preview({ counts: counts({ settled: 2 }) }), ALL)).toBe(false);
    expect(paidQuestion(p)).toEqual({ question: 'Have these 6 people paid the £49.99?', yes: 'Yes, they have paid', no: 'No, not yet' });
    expect(paidQuestion(preview({ counts: counts({ ask: 1 }) })).question).toBe('Has this person paid the £49.99?');
    expect(boxProblem(p, ALL, null)).toBe('Say whether they have paid.');
    expect(boxProblem(p, ALL, false)).toBeNull();
    expect(boxProblem(p, { ...ALL, ask: false }, null)).toBeNull();
  });

  it('sends the ticks, the numbers the box showed, and the answer only where it was asked', () => {
    expect(linkBody(p, ALL, true)).toEqual({
      word: 'Gold',
      typeId: GOLD.id,
      groups: { settled: true, due: true, ask: true },
      // The box as it was shown goes back with the press.
      digest: DIGEST,
      paid: true,
    });
    // An answer picked, then the group unticked: it is not sent.
    expect(linkBody(p, { ...ALL, ask: false }, true).paid).toBeNull();
    expect(linkBody(p, { ...ALL, ask: false }, true).groups.ask).toBe(false);
  });

  it('a pack says its classes are not on the list', () => {
    const pack = { ...GOLD, name: '10 classes', kind: 'pack', termCount: null, termUnit: null, packClasses: 10, packDays: 60 };
    expect(packNote(preview({ type: pack }))).toBe("Each gets all 10 classes: your list doesn't say how many they have used.");
    expect(packNote(preview({ type: { ...pack, packClasses: 1, packDays: 1 } }))).toBeNull();
    expect(packNote(p)).toBeNull();
  });

  it('says back what the press did', () => {
    expect(doneWords(48, 'Gold', 'Gold Monthly')).toBe("48 people now have Gold Monthly. You can see it on each person's page.");
    expect(doneWords(1, 'Gold', 'Gold Monthly')).toBe("1 person now has Gold Monthly. You can see it on each person's page.");
    expect(doneWords(0, 'Gold', 'Gold Monthly')).toBe('“Gold” on your member list now counts as Gold Monthly. Nobody was given it.');
  });
});

describe("a membership from the list on a person's page", () => {
  const held = (over = {}, view = {}) => ({
    kind: 'recurring',
    startsOn: '2026-09-14',
    frozenOn: null,
    fromList: true,
    ...over,
    view: { status: 'active', endsOn: null, renewsOn: '2026-11-14', payment: null, ...view },
  });

  it('never prints the worked-back start day as the day the person started', () => {
    expect(datesLine(held())).toBe('From your list · Renews 14 November 2026');
    expect(datesLine(held({ kind: 'one_time' }, { renewsOn: null, endsOn: '2026-12-31' }))).toBe('From your list · Ends 31 December 2026');
    expect(datesLine(held({}, { renewsOn: null, endsOn: '2026-11-13' }))).toBe("From your list · Ends 13 November 2026, won't renew");
    expect(datesLine(held({ frozenOn: '2026-10-01' }, { status: 'frozen', renewsOn: null }))).toBe('From your list · Frozen since 1 October 2026');
    expect(datesLine(held({}, { status: 'cancelled', renewsOn: null, endsOn: '2026-10-04' }))).toBe('From your list · Cancelled 4 October 2026');
    expect(datesLine(held({ kind: 'one_time' }, { status: 'ended', renewsOn: null, endsOn: '2026-10-01' }))).toBe('From your list · Ended 1 October 2026');
    for (const line of [datesLine(held()), datesLine(held({}, { status: 'cancelled', renewsOn: null, endsOn: '2026-10-04' }))]) {
      expect(line).not.toContain('14 September');
      expect(line).not.toContain('Started');
    }
    // Paid further ahead than one period (a year paid on a monthly type): the list's day,
    // which is the day they are paid up to, never the rule's next monthly renewal.
    expect(datesLine(held({}, { renewsOn: '2026-10-22', payment: { state: 'paid', until: '2027-04-22' } }))).toBe('From your list · Renews 22 April 2027');
    expect(datesLine(held({}, { renewsOn: '2026-11-14', payment: { state: 'paid', until: '2026-11-14' } }))).toBe('From your list · Renews 14 November 2026');
    expect(datesLine(held({}, { renewsOn: '2026-11-03', payment: { state: 'due', since: '2026-09-03' } }))).toBe('From your list · Renews 3 November 2026');
    // Free and renewing: nothing is paid up to the list's day, so no day is claimed as the list's.
    expect(datesLine(held({ priceMinor: 0 }, { renewsOn: '2026-10-22' }))).toBe('From your list');
    expect(datesLine(held({ priceMinor: 4999 }, { renewsOn: '2026-10-22' }))).toBe('From your list · Renews 22 October 2026');
    // One given by hand reads as it did.
    expect(datesLine(held({ fromList: false }))).toBe('Started 14 September 2026 · Renews 14 November 2026');
  });
});
