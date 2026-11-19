// PAYMENTS OVERVIEW (V1-f). The worst thing it could do: show a trainer or a front desk the
// business's revenue, or who owes, when their role does not give them money. Each line and figure
// is checked against what the page it opens asks for, read from that page itself, for every mix of
// the ticks; and each figure against the route its own page reads.
import { describe, expect, it } from 'vitest';
import { ORG_PRIVILEGES, ROLE_PRIVILEGES } from '@app/shared';
import { consoleMenu } from './consoleMenu';
import { canOpenPaymentsOverview } from './consolePlaces';
import { graceWords, moneyAttention, needsPaymentSetup, overviewTiles, paymentLines, planState, revenueByMethod, setupBox } from './paymentsOverviewView';

const SLUG = 'iron-house';
const ORG = { id: 'g1', slug: SLUG, name: 'Iron House', orgType: 'gym', subscription: null };
const has = (ticks, t) => ticks.includes(t);

/** What each line's page asks for, from the page itself: Sell (`canOpenSell`), Failed payments
 *  (`canSeeFailedPayments`), Members' Payment due and No card on file (the list's own filters, for
 *  staff who keep its bills), Overview's Refunds to review, Chargebacks and App payments to review
 *  boxes (`billing.members`, with `members.confirm` for app payments, as the server's attention
 *  read), Memberships and its boxes (`memberships.manage`), Settings' Payments (`org.manage`),
 *  Reports' money (`reports.read` and `canReadMoney`), and the plan on Overview (`billing.manage`). */
const NEEDS = {
  sell: (t) => has(t, 'billing.members') || has(t, 'memberships.manage'),
  failed: (t) => has(t, 'members.confirm') && has(t, 'billing.members'),
  'payment-due': (t) => has(t, 'billing.members'),
  refunds: (t) => has(t, 'billing.members'),
  chargebacks: (t) => has(t, 'billing.members'),
  'app-payments': (t) => has(t, 'billing.members') && has(t, 'members.confirm'),
  memberships: (t) => has(t, 'memberships.manage'),
  products: (t) => has(t, 'billing.members') || has(t, 'memberships.manage'),
  discounts: (t) => has(t, 'memberships.manage'),
  tax: (t) => has(t, 'memberships.manage'),
  bills: (t) => has(t, 'memberships.manage'),
  square: (t) => has(t, 'org.manage'),
  terminals: (t) => has(t, 'org.manage'),
  cards: (t) => has(t, 'billing.members') && has(t, 'members.confirm'),
  'revenue-report': (t) => has(t, 'reports.read') && has(t, 'billing.members'),
  export: (t) => has(t, 'reports.read') && has(t, 'billing.members'),
  plan: (t) => has(t, 'billing.manage'),
};

/** Sell's own answer, as the server writes it for this reader: takings only for whoever records a
 *  sale (`register.ts`: "empty for a reader who cannot record a sale, with the totals at nothing"). */
function register(ticks, totals = {}) {
  const sells = has(ticks, 'billing.members');
  const zero = { count: 0, payments: 0, totalMinor: 0, taxMinor: 0, cash: 0, upi: 0, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, terminal: 0, app: 0, refundedMinor: 0, discountMinor: 0 };
  return {
    currency: 'USD',
    today: '2026-11-19',
    day: '2026-11-19',
    canSell: sells,
    canManage: has(ticks, 'memberships.manage'),
    totals: sells ? { ...zero, count: 11, payments: 4, totalMinor: 124000, terminal: 78000, cash: 31000, card_at_desk: 9000, bank_transfer: 6000, ...totals } : zero,
    membershipTypes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    products: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    discounts: [{ id: 'd1' }],
    tax: { included: false, rates: [{ id: 'r1', name: 'Sales tax', pcm: 8250 }] },
  };
}

