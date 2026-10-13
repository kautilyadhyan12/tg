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
  firstListedOn: '2026-01-05',
  listChangedOn: '2026-10-03',
  activeNow: 8,
  everLeft: true,
  months: memberMonths,
  stay: { leavers: 2, totalDays: 400 },
  leads: [],
});
const NO_VISITS = attendanceReportFrom({
  timezone: 'Europe/London',
  today: TODAY,
  firstVisitOn: null,
  days: [],
  weeks: [],
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
const money = (over = {}) =>
  moneyReportFrom({
    timezone: 'Europe/London',
    today: TODAY,
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
    owed: { currentMinor: 7998, currentPeople: 2, pastMinor: 6000, pastPeople: 1, overdueMinor: 4999, overduePeople: 1 },
    members: { today: TODAY, firstListedOn: '2026-01-05', everLeft: true, months: memberMonths },
    ...over,
  });

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
    expect(svc.money).toHaveBeenCalledWith('g1');
    expect(moneyPart().getByText('These figures come from the payments your staff record in the app. The first was recorded on 10 Jun 2026.')).toBeTruthy();

    expect(within(tile('recurring')).getByText('£99.98')).toBeTruthy();
    expect(within(tile('recurring')).getByText('2 repeating memberships')).toBeTruthy();
    expect(within(tile('collected')).getByText('£45.00')).toBeTruthy();
    expect(within(tile('collected')).getByText('October, so far: £60.00 paid, £15.00 refunded · September: £100.00')).toBeTruthy();
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
      money({ held: [], owed: { currentMinor: 0, currentPeople: 0, pastMinor: 0, pastPeople: 0, overdueMinor: 0, overduePeople: 0 } }),
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
        'Bills that have fallen due and are not fully paid, less what has been paid on them. A bill is overdue 7 days after its due date; you set this in Memberships, under Bills. Cancelled bills are not counted.',
      ),
    ).toBeTruthy();
    const life = within(tile('lifetime'));
    fireEvent.click(life.getByRole('button', { name: 'How Lifetime value is worked out' }));
    expect(
      life.getByText(
        'What a member pays you before they leave, on average: the money collected in July, August and September, divided by the 2 members who left in those months. It is the same as the money a member brings in a month divided by churn.',
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
    svc.money.mockResolvedValue(money({ owed: { currentMinor: 4999, currentPeople: 1, pastMinor: 0, pastPeople: 0, overdueMinor: 4999, overduePeople: 1 } }));
    open();
    const due = within(await screen.findByTestId('tile-due'));
    expect(due.getByText('1 member · all of it overdue')).toBeTruthy();
    expect(due.queryByRole('link', { name: 'See past members' })).toBeNull();
  });

  it('says so where payments in another currency are left out', async () => {
    svc.money.mockResolvedValue(money({ otherCurrency: true }));
    open();
    expect((await screen.findByTestId('other-currency-note')).textContent).toBe('Payments recorded in another currency, before your country changed, are not counted.');
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
