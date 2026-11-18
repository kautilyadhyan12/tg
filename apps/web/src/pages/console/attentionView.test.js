// THE BELL'S AND THE MENU'S WORDS (V1-d), over every kind of thing that can wait.
//
// The worst thing: a line or a count for something the server did not send (a part it leaves
// out for somebody who may not open its page), or a nought drawn as if it waited. So every
// part is tried left out, at nought, at one and at many.
import { describe, expect, it } from 'vitest';
import { ROLE_PRIVILEGES } from '@app/shared';
import { attentionLines, bellLabel, countText, menuCounts, moreCount, seesAnyPart } from './attentionView';

const NONE = { chargebacks: null, failedPayments: null, paymentDue: null, refunds: null, appPayments: null, appCancels: null, newLeads: null, atRisk: null, reported: null };
const ZERO = {
  chargebacks: { count: 0, lostCount: 0, needsReconnect: false, canReconnect: true },
  failedPayments: { count: 0, totals: [] },
  paymentDue: { count: 0, past: 0 },
  refunds: { count: 0 },
  appPayments: { count: 0, more: false },
  appCancels: { count: 0 },
  newLeads: { count: 0 },
  atRisk: { count: 0 },
  reported: { posts: 0, comments: 0 },
};
const OWNER = ROLE_PRIVILEGES.owner;
const lines = (part, privileges = OWNER, orgType = 'gym') => attentionLines({ ...NONE, ...part }, 'iron-house', privileges, orgType);
const only = (part, orgType) => {
  const got = lines(part, OWNER, orgType);
  expect(got).toHaveLength(1);
  return got[0];
};

describe('the bell: a line only for what the server sent and what waits', () => {
  it('THE WORST THING: nothing sent, or nothing waiting, is no line and no count', () => {
    expect(attentionLines(null, 'iron-house', OWNER, 'gym')).toEqual([]);
    expect(lines(NONE)).toEqual([]);
    expect(lines(ZERO)).toEqual([]);
    expect(menuCounts(lines(ZERO))).toEqual({});
    // Each part alone, sent at nought, draws nothing.
    for (const key of Object.keys(ZERO)) expect(lines({ [key]: ZERO[key] }), key).toEqual([]);
  });

  it('every kind, at one and at many: its words, its colour, its money and its place', () => {
    const table = [
      [{ chargebacks: { count: 1, lostCount: 0, needsReconnect: false, canReconnect: true } }, { key: 'chargebacks', tone: 'bad', count: 1, title: '1 chargeback needs a response', note: "A cardholder's bank disputed a payment", button: 'Respond', to: '/console/iron-house#chargebacks' }],
      [{ chargebacks: { count: 3, lostCount: 1, needsReconnect: false, canReconnect: true } }, { title: '3 chargebacks need attention', count: 3, note: "A cardholder's bank disputed a payment", button: 'Respond' }],
      [{ chargebacks: { count: 2, lostCount: 2, needsReconnect: false, canReconnect: true } }, { title: '2 lost chargebacks have automatic payments paused', note: 'The money went back to the cardholder', button: 'View' }],
      [{ failedPayments: { count: 1, totals: [{ currency: 'USD', minor: 2000 }] } }, { key: 'failed-payments', tone: 'bad', title: '1 failed card payment', note: 'Declined, still outstanding', money: '$20.00', to: '/console/iron-house/failed-payments' }],
      [{ failedPayments: { count: 3, totals: [{ currency: 'USD', minor: 6000 }, { currency: 'CAD', minor: 1500 }] } }, { title: '3 failed card payments', count: 3 }],
      [{ paymentDue: { count: 6, past: 1 } }, { key: 'payment-due', tone: 'warn', count: 7, title: '6 members with a payment due', note: 'Plus 1 past member', to: '/console/iron-house/members?show=payment-due' }],
      [{ paymentDue: { count: 1, past: 0 } }, { title: '1 member with a payment due', note: null }],
      [{ paymentDue: { count: 0, past: 2 } }, { title: '2 past members with a payment due', note: null, to: '/console/iron-house/members?show=past-payment-due' }],
      [{ refunds: { count: 2 } }, { key: 'refunds', tone: 'warn', title: '2 refunds to review', button: 'Review', to: '/console/iron-house#refunds-to-review' }],
      [{ appPayments: { count: 1, more: false } }, { key: 'app-payments', tone: 'warn', to: '/console/iron-house#app-payment-checks', note: 'Charged in the app, not applied here' }],
      [{ appPayments: { count: 10, more: true } }, { count: 10, note: 'Charged in the app, not applied here. More appear as you resolve these' }],
      [{ atRisk: { count: 2 } }, { key: 'at-risk', tone: 'warn', title: '2 members at risk', note: 'Stopped coming', to: '/console/iron-house/at-risk' }],
      [{ reported: { posts: 1, comments: 0 } }, { key: 'reported', title: '1 reported post', to: '/console/iron-house/updates#reported' }],
      [{ reported: { posts: 0, comments: 2 } }, { title: '2 reported comments', count: 2, to: '/console/iron-house/updates#reported-comments' }],
      [{ reported: { posts: 2, comments: 1 } }, { title: '2 reported posts and 1 reported comment', count: 3 }],
      [{ appCancels: { count: 1 } }, { key: 'app-cancels', tone: 'plain', note: 'Last 30 days', to: '/console/iron-house#app-cancels' }],
      [{ newLeads: { count: 5 } }, { key: 'new-leads', tone: 'plain', title: '5 new leads', note: 'Not contacted yet', to: '/console/iron-house/leads?status=new' }],
      [{ newLeads: { count: 1 } }, { title: '1 new lead' }],
    ];
    for (const [part, want] of table) expect(only(part), JSON.stringify(part)).toMatchObject(want);
  });

  it("a studio's words: clients, never members", () => {
    expect(only({ paymentDue: { count: 2, past: 1 } }, 'studio')).toMatchObject({ title: '2 clients with a payment due', note: 'Plus 1 past client' });
    expect(only({ atRisk: { count: 1 } }, 'studio').title).toBe('1 client at risk');
  });

  it('most urgent first: red, then gold, then plain', () => {
    const all = lines({
      newLeads: { count: 1 },
      appCancels: { count: 1 },
      reported: { posts: 1, comments: 0 },
      atRisk: { count: 1 },
      appPayments: { count: 1, more: false },
      refunds: { count: 1 },
      paymentDue: { count: 1, past: 0 },
      failedPayments: { count: 1, totals: [] },
      chargebacks: { count: 1, lostCount: 0 },
    });
    expect(all.map((l) => l.key)).toEqual(['chargebacks', 'failed-payments', 'payment-due', 'refunds', 'app-payments', 'at-risk', 'reported', 'app-cancels', 'new-leads']);
    expect(all.map((l) => l.tone)).toEqual(['bad', 'bad', 'warn', 'warn', 'warn', 'warn', 'warn', 'plain', 'plain']);
    // Failed payments with no money left owing shows no money, never "$0.00".
    expect(all[1].money).toBeNull();
  });

  it("a line whose page this person cannot open has no button (the server would not send it; the screen holds the same rule)", () => {
    const got = lines({ failedPayments: { count: 1, totals: [] } }, ['members.read']);
    expect(got[0].to).toBeNull();
  });
});