/** The attention route's answer for this reader: each part only where its own page's ticks are held. */
function attention(ticks, parts = {}) {
  const b = has(ticks, 'billing.members');
  const m = has(ticks, 'members.confirm');
  return {
    chargebacks: b ? { count: 2, lostCount: 0, needsReconnect: false, canReconnect: true, ...parts.chargebacks } : null,
    failedPayments: b && m ? { count: 3, totals: [{ currency: 'USD', minor: 6000 }], ...parts.failedPayments } : null,
    paymentDue: m ? { count: 6, past: 1, ...parts.paymentDue } : null,
    refunds: b ? { count: 2, ...parts.refunds } : null,
    appPayments: b && m ? { count: 1, more: false, ...parts.appPayments } : null,
    appCancels: m ? { count: 0 } : null,
    newLeads: m ? { count: 4 } : null,
    atRisk: has(ticks, 'members.read') ? { count: 2 } : null,
    reported: has(ticks, 'posts.manage') ? { posts: 1, comments: 0 } : null,
  };
}

/** An attention answer holding every part, whoever asks. */
const FULL = attention([...ORG_PRIVILEGES]);

const SQUARE_CONNECTED = { state: 'connected', businessName: 'Iron House LLC', locationName: 'Austin', locations: [], connectedAt: '2026-10-01T10:00:00Z', removedAt: null };
function payments({ square = SQUARE_CONNECTED, country = 'US', owner = true, availability = 'square', terminals = 2, squareReady = true } = {}) {
  const on = square?.state === 'connected';
  return {
    availability,
    country,
    canConnect: owner,
    squareReady,
    square,
    terminals: on && ['US', 'CA', 'AU'].includes(country) ? { needsAllow: false, list: Array.from({ length: terminals }, (_, i) => ({ id: `t${String(i)}` })), pairing: null } : null,
    needsAllow: false,
    allowFor: [],
  };
}

function page(ticks, extra = {}) {
  const facts = { register: register(ticks), attention: attention(ticks), payments: payments(), bills: has(ticks, 'members.read') ? { overdueAfterDays: 0 } : null, ...extra };
  const tiles = overviewTiles({ orgSlug: SLUG, ...facts, privileges: ticks, orgType: 'gym' });
  const groups = paymentLines({ orgSlug: SLUG, privileges: ticks, org: ORG, membersName: 'Members', ...facts });
  return { tiles, groups, lines: groups.flatMap((g) => g.lines), methods: revenueByMethod(facts.register, ticks) };
}

