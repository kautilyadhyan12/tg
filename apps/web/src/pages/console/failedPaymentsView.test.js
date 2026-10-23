import { describe, expect, it } from 'vitest';
import { canSeeFailedPayments, failedHeadline, overviewLine, retryLine, rowWhat } from './failedPaymentsView';

const row = (over = {}) => ({
  typeName: 'Gold Weekly',
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

  it("why there is no Try again, in the gym's own time; nothing said twice where the decline already says it", () => {
    expect(retryLine(row(), 'America/Chicago', 'US')).toBeNull();
    expect(retryLine(row({ retry: { kind: 'wait', from: '2026-10-24T19:15:00.000Z' } }), 'America/Chicago', 'US')).toBe(
      'Square recommends waiting 24 hours before retrying. It can be retried from 2:15 PM on 24 Oct.',
    );
    expect(retryLine(row({ retry: { kind: 'no', why: 'new_card' } }), 'America/Chicago', 'US')).toBeNull();
    expect(retryLine(row({ retry: { kind: 'no', why: 'tried_out' } }), 'America/Chicago', 'US')).toBeNull();
    for (const why of ['no_card', 'square', 'currency', 'elsewhere']) {
      expect(retryLine(row({ retry: { kind: 'no', why } }), 'America/Chicago', 'US')).toMatch(/\.$/);
    }
  });

  it('who sees it: people and payments both', () => {
    expect(canSeeFailedPayments(['members.read', 'billing.members'])).toBe(true);
    expect(canSeeFailedPayments(['members.read'])).toBe(false);
    expect(canSeeFailedPayments(['billing.members'])).toBe(false);
    expect(canSeeFailedPayments(undefined)).toBe(false);
  });
});
