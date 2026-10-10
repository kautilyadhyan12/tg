// THE REPORTS PAGE, drawn (ROADMAP 21a-i; spec Part 3 §16.5). Only the network is mocked:
// what staff see is read off the real page.
//
// The worst thing the screen could do: show a zero or a made-up number where the gym's list
// cannot give a figure, or ask for the figures for somebody the server would refuse.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { membersReportFrom } from '@app/shared';

const svc = { members: vi.fn() };
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
  privileges: ['members.read', 'members.confirm', 'reports.read'],
  timezone: 'Europe/London',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};

const facts = (over = {}) => ({
  timezone: 'Europe/London',
  today: '2026-10-10',
  firstListedOn: '2026-06-10',
  listChangedOn: '2026-10-03',
  activeNow: 11,
  everLeft: true,
  months: [
    { month: '2026-06', activeAtStart: 10, joined: 3, left: 0, leftOfStart: 0 },
    { month: '2026-07', activeAtStart: 13, joined: 1, left: 1, leftOfStart: 0 },
    { month: '2026-08', activeAtStart: 13, joined: 0, left: 1, leftOfStart: 1 },
    { month: '2026-09', activeAtStart: 12, joined: 0, left: 1, leftOfStart: 1 },
    { month: '2026-10', activeAtStart: 11, joined: 1, left: 1, leftOfStart: 1 },
  ],
  stay: { leavers: 4, totalDays: 1338 },
  leads: [
    { source: 'walk_in', leads: 3, joined: 1 },
    { source: 'friend', leads: 1, joined: 1 },
  ],
  ...over,
});
const NOBODY_REMOVED = facts({
  everLeft: false,
  stay: { leavers: 0, totalDays: 0 },
  months: facts().months.map((m) => ({ ...m, left: 0, leftOfStart: 0 })),
});
const EMPTY = facts({ firstListedOn: null, listChangedOn: null, activeNow: 0, everLeft: false, months: [], stay: { leavers: 0, totalDays: 0 }, leads: [] });

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
const tile = (key) => screen.getByTestId(`tile-${key}`);
const tableRows = (name) =>
  within(screen.getByRole('table', { name }))
    .getAllByRole('row')
    .map((r) => [...r.querySelectorAll('th,td')].map((c) => c.textContent));