describe('the worst thing: nobody is shown money, or a line, their role does not give them', () => {
  it('a trainer, as the app makes one, has no Payments overview and no line to it', () => {
    const trainer = [...ROLE_PRIVILEGES.trainer];
    expect(canOpenPaymentsOverview(trainer)).toBe(false);
    expect(consoleMenu(SLUG, trainer, 'gym').pages.map((p) => p.key)).not.toContain('payments');
    const shown = page(trainer);
    expect(shown.tiles).toEqual([]);
    expect(shown.lines).toEqual([]);
    expect(shown.methods).toBeNull();
  });

  it('a front desk with every tick but money sees no revenue, no amount and nobody who owes', () => {
    const desk = ORG_PRIVILEGES.filter((t) => t !== 'billing.members' && t !== 'billing.manage');
    const shown = page(desk);
    expect(shown.tiles.map((t) => t.key)).toEqual([]);
    expect(shown.methods).toBeNull();
    expect(JSON.stringify(shown)).not.toMatch(/\$|outstanding|Payment due|owe/);
  });

  it('for every mix of the ticks, each line opens a page that lets them in, and each figure is theirs', () => {
    const all = [...ORG_PRIVILEGES];
    let pages = 0;
    for (let mix = 0; mix < 2 ** all.length; mix += 1) {
      const ticks = all.filter((_, i) => (mix >> i) & 1);
      const shown = page(ticks);
      const keys = shown.lines.map((l) => l.key);
      for (const [key, needs] of Object.entries(NEEDS)) {
        if (keys.includes(key) !== needs(ticks)) throw new Error(`${key} for [${ticks.join(', ')}]: shown ${String(keys.includes(key))}`);
      }
      for (const line of shown.lines) {
        if (line.to !== null && !line.to.startsWith(`/console/${SLUG}`)) throw new Error(`${line.key} opens ${line.to}`);
      }
      const money = has(ticks, 'billing.members');
      const tiles = shown.tiles.map((t) => t.key);
      if (tiles.includes('revenue') !== money) throw new Error(`revenue for [${ticks.join(', ')}]`);
      if ((shown.methods !== null) !== money) throw new Error(`methods for [${ticks.join(', ')}]`);
      if (tiles.includes('payment-due') !== (money && has(ticks, 'members.confirm'))) throw new Error(`payment due for [${ticks.join(', ')}]`);
      if (!money && /\$/.test(JSON.stringify(shown))) throw new Error(`an amount for [${ticks.join(', ')}]`);
      // The page, and its line in the menu, for whoever has one line.
      const opens = canOpenPaymentsOverview(ticks);
      if (opens !== shown.lines.length > 0) throw new Error(`page for [${ticks.join(', ')}]: ${String(opens)}`);
      if (consoleMenu(SLUG, ticks, 'gym').pages.some((p) => p.key === 'payments') !== opens) throw new Error(`menu for [${ticks.join(', ')}]`);
      if (opens) pages += 1;
      // The view's own guards, given an answer holding every part, as no server would send it (round one, T1 and T2).
      const full = { register: register(ticks), attention: FULL, payments: payments(), bills: { overdueAfterDays: 0 } };
      const fullTiles = overviewTiles({ orgSlug: SLUG, ...full, privileges: ticks, orgType: 'gym' });
      const fullKeys = fullTiles.map((t) => t.key);
      const wantTiles = { revenue: money, 'payment-due': money, failed: NEEDS.failed(ticks), review: money };
      for (const [k, want] of Object.entries(wantTiles)) {
        if (fullKeys.includes(k) !== want) throw new Error(`tile ${k} for [${ticks.join(', ')}] given everything: shown ${String(fullKeys.includes(k))}`);
      }
      const fullLines = paymentLines({ orgSlug: SLUG, privileges: ticks, org: ORG, membersName: 'Members', ...full }).flatMap((g) => g.lines);
      for (const [key, needs] of Object.entries(NEEDS)) {
        if (fullLines.some((l) => l.key === key) !== needs(ticks)) throw new Error(`${key} for [${ticks.join(', ')}] given everything`);
      }
      if (!money && /[$]/.test(JSON.stringify([fullTiles, fullLines]))) throw new Error(`an amount for [${ticks.join(', ')}] given everything`);
    }
    expect(pages).toBeGreaterThan(0);
  }, 120_000);

  it('the menu has Payments overview first under Money, for the owner and a manager', () => {
    for (const role of ['owner', 'manager']) {
      const money = consoleMenu(SLUG, [...ROLE_PRIVILEGES[role]], 'gym').pages.filter((p) => p.group === 'money');
      expect(money[0]).toMatchObject({ key: 'payments', label: 'Payments overview', to: `/console/${SLUG}/payments`, phone: 'more' });
    }
  });
});

