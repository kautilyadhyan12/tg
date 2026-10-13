// Who can check in, the words (Settings and Attendance; ROADMAP 16d).
import { describe, expect, it } from 'vitest';
import { CHECKIN_STOP_WORDS, checkinOverdueSchema, checkinStopReasonSchema, checkinWhoSchema } from '@app/shared';
import {
  OVERDUE_CHOICES,
  PREVIEW_NAMES_SHOWN,
  WHO_CHOICES,
  notListedLine,
  overdueHint,
  previewNames,
  previewWords,
  rulesChanged,
  rulesSavedLine,
  rulesSummary,
  stopReason,
  stoppedLine,
} from './checkinRulesView';

const START = { who: 'everyone', overdue: 'let_in' };
const STRICT = { who: 'current_membership', overdue: 'see_staff' };

const person = (n, reason = 'ended') => ({ entryId: `e-${String(n)}`, name: `Person ${String(n)}`, reason });
const preview = (listed, people, stopped = people.length) => ({ rules: STRICT, listed, stopped, people });

describe('the choices', () => {
  it('offers every choice the server takes, and no other', () => {
    expect(WHO_CHOICES.map((c) => c.value)).toEqual(checkinWhoSchema.options);
    expect(OVERDUE_CHOICES.map((c) => c.value)).toEqual(checkinOverdueSchema.options);
  });

  it('says when a payment is overdue, by the gym’s own days of grace', () => {
    expect(overdueHint(0)).toBe('A payment is overdue from the day after it was due.');
    // With 7 days of grace a bill due on the 8th stops somebody from the 16th.
    expect(overdueHint(1)).toBe('A payment is overdue once it is more than 1 day late.');
    expect(overdueHint(7)).toBe('A payment is overdue once it is more than 7 days late.');
    expect(overdueHint(undefined)).toBe('A payment is overdue from the day after it was due.');
  });

  it('the closed box says what is saved', () => {
    expect(rulesSummary(null)).toBeUndefined();
    expect(rulesSummary(START)).toBe('Everyone on your list');
    expect(rulesSummary({ who: 'everyone', overdue: 'see_staff' })).toBe('Everyone on your list · overdue payments sent to staff');
    expect(rulesSummary({ who: 'current_membership', overdue: 'let_in' })).toBe('Only people with a current membership');
    expect(rulesSummary(STRICT)).toBe('Only people with a current membership · overdue payments sent to staff');
  });

  it('knows a choice not saved yet', () => {
    expect(rulesChanged(START, START)).toBe(false);
    expect(rulesChanged({ ...START, overdue: 'see_staff' }, START)).toBe(true);
    expect(rulesChanged(STRICT, START)).toBe(true);
    expect(rulesChanged(null, START)).toBe(false);
  });
});

