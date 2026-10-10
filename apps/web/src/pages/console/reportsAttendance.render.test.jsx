// THE REPORTS PAGE'S ATTENDANCE, drawn (ROADMAP 21a-ii; spec Part 3 §16.5). Only the network
// is mocked: what staff see is read off the real page.
//
// The worst thing the screen could do: show a zero or a made-up number where the gym's
// check-ins or classes cannot give a figure, or name one busiest hour where several tie.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { attendanceReportFrom, membersReportFrom } from '@app/shared';

const svc = { members: vi.fn(), attendance: vi.fn() };
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
  privileges: ['members.read', 'members.confirm', 'reports.read', 'attendance.read', 'schedule.manage'],
  timezone: 'Europe/London',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};

const MEMBERS = membersReportFrom({
  timezone: 'Europe/London',
  today: '2026-10-10',
  firstListedOn: '2026-06-10',
  listChangedOn: '2026-10-03',
  activeNow: 3,
  everLeft: false,
  months: [],
  stay: { leavers: 0, totalDays: 0 },
  leads: [],
});

// Saturday 10 October 2026. The first check-in was Monday 31 August: five whole weeks.
const facts = (over = {}) => ({
  timezone: 'Europe/London',
  today: '2026-10-10',
  firstVisitOn: '2026-08-31',
  days: [
    { day: '2026-09-14', visits: 2 },
    { day: '2026-10-05', visits: 1 },
    { day: '2026-10-08', visits: 4 },
    { day: '2026-10-10', visits: 1 },
  ],
  weeks: [
    { weekStart: '2026-08-31', visits: 1, people: 1 },
    { weekStart: '2026-09-14', visits: 4, people: 3 },
    { weekStart: '2026-09-28', visits: 1, people: 1 },
    { weekStart: '2026-10-05', visits: 6, people: 3 },
  ],
  hours: [
    { weekday: 1, hour: 18, visits: 5 },
    { weekday: 3, hour: 7, visits: 1 },
    { weekday: 7, hour: 20, visits: 1 },
  ],
  hoursNoTime: 1,
  member: { members: 3, visits: 6, visitors: 2 },
  classes: {
    ever: true,
    types: [
      { name: 'Spin', classes: 2, limitedClasses: 2, places: 12, booked: 5, bookings: 6, attended: 3, noShows: 2 },
      { name: 'Open gym', classes: 1, limitedClasses: 0, places: 0, booked: 0, bookings: 2, attended: 1, noShows: 0 },
    ],
  },
  ...over,
});
const NOTHING = facts({ firstVisitOn: null, days: [], weeks: [], hours: [], hoursNoTime: 0, classes: { ever: false, types: [] } });

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
  svc.members.mockResolvedValue(MEMBERS);
  svc.attendance.mockResolvedValue(attendanceReportFrom(facts()));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('the attendance figures', () => {
  it('shows each figure with its number, the weeks and the classes, for the gym the page is on', async () => {
    open();
    await screen.findByTestId('tile-week');
    expect(svc.attendance).toHaveBeenCalledTimes(1);
    expect(svc.attendance).toHaveBeenCalledWith('g1');
    expect(['week', 'per-member', 'busiest', 'fill', 'no-shows'].map((k) => tile(k).textContent)).toEqual([
      'Visits this week6Mon 5 Oct to today · 3 people · last week: 1',
      'Visits a member a week0.52 of 3 members came · 7 Sep to 4 Oct 2026',
      'Busiest timeMon 18:005 visits in 5 weeks',
      'How full classes are41.7%5 of 12 places booked · 2 classes',
      'No-shows33.3%2 of 6 places marked · 2 not marked yet',
    ]);
    expect(
      screen.getByText(
        'These figures count every check-in on your Attendance page: at the front desk, by staff, and visits staff added later. The first was on 31 Aug 2026.',
      ),
    ).toBeTruthy();
    // Newest first; a week nobody came is a zero.
    expect(tableRows('Visits, week by week')).toEqual([
      ['Week starting', 'Visits', 'People'],
      ['5 Oct (so far)', '6', '3'],
      ['28 Sep 2026', '1', '1'],
      ['21 Sep 2026', '0', '0'],
      ['14 Sep 2026', '4', '3'],
      ['7 Sep 2026', '0', '0'],
      ['31 Aug 2026', '1', '1'],
    ]);
    expect(tableRows('Classes in the last 8 weeks')).toEqual([
      ['Class', 'Classes', 'Booked', 'Full', 'No-shows'],
      ['Spin', '2', '5 of 12', '41.7%', '2 · 40%'],
      ['Open gym', '1', '2 · no limit', '–', '0 · 0%'],
    ]);
  });

  it('each figure says how it is worked out when its button is pressed, and not before', async () => {
    open();
    await screen.findByTestId('tile-week');
    const hows = {
      'Visits a member a week':
        'The 6 visits that the 3 members on your list today made in the last 4 full weeks (7 Sep to 4 Oct 2026), shared between them and the 4 weeks. A visit by someone you have removed is not counted.',
      'Busiest time':
        'Check-ins in the last 5 full weeks (31 Aug to 4 Oct 2026), counted by weekday and hour on your clock. 1 visit staff added on a later day has no time and is left out.',
      'No-shows':
        'Places marked No-show, out of the places marked Came or No-show, in classes that started since 16 Aug 2026 (the last 8 weeks). A place nobody marked is left out.',
    };
    for (const [label, text] of Object.entries(hows)) {
      expect(screen.queryByText(text)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: `How ${label} is worked out` }));
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it('the pictures say the number under the pointer: a day, and an hour of a weekday', async () => {
    open();
    await screen.findByTestId('day-bars');
    const bars = screen.getAllByTestId('day-bar');
    expect(bars).toHaveLength(28);
    // One line of words over the chart; a card for the day under the pointer and no other time.
    expect(screen.getByTestId('day-bars-summary').textContent).toBe('About 0.3 a day · busiest: Thu 8 Oct, 4 visits');
    expect(screen.queryByTestId('day-bars-card')).toBeNull();
    expect(screen.getByTestId('day-bars').querySelector('[data-part="today"]')).not.toBeNull();
    fireEvent.mouseEnter(bars[27]);
    expect(screen.getByTestId('day-bars-said').textContent).toBe('Today, Sat 10 Oct: 1 visit so far');
    expect(screen.getByTestId('day-bars-card').textContent).toBe('Today, Sat 10 Oct1 visit so far');
    fireEvent.focus(bars[25]);
    expect(screen.getByTestId('day-bars-said').textContent).toBe('Thu 8 Oct: 4 visits');
    expect(screen.getByTestId('day-bars-card').textContent).toBe('Thu 8 Oct4 visits');
    fireEvent.blur(bars[25]);
    expect(screen.queryByTestId('day-bars-card')).toBeNull();
    // Four weekends shaded, and the numbers down the side from the top of the chart to zero.
    expect(screen.getByTestId('day-bars').querySelectorAll('[data-part="weekend"]')).toHaveLength(8);
    expect(screen.getByTestId('day-bars').textContent).toContain('420');

    // Seven weekdays, and the hours from the earliest to the latest anybody came: 07 to 20.
    const cells = screen.getAllByTestId('hour-cell');
    expect(cells).toHaveLength(7 * 14);
    expect(cells.filter((c) => c.dataset.visits !== '0').map((c) => c.getAttribute('aria-label'))).toEqual([
      'Monday 18:00 to 19:00: 5 visits',
      'Wednesday 07:00 to 08:00: 1 visit',
      'Sunday 20:00 to 21:00: 1 visit',
    ]);
    // The number sits on its square, the busiest is ringed, and the key says what the shades mean.
    const monday6 = screen.getByRole('button', { name: 'Monday 18:00 to 19:00: 5 visits' });
    expect(monday6.textContent).toBe('5');
    expect([monday6.dataset.level, monday6.dataset.best]).toEqual(['5', 'yes']);
    expect(cells.filter((c) => c.dataset.best === 'yes')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Wednesday 07:00 to 08:00: 1 visit' }).dataset.level).toBe('1');
    expect(screen.getByTestId('hour-grid').textContent).toContain('QuietBusyNobodyThe busiest');
    expect(screen.getByTestId('hour-grid-said').textContent).toBe('Check-ins by weekday and hour, 31 Aug to 4 Oct 2026');
    fireEvent.click(cells[0]);
    expect(screen.getByTestId('hour-grid-said').textContent).toBe('Monday 07:00 to 08:00: 0 visits');
  });

  it("a gym on the 12-hour clock reads its hours that way", async () => {
    open({ ...ORG, clockFormat: '12h' });
    await screen.findByTestId('tile-busiest');
    expect(tile('busiest').textContent).toBe('Busiest timeMon 6 PM5 visits in 5 weeks');
    expect(screen.getByRole('button', { name: 'Monday 6 PM to 7 PM: 5 visits' })).toBeTruthy();
  });

  it('Download CSV saves each table under a dated name', async () => {
    const texts = [];
    URL.createObjectURL = vi.fn((blob) => {
      texts.push(blob);
      return 'blob:report';
    });
    URL.revokeObjectURL = vi.fn();
    const names = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      names.push(this.download);
    });
    open();
    await screen.findByTestId('tile-week');
    for (const label of ['Visits day by day', 'Visits week by week', 'Busiest hours', 'Class by class']) {
      fireEvent.click(within(screen.getByRole('region', { name: label })).getByRole('button', { name: 'Download CSV' }));
    }
    expect(names).toEqual(['visits-by-day-2026-10-10.csv', 'visits-by-week-2026-10-10.csv', 'busiest-hours-2026-10-10.csv', 'classes-report-2026-10-10.csv']);
    expect(texts).toHaveLength(4);
  });
});

