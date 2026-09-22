// THE WEEK TAB, AT THE SCREEN. ROADMAP 17b-ii-b-i; Part 3 §13.3, §13.6.
//
// Only the network is mocked. The mutation cases assert what goes on the wire
// and what the screen draws from the server's answer — never only that a
// button was pressed.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const api = {
  getMine: vi.fn(),
  getClasses: vi.fn(),
  getStaff: vi.fn(),
  getClassWeek: vi.fn(),
  changeClassDay: vi.fn(),
  cancelClassDay: vi.fn(),
  restoreClassDay: vi.fn(),
};
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: api, errorText: (_err, fallback) => fallback };
});
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Kd' }, logout: vi.fn(), loading: false }),
}));

const Classes = (await import('./Classes')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'schedule.manage', 'org.manage', 'staff.manage'],
  timezone: 'Europe/London',
  clockFormat: '24h',
  orgType: 'gym',
  subscription: { status: 'trialing' },
};

const day = (over) => ({
  id: 'x1',
  classTypeId: 't1',
  scheduleId: 's1',
  name: 'Spin',
  colour: 'teal',
  openGym: false,
  localDate: '2026-09-22',
  startMinute: 1080,
  startsAt: '2026-09-22T17:00:00.000Z',
  minutes: 45,
  places: 12,
  coachUserId: 'u8',
  coachName: 'Dana Okafor',
  status: 'scheduled',
  changedAlone: false,
  started: false,
  ...over,
});

const SPIN_TUE = day({});
const YOGA_WED = day({
  id: 'x2',
  classTypeId: 't2',
  scheduleId: 's2',
  name: 'Yoga',
  colour: 'blue',
  localDate: '2026-09-23',
  startMinute: 420,
  minutes: 60,
  places: null,
  coachUserId: null,
  coachName: null,
  status: 'cancelled',
});
const SPIN_FRI = day({ id: 'x3', localDate: '2026-09-25', startMinute: 1170, minutes: 90, places: 8, changedAlone: true });
const SPIN_MON = day({ id: 'x0', localDate: '2026-09-21', started: true });

const week = (over = {}) => ({
  data: {
    timezone: 'Europe/London',
    clockFormat: '24h',
    today: '2026-09-22',
    weekStart: '2026-09-21',
    lastWeekStart: '2026-11-09',
    sessions: [SPIN_MON, SPIN_TUE, YOGA_WED, SPIN_FRI],
    ...over,
  },
});

const timetable = () => ({
  data: {
    timezone: 'Europe/London',
    clockFormat: '24h',
    horizonDays: 56,
    entries: [],
    archived: [],
    archivedTotal: 0,
  },
});

beforeEach(() => {
  resetConsoleOrgs();
  api.getMine.mockReset().mockResolvedValue({ data: { orgs: [ORG], formerOrgs: [] } });
  api.getClasses.mockReset().mockResolvedValue(timetable());
  api.getStaff.mockReset().mockResolvedValue({
    data: { staff: [{ userId: 'u8', displayName: 'Dana Okafor', email: 'd@example.com', role: 'trainer' }] },
  });
  api.getClassWeek.mockReset().mockResolvedValue(week());
  api.changeClassDay.mockReset().mockResolvedValue(week());
  api.cancelClassDay.mockReset().mockResolvedValue(week());
  api.restoreClassDay.mockReset().mockResolvedValue(week());
});
afterEach(() => {
  cleanup();
  resetConsoleOrgs();
});

let lastSearch = '';
function Where() {
  lastSearch = useLocation().search;
  return null;
}

