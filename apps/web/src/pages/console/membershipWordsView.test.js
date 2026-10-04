// Memberships from your list, their words (spec Part 3 §13.2; ROADMAP 17a-iii).
import { describe, expect, it } from 'vitest';
import {
  UNLINK_QUESTION,
  asksPaid,
  boxProblem,
  boxWords,
  doneWords,
  giveGroups,
  givenCount,
  groupNames,
  leftOut,
  linkBody,
  linkedLine,
  packNote,
  paidQuestion,
  personNote,
  wordLine,
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
const preview = (over = {}) => ({ today: '2026-10-04', word: 'Gold', type: GOLD, counts: counts(), people: [], ...over });
const ALL = { settled: true, due: true, ask: true };

describe('a word on the list', () => {
  it('says how many people have it, and what a link has done', () => {
    expect(wordLine({ word: 'Gold', people: 42 })).toBe('Gold · 42 people');
    expect(wordLine({ word: 'Day guest', people: 1 })).toBe('Day guest · 1 person');
    expect(wordLine({ word: 'Gold', people: 2100 })).toBe('Gold · 2,100 people');
    const link = (over) => ({ word: 'Gold', people: 42, link: { typeId: GOLD.id, typeName: 'Gold Monthly', typeArchived: false, waiting: 0, ...over } });
    expect(linkedLine({ word: 'Gold', people: 42, link: null })).toBeNull();
    expect(linkedLine(link({}))).toEqual({ text: 'Linked to Gold Monthly. Everyone with Gold on your list has it, or has had it.', canGive: false });
    expect(linkedLine(link({ waiting: 3 }))).toEqual({ text: "Linked to Gold Monthly. 3 people with Gold on your list don't have it yet.", canGive: true });
    expect(linkedLine(link({ waiting: 1 })).text).toBe("Linked to Gold Monthly. 1 person with Gold on your list doesn't have it yet.");
    expect(linkedLine(link({ waiting: 3, typeArchived: true })).canGive).toBe(false);
    expect(UNLINK_QUESTION(link({}))).toBe("Remove the link between Gold and Gold Monthly? Nobody's membership changes. You can link it again.");
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

  it('a group shows three names, then how many more, then all of them', () => {
    const people = [1, 2, 3, 4, 5].map((n) => person(n, 'settled', { renewsOn: '2026-11-14' }));
    const p = preview({ counts: counts({ settled: 300 }), people });
    const few = groupNames(p, 'settled', false);
    expect(few.names.map((n) => n.text)).toEqual(['Person 1 (renews 14 November 2026)', 'Person 2 (renews 14 November 2026)', 'Person 3 (renews 14 November 2026)']);
    expect(few.more).toBe(297);
    expect(few.canSeeAll).toBe(true);
    const all = groupNames(p, 'settled', true);
    expect(all.names).toHaveLength(5);
    // The server named five of three hundred.
    expect(all.unnamed).toBe(295);
    expect(groupNames(preview({ counts: counts({ has: 2 }), people: [person(1, 'has'), person(2, 'has')] }), 'has', false)).toMatchObject({ more: 0, canSeeAll: false });
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
    expect(groups[1].detail).toContain('"Payment due" since that date');
    expect(groups[2].detail).toBe('Your list has no renewal date for them, so their membership starts today.');
    // A type that ends keeps the list's end date, and one that is free has nothing to pay.
    const term = { ...GOLD, name: 'Three months', kind: 'one_time', termCount: 3 };
    expect(giveGroups(preview({ type: term, counts: counts({ ask: 2 }) }))[0].detail).toBe('Where your list has an end date for them they keep it; otherwise it starts today.');
    expect(giveGroups(preview({ type: { ...term, priceMinor: 0 }, counts: counts({ settled: 2 }) }))[0].title).toBe('2 people · nothing to pay');
  });

  it('everybody left out has a reason', () => {
    expect(leftOut(preview())).toEqual([]);
    expect(leftOut(preview({ counts: counts({ has: 3, ended: 1, full: 1, day: 2, past: 5 }) })).map((l) => l.text)).toEqual([
      '3 people already have Gold Monthly, or had it before.',
      '1 person: your list says their membership has ended.',
      '1 person already has as many memberships running as one person can.',
      '2 people: the date in your list is too far away to use. Add their membership on their own page.',
      '5 past members have Gold too. They are not on your list now, so they get nothing.',
    ]);
    expect(leftOut(preview({ counts: counts({ has: 1, past: 1 }) })).map((l) => l.text)).toEqual([
      '1 person already has Gold Monthly, or had it before.',
      '1 past member has Gold too. They are not on your list now, so they get nothing.',
    ]);
  });
});

describe('the button says how many, and nothing is sent that staff did not tick', () => {
  const p = preview({ counts: counts({ settled: 38, due: 4, ask: 6, has: 3 }) });

  it('counts only the ticked groups', () => {
    expect(givenCount(p, ALL)).toBe(48);
    expect(givenCount(p, { ...ALL, due: false })).toBe(44);
    expect(boxWords(p, ALL)).toEqual({ heading: 'Give Gold Monthly to people with Gold on your list?', button: 'Give Gold Monthly to 48 people', nobody: null });
    expect(boxWords(p, { settled: false, due: false, ask: false })).toEqual({
      heading: 'Give Gold Monthly to people with Gold on your list?',
      button: 'Link Gold to Gold Monthly',
      nobody: 'Nobody is given Gold Monthly now. The link is kept, so you can give it later.',
    });
    expect(boxWords(preview({ counts: counts({ settled: 1 }) }), ALL).button).toBe('Give Gold Monthly to 1 person');
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
      expected: { settled: 38, due: 4, ask: 6 },
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
    expect(doneWords(0, 'Gold', 'Gold Monthly')).toBe('Gold is linked to Gold Monthly. Nobody was given it.');
  });
});

describe("a membership from the list on a person's page", () => {
  const held = (over = {}, view = {}) => ({
    kind: 'recurring',
    startsOn: '2026-09-14',
    frozenOn: null,
    fromList: true,
    ...over,
    view: { status: 'active', endsOn: null, renewsOn: '2026-11-14', ...view },
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
    // One given by hand reads as it did.
    expect(datesLine(held({ fromList: false }))).toBe('Started 14 September 2026 · Renews 14 November 2026');
  });
});