beforeEach(() => {
  resetConsoleOrgs();
  svc.members.mockResolvedValue(membersReportFrom(facts()));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('the members figures', () => {
  it('shows each figure with its number, the months and the leads, for the gym the page is on', async () => {
    open();
    await screen.findByTestId('tile-active');
    expect(svc.members).toHaveBeenCalledTimes(1);
    expect(svc.members).toHaveBeenCalledWith('g1');
    expect(['active', 'new', 'left', 'churn', 'retention', 'stay'].map((k) => tile(k).textContent)).toEqual([
      'Members now11Members on your list, month by month1 Jul 2026Today',
      'New this month1October 2026, so far · September: 0',
      'Left this month1October 2026, so far · September: 1',
      'Churn5.3%a month, Jul to Sep 2026',
      'Retention94.7%a month, Jul to Sep 202694.7% stayed5.3% left',
      'Average stay11 months4 people left in the months shown',
    ]);
    expect(screen.getByText('These figures come from your member list. Someone was last added or removed on 3 Oct 2026.')).toBeTruthy();
    expect(tableRows('Members, month by month')).toEqual([
      ['Month', 'Members at start', 'New', 'Left', 'Churn'],
      ['Oct 2026 (so far)', '11', '1', '1', '–'],
      ['Sep 2026', '12', '0', '1', '8.3%'],
      ['Aug 2026', '13', '0', '1', '7.7%'],
      ['Jul 2026', '13', '1', '1', '0%'],
      ['Jun 2026', '–', '–', '0', '–'],
    ]);
    expect(screen.getByTestId('leads-report').textContent).toContain('50%2 of 4 leads joined');
    expect([...screen.getByTestId('lead-bars').querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Walked in1 of 3 joined · 33.3%',
      'A friend1 of 1 joined · 100%',
    ]);
    expect(screen.queryByTestId('nobody-removed-note')).toBeNull();
  });

  it('a gym that has removed nobody reads a sentence, never 0 or 0%, and is told what those figures count', async () => {
    svc.members.mockResolvedValue(membersReportFrom(NOBODY_REMOVED));
    open();
    await screen.findByTestId('tile-active');
    for (const key of ['left', 'churn', 'retention', 'stay']) {
      expect(tile(key).textContent, key).toContain('Nobody has been removed from your member list yet.');
      expect(tile(key).textContent, key).not.toMatch(/\d/);
    }
    expect(tile('active').textContent).toContain('Members now11');
    // No Left bars and no stayed-and-left bar for a gym that has removed nobody.
    expect(screen.queryByTestId('stay-bar')).toBeNull();
    expect(screen.getByTestId('month-bars').textContent).toBe('NewJunJulAugSepOct');
    expect(screen.getByTestId('nobody-removed-note').textContent).toContain('count members you remove from your list or mark as left in an import');
    expect(tableRows('Members, month by month')[1]).toEqual(['Oct 2026 (so far)', '11', '1', '–', '–']);
  });

  it('too few months reads "Not enough data yet", with how many there are', async () => {
    svc.members.mockResolvedValue(membersReportFrom(facts({ firstListedOn: '2026-08-15' })));
    open();
    await screen.findByTestId('tile-active');
    for (const key of ['churn', 'retention', 'stay']) {
      expect(tile(key).textContent, key).toContain('Not enough data yet. This needs 3 full months of your member list here; you have 1 so far.');
      expect(tile(key).textContent, key).not.toContain('%');
    }
    expect(tile('left').textContent).toBe('Left this month1October 2026, so far · September: 1');
    expect(screen.queryByTestId('stay-bar')).toBeNull();
  });

  it('each figure says how it is worked out when its button is pressed, and not before', async () => {
    open();
    await screen.findByTestId('tile-active');
    const button = within(tile('churn')).getByRole('button', { name: 'How Churn is worked out' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(tile('churn').textContent).not.toContain('at the start of');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(tile('churn').textContent).toContain(
      'Of the members on your list at the start of July, August and September, the share who left during that month, the three months taken together.',
    );
    // Only that one opened.
    expect(tile('retention').textContent).toBe('Retention94.7%a month, Jul to Sep 202694.7% stayed5.3% left');
    fireEvent.click(button);
    expect(tile('churn').textContent).toBe('Churn5.3%a month, Jul to Sep 2026');
    for (const label of ['Members now', 'New this month', 'Left this month', 'Retention', 'Average stay', 'leads that became members']) {
      expect(screen.getByRole('button', { name: `How ${label} is worked out` })).toBeTruthy();
    }
  });

  it('the pictures say the number under the pointer, and their parts in words', async () => {
    open();
    await screen.findByTestId('tile-active');
    const trend = screen.getByTestId('members-trend');
    expect(within(trend).getByRole('img').getAttribute('aria-label')).toBe('Members on your list: 13 members on 1 Jul 2026, 11 members today');
    const strips = within(trend).getAllByTestId('trend-point');
    expect(strips.map((b) => b.getAttribute('aria-label'))).toEqual([
      '1 Jul 2026: 13 members',
      '1 Aug 2026: 13 members',
      '1 Sep 2026: 12 members',
      '1 Oct 2026: 11 members',
      'Today, 10 Oct 2026: 11 members',
    ]);
    fireEvent.mouseEnter(strips[1]);
    expect(screen.getByTestId('members-trend-said').textContent).toBe('1 Aug 2026: 13 members');
    // The keyboard reaches each point too.
    fireEvent.focus(strips[4]);
    expect(screen.getByTestId('members-trend-said').textContent).toBe('Today, 10 Oct 2026: 11 members');
    fireEvent.blur(strips[4]);
    expect(screen.getByTestId('members-trend-said').textContent).toBe('Members on your list, month by month');
    const bars = screen.getByTestId('month-bars');
    expect(bars.textContent).toBe('NewLeftJunJulAugSepOct');
    fireEvent.focus(within(bars).getByRole('button', { name: 'July 2026: 1 new, 1 left' }));
    expect(screen.getByTestId('month-bars-said').textContent).toBe('July 2026: 1 new, 1 left');
    // June, the month the list began, has no New bar; August has only a Left bar.
    const parts = (name) => [...within(bars).getByRole('button', { name }).querySelectorAll('[data-part]')].map((el) => `${el.dataset.part} ${el.style.background}`);
    expect(parts('June 2026: your list started, 0 left')).toEqual([]);
    expect(parts('July 2026: 1 new, 1 left')).toEqual(['new var(--cl-blue)', 'left var(--cl-orange)']);
    expect(parts('August 2026: 0 new, 1 left')).toEqual(['left var(--cl-orange)']);
    // Stayed is the long blue part and left the short orange one, each as wide as its share.
    const stay = screen.getByTestId('stay-bar');
    expect(within(stay).getByRole('img').getAttribute('aria-label')).toBe('94.7% stayed, 5.3% left');
    expect([...stay.querySelectorAll('[data-part]')].map((el) => [el.dataset.part, el.style.flexGrow, el.style.background])).toEqual([
      ['stayed', '94.7', 'var(--cl-blue)'],
      ['left', '5.3', 'var(--cl-orange)'],
    ]);
    // Each lead bar is as long as its share.
    expect([...screen.getByTestId('lead-bars').querySelectorAll('[data-part="joined"]')].map((el) => el.style.width)).toEqual(['33.3%', '100%']);
  });

  it('Download CSV saves the months under a dated name', async () => {
    const made = [];
    URL.createObjectURL = vi.fn((blob) => {
      made.push(blob);
      return 'blob:report';
    });
    URL.revokeObjectURL = vi.fn();
    const names = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      names.push(this.download);
    });
    open();
    await screen.findByTestId('tile-active');
    const [months, leads] = screen.getAllByRole('button', { name: 'Download CSV' });
    fireEvent.click(months);
    fireEvent.click(leads);
    expect(names).toEqual(['members-report-2026-10-10.csv', 'leads-report-2026-10-10.csv']);
    expect(made.map((b) => b.type)).toEqual(['text/csv;charset=utf-8', 'text/csv;charset=utf-8']);
  });
});

describe('what a gym has not done yet is never a zero', () => {
  it('leads with none marked Joined read a sentence and their counts, no share and no bar', async () => {
    svc.members.mockResolvedValue(membersReportFrom(facts({ leads: [{ source: 'walk_in', leads: 3, joined: 0 }, { source: 'friend', leads: 1, joined: 0 }] })));
    open();
    await screen.findByTestId('tile-active');
    const leads = screen.getByTestId('leads-report');
    expect(leads.textContent).toContain('No lead has been marked Joined yet. Press Joined on a lead when they sign up.4 leads');
    expect(leads.textContent).not.toContain('%');
    expect([...screen.getByTestId('lead-bars').querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Walked in3 leads', 'A friend1 lead']);
    expect(leads.querySelectorAll('[data-part="joined"]')).toHaveLength(0);
  });

  it('the month the list began says so in place of New, with no line and no New bar', async () => {
    svc.members.mockResolvedValue(
      membersReportFrom(
        facts({
          firstListedOn: '2026-10-08',
          everLeft: false,
          activeNow: 200,
          stay: { leavers: 0, totalDays: 0 },
          months: [{ month: '2026-10', activeAtStart: 0, joined: 200, left: 0, leftOfStart: 0 }],
        }),
      ),
    );
    open();
    await screen.findByTestId('tile-active');
    expect(tile('new').textContent).toBe('New this monthYour member list started this month, so new members are counted from next month.');
    expect(tile('active').textContent).toBe('Members now200');
    expect(screen.queryByTestId('members-trend')).toBeNull();
    // Nothing to draw yet: no empty picture.
    expect(screen.queryByTestId('month-bars')).toBeNull();
    expect(tableRows('Members, month by month')[1]).toEqual(['Oct 2026 (so far)', '–', '–', '–', '–']);
  });
});

describe('what is not set up yet', () => {
  it('a gym with nobody on its list and no leads gets a button to each place, and no figure', async () => {
    svc.members.mockResolvedValue(membersReportFrom(EMPTY));
    open();
    await screen.findByText('Nobody is on your member list yet. These figures start when you add your members.');
    expect(screen.queryByTestId('tile-active')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('link', { name: 'Import your members' }).getAttribute('href')).toBe('/console/iron-house/members?open=import');
    expect(screen.getByText("You haven't added any leads yet.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add a lead' }).getAttribute('href')).toBe('/console/iron-house/leads?open=add');
  });

  it('staff who cannot open Leads are told who can, with no button', async () => {
    svc.members.mockResolvedValue(membersReportFrom(EMPTY));
    open({ ...ORG, staffRole: 'trainer', privileges: ['members.read', 'reports.read'] });
    await screen.findByText("You haven't added any leads yet.");
    expect(screen.queryByRole('link', { name: 'Add a lead' })).toBeNull();
    expect(screen.getByText('Staff who keep the member list can add leads.')).toBeTruthy();
  });
});

describe('who sees it, and when it cannot be read', () => {
  it('somebody without the tick is told, and nothing is asked for them', async () => {
    open({ ...ORG, staffRole: 'trainer', privileges: ['members.read'] });
    await screen.findByText("Your role doesn't allow you to see reports. Ask the owner if you need to.");
    expect(svc.members).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tile-active')).toBeNull();
  });

  it('a refusal from the server reads the same', async () => {
    svc.members.mockRejectedValue({ response: { status: 403, data: { message: "Your role doesn't allow that." } } });
    open();
    await screen.findByText("Your role doesn't allow you to see reports. Ask the owner if you need to.");
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a failure says so with Try again, which reads it again; it is never drawn as an empty report', async () => {
    svc.members.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    open();
    await screen.findByText("We couldn't load your reports.");
    expect(screen.queryByText(/Nobody is on your member list/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('tile-active');
    await waitFor(() => expect(svc.members).toHaveBeenCalledTimes(2));
  });

  it("a studio reads its own word for its people", async () => {
    open({ ...ORG, orgType: 'studio' });
    await screen.findByTestId('tile-active');
    expect(tile('active').textContent).toContain('Clients now11Clients on your list');
    expect(screen.getByRole('heading', { name: 'Leads that became clients' })).toBeTruthy();
  });
});
