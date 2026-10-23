import { describe, expect, it } from 'vitest';
import { canSeeFailedPayments, failedHeadline, needsCard, nextStep, overviewLine, rowFacts, rowWhat } from './failedPaymentsView';

const declined = (over = {}) => ({ brand: 'VISA', last4: '0002', on: '2026-10-23', reason: 'declined', next: null, stop: 'bank', notice: { state: 'emailed', on: '2026-10-23' }, ...over });
const row = (over = {}) => ({
  typeName: 'Gold Weekly',
  declined: declined(),
  covers: { from: '2026-10-23', to: '2026-10-29' },
  fee: null,
  retry: { kind: 'charge' },
  ...over,
});

describe('Failed payments, in words', () => {
  it('the heading and Overview count every row, and add each currency on its own', () => {
    expect(failedHeadline({ count: 0, totals: [] })).toBeNull();
    expect(failedHeadline({ count: 1, totals: [{ currency: 'USD', minor: 2500 }] })).toBe('1 failed payment · $25.00 owed');
    expect(failedHeadline({ count: 3, totals: [{ currency: 'CAD', minor: 1000 }, { currency: 'USD', minor: 2500 }] })).toBe('3 failed payments · CA$10.00 + $25.00 owed');
    expect(overviewLine({ count: 0, totals: [] })).toBeNull();
    expect(overviewLine({ count: 1, totals: [{ currency: 'USD', minor: 2500 }] })).toEqual({ value: '1 card payment was declined and is still owed.', owed: '$25.00 owed' });
    expect(overviewLine({ count: 2, totals: [{ currency: 'USD', minor: 5000 }] })?.value).toBe('2 card payments were declined and are still owed.');
  });

  it('what a row is for: a period by its days, a membership of one period by its name, a fee by its own words', () => {
    expect(rowWhat(row())).toBe('Gold Weekly · 23 Oct – 29 Oct 2026');
    expect(rowWhat(row({ covers: null }))).toBe('Gold Weekly');
    expect(rowWhat(row({ fee: { kind: 'no_show', forName: 'Spin', on: '2026-10-21', to: null } }))).toMatch(/^No-show fee · Spin on /);
    expect(rowWhat(row({ fee: { kind: 'freeze', forName: 'Gold Monthly', on: '2026-10-22', to: '2026-11-21' } }))).toBe('Freeze fee · Gold Monthly, frozen 22 Oct – 21 Nov 2026');
  });

  it('a row is short facts: the card, the day, the reason, the next step and the email', () => {
    expect(rowFacts(row(), 'America/Chicago', 'US')).toEqual([
      { label: 'Declined card', value: 'Visa ending 0002' },
      { label: 'Declined on', value: '23 Oct' },
      { label: 'Reason', value: 'No reason given by the bank' },
      { label: 'Next step', value: 'Not retried automatically. Ask the cardholder to contact their bank, then try again.' },
      { label: 'Cardholder email', value: 'Emailed on 23 Oct' },
    ]);
    const short = row({ declined: declined({ reason: 'insufficient_funds', next: '2026-10-26', stop: null, notice: { state: 'no_email', on: null } }) });
    expect(rowFacts(short, 'America/Chicago', 'US').map((f) => f.value)).toEqual([
      'Visa ending 0002',
      '23 Oct',
      'Not enough funds',
      'Retried automatically on 26 Oct, or try again now',
      'No email address on file. Contact them directly.',
    ]);
  });

  it("the next step says when it can be retried, in the gym's own time, or what to do instead", () => {
    expect(nextStep(row({ retry: { kind: 'wait', from: '2026-10-24T19:15:00.000Z' } }), 'America/Chicago', 'US')).toBe(
      'Can be retried from 2:15 PM on 24 Oct (Square recommends waiting 24 hours)',
    );
    expect(nextStep(row({ retry: { kind: 'no', why: 'new_card' } }), 'America/Chicago', 'US')).toMatch(/^The bank declined this card permanently\. Add a new card/);
    expect(nextStep(row({ retry: { kind: 'no', why: 'no_card' } }), 'America/Chicago', 'US')).toMatch(/^No card on file\. Add a new card/);
    for (const why of ['tried_out', 'square', 'currency', 'elsewhere']) {
      expect(nextStep(row({ retry: { kind: 'no', why } }), 'America/Chicago', 'US')).toMatch(/\.$/);
    }
    expect(['no_card', 'new_card', 'tried_out'].every((why) => needsCard(row({ retry: { kind: 'no', why } })))).toBe(true);
    expect(['square', 'currency', 'elsewhere'].some((why) => needsCard(row({ retry: { kind: 'no', why } })))).toBe(false);
    expect(needsCard(row())).toBe(false);
  });

  it('who sees it: people and payments both', () => {
    expect(canSeeFailedPayments(['members.read', 'billing.members'])).toBe(true);
    expect(canSeeFailedPayments(['members.read'])).toBe(false);
    expect(canSeeFailedPayments(['billing.members'])).toBe(false);
    expect(canSeeFailedPayments(undefined)).toBe(false);
  });
});
