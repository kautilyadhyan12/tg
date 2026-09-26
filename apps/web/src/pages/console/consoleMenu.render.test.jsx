// THE WORST THING THE NEW MENU COULD DO (R1): somebody loses a page they use today —
// a trainer who cannot find Attendance on a phone, or nobody finding Sign out.
//
// The pages each person may open are written out HERE, from the menu as it was before
// R1 (ConsoleLayout at fa8e38a): Overview and Members always, Leads with
// `members.confirm`, Attendance with `attendance.read`, Classes with `schedule.manage`,
// Settings with `staff.manage` or `org.manage`. Every mix of those five is drawn, and the
// computer menu and the phone's tabs plus More must each hold exactly those pages.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROLE_PRIVILEGES } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getMine: vi.fn() } };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', displayName: 'Jordan Hayes', email: 'jordan@example.com' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const More = (await import('./More')).default;
const Overview = (await import('./Overview')).default;

const GATES = ['members.confirm', 'attendance.read', 'schedule.manage', 'staff.manage', 'org.manage'];
const BASE = '/console/iron-house';

/** What the menu offered this person before R1. */
function openableToday(privileges) {
  const has = (p) => privileges.includes(p);
  return [
    BASE,
    `${BASE}/members`,
    ...(has('members.confirm') ? [`${BASE}/leads`] : []),
    ...(has('attendance.read') ? [`${BASE}/attendance`] : []),
    ...(has('schedule.manage') ? [`${BASE}/classes`] : []),
    ...(has('staff.manage') || has('org.manage') ? [`${BASE}/settings`] : []),
  ].sort();
}

const gym = (staffRole, privileges) => ({
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType: 'gym',
  timezone: 'America/Chicago',
  country: 'US',
  status: 'active',
  staffRole,
  isMember: false,
  privileges,
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z', seatCap: 200 },
});

/** The More page, inside the shell, as a phone opens it. Waits for the gym's name in the
 *  menu, which is drawn only once the person's permissions have arrived. */
async function openMore(staffRole, privileges) {
  orgService.getMine.mockResolvedValue({ data: { orgs: [gym(staffRole, privileges)] } });
  render(
    <MemoryRouter initialEntries={[`${BASE}/more`]}>
      <Routes>
        <Route path="/console/:orgSlug/more" element={<ConsoleLayout><More /></ConsoleLayout>} />
      </Routes>
    </MemoryRouter>,
  );
  await within(screen.getByTestId('console-rail')).findByText('Iron House');
}

const hrefs = (el) => [...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));

function menus() {
  const rail = hrefs(within(screen.getByTestId('console-rail')).getByRole('navigation', { name: 'Console' }));
  const tabs = hrefs(screen.getByTestId('console-tabbar')).filter((h) => h !== `${BASE}/more`);
  const more = hrefs(screen.getByTestId('console-more')).filter((h) => h !== '/console');
  return { rail, tabs, more };
}

/** Every one of the 32 mixes of the five permissions that decide a page. */
const EVERY_MIX = Array.from({ length: 2 ** GATES.length }, (_, bits) =>
  ['members.read', ...GATES.filter((_, i) => bits & (1 << i))],
);

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
});
afterEach(() => cleanup());

describe('nobody loses a page they can open today', () => {
  it.each([
    ['owner', ROLE_PRIVILEGES.owner],
    ['manager', ROLE_PRIVILEGES.manager],
    ['trainer', ROLE_PRIVILEGES.trainer],
  ])('a %s with the usual permissions', async (role, privileges) => {
    await openMore(role, [...privileges]);
    const { rail, tabs, more } = menus();
    expect([...rail].sort()).toEqual(openableToday(privileges));
    expect([...tabs, ...more].sort()).toEqual(openableToday(privileges));
  });

  it.each(EVERY_MIX.map((p) => [p.slice(1).join(' + ') || 'none of them', p]))(
    'permissions: %s',
    async (_label, privileges) => {
      await openMore('manager', privileges);
      const { rail, tabs, more } = menus();
      expect([...rail].sort()).toEqual(openableToday(privileges));
      // Each page once on a phone: in the tabs or in More, never both, never neither.
      expect([...tabs, ...more].sort()).toEqual(openableToday(privileges));
    },
  );

  it('a trainer on a phone has Attendance as a tab', async () => {
    await openMore('trainer', [...ROLE_PRIVILEGES.trainer]);
    const tabbar = screen.getByTestId('console-tabbar');
    expect(within(tabbar).getByRole('link', { name: 'Attendance' }).getAttribute('href')).toBe(`${BASE}/attendance`);
  });
});

describe('the gym box at the top of the menu', () => {
  // Another gym's address, or a made-up one: there is no gym to name, and the box still
  // says whose console this is, as it did before R1.
  it('says "Gym console" when the address is not one of the person’s gyms', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [gym('owner', [...ROLE_PRIVILEGES.owner])] } });
    render(
      <MemoryRouter initialEntries={['/console/somebody-elses-gym']}>
        <Routes>
          <Route path="/console/:orgSlug" element={<ConsoleLayout><Overview /></ConsoleLayout>} />
        </Routes>
      </MemoryRouter>,
    );
    // The page's own answer comes only once the person's gyms have been read.
    expect(await screen.findByText(/couldn't find an organisation you run/i)).toBeTruthy();
    const box = within(screen.getByTestId('console-rail')).getByRole('link', { name: /Switch to another organisation/ });
    expect(within(box).getByText('Gym console')).toBeTruthy();
    expect(within(screen.getByTestId('console-topbar')).getByText('Gym console')).toBeTruthy();
    expect(screen.queryByText('Iron House')).toBeNull();
  });
});

describe('the banner above every page', () => {
  it('takes its colours from the look, by name', async () => {
    // The gym is on a free trial, so the trial's "info" banner is up.
    await openMore('owner', [...ROLE_PRIVILEGES.owner]);
    expect(screen.getByRole('status').className).toContain('c-banner-info');
  });
});

describe('the way out is always there', () => {
  it('on a computer: Sign out and Your organisations in the menu, and the gym name goes to your organisations', async () => {
    await openMore('trainer', [...ROLE_PRIVILEGES.trainer]);
    const rail = screen.getByTestId('console-rail');
    expect(within(rail).getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(within(rail).getByRole('link', { name: 'Your organisations' }).getAttribute('href')).toBe('/console');
    expect(within(rail).getByRole('link', { name: /Iron House/ }).getAttribute('href')).toBe('/console');
  });

  it('on a phone: More holds Sign out and Your organisations, and the gym name goes to your organisations', async () => {
    await openMore('trainer', [...ROLE_PRIVILEGES.trainer]);
    const more = screen.getByTestId('console-more');
    expect(within(more).getByRole('link', { name: 'Your organisations' }).getAttribute('href')).toBe('/console');
    expect(within(screen.getByTestId('console-more-you')).getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(within(screen.getByTestId('console-tabbar')).getByRole('link', { name: 'More' }).getAttribute('href')).toBe(
      `${BASE}/more`,
    );
    expect(within(screen.getByTestId('console-topbar')).getByRole('link', { name: /Iron House/ }).getAttribute('href')).toBe(
      '/console',
    );
  });
});
