// THE REPORTS PAGE'S MONEY, drawn (ROADMAP 21b-i; spec Part 3 §16.5). Only the network is
// mocked: what staff see is read off the real page.
//
// The worst thing the screen could do: show a zero where the gym records no payment here,
// or ask for and draw money for somebody who may not record payments.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { attendanceReportFrom, membersReportFrom, moneyReportFrom } from '@app/shared';

const svc = { members: vi.fn(), attendance: vi.fn(), money: vi.fn() };
const orgApi = { getMine: vi.fn() };
vi.mock('../../api/reportsApi', () => ({ reportsService: svc }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});

const Reports = (await import('./Reports')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'members.confirm', 'reports.read', 'billing.members', 'memberships.manage'],
  timezone: 'Europe/London',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};

const TODAY = '2026-10-20';
const MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const memberMonths = MONTHS.map((month) => ({ month, activeAtStart: 10, joined: 0, left: month === '2026-08' ? 2 : 0, leftOfStart: month === '2026-08' ? 2 : 0 }));
const MEMBERS = membersReportFrom({
  timezone: 'Europe/London',
  today: TODAY,
  period: '12m',
  firstListedOn: '2026-01-05',
  listChangedOn: '2026-10-03',
  activeNow: 8,
  everLeft: true,
  months: memberMonths,
  inPeriod: { joined: 0, left: 2 },
  stay: { leavers: 2, totalDays: 400 },
  leads: [],
  anyLead: false,
  yearEarlier: { joined: 0, late: 0, lateFrom: null },
});
const NO_VISITS = attendanceReportFrom({
  timezone: 'Europe/London',
  today: TODAY,
  period: '12m',
  firstVisitOn: null,
  days: [],
  weeks: [],
  people: 0,
  hours: [],
  hoursNoTime: 0,
  member: { members: 0, visits: 0, visitors: 0 },
  classes: { ever: false, types: [] },
});

const gold = (over = {}) => ({
  typeId: 'gold',
  typeName: 'Gold Monthly',
  priceMinor: 4999,
  membership: {
    kind: 'recurring',
    termCount: 1,
    termUnit: 'month',
    packClasses: null,
    packDays: null,
    free: false,
    startsOn: '2026-10-01',
    frozenDays: 0,
    status: 'active',
    frozenOn: null,
    cancelledOn: null,
    paidPeriods: 1,
    paidFloor: 0,
    renews: true,
    classesLeft: null,
    ...over,
  },
});
// Twelve months hold every month the fixture names, so each month's money is all in the period.
const inPeriod = (facts) => ({ ...facts, months: facts.months.map((m) => ({ periodPaidMinor: m.paidMinor, periodRefundedMinor: m.refundedMinor, ...m })) });
const money = (over = {}) =>
  moneyReportFrom(inPeriod({
    timezone: 'Europe/London',
    today: TODAY,
    period: '12m',
    currency: 'GBP',
    anyMembership: true,
    firstPaidOn: '2026-06-10',
    otherCurrency: false,
    overdueAfterDays: 7,
    held: [gold(), gold()],
    months: [
      { typeId: 'gold', typeName: 'Gold Monthly', month: '2026-07', paidMinor: 10000, refundedMinor: 0 },
      { typeId: 'gold', typeName: 'Gold Monthly', month: '2026-08', paidMinor: 10000, refundedMinor: 0 },
      { typeId: 'gold', typeName: 'Gold Monthly', month: '2026-09', paidMinor: 12000, refundedMinor: 2000 },
      { typeId: 'day', typeName: 'One month', month: '2026-10', paidMinor: 6000, refundedMinor: 1500 },
    ],
    owed: { currentMinor: 7998, currentPeople: 2, listPeople: 2, pastMinor: 6000, pastPeople: 1, overdueMinor: 4999, overduePeople: 1 },
    members: { today: TODAY, firstListedOn: '2026-01-05', everLeft: true, months: memberMonths },
    yearEarlier: { paidMinor: 0, refundedMinor: 0 },
    ...over,
  }));

const open = (org = ORG) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={['/console/iron-house/reports']}>
      <Routes>
        <Route path="/console/:orgSlug/reports" element={<Reports />} />
      </Routes>
    </MemoryRouter>,
  );
};
const moneyPart = () => within(screen.getByRole('region', { name: 'Money' }));
const tile = (key) => screen.getByTestId(`tile-${key}`);
const tableRows = (name) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .map((r) => [...r.querySelectorAll('th,td')].map((c) => c.textContent));