describe('who is sent to staff today', () => {
  it('nobody on the list', () => {
    expect(previewWords(preview(0, []), true)).toEqual({ title: 'Nobody is on your Members list yet.', rest: null });
  });

  it('nobody stopped: before Save and after', () => {
    expect(previewWords(preview(13, []), true).title).toBe('With these choices all 13 people on your list would still be checked in today.');
    expect(previewWords(preview(13, []), false).title).toBe('All 13 people on your list are checked in at the front desk today.');
    expect(previewWords(preview(1, []), false).title).toBe('The 1 person on your list is checked in at the front desk today.');
    expect(previewWords(preview(1, []), true).title).toBe('With these choices the 1 person on your list would still be checked in today.');
  });

  it('some stopped: who would change, and who would not', () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => person(n));
    expect(previewWords(preview(13, six), true)).toEqual({
      title: 'Today 6 of the 13 people on your list would be sent to staff:',
      rest: 'The other 7 would be checked in as now.',
    });
    expect(previewWords(preview(13, six), false)).toEqual({
      title: 'Today 6 of the 13 people on your list are sent to staff:',
      rest: 'The other 7 are checked in as now.',
    });
  });

  it('one other person is said as one', () => {
    const five = [1, 2, 3, 4, 5].map((n) => person(n));
    expect(previewWords(preview(6, five), false).rest).toBe('The other 1 is checked in as now.');
    expect(previewWords(preview(6, five), true).rest).toBe('The other 1 would be checked in as now.');
  });

  it('everybody stopped says so', () => {
    const two = [person(1, 'no_membership'), person(2, 'no_membership')];
    expect(previewWords(preview(2, two), true).rest).toBe('Nobody on your list would be checked in at the front desk.');
    expect(previewWords(preview(2, two), false).rest).toBe('Nobody on your list is checked in at the front desk.');
  });

  it('a few names, then "and N more", and See all shows every one sent', () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => person(n));
    const few = previewNames(preview(13, six), false);
    expect(few.shown).toHaveLength(PREVIEW_NAMES_SHOWN);
    expect(few.shown[0]).toEqual({ entryId: 'e-1', name: 'Person 1', reason: 'Membership ended' });
    expect(few.more).toBe(3);
    expect(few.canSeeAll).toBe(true);
    const all = previewNames(preview(13, six), true);
    expect(all.shown).toHaveLength(6);
    expect(all.more).toBe(0);
    expect(all.canSeeAll).toBe(false);
  });

  it('three or fewer are all shown, with nothing more to see', () => {
    const names = previewNames(preview(13, [person(1), person(2, 'overdue')]), false);
    expect(names.shown.map((p) => p.reason)).toEqual(['Membership ended', 'Payment overdue']);
    expect(names.more).toBe(0);
    expect(names.canSeeAll).toBe(false);
  });

  it('a list longer than the server sends by name says how many are not listed', () => {
    const sent = [1, 2, 3, 4].map((n) => person(n));
    const all = previewNames(preview(900, sent, 700), true);
    expect(all.shown).toHaveLength(4);
    expect(all.notSent).toBe(696);
    expect(all.more).toBe(696);
  });

  it('a record with no name is still a row', () => {
    expect(previewNames(preview(1, [{ entryId: 'e-x', name: '', reason: 'frozen' }]), false).shown[0]).toEqual({ entryId: 'e-x', name: 'No name', reason: 'Membership frozen' });
  });
});

describe('people in the app who are on no record', () => {
  it('are said in a line of their own, before Save and after', () => {
    expect(notListedLine({ ...preview(13, []), notListed: 0 }, true)).toBeNull();
    expect(notListedLine(preview(13, []), true)).toBeNull();
    expect(notListedLine({ ...preview(13, []), notListed: 1 }, true)).toBe('1 person in the app who is not on your Members list would also be sent to staff.');
    expect(notListedLine({ ...preview(13, []), notListed: 1 }, false)).toBe('1 person in the app who is not on your Members list is also sent to staff.');
    expect(notListedLine({ ...preview(13, []), notListed: 4 }, true)).toBe('4 people in the app who are not on your Members list would also be sent to staff.');
    expect(notListedLine({ ...preview(13, []), notListed: 4 }, false)).toBe('4 people in the app who are not on your Members list are also sent to staff.');
  });
});

describe('what Save says', () => {
  it('says what the desk now does', () => {
    expect(rulesSavedLine(START, preview(13, []))).toBe('Saved. Everyone on your list is checked in at the front desk.');
    expect(rulesSavedLine(STRICT, preview(13, [person(1)]))).toBe(
      'Saved. Your front desk follows this from the next scan. 1 person on your list would be sent to staff if they came today.',
    );
    expect(rulesSavedLine(STRICT, preview(13, [person(1), person(2)]))).toBe(
      'Saved. Your front desk follows this from the next scan. 2 people on your list would be sent to staff if they came today.',
    );
    expect(rulesSavedLine(STRICT, null)).toBe('Saved. Your front desk follows this from the next scan.');
  });
});

describe('the line staff read on Attendance', () => {
  it('has a sentence for every reason the server sends', () => {
    for (const reason of checkinStopReasonSchema.options) {
      const line = stoppedLine({ stopped: reason });
      expect(line).toBe(`Your front desk sends them to staff: ${stopReason(reason)}. You can still check them in here.`);
      expect(stopReason(reason).toLowerCase()).toBe(CHECKIN_STOP_WORDS[reason].toLowerCase());
    }
    expect(stoppedLine({ stopped: 'ended' })).toBe('Your front desk sends them to staff: membership ended. You can still check them in here.');
  });

  it('says nothing for somebody the desk lets in, or an answer without the field', () => {
    expect(stoppedLine({ stopped: null })).toBe('');
    expect(stoppedLine({})).toBe('');
    expect(stoppedLine({ stopped: 'something_new' })).toBe('');
  });
});