describe('what a gym has not done yet is never a zero', () => {
  it('too few weeks of check-ins reads "Not enough data yet", with how many there are, and no grid of hours', async () => {
    svc.attendance.mockResolvedValue(attendanceReportFrom(facts({ firstVisitOn: '2026-09-28', hours: [{ weekday: 1, hour: 18, visits: 9 }] })));
    open();
    await screen.findByTestId('tile-week');
    // Each box in its own words.
    expect(tile('per-member').textContent).toBe(
      'Visits a member a weekNot enough data yet. Visits a member are shared over 2 full weeks of check-ins or more, Monday to Sunday; you have 1 so far.',
    );
    expect(tile('busiest').textContent).toBe(
      'Busiest timeNot enough data yet. The busiest time is picked once every weekday has been counted twice: 2 full weeks of check-ins; you have 1 so far.',
    );
    expect(screen.queryByTestId('hour-grid')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Busiest hours' })).toBeNull();
  });

  it('hours that tie are all named, and past three no one hour is', async () => {
    svc.attendance.mockResolvedValue(
      attendanceReportFrom(
        facts({
          hours: [
            { weekday: 1, hour: 18, visits: 5 },
            { weekday: 3, hour: 18, visits: 5 },
          ],
          hoursNoTime: 0,
        }),
      ),
    );
    open();
    await screen.findByTestId('tile-busiest');
    expect(tile('busiest').textContent).toBe('Busiest timeMon 18:00 and Wed 18:005 visits each in 5 weeks');
    cleanup();
    resetConsoleOrgs();
    svc.attendance.mockResolvedValue(attendanceReportFrom(facts({ hours: [1, 2, 3, 4].map((weekday) => ({ weekday, hour: 9, visits: 2 })) })));
    open();
    await screen.findByTestId('tile-busiest');
    expect(tile('busiest').textContent).toBe('Busiest timeNo one hour stands out: 4 hours had 2 visits each.');
  });

  it('classes booked and never marked read a sentence and a button to the calendar, never 0%', async () => {
    svc.attendance.mockResolvedValue(
      attendanceReportFrom(facts({ classes: { ever: true, types: [{ name: 'Spin', classes: 2, limitedClasses: 2, places: 20, booked: 8, bookings: 8, attended: 0, noShows: 0 }] } })),
    );
    open();
    await screen.findByTestId('tile-no-shows');
    expect(tile('no-shows').textContent).toBe(
      'No-showsNo place has been marked Came or No-show yet (8 booked). The app marks a class when people check in at the gym around it; staff can also mark each person on the Calendar.Open the calendar',
    );
    expect(within(tile('no-shows')).getByRole('link', { name: 'Open the calendar' }).getAttribute('href')).toBe('/console/iron-house/classes?view=week');
    expect(tableRows('Classes in the last 8 weeks')[1]).toEqual(['Spin', '2', '8 of 20', '40%', '–']);
  });

  it('classes with no limit on places have no share, and say why', async () => {
    svc.attendance.mockResolvedValue(
      attendanceReportFrom(facts({ classes: { ever: true, types: [{ name: 'Open gym', classes: 3, limitedClasses: 0, places: 0, booked: 0, bookings: 0, attended: 0, noShows: 0 }] } })),
    );
    open();
    await screen.findByTestId('tile-fill');
    expect(tile('fill').textContent).toBe('How full classes areNone of your classes has a limit on places, so there is no share to give.');
    expect(tile('no-shows').textContent).toBe('No-showsNobody has booked a class in the last 8 weeks.');
  });
});

describe('what is not set up yet', () => {
  it('a gym with no check-in and no classes gets a button to each place, and no figure', async () => {
    svc.attendance.mockResolvedValue(attendanceReportFrom(NOTHING));
    open();
    await screen.findByText('Nobody has checked in yet. These figures start when your members check in at your front desk, or staff check them in.');
    for (const key of ['week', 'per-member', 'busiest', 'fill', 'no-shows']) expect(screen.queryByTestId(`tile-${key}`)).toBeNull();
    expect(screen.queryByTestId('day-bars')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Attendance' }).getAttribute('href')).toBe('/console/iron-house/attendance');
    expect(screen.getByText("You haven't set up any classes yet. These figures start when you run classes that people book.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Set up classes' }).getAttribute('href')).toBe('/console/iron-house/classes');
  });

  it('classes set up and none run in eight weeks says so, with the calendar', async () => {
    svc.attendance.mockResolvedValue(attendanceReportFrom(facts({ classes: { ever: true, types: [] } })));
    open();
    await screen.findByText('No class has started in the last 8 weeks.');
    expect(screen.getByRole('link', { name: 'Open the calendar' }).getAttribute('href')).toBe('/console/iron-house/classes?view=week');
    // The visit figures are still there.
    expect(tile('week')).toBeTruthy();
  });

  it('staff who cannot open Attendance or the timetable are told who can, with no button', async () => {
    svc.attendance.mockResolvedValue(attendanceReportFrom(NOTHING));
    open({ ...ORG, staffRole: 'trainer', privileges: ['members.read', 'reports.read'] });
    await screen.findByText('Staff who can open Attendance can check members in.');
    expect(screen.queryByRole('link', { name: 'Open Attendance' })).toBeNull();
    expect(screen.getByText('Staff who run the timetable can set them up.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Set up classes' })).toBeNull();
  });

  it("a studio reads its own word for its people", async () => {
    svc.attendance.mockResolvedValue(attendanceReportFrom(NOTHING));
    open({ ...ORG, orgType: 'studio' });
    await screen.findByText('Nobody has checked in yet. These figures start when your clients check in at your front desk, or staff check them in.');
  });
});

describe('when it cannot be read', () => {
  it('a failure says so with Try again, which reads it again; the members figures stay, and nothing is drawn as an empty report', async () => {
    svc.attendance.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    open();
    await screen.findByText("We couldn't load your attendance figures.");
    expect(screen.getByTestId('tile-active')).toBeTruthy();
    expect(screen.queryByText(/Nobody has checked in yet/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await screen.findByTestId('tile-week');
    await waitFor(() => expect(svc.attendance).toHaveBeenCalledTimes(2));
    expect(svc.members).toHaveBeenCalledTimes(1);
  });

  it('somebody without the tick is asked for neither report', async () => {
    open({ ...ORG, staffRole: 'trainer', privileges: ['members.read'] });
    await screen.findByText("Your role doesn't allow you to see reports. Ask the owner if you need to.");
    expect(svc.attendance).not.toHaveBeenCalled();
    expect(svc.members).not.toHaveBeenCalled();
  });
});
