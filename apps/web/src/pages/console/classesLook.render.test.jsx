// THE CLASSES PAGE IN THE NEW LOOK (ROADMAP R2; spec Part 3 §17). A restyle changes how the
// page looks, never what it does (RULINGS 2026-09-26: "do not delete the exsiting features
// and buttons etc"). The worst thing R2 could do is take a control away from a gym that
// relies on it — no way to cancel a class that must be cancelled — so these tests list
// every control the page had before R2, for an owner, a lapsed gym and a role without the
// timetable tick, on the Classes tab and the Calendar.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const api = {
  getMine: vi.fn(),
  getClasses: vi.fn(),
  getStaff: vi.fn(),
  getClassWeek: vi.fn(),
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
const LAPSED = { ...ORG, consoleReadOnly: true, subscription: null };
const NO_TICK = { ...ORG, staffRole: 'trainer', privileges: ['members.read'] };

const YOGA = {
  id: 't1',
  name: 'Sunrise Yoga',
  description: 'Bring a mat.',
  minutes: 60,
  places: 20,
  coachUserId: 'u9',
  coachName: 'Priya Sharma',
  colour: 'blue',
  openGym: false,
  archivedAt: null,
};
const OLD = { ...YOGA, id: 't9', name: 'Old Pilates', colour: 'purple' };

const slot = (over) => ({
  id: 's1',
  classTypeId: 't1',
  weekdays: [1, 3],
  startMinute: 1110,
  startsOn: '2026-09-21',
  endsOn: null,
  minutes: 45,
  places: 12,
  coachUserId: 'u8',
  coachName: 'Dana Okafor',
  nextDates: ['2099-09-21', '2099-09-23'],
  sessionsAhead: 16,
  datesComplete: false,
  finished: false,
  startedToday: false,
  ...over,
});
const MON_WED = slot({});
const SAT = slot({ id: 's2', weekdays: [6], startMinute: 540 });

const timetable = {
  data: {
    timezone: 'Europe/London',
    clockFormat: '24h',
    horizonDays: 56,
    entries: [{ type: YOGA, schedules: [MON_WED, SAT] }],
    archived: [OLD],
    archivedTotal: 1,
  },
};

const session = (over) => ({
  id: 'x1',
  classTypeId: 't1',
  scheduleId: 's1',
  name: 'Sunrise Yoga',
  colour: 'blue',
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
const TUE = session({});
const WED_CANCELLED = session({ id: 'x2', localDate: '2026-09-23', status: 'cancelled' });
const FRI_CHANGED = session({ id: 'x3', localDate: '2026-09-25', changedAlone: true });

// A week that is not this one, so "Today" is offered.
const week = {
  data: {
    timezone: 'Europe/London',
    clockFormat: '24h',
    today: '2026-09-15',
    weekStart: '2026-09-21',
    lastWeekStart: '2026-11-09',
    sessions: [TUE, WED_CANCELLED, FRI_CHANGED],
  },
};

const useOrg = (org) => api.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });

beforeEach(() => {
  resetConsoleOrgs();
  api.getMine.mockReset();
  useOrg(ORG);
  api.getClasses.mockReset().mockResolvedValue(timetable);
  api.getStaff.mockReset().mockResolvedValue({ data: { staff: [] } });
  api.getClassWeek.mockReset().mockResolvedValue(week);
});
afterEach(() => {
  cleanup();
  resetConsoleOrgs();
});

const draw = (search = '') =>
  render(
    <MemoryRouter initialEntries={[`/console/iron-house/classes${search}`]}>
      <Routes>
        <Route path="/console/:orgSlug/classes" element={<Classes />} />
      </Routes>
    </MemoryRouter>,
  );

const button = (name) => screen.queryByRole('button', { name });

// Every control of a class and its time slots, as named before R2.
const CLASS_CONTROLS = [
  'Add class',
  'Edit Sunrise Yoga',
  'Bulk edit the time slots of Sunrise Yoga',
  'Archive Sunrise Yoga',
  'Add time slot',
  'Edit the Mon & Wed 18:30 time slot of Sunrise Yoga',
  'Cancel the Mon & Wed 18:30 time slot of Sunrise Yoga',
  'Edit the Sat 09:00 time slot of Sunrise Yoga',
  'Cancel the Sat 09:00 time slot of Sunrise Yoga',
];

describe('the Classes tab keeps every control', () => {
  it('an owner has every button, the two tabs and Restore under Archived classes', async () => {
    draw();
    await screen.findByRole('heading', { name: 'Sunrise Yoga' });
    for (const name of CLASS_CONTROLS) expect(button(name), name).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Classes' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Calendar' })).toBeTruthy();
    expect(screen.getByText('Bring a mat.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Archived classes/ }));
    expect(button('Restore Old Pilates')).not.toBeNull();
  });

  it('a lapsed gym reads everything and is offered none of them', async () => {
    useOrg(LAPSED);
    draw();
    await screen.findByRole('heading', { name: 'Sunrise Yoga' });
    expect(screen.getByText(/needs a plan before anything here can be changed/)).toBeTruthy();
    for (const name of CLASS_CONTROLS) expect(button(name), name).toBeNull();
    expect(screen.getByText('Mon & Wed ·', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Archived classes/ }));
    expect(screen.getByText('Old Pilates')).toBeTruthy();
    expect(button('Restore Old Pilates')).toBeNull();
  });

  it('a role without the timetable tick is told so, with no tabs and no buttons', async () => {
    useOrg(NO_TICK);
    draw();
    await screen.findByText(/role doesn't allow you to set the timetable/);
    for (const name of CLASS_CONTROLS) expect(button(name), name).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('the Calendar tab keeps every control', () => {
  it('an owner can step weeks, filter, go back to today, and open, edit, cancel and un-cancel a class', async () => {
    draw('?view=week');
    await screen.findByText('Changed');
    for (const name of ['Week before', 'Week after', 'Today']) expect(button(name), name).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Show which class' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Show which coach' })).toBeTruthy();
    // Changed and Cancelled are words on the class, never colour alone.
    expect(screen.getByText('Cancelled')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Sunrise Yoga on Tue 22 Sep/ }));
    expect(button('Edit')).not.toBeNull();
    expect(button('Cancel class')).not.toBeNull();
    expect(button('Close this class')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Sunrise Yoga on Wed 23 Sep.*cancelled$/ }));
    expect(button('Un-cancel')).not.toBeNull();
  });

  it('a lapsed gym sees its week and can open a class, with nothing to press on it', async () => {
    useOrg(LAPSED);
    draw('?view=week');
    await screen.findByText('Changed');
    fireEvent.click(screen.getByRole('button', { name: /^Sunrise Yoga on Tue 22 Sep/ }));
    expect(button('Close this class')).not.toBeNull();
    for (const name of ['Edit', 'Cancel class', 'Un-cancel']) expect(button(name), name).toBeNull();
  });
});

describe('the new look', () => {
  it('puts Add class at the top of the page, before the first class', async () => {
    draw();
    const heading = await screen.findByRole('heading', { name: 'Sunrise Yoga' });
    const add = screen.getByRole('button', { name: 'Add class' });
    // DOCUMENT_POSITION_FOLLOWING: the class comes after the button.
    expect(add.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Classes' }).className).toContain('c-h1');
  });

  it('draws a class s colour by its name in the look, so it holds in dark and light', async () => {
    draw();
    await screen.findByRole('heading', { name: 'Sunrise Yoga' });
    expect(screen.getByTestId('class-colour').style.background).toBe('var(--cl-blue)');
  });
});
