// OVERVIEW in the third look (ROADMAP V5-a; boards `Overview`, `Phone`). Only the network is
// mocked: what staff see is read off the real page. The worst thing it could do: show somebody
// whose role gives them no money the business's revenue, who owes, or a money line.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ROLE_PRIVILEGES, startHereResponseSchema } from '@app/shared';
import { WEEK_STARTS, attendanceDay, overview } from './__fixtures__/overview';
import { bestWeekKey, overviewHeading } from './overviewView';

const orgApi = {
  getMine: vi.fn(),
  getMembers: vi.fn(),
  getCodes: vi.fn(),
  getApplications: vi.fn(),
  getOverview: vi.fn(),
  getAttendanceDay: vi.fn(),
  getStartHere: vi.fn(),
  setStartHereHidden: vi.fn(),
  getMyCoOwnerRequest: vi.fn(() => Promise.resolve({ data: { request: null } })),
  getMyOwnerRequest: vi.fn(() => Promise.resolve({ data: { request: null } })),
};
const register = { get: vi.fn() };
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});
vi.mock('../../api/registerApi', () => ({ registerService: register }));
vi.mock('../../api/weekApi', () => ({ weekService: { get: vi.fn(() => new Promise(() => {})) } }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Dana Brooks' }, logout: vi.fn() }),
}));

const Overview = (await import('./Overview')).default;
const { AttentionContext } = await import('./useAttention');
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
  staffRole: 'owner',
  privileges: [...ROLE_PRIVILEGES.owner],
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
};
const ZERO = { count: 0, payments: 0, totalMinor: 0, taxMinor: 0, cash: 0, upi: 0, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, terminal: 0, app: 0, refundedMinor: 0, discountMinor: 0 };
const takings = { currency: 'USD', today: '2026-11-19', day: '2026-11-19', canSell: true, canManage: true, totals: { ...ZERO, count: 7, payments: 2, totalMinor: 124000, cash: 124000 } };
/** What the server sends the owner: every part. */
const ATTENTION = {
  chargebacks: { count: 2, lostCount: 0, needsReconnect: false, canReconnect: true },
  failedPayments: { count: 3, totals: [{ currency: 'USD', minor: 6000 }] },
  paymentDue: { count: 6, past: 1 },
  refunds: { count: 2 },
  appPayments: { count: 1, more: false },
  appCancels: { count: 2 },
  newLeads: { count: 5 },
  atRisk: { count: 2 },
  reported: null,
};
/** What it sends somebody who takes no payments: no money part at all. */
const NO_MONEY = { ...ATTENTION, chargebacks: null, failedPayments: null, paymentDue: null, refunds: null, appPayments: null, appCancels: null };
const retired = { response: { status: 410, data: { error: 'join_codes_retired', message: 'Join codes have been switched off.', requestId: 'r' } } };
const startHere = (done) =>
  startHereResponseSchema.parse({
    startHere: { hidden: false, canHide: true, steps: ['memberships', 'members', 'staff', 'frontDesk'].map((step) => ({ step, done: done.includes(step) })) },
  });
const busyNumbers = () =>
  overview({
    today: { visits: 6, visitors: 5 },
    week: { visits: 40, visitors: 21, prevVisits: 58, prevVisitors: 26 },
    month: { visitors: 12, members: 26, adoptionPct: 46 },
    weeks: WEEK_STARTS.map((weekStart, i) => ({ weekStart, visits: [41, 46, 39, 52, 49, 58, 55, 5][i], visitors: [20, 21, 19, 24, 22, 26, 25, 4][i] })),
  });