describe('each figure is its own page’s figure', () => {
  const owner = [...ROLE_PRIVILEGES.owner];
  const line = (shown, key) => shown.lines.find((l) => l.key === key);

  it('the owner of a connected business reads the board', () => {
    const shown = page(owner);
    expect(shown.tiles.map((t) => [t.title, t.figure, t.note])).toEqual([
      ['Revenue today', '$1,240.00', '15 payments'],
      ['Payment due', '6', 'members'],
      ['Failed payments', '3', '$60.00 outstanding'],
      ['To review', '5', '2 refunds · 2 chargebacks · 1 app payment'],
    ]);
    expect(shown.groups.map((g) => [g.label, g.lines.map((l) => [l.title, l.state?.text ?? null, l.where])])).toEqual([
      [
        'Daily',
        [
          ['Sell', 'Point of sale · 11 sales today', null],
          ['Failed payments', '3 outstanding · $60.00', null],
          ['Payment due', '6 members', 'in Members'],
          ['Refunds to review', '2 pending', 'on Overview'],
          ['Chargebacks', '2 need a response', 'on Overview'],
          ['App payments to review', '1 to review', 'on Overview'],
        ],
      ],
      [
        'Products and pricing',
        [
          ['Memberships', '4 on your price list', null],
          ['Products', '3 products', 'in Sell'],
          ['Discounts', '1 discount', 'in Memberships'],
          ['Tax', 'Sales tax 8.25%', 'in Memberships'],
          ['Billing rules', 'Grace period: none', 'in Memberships'],
        ],
      ],
      [
        'Setup and reports',
        [
          ['Card payments with Square', 'Connected', 'in Settings'],
          ['Square Terminals', '2 paired', 'in Settings'],
          ['Request cards on file', null, 'in Members'],
          ['Revenue report', 'Monthly figures', 'in Reports'],
          ['Export payments', 'CSV', 'in Reports'],
          ['Your KWAZO plan', null, 'on Overview'],
        ],
      ],
    ]);
  });

  it('each line opens its exact place', () => {
    const to = Object.fromEntries(page(owner).lines.map((l) => [l.key, l.to]));
    expect(to).toEqual({
      sell: `/console/${SLUG}/sell`,
      failed: `/console/${SLUG}/failed-payments`,
      'payment-due': `/console/${SLUG}/members?show=payment-due`,
      refunds: `/console/${SLUG}#refunds-to-review`,
      chargebacks: `/console/${SLUG}#chargebacks`,
      'app-payments': `/console/${SLUG}#app-payment-checks`,
      memberships: `/console/${SLUG}/memberships`,
      products: `/console/${SLUG}/sell#products`,
      discounts: `/console/${SLUG}/memberships#discounts`,
      tax: `/console/${SLUG}/memberships#tax`,
      bills: `/console/${SLUG}/memberships#bills`,
      square: `/console/${SLUG}/settings#payments`,
      terminals: `/console/${SLUG}/settings#payments`,
      cards: `/console/${SLUG}/members?show=no-card`,
      'revenue-report': `/console/${SLUG}/reports#money`,
      export: `/console/${SLUG}/reports#export-payments`,
      plan: `/console/${SLUG}#plan`,
    });
  });

  it('only past members owe: Payment due opens Past members, as the bell does', () => {
    const shown = page(owner, { attention: attention(owner, { paymentDue: { count: 0, past: 2 } }) });
    expect(line(shown, 'payment-due')).toMatchObject({ state: { text: '2 past members' }, to: `/console/${SLUG}/members?show=past-payment-due` });
    expect(shown.tiles.find((t) => t.key === 'payment-due')).toMatchObject({ figure: '2', note: 'past members', tone: 'warn', to: `/console/${SLUG}/members?show=past-payment-due` });
  });

  it('nothing waiting reads as nothing, never as a missing figure', () => {
    const calm = attention(owner, { chargebacks: { count: 0 }, failedPayments: { count: 0, totals: [] }, paymentDue: { count: 0, past: 0 }, refunds: { count: 0 }, appPayments: { count: 0 } });
    const shown = page(owner, { attention: calm });
    expect(['failed', 'payment-due', 'refunds', 'chargebacks', 'app-payments'].map((k) => line(shown, k).state.text)).toEqual(['None outstanding', 'No payments due', 'None pending', 'None', 'None']);
    expect(shown.tiles.find((t) => t.key === 'review')).toMatchObject({ figure: '0', note: 'Nothing to review' });
    // Overview draws those boxes only while something waits: nothing to open, and no "on Overview".
    for (const k of ['refunds', 'chargebacks', 'app-payments']) expect(line(shown, k)).toMatchObject({ to: null, where: null });
    expect(line(shown, 'failed').to).toBe(`/console/${SLUG}/failed-payments`);
  });

  it('chargebacks waiting on a reconnect still open Overview, where its box says so', () => {
    const shown = page(owner, { attention: attention(owner, { chargebacks: { count: 0, needsReconnect: true } }) });
    expect(line(shown, 'chargebacks')).toMatchObject({ to: `/console/${SLUG}#chargebacks`, where: 'on Overview' });
  });

  it('a figure not read yet is left out, never a nought', () => {
    const shown = page(owner, { register: null, attention: null, payments: null, bills: null });
    expect(shown.tiles).toEqual([]);
    expect(shown.methods).toBeNull();
    for (const l of shown.lines) {
      if (l.state !== null) expect(['revenue-report', 'export', 'sell']).toContain(l.key);
    }
    expect(shown.lines.map((l) => l.key)).not.toContain('square');
  });

  it('chargebacks that need Square reconnected say so; lost ones say lost', () => {
    expect(line(page(owner, { attention: attention(owner, { chargebacks: { needsReconnect: true, count: 0 } }) }), 'chargebacks').state).toEqual({ text: 'Reconnect Square to see them', tone: 'bad' });
    expect(line(page(owner, { attention: attention(owner, { chargebacks: { count: 2, lostCount: 2 } }) }), 'chargebacks').state.text).toBe('2 lost');
    expect(line(page(owner, { attention: attention(owner, { chargebacks: { count: 3, lostCount: 1 } }) }), 'chargebacks').state.text).toBe('2 need a response');
  });

  it('a lost chargeback is not counted To review: nothing is left to respond to (round one, L2)', () => {
    const lost = attention(owner, { refunds: { count: 0 }, appPayments: { count: 0 }, chargebacks: { count: 2, lostCount: 2 } });
    expect(page(owner, { attention: lost }).tiles.find((t) => t.key === 'review')).toMatchObject({ figure: '0', note: 'Nothing to review' });
    const some = attention(owner, { refunds: { count: 1 }, appPayments: { count: 0 }, chargebacks: { count: 3, lostCount: 1 } });
    expect(page(owner, { attention: some }).tiles.find((t) => t.key === 'review')).toMatchObject({ figure: '3', note: '1 refund · 2 chargebacks' });
  });

  it('a studio says clients', () => {
    const groups = paymentLines({ orgSlug: SLUG, privileges: owner, org: { ...ORG, orgType: 'studio' }, membersName: 'Clients & staff', register: register(owner), attention: attention(owner), payments: payments(), bills: { overdueAfterDays: 3 } });
    const lines = groups.flatMap((g) => g.lines);
    expect(lines.find((l) => l.key === 'payment-due')).toMatchObject({ state: { text: '6 clients' }, where: 'in Clients & staff' });
    expect(lines.find((l) => l.key === 'cards')).toMatchObject({ state: null, where: 'in Clients & staff' });
    expect(lines.find((l) => l.key === 'bills').state.text).toBe('Grace period: 3 days');
  });

  it('several tax rates are counted; none reads No tax', () => {
    const two = { ...register(owner), tax: { included: false, rates: [{ id: 'a', name: 'GST', pcm: 5000 }, { id: 'b', name: 'QST', pcm: 9975 }] } };
    expect(page(owner, { register: two }).lines.find((l) => l.key === 'tax').state.text).toBe('2 tax rates');
    expect(page(owner, { register: { ...register(owner), tax: { included: false, rates: [] } } }).lines.find((l) => l.key === 'tax').state.text).toBe('No tax');
  });

  it('Terminals are listed only where Square sells them', () => {
    expect(page(owner, { payments: payments({ country: 'GB' }) }).lines.map((l) => l.key)).not.toContain('terminals');
    expect(page(owner, { payments: payments({ terminals: 0 }) }).lines.find((l) => l.key === 'terminals').state.text).toBe('None paired');
  });
});

