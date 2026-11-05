import { describe, expect, it } from 'vitest';
import { draftBody, draftFromType, draftProblems, emptyDraft } from './membershipTypesView';
import { reminderDayOptions, reminderLines, reminderStatusLine, renewalReminderBox } from './renewalReminderView';

// A reminder before a renewal or a minimum term's end (ROADMAP 18v-iv): the line's pick, its box and the person's page.

const status = (state, on = null, aboutOn = null) => ({ state, on, aboutOn });
const person = (entryId, name, s, paidBy = null) => ({ entryId, name, paidBy, status: s });

describe('the two picks on a line', () => {
  it('offers fewer days than one payment holds before every renewal, and every choice before a term ends', () => {
    const values = (when, count, unit) => reminderDayOptions(when, count, unit).map((o) => o.value);
    expect(values('every_renewal', '1', 'week')).toEqual(['', '3']);
    expect(values('every_renewal', '1', 'month')).toEqual(['', '3', '7', '14']);
    expect(values('every_renewal', '1', 'year')).toEqual(['', '3', '7', '14', '30', '45', '60']);
    expect(values('term_end', '1', 'week')).toEqual(['', '3', '7', '14', '30', '45', '60']);
  });

  const monthly = { ...emptyDraft(), name: 'Gold Monthly', price: '49.99' };

  it('sends what it shows: neither, one, or both; the term one only with a minimum term', () => {
    expect([draftBody(monthly, 'USD').renewalReminderDays, draftBody(monthly, 'USD').termReminderDays]).toEqual([null, null]);
    const both = { ...monthly, contract: 'fixed', renewalReminderDays: '7', termReminderDays: '30' };
    expect(draftProblems(both, 'USD')).toBeNull();
    expect([draftBody(both, 'USD').renewalReminderDays, draftBody(both, 'USD').termReminderDays]).toEqual([7, 30]);
    // The minimum term taken off takes its reminder with it.
    expect(draftBody({ ...both, contract: 'none' }, 'USD').termReminderDays).toBeNull();
  });

  it('refuses 30 days before every monthly renewal, and on a free line', () => {
    expect(draftProblems({ ...monthly, renewalReminderDays: '30' }, 'USD')?.renewalReminderDays).toBe('That is longer than one payment. Choose fewer days before.');
    expect(draftProblems({ ...monthly, price: '0', renewalReminderDays: '7' }, 'USD')?.renewalReminderDays).toBe('A free membership has no renewal reminder. Choose No reminder.');
  });

  it('reads a saved line back into the form, and says both on the price list', () => {
    const type = { id: 'x', currency: 'USD', priceMinor: 4999, termCount: 1, termUnit: 'month', kind: 'recurring', contractPeriods: 12, contractThen: 'renews', renewalReminderDays: 7, termReminderDays: 30, classTypes: null, access: 'all_classes' };
    const draft = draftFromType(type);
    expect([draft.renewalReminderDays, draft.termReminderDays]).toEqual(['7', '30']);
    expect(reminderLines(type)).toEqual(['Renewal reminder: 7 days before every renewal', 'Minimum term reminder: 30 days before it ends']);
    expect(reminderLines({ renewalReminderDays: null, termReminderDays: null })).toEqual([]);
  });
});

describe('the box of who gets it', () => {
  it('groups people by what happens, names who pays for somebody else, and the days', () => {
    const box = renewalReminderBox(
      {
        people: [
          person('a', 'Ana Ruiz', status('will_send', '2026-11-07', '2026-11-10')),
          person('k', 'Kim Child', status('will_send', '2026-11-08', '2026-11-11'), 'Tom Payer'),
          person('n', 'Nell Phone', status('no_email', null, '2026-11-10')),
          person('b', 'Ben Stops', status('not_renewing')),
          person('s', 'Sam Sent', status('sent', '2026-11-05', '2026-11-08')),
        ],
      },
      'every_renewal',
    );
    expect(box?.groups.map((g) => [g.title, g.people.map((p) => p.line)])).toEqual([
      ['Will be emailed (2)', ['Ana Ruiz · to be emailed 7 Nov · renews 10 Nov', 'Kim Child, paid by Tom Payer · to be emailed 8 Nov · renews 11 Nov']],
      ['Already emailed (1)', ['Sam Sent · emailed 5 Nov · renews 8 Nov']],
      ['Not emailed: no email address on the record of whoever pays (1)', ['Nell Phone']],
      ['Not emailed: their membership will not renew (1)', ['Ben Stops']],
    ]);
    expect(renewalReminderBox({ people: [] }, 'term_end')?.empty).toBe('Nobody holds this membership yet.');
    expect(renewalReminderBox(null, 'every_renewal')).toBeNull();
  });

  it('says "term ends" for a reminder before the minimum term ends', () => {
    const box = renewalReminderBox({ people: [person('a', 'Ana Ruiz', status('will_send', '2027-10-04', '2027-11-02'))] }, 'term_end');
    expect(box?.groups[0]?.people[0]?.line).toBe('Ana Ruiz · to be emailed 4 Oct · term ends 2 Nov');
  });
});

describe("a person's page", () => {
  it('says when it was or will be emailed, and why it cannot be; nothing where there is nothing to say', () => {
    expect(reminderStatusLine(status('sent', '2026-11-05', '2026-11-08'))).toBe('Renewal reminder emailed on 5 Nov.');
    expect(reminderStatusLine(status('will_send', '2026-11-07', '2026-11-10'))).toBe('Renewal reminder will be emailed on 7 Nov.');
    expect(reminderStatusLine(status('no_email', null, '2026-11-10'))).toBe('No renewal reminder can be emailed: whoever pays for it has no email address on their record.');
    for (const quiet of ['frozen', 'not_renewing', 'no_term']) expect(reminderStatusLine(status(quiet))).toBeNull();
    expect(reminderStatusLine(status('billed_elsewhere'))).toBe('No renewal reminder is emailed: it is paid in your other software.');
    expect(reminderStatusLine(null)).toBeNull();
    expect(reminderStatusLine(status('sent', '2026-11-05', '2027-11-02'), 'term_end')).toBe('Minimum term reminder emailed on 5 Nov.');
    expect(reminderStatusLine(status('no_email'), 'term_end')).toBe('No minimum term reminder can be emailed: whoever pays for it has no email address on their record.');
  });
});
