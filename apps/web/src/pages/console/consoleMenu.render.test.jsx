// THE WORST THING THE NEW MENU COULD DO (R1): somebody loses a page they use today —
// a trainer who cannot find Attendance on a phone, or nobody finding Sign out.
//
// The pages each person may open are written out HERE, from the menu as it was before
// R1 (ConsoleLayout at fa8e38a): Overview and Members always, Leads with
// `members.confirm`, Attendance with `attendance.read`, Classes with `schedule.manage`,
// Settings with `staff.manage` or `org.manage`, and Updates with `posts.manage` (19b-i).
// `staff.manage` brought Settings until 23c-ii, while staff were a box there; they are on
// Members → Staff now, a tab of a page everybody has, so that tick brings no page of its own.
// `memberships.manage` brought Settings from 17a-i to 23c-i, while the price list was a box
// there; it now brings Memberships, a page of its own, and Settings holds nothing for it. Every mix of them is drawn, and the computer menu and
// the phone's tabs plus More must each hold exactly those pages.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
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

const GATES = ['members.confirm', 'attendance.read', 'schedule.manage', 'staff.manage', 'org.manage', 'leaderboard.manage', 'memberships.manage', 'posts.manage', 'reports.read'];
const BASE = '/console/iron-house';

/** What the menu offered this person before R1, and Settings for whoever sets the timetable. */
function openableToday(privileges) {
  const has = (p) => privileges.includes(p);
  return [
    BASE,
    `${BASE}/members`,
    // Memberships (23c-i): its own page, for whoever may change the price list.
    ...(has('memberships.manage') ? [`${BASE}/memberships`] : []),
    // Sell (18b-i): its own page, for whoever may record a sale or change products.
    ...(has('billing.members') || has('memberships.manage') ? [`${BASE}/sell`] : []),
    // Failed payments (18d-iii-ii-b): its own page, for whoever reads people and records payments.
    ...(has('members.read') && has('billing.members') ? [`${BASE}/failed-payments`] : []),
    ...(has('members.confirm') ? [`${BASE}/leads`] : []),
    ...(has('attendance.read') ? [`${BASE}/attendance`] : []),
    // At risk (20d-i): its own page, for whoever may see the gym's people.
    ...(has('members.read') ? [`${BASE}/at-risk`] : []),
    ...(has('schedule.manage') ? [`${BASE}/classes`] : []),
    // Personal training (17e-i) is every member of staff's: their own hours and sessions.
    `${BASE}/personal-training`,
    ...(has('posts.manage') ? [`${BASE}/updates`, `${BASE}/events`] : []),
    // Plans (24a-i): the gym's meal plans, for whoever holds the tick.
    ...(has('plans.manage') ? [`${BASE}/plans`] : []),
    ...(has('leaderboard.manage') ? [`${BASE}/leaderboard`, `${BASE}/challenges`] : []),
    // Reports (21a-i): its own page, for whoever may read the gym's figures.
    ...(has('reports.read') ? [`${BASE}/reports`] : []),
    // Settings also holds Booking rules since 17c-ii-a, on `schedule.manage`.
    ...(has('org.manage') || has('schedule.manage') ? [`${BASE}/settings`] : []),
  ].sort();
}