describe('how today was paid', () => {
  it('each way that took money, the most first, named as every row names it', () => {
    expect(revenueByMethod(register([...ROLE_PRIVILEGES.owner]), [...ROLE_PRIVILEGES.owner])).toEqual([
      { key: 'terminal', label: 'Card on Terminal', money: '$780.00', share: 62.9 },
      { key: 'cash', label: 'Cash', money: '$310.00', share: 25 },
      { key: 'card_at_desk', label: 'Card at the desk', money: '$90.00', share: 7.3 },
      { key: 'bank_transfer', label: 'Bank transfer', money: '$60.00', share: 4.8 },
    ]);
  });
  it('nothing taken is an empty list, and a sliver still shows', () => {
    const owner = [...ROLE_PRIVILEGES.owner];
    expect(revenueByMethod(register(owner, { totalMinor: 0, terminal: 0, cash: 0, card_at_desk: 0, bank_transfer: 0 }), owner)).toEqual([]);
    // A sliver keeps its line; the bar's smallest width is the stylesheet's, and the shares add up to the day.
    const sliver = revenueByMethod(register(owner, { terminal: 1000000, cash: 100, card_at_desk: 0, bank_transfer: 0 }), owner);
    expect(sliver.map((w) => [w.key, w.share])).toEqual([['terminal', 100], ['cash', 0]]);
  });
});