const draw = (path = '/console/iron-house/classes?view=week') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/console/:orgSlug/classes"
          element={
            <>
              <Classes />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const openDay = async (label) => {
  fireEvent.click(await screen.findByRole('button', { name: label }));
};

describe('the Week tab', () => {
  it('opens from the Classes list, reads the gym s current week, and keeps the tab in the address', async () => {
    draw('/console/iron-house/classes');
    fireEvent.click(await screen.findByRole('tab', { name: 'Week' }));
    await screen.findByText('21 – 27 Sep 2026');
    expect(api.getClassWeek).toHaveBeenCalledWith('g1', null);
    expect(lastSearch).toBe('?view=week');
  });

  it('draws each day with its classes, in the gym s own words', async () => {
    draw();
    await screen.findByText('21 – 27 Sep 2026');
    expect(screen.getByText('Tue 22 Sep · Today')).toBeTruthy();
    expect(screen.getByText('Sun 27 Sep')).toBeTruthy();
    const tuesday = screen.getByRole('button', { name: 'Spin on Tue 22 Sep 2026 at 18:00' });
    expect(within(tuesday).getByText('18:00 · 45 min')).toBeTruthy();
    expect(within(tuesday).getByText('12 places · Dana Okafor')).toBeTruthy();
    const wednesday = screen.getByRole('button', { name: 'Yoga on Wed 23 Sep 2026 at 07:00, cancelled' });
    expect(within(wednesday).getByText('Cancelled')).toBeTruthy();
    expect(within(wednesday).getByText('No limit')).toBeTruthy();
    const friday = screen.getByRole('button', {
      name: 'Spin on Fri 25 Sep 2026 at 19:30, changed for this day',
    });
    expect(within(friday).getByText('Changed for this day')).toBeTruthy();
  });

  it('steps between weeks, and never past the last week the server says is written', async () => {
    draw();
    await screen.findByText('21 – 27 Sep 2026');
    expect(screen.queryByRole('button', { name: 'This week' })).toBeNull();

    api.getClassWeek.mockResolvedValueOnce(
      week({ weekStart: '2026-09-14', sessions: [] }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Week before' }));
    await screen.findByText('14 – 20 Sep 2026');
    expect(api.getClassWeek).toHaveBeenLastCalledWith('g1', '2026-09-14');
    expect(screen.getByText('No classes this week.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'This week' })).toBeTruthy();

    api.getClassWeek.mockResolvedValueOnce(week({ weekStart: '2026-11-09', sessions: [] }));
    fireEvent.click(screen.getByRole('button', { name: 'Week after' }));
    await screen.findByText('9 – 15 Nov 2026');
    expect(screen.getByRole('button', { name: 'Week after' }).disabled).toBe(true);
  });

  it('filters by class and by coach, including classes with nobody named', async () => {
    draw();
    await screen.findByText('21 – 27 Sep 2026');
    fireEvent.change(screen.getByRole('combobox', { name: 'Show which class' }), {
      target: { value: 't2' },
    });
    expect(screen.queryByRole('button', { name: /^Spin on/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Yoga on/ })).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Show which class' }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Show which coach' }), {
      target: { value: 'none' },
    });
    expect(screen.queryByRole('button', { name: /^Spin on/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Yoga on/ })).toBeTruthy();
  });
});

describe('this day only', () => {
  it('cancelling asks first, sends the date, and then offers to put it back', async () => {
    api.cancelClassDay.mockResolvedValue(
      week({ sessions: [SPIN_MON, { ...SPIN_TUE, status: 'cancelled' }, YOGA_WED, SPIN_FRI] }),
    );
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this day' }));
    expect(api.cancelClassDay).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Cancel Spin on Tue 22 Sep 2026 at 18:00? It stays on the week crossed out, and you can put it back on.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this day' }));
    await waitFor(() => expect(api.cancelClassDay).toHaveBeenCalledWith('g1', 'x1'));
    expect(await screen.findByRole('button', { name: 'Put it back on' })).toBeTruthy();
  });

  it('putting a cancelled day back is one tap', async () => {
    draw();
    await openDay('Yoga on Wed 23 Sep 2026 at 07:00, cancelled');
    fireEvent.click(screen.getByRole('button', { name: 'Put it back on' }));
    await waitFor(() => expect(api.restoreClassDay).toHaveBeenCalledWith('g1', 'x2'));
    expect(screen.queryByRole('button', { name: 'Change this day' })).toBeNull();
  });

  it('changing a day starts from that day s own numbers and sends all four', async () => {
    draw();
    await openDay('Spin on Fri 25 Sep 2026 at 19:30, changed for this day');
    fireEvent.click(screen.getByRole('button', { name: 'Change this day' }));
    expect(screen.getByLabelText('How long (minutes)').value).toBe('90');
    expect(screen.getByLabelText('How many people fit').value).toBe('8');
    expect(screen.getByLabelText('Coach (optional)').value).toBe('u8');

    fireEvent.change(screen.getByLabelText('How many people fit'), { target: { value: '15' } });
    fireEvent.click(screen.getByLabelText('No limit'));
    fireEvent.change(screen.getByLabelText('Coach (optional)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save this day' }));
    await waitFor(() => expect(api.changeClassDay).toHaveBeenCalled());
    expect(api.changeClassDay).toHaveBeenCalledWith('g1', 'x3', {
      startMinute: 1170,
      minutes: 90,
      places: null,
      coachUserId: null,
    });
  });

  it('a class that has already started offers nothing to press', async () => {
    draw();
    await openDay('Spin on Mon 21 Sep 2026 at 18:00');
    expect(screen.getByText("This class has already started, so it can't be changed.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Change this day' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel this day' })).toBeNull();
  });

  it('a gym with no live plan sees its week and nothing to press', async () => {
    api.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, consoleReadOnly: true }], formerOrgs: [] },
    });
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    expect(screen.queryByRole('button', { name: 'Change this day' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel this day' })).toBeNull();
  });

  it('a refusal is said, and the day stays open as it was', async () => {
    api.cancelClassDay.mockRejectedValue(new Error('409'));
    draw();
    await openDay('Spin on Tue 22 Sep 2026 at 18:00');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this day' }));
    expect(await screen.findByText("We couldn't save that.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Put it back on' })).toBeNull();
  });

  it('going back to the Classes list reads the timetable again', async () => {
    draw();
    await screen.findByText('21 – 27 Sep 2026');
    const before = api.getClasses.mock.calls.length;
    fireEvent.click(screen.getByRole('tab', { name: 'Classes' }));
    await waitFor(() => expect(api.getClasses.mock.calls.length).toBe(before + 1));
    expect(lastSearch).toBe('');
  });
});