function Where() {
  const { pathname, search, hash } = useLocation();
  return <p data-testid="where">{`${pathname}${search}${hash}`}</p>;
}
/** Where the browser is, drawn beside the page whatever route is open. */
function Here() {
  const { pathname, search, hash } = useLocation();
  return <p data-testid="here">{`${pathname}${search}${hash}`}</p>;
}
function open(org = ORG, attention = ATTENTION) {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house']}>
      <AttentionContext.Provider value={{ attention, counts: {}, reload: () => undefined, paymentSetup: false }}>
        <Routes>
          <Route path="/console/:orgSlug" element={<Overview />} />
          <Route path="/console/:orgSlug/*" element={<Where />} />
        </Routes>
        <Here />
      </AttentionContext.Provider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetConsoleOrgs();
  register.get.mockResolvedValue(takings);
  orgApi.getCodes.mockRejectedValue(retired);
  orgApi.getApplications.mockRejectedValue(retired);
  orgApi.getMembers.mockResolvedValue({ data: { items: [], nextCursor: null } });
  orgApi.getOverview.mockResolvedValue(busyNumbers());
  orgApi.getAttendanceDay.mockResolvedValue(
    attendanceDay({
      totals: { people: 5, visits: 6 },
      people: [
        { userId: 'p1', displayName: 'Sam Rivera', visits: [{ markedAt: '2026-11-19T12:42:00.000Z', hoursStatus: 'open' }] },
        { userId: 'p2', displayName: 'Ava Chen', visits: [{ markedAt: '2026-11-19T13:05:00.000Z', hoursStatus: 'open' }] },
      ],
    }),
  );
  orgApi.getStartHere.mockResolvedValue({ data: startHere(['memberships']) });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the worst thing: money only for whoever their role gives it to', () => {
  it('a trainer at the front desk sees who came, and no revenue, nobody who owes, no money line', async () => {
    open({ ...ORG, staffRole: 'trainer', privileges: [...ROLE_PRIVILEGES.trainer] }, NO_MONEY);
    await screen.findByTestId('ov-tile-today');
    await screen.findByText('Sam Rivera');
    expect(screen.queryByTestId('ov-tile-revenue')).toBeNull();
    expect(screen.queryByTestId('ov-tile-payment-due')).toBeNull();
    expect(screen.queryByText('Revenue today')).toBeNull();
    expect(screen.queryByText('Payment due')).toBeNull();
    expect(register.get).not.toHaveBeenCalled();
    const box = within(screen.getByTestId('ov-attention'));
    expect(box.queryByText(/payment|refund|chargeback/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it('even if the bell were sent a money part, a role without Payment due or Sell gets no figure for it', async () => {
    open({ ...ORG, staffRole: 'trainer', privileges: [...ROLE_PRIVILEGES.trainer] }, ATTENTION);
    await screen.findByTestId('ov-tile-today');
    expect(screen.queryByTestId('ov-tile-revenue')).toBeNull();
    expect(screen.queryByTestId('ov-tile-payment-due')).toBeNull();
    expect(register.get).not.toHaveBeenCalled();
  });

  it('the owner sees Revenue today and Payment due, each from its own page', async () => {
    open();
    const revenue = within(await screen.findByTestId('ov-tile-revenue'));
    expect(revenue.getByText('$1,240.00')).toBeTruthy();
    expect(revenue.getByText(/9 payments/)).toBeTruthy();
    const due = within(screen.getByTestId('ov-tile-payment-due'));
    expect(due.getByText('6')).toBeTruthy();
    fireEvent.click(due.getByRole('link', { name: 'View' }));
    expect(screen.getByTestId('where').textContent).toBe('/console/iron-house/members?show=payment-due');
  });
});

describe('the page', () => {
  it("greets in the business's own day, with Check in for staff who check people in", async () => {
    open();
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toMatch(/^Good (morning|afternoon|evening), Dana$/);
    expect(screen.getByTestId('ov-business').textContent).toBe('Iron House · Austin · Gym');
    fireEvent.click(screen.getByRole('link', { name: 'Check in' }));
    expect(screen.getByTestId('where').textContent).toBe('/console/iron-house/attendance#check-in');
  });

  it('the figures: people today, this week against last, and the share who came in 30 days', async () => {
    open();
    const today = within(await screen.findByTestId('ov-tile-today'));
    expect(today.getByText('5')).toBeTruthy();
    expect(today.getByText('people')).toBeTruthy();
    const week = within(screen.getByTestId('ov-tile-week'));
    expect(week.getByText('21')).toBeTruthy();
    expect(week.getByText(/people so far, against 26 people in the whole of last week/)).toBeTruthy();
    const month = within(screen.getByTestId('ov-tile-month'));
    expect(month.getByText('46%')).toBeTruthy();
    expect(month.getByText('12 of 26 members came in the last 30 days')).toBeTruthy();
    const order = [...screen.getByTestId('ov-tiles').querySelectorAll('[data-testid^="ov-tile-"]')].map((t) => t.getAttribute('data-testid'));
    expect(order).toEqual(['ov-tile-today', 'ov-tile-revenue', 'ov-tile-payment-due', 'ov-tile-week', 'ov-tile-month']);
  });

  it('Needs attention lists what the bell lists, most urgent first, each opening its place', async () => {
    open();
    const box = await screen.findByTestId('ov-attention');
    const lines = within(box).getAllByTestId('ov-attention-line');
    const titles = lines.map((l) => l.querySelector('.c-attn-text > span').textContent);
    expect(titles).toEqual([
      '2 chargebacks need a response',
      '3 failed card payments',
      '6 members with a payment due',
      '2 refunds to review',
      '1 app payment to review',
      '2 members at risk',
      '2 members cancelled in the app',
      '5 new leads',
    ]);
    expect(within(box).getByText('8 items · by urgency')).toBeTruthy();
    const refunds = lines[3];
    fireEvent.click(within(refunds).getByRole('link'));
    // Overview again, at its Refunds to review box.
    expect(screen.queryByTestId('where')).toBeNull();
    expect(screen.getByTestId('here').textContent).toBe('/console/iron-house#refunds-to-review');
  });

  it('says Nothing needs attention when the bell is empty, and draws no box for somebody who may see no part', async () => {
    const quiet = Object.fromEntries(Object.keys(ATTENTION).map((k) => [k, null]));
    open(ORG, { ...quiet, newLeads: { count: 0 } });
    expect(await screen.findByTestId('ov-attention-none')).toBeTruthy();
    cleanup();
    resetConsoleOrgs();
    open(ORG, quiet);
    await screen.findByTestId('ov-tile-today');
    expect(screen.queryByTestId('ov-attention')).toBeNull();
  });

  it("today's check-ins show each person with their time, and the way to everyone", async () => {
    open();
    const box = within(await screen.findByTestId('todays-checkins'));
    expect(box.getAllByTestId('checkin-person')).toHaveLength(2);
    expect(box.getByText('5 people')).toBeTruthy();
    fireEvent.click(box.getByRole('link', { name: /3 more — see everyone/ }));
    expect(screen.getByTestId('where').textContent).toBe('/console/iron-house/attendance');
  });

  it('the chart marks the busiest finished week, and this week is never it', async () => {
    open();
    const chart = await screen.findByTestId('attendance-chart');
    expect(chart.querySelectorAll('.c-ov-bar-best')).toHaveLength(1);
    expect(chart.querySelectorAll('.c-ov-bar-now')).toHaveLength(1);
    expect(within(chart).getByText('This week')).toBeTruthy();
    expect(within(chart).getByText('Busiest week')).toBeTruthy();
  });

  it('Getting started shows the next step with its button, and View all steps opens every step', async () => {
    open();
    const strip = within(await screen.findByTestId('start-here'));
    expect(strip.getByTestId('start-here-count').textContent).toBe('1 of 4 done');
    expect(strip.getByRole('heading').textContent).toMatch(/^Next: /);
    expect(document.querySelector('[data-step]')).toBeNull();
    fireEvent.click(strip.getByRole('button', { name: /View all 4 steps/ }));
    expect(document.querySelectorAll('[data-step]')).toHaveLength(4);
    expect(strip.getByRole('button', { name: 'Hide this list' })).toBeTruthy();
    fireEvent.click(strip.getByRole('button', { name: /Hide the steps/ }));
    expect(document.querySelector('[data-step]')).toBeNull();
  });
});

describe('what the review found (V5-a, round one)', () => {
  it('staff who keep the price list but take no payments get no Revenue today, though the register sends its totals', async () => {
    register.get.mockResolvedValue({ ...takings, canSell: false });
    const keeper = { ...ORG, staffRole: 'manager', privileges: ['members.read', 'memberships.manage', 'attendance.read'] };
    open(keeper, NO_MONEY);
    await screen.findByTestId('ov-tile-today');
    await waitFor(() => expect(register.get).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('ov-tile-revenue')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it('This week follows the people: more people and fewer visits than last week is up', async () => {
    orgApi.getOverview.mockResolvedValue(
      overview({ today: { visits: 2, visitors: 2 }, week: { visits: 26, visitors: 25, prevVisits: 60, prevVisitors: 15 }, month: { visitors: 12, members: 26, adoptionPct: 46 } }),
    );
    open();
    const week = within(await screen.findByTestId('ov-tile-week'));
    expect(week.getByText('25')).toBeTruthy();
    expect(week.getByText('▲')).toBeTruthy();
    expect(week.getByText(/against 15 people in the whole of last week/)).toBeTruthy();
  });

  it('Revenue today is read again when staff come back to the window', async () => {
    open();
    await screen.findByText('$1,240.00');
    expect(register.get).toHaveBeenCalledTimes(1);
    register.get.mockResolvedValue({ ...takings, totals: { ...takings.totals, totalMinor: 150000 } });
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('$1,500.00')).toBeTruthy();
    expect(register.get).toHaveBeenCalledTimes(2);
  });

  it('Getting started shows every button of the next step: Import and Add when it is bringing members in', async () => {
    orgApi.getStartHere.mockResolvedValue({ data: startHere(['memberships']) });
    open();
    const strip = within(await screen.findByTestId('start-here'));
    expect(strip.getByRole('link', { name: 'Import members' }).getAttribute('href')).toBe('/console/iron-house/members?open=import');
    expect(strip.getByRole('link', { name: 'Add member' }).getAttribute('href')).toBe('/console/iron-house/members?open=add');
  });

  it('the ring draws no progress at 0 done, and some at 1', async () => {
    orgApi.getStartHere.mockResolvedValue({ data: startHere([]) });
    open();
    const card = await screen.findByTestId('start-here');
    expect(card.querySelector('.c-ov-ring-fill')).toBeNull();
    cleanup();
    resetConsoleOrgs();
    orgApi.getStartHere.mockResolvedValue({ data: startHere(['memberships']) });
    open();
    expect((await screen.findByTestId('start-here')).querySelector('.c-ov-ring-fill')).not.toBeNull();
  });

  it('Streaks folds away and opens again', async () => {
    orgApi.getOverview.mockResolvedValue({
      data: { overview: { ...busyNumbers().data.overview, onARoll: [{ userId: 'r1', displayName: 'Priya Nair', weeksRunning: 5, daysRunning: 3, visits: 11, cheerableAt: null }] } },
    });
    open();
    const box = within(await screen.findByTestId('streaks'));
    expect(box.getByText('Priya Nair')).toBeTruthy();
    const fold = box.getByRole('button', { name: /^Streaks/ });
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(box.queryByText('Priya Nair')).toBeNull();
    fireEvent.click(fold);
    expect(box.getByText('Priya Nair')).toBeTruthy();
  });

  it("a role that may not open Attendance gets no link to it under today's check-ins", async () => {
    const noAttendancePage = { ...ORG, staffRole: 'manager', privileges: ['members.read'] };
    open(noAttendancePage, NO_MONEY);
    const box = within(await screen.findByTestId('todays-checkins'));
    expect(box.queryByRole('link')).toBeNull();
  });
});

describe('overviewHeading and bestWeekKey', () => {
  it("reads the hour and the day in the business's zone, not the browser's", () => {
    const now = new Date('2026-11-16T14:30:00.000Z');
    expect(overviewHeading({ now, timezone: 'America/Chicago', displayName: 'Dana Brooks' })).toEqual({
      eyebrow: 'Overview · Monday 16 November',
      greeting: 'Good morning, Dana',
    });
    expect(overviewHeading({ now, timezone: 'Asia/Kolkata', displayName: 'Dana Brooks' }).greeting).toBe('Good evening, Dana');
    expect(overviewHeading({ now: new Date('2026-11-16T03:30:00.000Z'), timezone: 'Asia/Kolkata', displayName: '' })).toEqual({
      eyebrow: 'Overview · Monday 16 November',
      greeting: 'Good morning',
    });
    expect(overviewHeading({ now, timezone: 'Not/AZone', displayName: 'kd@gmail.com' }).greeting).toMatch(/^Good (morning|afternoon|evening)$/);
  });

  it('the busiest finished week, the later one on a tie, never the current week, none with no visits', () => {
    const bar = (key, visits, isCurrent = false) => ({ key, visits, isCurrent });
    expect(bestWeekKey([bar('a', 4), bar('b', 9), bar('c', 9), bar('d', 30, true)])).toBe('c');
    expect(bestWeekKey([bar('a', 0), bar('b', 0), bar('c', 3, true)])).toBeNull();
    expect(bestWeekKey(null)).toBeNull();
  });
});