describe('before Square is connected, the setup comes first', () => {
  const owner = [...ROLE_PRIVILEGES.owner];
  const manager = [...ROLE_PRIVILEGES.manager];
  const notConnected = (o = {}) => payments({ square: null, ...o });

  it('the owner of a US business: Connect Square, three steps, what works already', () => {
    const box = setupBox(notConnected(), ORG, owner);
    expect(box).toMatchObject({ step: 'connect', label: 'Payment setup · step 1 of 3', title: 'Connect Square to take card payments', press: { kind: 'connect', words: 'Connect Square' }, ask: null });
    expect(box.steps.map((s) => [s.title, s.optional])).toEqual([
      ['Connect Square', false],
      ['Pair a Terminal', true],
      ['Request cards on file', false],
    ]);
    expect(box.intro).toBe('Card payments on a Terminal, cards on file, autopay and payments in the member app run through your Square account. Connecting takes a few minutes.');
    expect(box.without).toMatch(/^Record cash, bank transfers and card payments taken on your own card machine/);
    expect(needsPaymentSetup(notConnected())).toBe(true);
  });

  it('a manager reads who can, with no button', () => {
    const box = setupBox(notConnected({ owner: false }), ORG, manager);
    expect(box.press).toBeNull();
    expect(box.ask).toBe('Only the owner of Iron House can connect Square.');
  });

  it('where Square sells no Terminal, two steps and no Terminal in the words', () => {
    const box = setupBox(notConnected({ country: 'GB' }), { ...ORG, orgType: 'studio' }, owner);
    expect(box.label).toBe('Payment setup · step 1 of 2');
    expect(box.steps.map((s) => s.title)).toEqual(['Connect Square', 'Request cards on file']);
    expect(box.intro).not.toMatch(/Terminal/);
    expect(box.steps[1].text).toBe('Ask clients to add a card for autopay.');
  });

  it('disconnected: connect again', () => {
    const removed = { ...SQUARE_CONNECTED, state: 'removed', removedAt: '2026-11-01T10:00:00Z' };
    expect(setupBox(notConnected({ square: removed }), ORG, owner)).toMatchObject({ step: 'again', press: { words: 'Connect Square again' } });
    expect(setupBox(notConnected({ square: removed, owner: false }), ORG, manager).ask).toBe('Only the owner of Iron House can connect Square again.');
    expect(page(owner, { payments: notConnected({ square: removed }) }).lines.find((l) => l.key === 'square').state).toEqual({ text: 'Disconnected', tone: 'bad' });
  });

  it('connected but no location chosen: the owner finishes in Settings', () => {
    const choosing = { ...SQUARE_CONNECTED, state: 'choose_location', locationName: null };
    expect(setupBox(notConnected({ square: choosing }), ORG, owner)).toMatchObject({ step: 'location', press: { kind: 'place', to: `/console/${SLUG}/settings#payments`, words: 'Choose location' } });
    expect(setupBox(notConnected({ square: choosing, owner: false }), ORG, manager)).toMatchObject({ press: null, ask: 'Only the owner of Iron House can choose the Square location.' });
    expect(needsPaymentSetup(notConnected({ square: choosing }))).toBe(true);
  });

  it('India and other countries: no Connect Square, no Set up, Settings’ own words', () => {
    const india = notConnected({ availability: 'india_soon', country: 'IN' });
    expect(setupBox(india, ORG, owner)).toMatchObject({ step: 'elsewhere', title: 'Coming soon in India', press: null, steps: [] });
    expect(setupBox(india, ORG, owner).intro).toMatch(/^Card and UPI payments for gyms in India are coming soon\./);
    expect(needsPaymentSetup(india)).toBe(false);
    expect(page(owner, { payments: india }).tiles.map((t) => t.key)).not.toContain('cards');
  });

  it.each([
    ['India', { availability: 'india_soon', country: 'IN' }],
    ['Brazil', { availability: 'not_available', country: 'BR' }],
  ])('%s: nothing promises "after Square is connected", where it cannot be (round one, H2)', (_, where) => {
    const calm = attention(owner, { failedPayments: { count: 0, totals: [] }, chargebacks: { count: 0 } });
    const shown = page(owner, { payments: notConnected(where), attention: calm });
    expect(JSON.stringify(shown)).not.toMatch(/after Square is connected/i);
    expect(shown.tiles.find((t) => t.key === 'failed')).toMatchObject({ figure: '0', note: 'None outstanding' });
    expect(shown.lines.find((l) => l.key === 'chargebacks').state.text).toBe('None');
    expect(shown.lines.map((l) => l.key)).not.toContain('cards');
  });

  it('no country yet: Set your country for the owner, who can for anybody else', () => {
    const none = notConnected({ availability: 'no_country', country: null });
    expect(setupBox(none, ORG, owner).press).toEqual({ kind: 'place', to: `/console/${SLUG}/settings#country`, words: 'Set your country' });
    expect(setupBox(none, ORG, manager)).toMatchObject({ press: null, ask: 'The owner can set the country in Gym details.' });
    expect(needsPaymentSetup(none)).toBe(true);
  });

  it('connected, a server without Square, or not read yet: no box and no Set up', () => {
    for (const p of [payments(), payments({ square: null, squareReady: false }), null]) {
      expect(setupBox(p, ORG, owner)).toBeNull();
      expect(needsPaymentSetup(p)).toBe(false);
    }
  });

  it('a server with no Square says nothing about Square: never "Not connected"', () => {
    const shown = page(owner, { payments: payments({ square: null, squareReady: false }), attention: attention(owner, { failedPayments: { count: 0, totals: [] }, chargebacks: { count: 0 } }) });
    expect(JSON.stringify(shown)).not.toMatch(/Not connected|After Square|Available after|Connect Square/);
    expect(shown.lines.map((l) => l.key)).not.toContain('square');
  });

  it('what needs Square says so, in place of a figure', () => {
    const shown = page(owner, { payments: notConnected(), attention: attention(owner, { failedPayments: { count: 0, totals: [] }, chargebacks: { count: 0 } }) });
    expect(shown.tiles.map((t) => [t.title, t.figure, t.note])).toEqual([
      ['Revenue today', '$1,240.00', '15 payments'],
      ['Payment due', '6', 'members'],
      ['Failed payments', '—', 'Available after Square is connected'],
      ['Cards on file', '—', 'Available after Square is connected'],
    ]);
    const state = Object.fromEntries(shown.lines.map((l) => [l.key, l.state?.text ?? null]));
    expect(state).toMatchObject({ failed: 'After Square is connected', chargebacks: 'After Square is connected', cards: 'After Square is connected', square: 'Not connected', terminals: 'Connect Square first' });
  });
});