describe('a Square connection that must be reconnected', () => {
  const lost = (canReconnect, count = 0) => ({ chargebacks: { count, lostCount: 0, needsReconnect: true, canReconnect } });
  it('THE WORST THING: never "Nothing needs attention" while Overview says to reconnect; a red line first', () => {
    const got = lines(lost(true));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ key: 'reconnect', tone: 'bad', title: 'Reconnect Square', button: 'Reconnect', to: '/console/iron-house/settings#payments' });
    expect(menuCounts(got).overview).toEqual({ count: 1, tone: 'bad' });
  });
  it('the owner gets the button; anybody else reads who can, with none', () => {
    expect(lines(lost(false))[0]).toMatchObject({ note: 'The owner needs to reconnect Square before chargebacks can show', to: null });
    // An owner whose ticks were taken down cannot open Settings: no button either.
    expect(lines(lost(true), ['billing.members'])[0].to).toBeNull();
  });
  it('with chargebacks still counted, both lines, reconnect first', () => {
    expect(lines(lost(true, 2)).map((l) => l.key)).toEqual(['reconnect', 'chargebacks']);
  });
});

describe('the counts in the menu', () => {
  it("Overview's is the number of kinds waiting, in the most urgent one's colour; each page its own", () => {
    const counts = menuCounts(lines({ newLeads: { count: 5 }, atRisk: { count: 2 }, failedPayments: { count: 3, totals: [] }, reported: { posts: 1, comments: 1 }, refunds: { count: 4 } }));
    expect(counts).toEqual({
      overview: { count: 5, tone: 'bad' },
      leads: { count: 5, tone: 'plain' },
      'at-risk': { count: 2, tone: 'warn' },
      'failed-payments': { count: 3, tone: 'bad' },
      updates: { count: 2, tone: 'warn' },
    });
    expect(menuCounts(lines({ newLeads: { count: 1 } })).overview).toEqual({ count: 1, tone: 'plain' });
    expect(menuCounts(lines({ refunds: { count: 1 } })).overview).toEqual({ count: 1, tone: 'warn' });
  });

  it("the phone's More: everything waiting on the pages under it", () => {
    const counts = menuCounts(lines({ newLeads: { count: 5 }, atRisk: { count: 2 } }));
    const more = [{ key: 'leads' }, { key: 'at-risk' }, { key: 'sell' }];
    expect(moreCount(more, counts)).toEqual({ count: 7, tone: 'warn' });
    expect(moreCount([{ key: 'sell' }], counts)).toBeNull();
  });

  it('a count is never wider than three characters, and the bell says what it holds', () => {
    expect([0, 1, 99, 100, 12345].map(countText)).toEqual(['0', '1', '99', '99+', '99+']);
    expect(bellLabel([])).toBe('Needs attention: nothing needs attention');
    expect(bellLabel([{}])).toBe('Needs attention: 1 thing needs attention');
    expect(bellLabel([{}, {}])).toBe('Needs attention: 2 things need attention');
  });
});

describe('who has a bell', () => {
  it('whoever may see at least one part; nobody before the answer, or who may see none', () => {
    expect(seesAnyPart(null)).toBe(false);
    expect(seesAnyPart(NONE)).toBe(false);
    expect(seesAnyPart({ ...NONE, atRisk: { count: 0 } })).toBe(true);
    expect(seesAnyPart(ZERO)).toBe(true);
  });
});
