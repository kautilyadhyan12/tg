// A person's memberships, in words (spec Part 3 §13.2; ROADMAP 17a-ii).
import { describe, expect, it } from 'vitest';
import { giveHeldMembership, heldMembershipSchema, heldMembershipView, moveHeldMembership } from '@app/shared';
import {
  askWords,
  classesLine,
  datesLine,
  doneWords,
  givePreview,
  isLive,
  paymentLine,
  startRange,
  statusTag,
  listedRow,
} from './heldMembershipsView';

const TODAY = '2026-10-20';
const monthly = { id: '22222222-2222-4222-8222-000000000001', name: 'Gold Monthly', kind: 'recurring', priceMinor: 4999, currency: 'GBP', termCount: 1, termUnit: 'month', packClasses: null, packDays: null };
const threeMonths = { ...monthly, name: 'Three months', kind: 'one_time', termCount: 3 };
const tenPack = { ...monthly, name: '10 classes', kind: 'pack', termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };
const dayPass = { ...tenPack, name: 'Day pass', packClasses: 1, packDays: 1, priceMinor: 1500 };
const freeWeek = { ...monthly, name: 'Free week', kind: 'trial', termCount: 7, termUnit: 'day', priceMinor: 0 };

/** A held membership as the server sends it: given on `givenOn`, moved, then read on `today`. */
function held(type, startsOn, paid, { givenOn = startsOn, moves = [], today = TODAY } = {}) {
  const made = giveHeldMembership(type, startsOn, paid, givenOn);
  if (!made.ok) throw new Error(made.reason);
  let m = made.membership;
  for (const [event, on] of moves) {
    const move = moveHeldMembership(m, event, on);
    if (!move.ok) throw new Error('refused');
    m = move.membership;
  }
  return heldMembershipSchema.parse({
    id: '44444444-4444-4444-8444-000000000001',
    typeId: type.id,
    typeName: type.name,
    kind: type.kind,
    priceMinor: type.priceMinor,
    currency: type.currency,
    termCount: type.termCount,
    termUnit: type.termUnit,
    packClasses: type.packClasses,
    packDays: type.packDays,
    startsOn,
    frozenOn: m.frozenOn,
    classesLeft: m.classesLeft,
    fromList: false,
    view: heldMembershipView(m, today),
  });
}

describe('what a membership reads as', () => {
  it('says when it runs, in each state', () => {
    const cases = [
      [held(monthly, '2026-10-04', true), 'Active', 'Started 4 October 2026 · Renews 4 November 2026'],
      [held(monthly, '2026-11-01', true, { givenOn: TODAY }), 'Not started', 'Starts 1 November 2026 · Renews 1 December 2026'],
      [held(threeMonths, '2026-10-04', true), 'Active', 'Started 4 October 2026 · Ends 3 January 2027'],
      [held(dayPass, TODAY, true), 'Active', 'For 20 October 2026 only'],
      [held(monthly, '2026-10-04', true, { moves: [[{ type: 'freeze' }, '2026-10-10']] }), 'Frozen', 'Started 4 October 2026 · Frozen since 10 October 2026'],
      [held(monthly, '2026-10-04', true, { moves: [[{ type: 'cancel', when: 'period_end' }, '2026-10-10']] }), 'Active', "Started 4 October 2026 · Ends 3 November 2026, won't renew"],
      [held(monthly, '2026-10-04', true, { moves: [[{ type: 'cancel', when: 'today' }, '2026-10-10']] }), 'Cancelled', 'Started 4 October 2026 · Cancelled 10 October 2026'],
      // Cancelled before its start day: it never started.
      [held(monthly, '2026-11-10', true, { givenOn: '2026-10-04', moves: [[{ type: 'cancel', when: 'today' }, '2026-10-04']] }), 'Cancelled', 'Was to start 10 November 2026 · Cancelled 4 October 2026'],
      // Cancelled on its start day: it had started.
      [held(monthly, '2026-10-04', true, { moves: [[{ type: 'cancel', when: 'today' }, '2026-10-04']] }), 'Cancelled', 'Started 4 October 2026 · Cancelled 4 October 2026'],
      [held(threeMonths, '2026-07-01', true), 'Ended', '1 July 2026 to 30 September 2026'],
      [held(dayPass, '2026-10-01', true), 'Ended', '1 October 2026'],
    ];
    for (const [m, tag, line] of cases) {
      expect(statusTag(m).tag, line).toBe(tag);
      expect(datesLine(m)).toBe(line);
    }
    expect(statusTag(cases[0][0]).tone).toBe('green');
    expect(statusTag(cases[4][0]).tone).toBe('orange');
    expect(cases.map(([m]) => isLive(m))).toEqual([true, true, true, true, true, true, false, false, false, false, false]);
    // A past member's are kept and not in use: one that would be running says so, one that is over keeps its word.
    expect(statusTag(cases[0][0], true)).toEqual({ tag: 'Not in use', tone: 'plain' });
    expect(statusTag(cases[4][0], true)).toEqual({ tag: 'Not in use', tone: 'plain' });
    expect(statusTag(cases[6][0], true).tag).toBe('Cancelled');
  });

  it('says what is paid and what is owed, and marks only what is owed today', () => {
    const cases = [
      [held(monthly, '2026-10-04', true), { text: 'Paid · next payment due 4 November 2026', due: false }],
      [held(monthly, '2026-10-04', true, { today: '2026-11-04' }), { text: 'Payment due today', due: true }, '2026-11-04'],
      [held(monthly, '2026-10-04', true, { today: '2026-11-20' }), { text: 'Payment due since 4 November 2026', due: true }, '2026-11-20'],
      [held(monthly, '2026-11-01', false, { givenOn: TODAY }), { text: 'Payment due on 1 November 2026', due: false }],
      [held(threeMonths, '2026-10-04', true), { text: 'Paid', due: false }],
      [held(threeMonths, '2026-10-04', false), { text: 'Payment due since 4 October 2026', due: true }],
      [held(monthly, '2026-10-04', false, { moves: [[{ type: 'freeze' }, '2026-10-10']] }), { text: 'Payment due', due: true }],
      [held(monthly, '2026-10-04', true, { moves: [[{ type: 'freeze' }, '2026-10-10']] }), { text: 'Paid', due: false }],
      [held(monthly, '2026-10-04', true, { moves: [[{ type: 'cancel', when: 'period_end' }, '2026-10-10']] }), { text: 'Paid to the end', due: false }],
      [held(freeWeek, TODAY, false), null],
      [held(threeMonths, '2026-07-01', false, { givenOn: '2026-07-01' }), null],
    ];
    for (const [m, want, today = TODAY] of cases) expect(paymentLine(m, today), datesLine(m)).toEqual(want);
  });

  it('counts a pack\'s classes, and says nothing for a day pass or another kind', () => {
    expect(classesLine(held(tenPack, TODAY, true))).toBe('10 of 10 classes left');
    expect(classesLine({ ...held(tenPack, TODAY, true), classesLeft: 1 })).toBe('1 of 10 classes left');
    expect(classesLine(held(dayPass, TODAY, true))).toBeNull();
    expect(classesLine(held(monthly, TODAY, true))).toBeNull();
    expect(classesLine(held(tenPack, TODAY, true, { moves: [[{ type: 'cancel', when: 'today' }, TODAY]] }))).toBeNull();
  });
});