beforeEach(() => {
  resetConsoleOrgs();
  svc.members.mockResolvedValue(MEMBERS);
  svc.attendance.mockResolvedValue(NO_VISITS);
  svc.money.mockResolvedValue(money());
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('the money figures', () => {
  it('shows each figure, the months and the memberships, for the gym the page is on', async () => {
    open();
    await screen.findByTestId('tile-recurring');
    expect(svc.money).toHaveBeenCalledWith('g1', '12m');
    expect(moneyPart().getByText('These figures come from the payments your staff record in the app. The first was recorded on 10 Jun 2026.')).toBeTruthy();

    expect(within(tile('recurring')).getByText('£99.98')).toBeTruthy();
    expect(within(tile('recurring')).getByText('2 repeating memberships')).toBeTruthy();
    expect(within(tile('collected')).getByText('£345.00')).toBeTruthy();
    expect(within(tile('collected')).getByText('since 10 Jun 2026, the first payment recorded here: £380.00 paid, £35.00 refunded · October, so far: £45.00')).toBeTruthy();
    expect(within(tile('due')).getByText('£139.98')).toBeTruthy();
    expect(within(tile('due')).getByText('2 members and 1 past member · £49.99 of it overdue')).toBeTruthy();
    // 300.00 collected in July to September, and 2 members left in them.
    expect(within(tile('lifetime')).getByText('£150.00')).toBeTruthy();
    expect(within(tile('lifetime')).getByText('a member, Jul to Sep 2026')).toBeTruthy();

    expect(tableRows('Money, month by month')).toEqual([
      ['Month', 'Paid', 'Refunded', 'Collected'],
      ['Oct 2026 (so far)', '£60.00', '£15.00', '£45.00'],
      ['Sep 2026', '£120.00', '£20.00', '£100.00'],
      ['Aug 2026', '£100.00', '£0.00', '£100.00'],
      ['Jul 2026', '£100.00', '£0.00', '£100.00'],
      ['Jun 2026', '£0.00', '£0.00', '£0.00'],
    ]);
    expect(tableRows('Money, by membership')).toEqual([
      ['Membership', 'In use now', 'Monthly recurring', 'Collected in October', 'Collected, last 12 months'],
      ['Gold Monthly', '2', '£99.98', '£0.00', '£300.00'],
      ['One month', '0', '–', '£45.00', '£45.00'],
    ]);
  });

  it('the people who owe are one press away, on Members already showing them', async () => {
    open();
    const due = within(await screen.findByTestId('tile-due'));
    expect(due.getByRole('link', { name: 'See who' }).getAttribute('href')).toBe('/console/iron-house/members?show=payment-due');
    expect(due.getByRole('link', { name: 'See past members' }).getAttribute('href')).toBe('/console/iron-house/members?show=past-payment-due');
  });

  it('nothing due is a sentence with no button; no repeating membership is a sentence, never £0.00', async () => {
    svc.money.mockResolvedValue(
      money({ held: [], owed: { currentMinor: 0, currentPeople: 0, listPeople: 0, pastMinor: 0, pastPeople: 0, overdueMinor: 0, overduePeople: 0 } }),
    );
    open();
    const due = within(await screen.findByTestId('tile-due'));
    expect(due.getByText('No bill in the app is due.')).toBeTruthy();
    expect(due.queryByRole('link')).toBeNull();
    expect(within(tile('recurring')).getByText('No repeating membership is in use today.')).toBeTruthy();
    expect(within(tile('recurring')).queryByText('£0.00')).toBeNull();
  });

  it('says how a figure is worked out when its button is pressed', async () => {
    open();
    const due = within(await screen.findByTestId('tile-due'));
    fireEvent.click(due.getByRole('button', { name: 'How Payment due is worked out' }));
    expect(
      due.getByText(
        "Bills that have fallen due and are not fully paid, less what has been paid on them. A bill is overdue 7 days after its due date; you set this in Memberships, under Bills. Cancelled bills are not counted. A new month's bill appears within the hour after the month begins.",
      ),
    ).toBeTruthy();
    const life = within(tile('lifetime'));
    fireEvent.click(life.getByRole('button', { name: 'How Lifetime value is worked out' }));
    expect(
      life.getByText(
        'What a member pays you before they leave, on average: the money collected in July, August and September, divided by the 2 members who left in those months. Someone who joined and left inside one month is not counted. It is the same as the money a member brings in a month divided by churn.',
      ),
    ).toBeTruthy();
  });

  it('lifetime value without enough behind it is a sentence', async () => {
    svc.money.mockResolvedValue(money({ firstPaidOn: '2026-09-02' }));
    open();
    const life = within(await screen.findByTestId('tile-lifetime'));
    expect(life.getByText('Not enough data yet. Lifetime value needs 3 full months of payments recorded here and of your member list.')).toBeTruthy();
  });

  it('everything owed being overdue is said in words, not as the same amount twice', async () => {
    svc.money.mockResolvedValue(money({ owed: { currentMinor: 4999, currentPeople: 1, listPeople: 1, pastMinor: 0, pastPeople: 0, overdueMinor: 4999, overduePeople: 1 } }));
    open();
    const due = within(await screen.findByTestId('tile-due'));
    expect(due.getByText('1 member · all of it overdue')).toBeTruthy();
    expect(due.queryByRole('link', { name: 'See past members' })).toBeNull();
  });

  it('people the Members list marks Payment due with no bill here are said, and See who still opens them', async () => {
    svc.money.mockResolvedValue(money({ owed: { currentMinor: 7998, currentPeople: 2, listPeople: 5, pastMinor: 0, pastPeople: 0, overdueMinor: 0, overduePeople: 0 } }));
    open();
    const due = within(await screen.findByTestId('tile-due'));
    expect(due.getByText('2 members · none of it overdue · 3 more are marked Payment due on your member list, with no amount in the app.')).toBeTruthy();
    expect(due.getByRole('link', { name: 'See who' })).toBeTruthy();
    cleanup();
    resetConsoleOrgs();
    svc.money.mockResolvedValue(money({ owed: { currentMinor: 0, currentPeople: 0, listPeople: 1, pastMinor: 0, pastPeople: 0, overdueMinor: 0, overduePeople: 0 } }));
    open();
    const again = within(await screen.findByTestId('tile-due'));
    expect(again.getByText('No bill in the app is due.')).toBeTruthy();
    expect(again.getByText('1 member is marked Payment due on your member list, with no amount in the app.')).toBeTruthy();
    expect(again.getByRole('link', { name: 'See who' }).getAttribute('href')).toBe('/console/iron-house/members?show=payment-due');
  });

  it('with money in another currency left out, the list-only sentence does not say the app holds no amount', async () => {
    svc.money.mockResolvedValue(money({ otherCurrency: true, owed: { currentMinor: 0, currentPeople: 0, listPeople: 1, pastMinor: 0, pastPeople: 0, overdueMinor: 0, overduePeople: 0 } }));
    open();
    const due = within(await screen.findByTestId('tile-due'));
    expect(due.getByText('1 member is marked Payment due on your member list, with no amount counted here.')).toBeTruthy();
  });

  it('three months that gave back as much as they took say so, not "not enough data"', async () => {
    svc.money.mockResolvedValue(
      money({
        months: [
          { typeId: 'gold', typeName: 'Gold Monthly', month: '2026-08', paidMinor: 5000, refundedMinor: 5000 },
          { typeId: 'gold', typeName: 'Gold Monthly', month: '2026-10', paidMinor: 5000, refundedMinor: 0 },
        ],
      }),
    );
    open();
    const life = within(await screen.findByTestId('tile-lifetime'));
    expect(life.getByText('In the last 3 full months you refunded as much as you collected, so there is no lifetime value to show.')).toBeTruthy();
  });

  it('a membership name a spreadsheet would run as a formula is saved as words', async () => {
    const saved = [];
    const real = globalThis.Blob;
    vi.stubGlobal('Blob', function Blob(parts, options) {
      saved.push(parts.join(''));
      return new real(parts, options);
    });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    svc.money.mockResolvedValue(money({ months: [{ typeId: 'bad', typeName: '=HYPERLINK("http://x","Gold")', month: '2026-10', paidMinor: 100, refundedMinor: 0 }] }));
    open();
    const part = within(await screen.findByTestId('money-by-membership'));
    fireEvent.click(part.getByRole('button', { name: 'Download CSV' }));
    vi.unstubAllGlobals();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toContain(`"'=HYPERLINK(""http://x"",""Gold"")"`);
    expect(saved[0]).not.toMatch(/(^|,|\n)"=/);
  });

  it('says so where payments in another currency are left out', async () => {
    svc.money.mockResolvedValue(money({ otherCurrency: true }));
    open();
    expect((await screen.findByTestId('other-currency-note')).textContent).toBe('Payments and bills in another currency, from before your country changed, are not counted here.');
  });
});

describe('a gym with no money figures', () => {
  it('that records no payment here is told why, with a button to Members and no figure', async () => {
    svc.money.mockResolvedValue(money({ firstPaidOn: null }));
    open();
    const part = within(await screen.findByRole('region', { name: 'Money' }));
    await waitFor(() =>
      expect(
        part.getByText(
          "No payment is recorded in the app yet. If you take payments in other software, your money figures are there. To see them here, record each payment on the member's page.",
        ),
      ).toBeTruthy(),
    );
    expect(part.getByRole('link', { name: 'Open Members' }).getAttribute('href')).toBe('/console/iron-house/members');
    expect(screen.queryByTestId('tile-recurring')).toBeNull();
    expect(part.queryByText(/£/)).toBeNull();
  });

  it('that has given no membership is sent to Memberships, or told who can set them up', async () => {
    svc.money.mockResolvedValue(money({ anyMembership: false, firstPaidOn: null }));
    open();
    const part = within(await screen.findByRole('region', { name: 'Money' }));
    await waitFor(() => expect(part.getByRole('link', { name: 'Set up memberships' }).getAttribute('href')).toBe('/console/iron-house/memberships'));
    cleanup();
    resetConsoleOrgs();
    open({ ...ORG, staffRole: 'manager', privileges: ['members.read', 'reports.read', 'billing.members'] });
    const again = within(await screen.findByRole('region', { name: 'Money' }));
    await waitFor(() => expect(again.getByText('Staff who manage memberships can set them up.')).toBeTruthy());
    expect(again.queryByRole('link', { name: 'Set up memberships' })).toBeNull();
  });
});

describe('who sees money', () => {
  it('somebody who may read reports and not record payments is told, and nothing is asked for them', async () => {
    open({ ...ORG, staffRole: 'trainer', privileges: ['members.read', 'reports.read'] });
    const part = within(await screen.findByRole('region', { name: 'Money' }));
    expect(part.getByText("Your role doesn't allow you to see money figures. Ask the owner if you need to.")).toBeTruthy();
    expect(svc.money).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tile-recurring')).toBeNull();
  });

  it('a failure keeps the figures above on the page and offers to try again', async () => {
    svc.money.mockRejectedValueOnce(new Error('down'));
    open();
    const part = within(await screen.findByRole('region', { name: 'Money' }));
    fireEvent.click(await part.findByRole('button', { name: /try again/i }));
    await screen.findByTestId('tile-recurring');
    expect(screen.getByTestId('tile-active')).toBeTruthy();
    expect(svc.money).toHaveBeenCalledTimes(2);
  });
});

describe('the period', () => {
  it('four weeks: Collected is the money of those days, said with them, and the membership table is headed for them', async () => {
    // From 23 September: 50.00 of September's 120.00 and all of October's, less the refunds of those days.
    svc.money.mockResolvedValue(
      money({
        period: '4w',
        firstPaidOn: '2025-03-01',
        months: [
          { typeId: 'gold', typeName: 'Gold Monthly', month: '2026-08', paidMinor: 10000, refundedMinor: 0, periodPaidMinor: 0, periodRefundedMinor: 0 },
          { typeId: 'gold', typeName: 'Gold Monthly', month: '2026-09', paidMinor: 12000, refundedMinor: 2000, periodPaidMinor: 5000, periodRefundedMinor: 0 },
          { typeId: 'day', typeName: 'One month', month: '2026-10', paidMinor: 6000, refundedMinor: 1500, periodPaidMinor: 6000, periodRefundedMinor: 1500 },
        ],
      }),
    );
    open();
    await screen.findByTestId('tile-recurring');
    expect(tile('collected').textContent).toBe('Collected£95.0023 Sep 2026 to 20 Oct 2026: £110.00 paid, £15.00 refunded · October, so far: £45.00A year earlier: £0.00 · up £95.00');
    fireEvent.click(within(tile('collected')).getByRole('button', { name: 'How Collected is worked out' }));
    expect(within(tile('collected')).getByText('Payments your staff recorded from 23 Sep 2026 to today, less refunds noted in those days. A payment or a refund that was undone is not counted. A year earlier counts the same weekdays 52 weeks before: 24 Sep 2025 to 21 Oct 2025.')).toBeTruthy();
    // Whole months, each its own figure; and each membership's money in the four weeks.
    expect(tableRows('Money, month by month')).toEqual([
      ['Month', 'Paid', 'Refunded', 'Collected'],
      ['Oct 2026 (so far)', '£60.00', '£15.00', '£45.00'],
      ['Sep 2026', '£120.00', '£20.00', '£100.00'],
    ]);
    expect(tableRows('Money, by membership')).toEqual([
      ['Membership', 'In use now', 'Monthly recurring', 'Collected in October', 'Collected, last 4 weeks'],
      ['Gold Monthly', '2', '£99.98', '£0.00', '£50.00'],
      ['One month', '0', '–', '£45.00', '£45.00'],
    ]);
  });

  it('a gym whose first payment is inside the period reads where its money starts', async () => {
    svc.money.mockResolvedValue(money({ period: '12m', firstPaidOn: '2026-06-10' }));
    open();
    await screen.findByTestId('tile-recurring');
    expect(tile('collected').textContent).toContain('since 10 Jun 2026, the first payment recorded here');
    svc.money.mockResolvedValue(money({ period: '12m', firstPaidOn: '2025-03-01' }));
    cleanup();
    open();
    await screen.findByTestId('tile-recurring');
    expect(tile('collected').textContent).toContain('1 Nov 2025 to 20 Oct 2026: £380.00 paid, £35.00 refunded');
  });
});
