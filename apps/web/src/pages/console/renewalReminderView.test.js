import { describe, expect, it } from 'vitest';
import { draftBody, draftFromType, draftProblems, emptyDraft } from './membershipTypesView';
import { reminderDayOptions, reminderStatusLine, renewalReminderBox, renewalReminderLine, startingDays } from './renewalReminderView';

// A reminder before a renewal or a minimum term's end (ROADMAP 18v-iv): the line's pick, its box and the person's page.

const status = (state, on = null, aboutOn = null) => ({ state, on, aboutOn });
const person = (entryId, name, s, paidBy = null) => ({ entryId, name, paidBy, status: s });

describe('the pick on a line', () => {
  it('offers fewer days than one payment holds before every renewal, and every choice before a term ends', () => {
    expect(reminderDayOptions('every_renewal', '1', 'week').map((o) => o.value)).toEqual(['3']);
    expect(reminderDayOptions('every_renewal', '1', 'month').map((o) => o.value)).toEqual(['3', '7', '14']);
    expect(reminderDayOptions('every_renewal', '1', 'year').map((o) => o.value)).toEqual(['3', '7', '14', '30', '45', '60']);
    expect(reminderDayOptions('term_end', '1', 'week').map((o) => o.value)).toEqual(['3', '7', '14', '30', '45', '60']);
    expect(startingDays('every_renewal', '1', 'week')).toBe('3');
    expect(startingDays('every_renewal', '1', 'month')).toBe('7');
    expect(startingDays('term_end', '1', 'month')).toBe('30');
  });

  const monthly = { ...emptyDraft(), name: 'Gold Monthly', price: '49.99' };

  it('sends the reminder it shows, and none where none is picked', () => {
    expect(draftBody(monthly, 'USD').renewalReminder).toBeNull();
    const picked = { ...monthly, renewalReminderWhen: 'every_renewal', renewalReminderDays: '7' };
    expect(draftProblems(picked, 'USD')).toBeNull();
    expect(draftBody(picked, 'USD').renewalReminder).toEqual({ when: 'every_renewal', days: 7 });
  });

  it('refuses before the minimum term ends with no term, 30 days before every monthly renewal, and on a free line', () => {
    expect(draftProblems({ ...monthly, renewalReminderWhen: 'term_end', renewalReminderDays: '30' }, 'USD')?.renewalReminder).toBe('Set a minimum term first, or choose Before every renewal.');
    expect(draftProblems({ ...monthly, renewalReminderWhen: 'every_renewal', renewalReminderDays: '30' }, 'USD')?.renewalReminder).toBe('Choose how many days before.');
    expect(draftProblems({ ...monthly, price: '0', renewalReminderWhen: 'every_renewal', renewalReminderDays: '7' }, 'USD')?.renewalReminder).toBe(
      'A free membership has no renewal reminder. Choose No reminder.',
    );
    expect(draftProblems({ ...monthly, contract: 'fixed', renewalReminderWhen: 'term_end', renewalReminderDays: '30' }, 'USD')).toBeNull();
  });

  it('reads a saved line back into the form, and says it on the price list', () => {
    const type = { id: 'x', currency: 'USD', priceMinor: 49900, termCount: 1, termUnit: 'year', kind: 'recurring', renewalReminder: { when: 'every_renewal', days: 30 }, classTypes: null, access: 'all_classes' };
    const draft = draftFromType(type);
    expect([draft.renewalReminderWhen, draft.renewalReminderDays]).toEqual(['every_renewal', '30']);
    expect(renewalReminderLine(type)).toBe('Renewal reminder: 30 days before every renewal');
    expect(renewalReminderLine({ renewalReminder: { when: 'term_end', days: 30 } })).toBe('Renewal reminder: 30 days before the minimum term ends');
    expect(renewalReminderLine({ renewalReminder: null })).toBeNull();
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
      ['Will be emailed (2)', ['Ana Ruiz · emailed 7 Nov · renews 10 Nov', 'Kim Child, paid by Tom Payer · emailed 8 Nov · renews 11 Nov']],
      ['Already emailed (1)', ['Sam Sent · emailed 5 Nov']],
      ['Not emailed: no email address on the record of whoever pays (1)', ['Nell Phone']],
      ['Not emailed: their membership will not renew (1)', ['Ben Stops']],
    ]);
    expect(renewalReminderBox({ people: [] }, 'term_end')?.empty).toBe('Nobody holds this membership yet.');
    expect(renewalReminderBox({ people: [] }, '')).toBeNull();
  });

  it('says "term ends" for a reminder before the minimum term ends', () => {
    const box = renewalReminderBox({ people: [person('a', 'Ana Ruiz', status('will_send', '2027-10-04', '2027-11-02'))] }, 'term_end');
    expect(box?.groups[0]?.people[0]?.line).toBe('Ana Ruiz · emailed 4 Oct · term ends 2 Nov');
  });
});

describe("a person's page", () => {
  it('says when it was or will be emailed, and why it cannot be; nothing where there is nothing to say', () => {
    expect(reminderStatusLine(status('sent', '2026-11-05', '2026-11-08'))).toBe('Renewal reminder emailed on 5 Nov.');
    expect(reminderStatusLine(status('will_send', '2026-11-07', '2026-11-10'))).toBe('Renewal reminder will be emailed on 7 Nov.');
    expect(reminderStatusLine(status('no_email', null, '2026-11-10'))).toBe('No renewal reminder can be emailed: whoever pays for it has no email address on their record.');
    for (const quiet of ['frozen', 'not_renewing', 'no_term', 'billed_elsewhere']) expect(reminderStatusLine(status(quiet))).toBeNull();
    expect(reminderStatusLine(null)).toBeNull();
  });
});