const gym = (staffRole, privileges) => ({
  id: '11111111-1111-4111-8111-111111111111',
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

/** Presses your name at the foot of the computer's menu, and gives back the box it opens. */
function openYou() {
  fireEvent.click(within(screen.getByTestId('console-rail')).getByRole('button', { name: /Jordan Hayes/ }));
  return screen.getByRole('dialog', { name: 'Jordan Hayes' });
}

function menus() {
  const rail = hrefs(within(screen.getByTestId('console-rail')).getByRole('navigation', { name: 'Console' }));
  const tabs = hrefs(screen.getByTestId('console-tabbar')).filter((h) => h !== `${BASE}/more`);
  // Your organisations and Your account are the person's own, not the gym's pages (checked below).
  const more = hrefs(screen.getByTestId('console-more')).filter((h) => h !== '/console' && h !== `${BASE}/account`);
  return { rail, tabs, more };
}

/** Every mix of the permissions that decide a page. */
const EVERY_MIX = Array.from({ length: 2 ** GATES.length }, (_, bits) =>
  ['members.read', ...GATES.filter((_, i) => bits & (1 << i))],
);

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  window.localStorage.clear();
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

  it.each([['owner'], ['manager'], ['trainer']])('a %s reaches Your account, with Delete account, from their name in the menu and from More (19b-ii)', async (role) => {
    await openMore(role, [...ROLE_PRIVILEGES[role]]);
    expect(within(openYou()).getByRole('link', { name: 'Your account' }).getAttribute('href')).toBe(`${BASE}/account`);
    expect(within(screen.getByTestId('console-more')).getByRole('link', { name: 'Your account' }).getAttribute('href')).toBe(`${BASE}/account`);
  });

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

describe('the menu in five groups (spec Part 3 §17.10 rule 7)', () => {
  const railGroups = () =>
    within(screen.getByTestId('console-rail'))
      .getAllByRole('group')
      .map((g) => [g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')).textContent, within(g).getAllByRole('link').map((a) => a.textContent)]);
  const moreGroups = () =>
    within(screen.getByTestId('console-more'))
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);

  it('an owner: Overview, then Today, People, Money, Community and Manage, the same headings on a phone', async () => {
    await openMore('owner', [...ROLE_PRIVILEGES.owner]);
    expect(railGroups()).toEqual([
      ['Today', ['Attendance', 'Classes', 'Personal training']],
      ['People', ['Members & staff', 'Leads', 'At risk']],
      ['Money', ['Sell', 'Memberships', 'Failed payments']],
      ['Community', ['Updates', 'Events', 'Fitness plans', 'Challenges', 'Leaderboard']],
      ['Manage', ['Reports', 'Settings']],
    ]);
    expect(moreGroups()).toEqual(['Today', 'People', 'Money', 'Community', 'Manage']);
  });

  it('a trainer: only the headings that hold a page of theirs, and Manage on a phone for their organisations and account', async () => {
    await openMore('trainer', [...ROLE_PRIVILEGES.trainer]);
    expect(railGroups()).toEqual([
      ['Today', ['Attendance', 'Personal training']],
      ['People', ['Members', 'At risk']],
    ]);
    expect(moreGroups()).toEqual(['Today', 'People', 'Manage']);
    const manage = within(screen.getByTestId('console-more')).getByRole('region', { name: 'Manage' });
    expect(within(manage).getAllByRole('link').map((a) => a.textContent)).toEqual(['Your organisations', 'Your account']);
  });

  it('you are named at the foot of the menu and at the top of More, with your initials', async () => {
    await openMore('trainer', [...ROLE_PRIVILEGES.trainer]);
    const foot = screen.getByTestId('console-rail').querySelector('.c-rail-me');
    expect(foot.textContent).toBe('JHJordan HayesTrainer');
    expect(foot.tagName).toBe('BUTTON');
    expect(foot.getAttribute('aria-expanded')).toBe('false');
    expect(within(openYou()).getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(foot.getAttribute('aria-expanded')).toBe('true');
    const me = screen.getByTestId('console-more-me');
    expect(me.textContent).toBe('JHJordan HayesTrainer · Iron House');
    expect(within(screen.getByTestId('console-topbar')).getByRole('link', { name: /^Jordan Hayes: your account and Sign out/ }).getAttribute('href')).toBe(`${BASE}/more`);
  });
});

describe('the way out is always there', () => {
  it('on a computer: Sign out and Your organisations under your name in the menu, and the gym name goes to your organisations', async () => {
    await openMore('trainer', [...ROLE_PRIVILEGES.trainer]);
    const rail = screen.getByTestId('console-rail');
    expect(within(rail).getByRole('link', { name: /Iron House/ }).getAttribute('href')).toBe('/console');
    const you = openYou();
    expect(within(you).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Your account', `${BASE}/account`],
      ['Your organisations', '/console'],
    ]);
    expect(within(you).getByRole('button', { name: 'Sign out' })).toBeTruthy();
    // Escape closes it, and your name has the keys back.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Jordan Hayes' })).toBeNull();
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

// V1-c: the bar across the top, with New, and groups that fold.
describe('New, in the bar across the top (spec Part 3 §17.11)', () => {
  it("an owner: New lists what they may add, each opening that page's own box", async () => {
    await openMore('owner', [...ROLE_PRIVILEGES.owner]);
    const bar = screen.getByTestId('console-bar');
    // The business's notice (here the trial's) is at the very top, above the bar (Kd, V1-c).
    expect(screen.getByRole('status').compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const button = within(bar).getByRole('button', { name: 'New' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    const box = screen.getByRole('dialog', { name: 'New' });
    expect(within(box).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Add member', `${BASE}/members?open=add`],
      ['Add lead', `${BASE}/leads?open=add`],
      ['New sale', `${BASE}/sell`],
      ['Add class', `${BASE}/classes?open=add`],
      ['Check in', `${BASE}/attendance#check-in`],
      ['New post', `${BASE}/updates#write`],
    ]);
    // A line pressed closes the box.
    fireEvent.click(within(box).getByRole('link', { name: 'Add class' }));
    expect(screen.queryByRole('dialog', { name: 'New' })).toBeNull();
  });

  it('a trainer, who may add nothing, has no New at all', async () => {
    await openMore('trainer', [...ROLE_PRIVILEGES.trainer]);
    // The bar holds Search for everybody (V1-e-i), and no New for them.
    expect(within(screen.getByTestId('console-bar')).getByTestId('console-search')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
  });

  it('a business that needs a plan says why instead of offering anything', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...gym('owner', [...ROLE_PRIVILEGES.owner]), consoleReadOnly: true }] } });
    render(
      <MemoryRouter initialEntries={[`${BASE}/more`]}>
        <Routes>
          <Route path="/console/:orgSlug/more" element={<ConsoleLayout><More /></ConsoleLayout>} />
        </Routes>
      </MemoryRouter>,
    );
    await within(screen.getByTestId('console-rail')).findByText('Iron House');
    fireEvent.click(within(screen.getByTestId('console-bar')).getByRole('button', { name: 'New' }));
    const box = screen.getByRole('dialog', { name: 'New' });
    expect(within(box).queryAllByRole('link')).toEqual([]);
    expect(box.textContent).toContain('This gym needs a plan before anything here can be changed.');
  });
});

describe("the menu's groups fold, and stay as you left them on this device", () => {
  const heading = (name) => within(screen.getByTestId('console-rail')).getByRole('button', { name });
  const railLink = (name) => within(screen.getByTestId('console-rail')).queryByRole('link', { name });

  /** The console at `path`, inside the shell, as a computer opens it. */
  async function openAt(path, extra = {}) {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...gym('owner', [...ROLE_PRIVILEGES.owner]), ...extra }] } });
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/console/:orgSlug/*" element={<ConsoleLayout><p>The page</p></ConsoleLayout>} />
        </Routes>
      </MemoryRouter>,
    );
    await within(screen.getByTestId('console-rail')).findByText('Iron House');
  }

  it('nothing is folded until you fold it; its heading folds it and opens it again', async () => {
    await openAt(`${BASE}/more`);
    for (const name of ['Today', 'People', 'Money', 'Community', 'Manage']) expect(heading(name).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(heading('Money'));
    expect(heading('Money').getAttribute('aria-expanded')).toBe('false');
    expect(railLink('Sell')).toBeNull();
    // Only that group: the others keep their pages.
    expect(railLink('Attendance')).not.toBeNull();
    fireEvent.click(heading('Money'));
    expect(railLink('Sell')).not.toBeNull();
  });

  it('a folded group is still folded the next time the console opens on this device', async () => {
    await openAt(`${BASE}/more`);
    fireEvent.click(heading('Community'));
    cleanup();
    resetConsoleOrgs();
    await openAt(`${BASE}/more`);
    expect(heading('Community').getAttribute('aria-expanded')).toBe('false');
    expect(railLink('Updates')).toBeNull();
  });

  it('the page you are on is never folded away: its group shows open for this visit, and the device keeps your choice', async () => {
    window.localStorage.setItem('kwazo.console.folded', JSON.stringify(['money', 'today']));
    await openAt(`${BASE}/sell`);
    expect(heading('Money').getAttribute('aria-expanded')).toBe('true');
    expect(railLink('Sell').className).toContain('c-nav-on');
    expect(heading('Today').getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('kwazo.console.folded'))).toEqual(['money', 'today']);
    // Pressed, it folds again at once, and stays folded as kept.
    fireEvent.click(heading('Money'));
    expect(heading('Money').getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('kwazo.console.folded'))).toEqual(['money', 'today']);
  });

  it('a group open for the page you are on, folded by you there, is kept folded', async () => {
    await openAt(`${BASE}/sell`);
    fireEvent.click(heading('Money'));
    expect(heading('Money').getAttribute('aria-expanded')).toBe('false');
    expect(JSON.parse(window.localStorage.getItem('kwazo.console.folded'))).toEqual(['money']);
  });

  it('nothing waiting is folded out of sight: Review needed moves to the heading of its folded group', async () => {
    await openAt(`${BASE}/more`, { membersNeedReview: 2 });
    const people = within(screen.getByTestId('console-rail')).getByRole('group', { name: /^People/ });
    expect(within(people).getAllByTestId('review-dot')).toHaveLength(1);
    fireEvent.click(heading(/^People/));
    expect(railLink(/^Members & staff/)).toBeNull();
    const dots = within(screen.getByTestId('console-rail')).getAllByTestId('review-dot').filter((d) => d.closest('[hidden]') === null);
    expect(dots).toHaveLength(1);
    expect(heading(/^People/).contains(dots[0])).toBe(true);
    expect(heading(/^People/).textContent).toContain('2 members need review');
  });

  it('on Your account, your name is the lit line of the menu', async () => {
    await openAt(`${BASE}/account`);
    const me = screen.getByTestId('console-rail').querySelector('.c-rail-me');
    expect(me.getAttribute('aria-current')).toBe('page');
    expect(me.className).toContain('c-rail-me-on');
    cleanup();
    resetConsoleOrgs();
    await openAt(`${BASE}/more`);
    expect(screen.getByTestId('console-rail').querySelector('.c-rail-me').getAttribute('aria-current')).toBeNull();
  });

  it('a browser that keeps nothing (a private window) shows the whole menu and still folds', async () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      await openAt(`${BASE}/more`);
      expect(heading('Money').getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(heading('Money'));
      expect(heading('Money').getAttribute('aria-expanded')).toBe('false');
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });

  it('whatever the browser kept that is not a group is ignored', async () => {
    window.localStorage.setItem('kwazo.console.folded', '{"not":"a list"');
    await openAt(`${BASE}/more`);
    expect(heading('Money').getAttribute('aria-expanded')).toBe('true');
  });
});