describe('the rest', () => {
  it('Needs attention keeps the bell’s money lines only, in its order', () => {
    const lines = ['reconnect', 'chargebacks', 'failed-payments', 'payment-due', 'refunds', 'app-payments', 'at-risk', 'reported', 'app-cancels', 'new-leads'].map((key) => ({ key, to: '/x' }));
    expect(moneyAttention(lines).map((l) => l.key)).toEqual(['reconnect', 'chargebacks', 'failed-payments', 'payment-due', 'refunds', 'app-payments']);
    // Reconnect Square for staff who cannot: kept, with nowhere to go, as the bell keeps it (round one, H1).
    expect(moneyAttention([{ key: 'reconnect', to: null }])).toEqual([{ key: 'reconnect', to: null }]);
  });

  it('the plan as Overview says it', () => {
    const trial = { ...ORG, subscription: { status: 'trialing', trialEndsAt: '2026-11-30T12:00:00Z', subscribed: false } };
    expect(planState(trial, Date.parse('2026-11-19T12:00:00Z')).text).toMatch(/^Free trial · ends /);
    expect(planState(trial, Date.parse('2026-12-01T12:00:00Z'))).toMatchObject({ text: expect.stringMatching(/^Free trial · ended /), tone: 'warn' });
    expect(planState({ ...ORG, subscription: { status: 'past_due', subscribed: true } })).toEqual({ text: 'Payment due', tone: 'warn' });
    expect(planState(ORG)).toBeNull();
  });

  it('grace period words', () => {
    expect([graceWords(0), graceWords(1), graceWords(7), graceWords(undefined)]).toEqual(['Grace period: none', 'Grace period: 1 day', 'Grace period: 7 days', null]);
  });
});
