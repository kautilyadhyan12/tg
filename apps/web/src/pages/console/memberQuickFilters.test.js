// Quick filters over Your list (V3a-i): one press shows one kind of person, with the
// server's own count, and a second press shows everyone again.
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, entriesQueryString, toggleWord } from './memberListPeople';
import { quickFilters } from './memberQuickFilters';

const list = {
  counts: { entries: 26, inApp: 12, canBeInvited: 9, noEmail: 1, former: 3, formerOwing: 0 },
  paymentStatuses: [
    { label: 'Paid', count: 17, inApp: 9, canBeInvited: 4 },
    { label: 'Payment due', count: 6, inApp: 2, canBeInvited: 3 },
  ],
  membershipTypes: [
    { label: 'Gold Weekly', count: 8, inApp: 4, canBeInvited: 3 },
    { label: '', count: 3, inApp: 0, canBeInvited: 2 },
  ],
  appWords: [
    { word: 'in_app', count: 12 },
    { word: 'not_in_app', count: 14 },
    { word: 'not_invited', count: 9 },
  ],
};

const by = (out) => Object.fromEntries(out.map((q) => [q.key, q]));

describe('quickFilters', () => {
  it('lists Everyone and each kind with the server’s count, Everyone on', () => {
    const out = quickFilters(list, EMPTY_FILTERS);
    expect(out.map((q) => [q.text, q.count, q.on])).toEqual([
      ['Everyone', 26, true],
      ['Payment due', 6, false],
      ['Not in the app', 14, false],
      ['Not invited yet', 9, false],
      ['No membership', 3, false],
    ]);
    expect(by(out)['payment-due'].warn).toBe(true);
  });

  it('one press asks the server for exactly that one kind, keeping the search', () => {
    const typed = { ...EMPTY_FILTERS, query: 'sam' };
    const q = by(quickFilters(list, typed));
    expect(entriesQueryString(q['payment-due'].next, null)).toBe('paymentStatus=Payment+due&query=sam');
    expect(entriesQueryString(q['not-in-app'].next, null)).toBe('app=not_in_app&query=sam');
    expect(entriesQueryString(q['not-invited'].next, null)).toBe('app=not_invited&query=sam');
    expect(entriesQueryString(q['no-membership'].next, null)).toBe('membershipType=&query=sam');
  });

  it('one press replaces whatever else was chosen, never adds to it', () => {
    const chosen = { ...toggleWord(EMPTY_FILTERS, 'status', 'Frozen'), tag: { id: 't1', name: 'VIP' } };
    const q = by(quickFilters(list, chosen));
    expect(q.everyone.on).toBe(false);
    expect(entriesQueryString(q['payment-due'].next, null)).toBe('paymentStatus=Payment+due');
  });

  it('the one pressed is on, and pressing it again shows everyone', () => {
    const only = { ...EMPTY_FILTERS, app: ['not_in_app'] };
    const q = by(quickFilters(list, only));
    expect(q['not-in-app'].on).toBe(true);
    expect(q.everyone.on).toBe(false);
    expect(q['payment-due'].on).toBe(false);
    expect(entriesQueryString(q['not-in-app'].next, null)).toBe('');
  });

  it('the same choice made in the Filter lights it, in any spelling', () => {
    const fromFilter = toggleWord(EMPTY_FILTERS, 'paymentStatus', 'Payment due');
    expect(by(quickFilters(list, fromFilter))['payment-due'].on).toBe(true);
  });

  it('a kind nobody is in is not drawn, unless it is the one showing', () => {
    const none = { ...list, appWords: [{ word: 'in_app', count: 26 }], paymentStatuses: [] };
    expect(quickFilters(none, EMPTY_FILTERS).map((q) => q.key)).toEqual(['everyone', 'no-membership']);
    const shown = by(quickFilters(none, { ...EMPTY_FILTERS, app: ['not_invited'] }));
    expect(shown['not-invited'].count).toBe(0);
    expect(shown['not-invited'].on).toBe(true);
  });

  it('nothing for past members, or before the list has answered', () => {
    expect(quickFilters(list, { ...EMPTY_FILTERS, records: 'former' })).toEqual([]);
    expect(quickFilters(null, EMPTY_FILTERS)).toEqual([]);
  });
});