describe("what the member list says their membership is, where they do not hold it here", () => {
  const TYPE = { id: '22222222-2222-4222-8222-000000000009', name: 'Gold Monthly' };
  const listed = (over = {}) => ({ word: 'Gold Plus', endsOn: '2026-10-13', endsOnKind: 'renews', type: null, ownName: false, held: false, ...over });

  it('a name that is no type yet is a row of its own, not set up, with the day the list gives', () => {
    expect(listedRow(listed(), 'Leo Grant')).toEqual({
      title: 'Gold Plus',
      tag: 'Not set up',
      from: 'From your member list · Renews 13 October 2026',
      note: 'This membership has no price here yet. Set it up in Memberships, and Leo Grant gets it.',
    });
    expect(listedRow(listed({ endsOnKind: 'ends', endsOn: '2026-12-31' }), 'Leo Grant').from).toBe('From your member list · Ends 31 December 2026');
    expect(listedRow(listed({ endsOnKind: null, endsOn: null }), 'this person')).toMatchObject({
      from: 'From your member list',
      note: 'This membership has no price here yet. Set it up in Memberships, and this person gets it.',
    });
  });

  it("a name that is one of the gym's types, never given to them, is said under the type's name", () => {
    expect(listedRow(listed({ word: 'Gold', type: TYPE }), 'Zara Ali')).toEqual({
      title: 'Gold Monthly',
      tag: 'Not added',
      from: 'Your member list says “Gold” · Renews 13 October 2026',
      note: "Zara Ali doesn't have it here yet. Add it with Add membership, or go to Memberships to give it to everyone on your list who is missing it.",
    });
    // The type's own name on the list (the server says so) is not quoted back at them.
    expect(listedRow(listed({ word: 'GOLD MONTHLY', type: TYPE, ownName: true, endsOn: null, endsOnKind: null }), 'this person')).toMatchObject({
      from: 'From your member list',
      note: expect.stringMatching(/^This person doesn't have it here yet\./),
    });
  });

  it('says nothing where the list says nothing, or they have, or have had, that type', () => {
    expect(listedRow(null, 'Leo Grant')).toBeNull();
    expect(listedRow(undefined, 'Leo Grant')).toBeNull();
    expect(listedRow(listed({ word: 'Gold', type: TYPE, held: true }), 'Leo Grant')).toBeNull();
  });
});

describe('each button asks first, naming the person and what will happen', () => {
  const active = held(monthly, '2026-10-04', true);

  it('mark paid names the money, the days it covers and the next due day, and that no money is taken', () => {
    expect(askWords('paid', active, 'Olivia Brown', TODAY)).toEqual({
      question: "Mark Olivia Brown's Gold Monthly as paid?",
      detail:
        'This notes that Olivia Brown paid £49.99 for 4 November 2026 up to 4 December 2026. Their next payment is then due 4 December 2026. It only notes it here: no money is taken.',
      button: 'Mark paid',
    });
    expect(askWords('paid', held(threeMonths, '2026-10-04', false), 'Olivia Brown', TODAY).detail).toBe(
      'This notes that Olivia Brown paid £49.99. It only notes it here: no money is taken.',
    );
    expect(askWords('undoPaid', active, 'Olivia Brown', TODAY).question).toBe("Take back the last payment noted for Olivia Brown's Gold Monthly?");
  });

  it('freeze and unfreeze say what happens to the days', () => {
    expect(askWords('freeze', active, 'Olivia Brown', TODAY).detail).toContain('every day it was frozen is added back, so Olivia Brown loses no days');
    const frozen = held(monthly, '2026-10-04', true, { moves: [[{ type: 'freeze' }, '2026-10-10']] });
    expect(askWords('unfreeze', frozen, 'Olivia Brown', TODAY).detail).toBe('It runs again from today. The 10 days it was frozen are added back.');
    expect(askWords('unfreeze', frozen, 'Olivia Brown', '2026-10-11').detail).toBe('It runs again from today. The 1 day it was frozen is added back.');
    expect(askWords('unfreeze', frozen, 'Olivia Brown', '2026-10-10').detail).toBe('It runs again from today. It was frozen today, so its dates stay as they were.');
  });

  it('cancel offers the last paid day where there is one, and today alone where there is not', () => {
    const paid = askWords('cancel', active, 'Olivia Brown', TODAY);
    expect(paid.question).toBe("Cancel Olivia Brown's Gold Monthly?");
    expect(paid.laterButton).toBe('Cancel on 3 November 2026');
    expect(paid.button).toBe('Cancel today');
    expect(paid.detail).toContain('Olivia Brown has paid up to 3 November 2026.');
    const owing = askWords('cancel', held(monthly, '2026-10-04', false), 'Olivia Brown', TODAY);
    expect(owing.laterButton).toBeNull();
    expect(owing.detail).toBe("It stops today. This can't be undone, but you can add a membership again.");
    expect(askWords('nonsense', active, 'Olivia Brown', TODAY)).toBeNull();
  });

  it('says back what each press did', () => {
    expect(['give', 'paid', 'undoPaid', 'freeze', 'unfreeze', 'cancelLater', 'cancel'].map((what) => doneWords(what, active))).toEqual([
      'Membership added.',
      'Gold Monthly marked paid.',
      'The last payment noted for Gold Monthly was taken back.',
      'Gold Monthly is frozen.',
      'Gold Monthly is running again.',
      "Gold Monthly will end and won't renew.",
      'Gold Monthly is cancelled.',
    ]);
  });
});

describe('the Add form works its line out by the rule the server gives with', () => {
  it('shows the dates for the type and start day chosen, and what the paid tick would mean', () => {
    expect(givePreview(monthly, '2026-10-20', false, TODAY)).toEqual({
      line: 'Started 20 October 2026 · Renews 20 November 2026',
      paidLabel: 'They have paid up to 20 November 2026',
      problem: null,
    });
    // Started earlier: the tick means the period today is in.
    expect(givePreview(monthly, '2026-07-04', true, TODAY)).toEqual({
      line: 'Started 4 July 2026 · Renews 4 November 2026',
      paidLabel: 'They have paid up to 4 November 2026',
      problem: null,
    });
    expect(givePreview(monthly, '2026-11-01', false, TODAY).line).toBe('Starts 1 November 2026 · Renews 1 December 2026');
    expect(givePreview(tenPack, '2026-10-20', false, TODAY)).toEqual({
      line: 'Started 20 October 2026 · Ends 18 December 2026 · 10 of 10 classes left',
      paidLabel: 'They have paid the £90.00',
      problem: null,
    });
    expect(givePreview(freeWeek, '2026-10-20', false, TODAY)).toEqual({ line: 'Started 20 October 2026 · Ends 26 October 2026', paidLabel: null, problem: null });
    expect(givePreview(null, '2026-10-20', false, TODAY)).toEqual({ line: null, paidLabel: null, problem: null });
  });

  it('says why a start day cannot be used', () => {
    expect(givePreview(dayPass, '2026-10-19', false, TODAY).problem).toBe(
      'With that start date this membership would already be over. Pick a later start date.',
    );
    expect(givePreview(monthly, '2027-10-22', false, TODAY).problem).toBe('Pick a start date no more than a year from today.');
    expect(startRange(TODAY)).toEqual({ min: '2000-01-01', max: '2027-10-21' });
    // The last day the calendar offers is one the rule takes.
    expect(givePreview(monthly, '2027-10-21', false, TODAY).problem).toBeNull();
  });
});
