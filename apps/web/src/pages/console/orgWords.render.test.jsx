// WHAT A STUDIO AND A PERSONAL TRAINER ACTUALLY SEE — roadmap item 2b, and the
// only test in the tree that proves the vocabulary reaches a SCREEN.
//
// The helpers next door prove the words exist (`orgWords` in `@app/shared`, and
// its own suite in `packages/shared`). This file is here because the defect 2b
// fixes was never in the table — it was that sixty sentences never asked it.
// **So every assertion below is on rendered text**, and each one is a place a
// studio's owner read the word "gym" or "member" about their own clients.
//
// THE GYM IS ASSERTED BESIDE EVERY ONE OF THEM. Making one type's copy right at
// the cost of another's is the failure mode this card can produce, and a suite
// that only ever renders a studio would go green on a console that says
// "studio" to everybody.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMembers: vi.fn(),
      getCodes: vi.fn(),
      getApplications: vi.fn(),
      getOverview: vi.fn(),
      getStartHere: vi.fn(),
      getAttendanceDay: vi.fn(),
      getStaff: vi.fn(),
      // Members → Staff reads its invitations (4a-i); the console's front page, the person's own.
      getStaffInvites: vi.fn(() => Promise.resolve({ data: { invites: [] } })),
      getStaffRoles: vi.fn(() => Promise.resolve({ data: { roles: [] } })),
      getMyStaffInvitations: vi.fn(() => Promise.resolve({ data: { address: 'a@example.com', addressProved: true, invitations: [] } })),
      updateOrg: vi.fn(),
      getHours: vi.fn(() =>
        Promise.resolve({
          data: { hours: { mode: 'unset', timezone: 'UTC', week: [], closures: [] } },
        }),
      ),
      setHours: vi.fn(),
      closeDay: vi.fn(),
      removeClosure: vi.fn(),
      // Settings' follow-up emails box (20c-v) reads on mount: switched off.
      getLeadEmailSettings: vi.fn(() =>
        Promise.resolve({
          data: { settings: { sendForMe: false, replyTo: null, perMonth: 100, usedThisMonth: 0, hasPostalAddress: true, stopped: false, appSending: 'on' } },
        }),
      ),
      updateLeadEmailSettings: vi.fn(),
      /** Settings' class bookings box (17c-ii-a) reads on mount too: the starting values. */
      getBookingSettings: vi.fn(() =>
        Promise.resolve({ data: { settings: { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 1440, waitlistMax: 20 }, pt: { opensDays: 7, freeCancelMinutes: 120 } } }),
      ),
      updateBookingSettings: vi.fn(),
      /** Settings' check-in devices box (16b-i) reads on mount too: a gym with none. */
      getCheckinDevices: vi.fn(() => Promise.resolve({ data: { devices: [] } })),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const Overview = (await import('./Overview')).default;
const Members = (await import('./Members')).default;
const ConsoleSettings = (await import('./Settings')).default;

// ── Fixtures ────────────────────────────────────────────────────────────────

/** One org, three types. Everything else is identical on purpose: the only
 *  thing under test is the word, so a difference on screen can have only one
 *  cause. */
const orgOfType = (orgType) => ({
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'flow-studio',
  name: 'Flow Studio',
  city: 'Austin',
  orgType,
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  clockFormat: '24h',
  manualAttendanceEnabled: true,
  country: 'US',
  status: 'active',
  staffRole: 'owner',
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
  privileges: [
    'members.read',
    'members.confirm',
    'members.remove',
    'codes.invite',
    'codes.manage',
    'staff.manage',
    'org.manage',
    'billing.manage',
    'attendance.read',
  ],
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z', seatCap: null },
});

const LIVE_CODE = {
  code: 'K7QM2X',
  label: 'Front Desk',
  paused: false,
  expiresAt: null,
  maxUses: null,
  joined: 0,
};

const ownerSeat = {
  userId: 'u1',
  displayName: 'Kd Owner',
  joinedAt: '2026-08-18T09:00:00.000Z',
  groupLabel: 'Front Desk',
  complimentary: true,
  takesSeat: false,
};

const ownerStaff = {
  userId: 'u1',
  displayName: 'Kd Owner',
  email: 'kd@example.com',
  role: 'owner',
  since: '2026-08-18T09:00:00.000Z',
  isYou: true,
  privileges: ['staff.manage', 'billing.manage'],
};

const coachStaff = {
  userId: 'u2',
  displayName: 'Priya Sen',
  email: 'priya@example.com',
  role: 'trainer',
  since: '2026-08-19T09:00:00.000Z',
  isYou: false,
  privileges: ['members.read', 'codes.invite'],
};

const mountAs = (orgType, path, element, pattern) => {
  orgService.getMine.mockResolvedValue({ data: { orgs: [orgOfType(orgType)] } });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={<ConsoleLayout>{element}</ConsoleLayout>} />
      </Routes>
    </MemoryRouter>,
  );
};

const overviewAs = (orgType) =>
  mountAs(orgType, '/console/flow-studio', <Overview />, '/console/:orgSlug');
const membersAs = (orgType) =>
  mountAs(orgType, '/console/flow-studio/members?view=app', <Members />, '/console/:orgSlug/members');
const staffTabAs = (orgType) =>
  mountAs(orgType, '/console/flow-studio/members?view=staff', <Members />, '/console/:orgSlug/members');
const settingsAs = (orgType) =>
  mountAs(orgType, '/console/flow-studio/settings', <ConsoleSettings />, '/console/:orgSlug/settings');

/** A `ConsoleSection` is CLOSED by default and a closed one is unmounted, so a
 *  test that does not open it is searching an empty document. The heading's
 *  accessible name is title + summary, hence the `^` anchor — `settings.render`
 *  next door uses the same handle for the same reason. */
const openSection = async (title) => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}`) }));
};

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  orgService.getCodes.mockResolvedValue({ data: { codes: [LIVE_CODE] } });
  orgService.getMembers.mockResolvedValue({ data: { items: [ownerSeat], nextCursor: null } });
  orgService.getApplications.mockResolvedValue({
    data: { items: [], nextCursor: null, pendingCount: 0 },
  });
  orgService.getOverview.mockRejectedValue({
    response: { status: 403, data: { error: 'forbidden', message: 'no', requestId: 'r' } },
  });
  orgService.getAttendanceDay.mockResolvedValue({ data: { attendance: null } });
  orgService.getStaff.mockResolvedValue({ data: { staff: [ownerStaff, coachStaff] } });
});

afterEach(() => {
  cleanup();
});

describe('the console shell', () => {
  // The menu names the organisation by its own name and type ("Austin · Studio") and its
  // people in its own word; "Gym console" is left for the pages with no organisation yet.
  const rail = () => screen.getByTestId('console-rail');

  it('names the tabs and the organisation after its type', async () => {
    settingsAs('studio');
    expect(await within(rail()).findByText('Austin · Studio')).toBeTruthy();
    expect(screen.getAllByText('Clients').length).toBeGreaterThan(0);
    expect(screen.queryByText('Members')).toBeNull();
    expect(screen.queryByText(/Gym console/)).toBeNull();
  });

  it('leaves a gym’s tabs exactly as they were — the control', async () => {
    settingsAs('gym');
    expect(await within(rail()).findByText('Austin · Gym')).toBeTruthy();
    expect(screen.getAllByText('Members').length).toBeGreaterThan(0);
    expect(screen.queryByText('Clients')).toBeNull();
  });

  /** A personal trainer's console is their business: the menu says what kind of
   *  organisation it is, never the staff role "Trainer". */
  it('calls a personal trainer’s organisation what it is, and their people Clients', async () => {
    settingsAs('personal_trainer');
    expect(await within(rail()).findByText('Austin · Personal trainer')).toBeTruthy();
    expect(screen.getAllByText('Clients').length).toBeGreaterThan(0);
    expect(within(rail()).queryByText('Trainer')).toBeNull();
  });
});

describe('the Overview', () => {
  it('counts a studio’s people as clients and hands the code to clients', async () => {
    overviewAs('studio');
    // The roster link's own heading — `memberCountLine` with the owner's seat.
    expect(await screen.findByText('1 client (you)')).toBeTruthy();
    expect(
      await screen.findByText(/Give this code to your clients\. They enter it in the app to join your studio\./i),
    ).toBeTruthy();
  });

  it('says members and gym to a gym — the control', async () => {
    overviewAs('gym');
    expect(await screen.findByText('1 member (you)')).toBeTruthy();
    expect(
      await screen.findByText(/Give this code to your members\. They enter it in the app to join your gym\./i),
    ).toBeTruthy();
  });
});

describe('the roster', () => {
  it('is headed Clients for a studio, and says clients when it is empty', async () => {
    orgService.getMembers.mockResolvedValue({ data: { items: [], nextCursor: null } });
    membersAs('studio');
    // The owner's page holds the staff too, and its title says so (23c-ii).
    expect(await screen.findByRole('heading', { name: 'Clients & staff' })).toBeTruthy();
    expect(await screen.findByText(/Invite clients from Your list\. They appear here once they join\./i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Members/ })).toBeNull();
  });

  it('is headed Members for a gym — the control', async () => {
    orgService.getMembers.mockResolvedValue({ data: { items: [], nextCursor: null } });
    membersAs('gym');
    expect(await screen.findByRole('heading', { name: 'Members & staff' })).toBeTruthy();
    expect(await screen.findByText(/Invite members from Your list\. They appear here once they join\./i)).toBeTruthy();
  });
});

describe('Settings', () => {
  it('calls the details card Studio details, and the name box Studio name', async () => {
    settingsAs('studio');
    expect(await screen.findByText(/Studio details/)).toBeTruthy();
    await openSection('Studio details');
    expect(await screen.findByLabelText('Studio name')).toBeTruthy();
    expect(screen.queryByText(/Gym details/)).toBeNull();
  });

  it('calls a personal trainer’s details card Business details', async () => {
    settingsAs('personal_trainer');
    expect(await screen.findByText(/Business details/)).toBeTruthy();
    await openSection('Business details');
    expect(await screen.findByLabelText('Your business name')).toBeTruthy();
  });

  /** §2.2's third role: a gym has a Trainer, a studio and a personal trainer
   *  have a Coach. The person's row on Members → Staff is where an owner reads it. */
  it('calls the third staff role Coach at a studio and Trainer at a gym', async () => {
    staffTabAs('studio');
    const studioRow = await screen.findByTestId('staff-tab-u2');
    expect(within(studioRow).getByText('Coach')).toBeTruthy();
    expect(studioRow.textContent).not.toMatch(/Trainer/);

    cleanup();
    resetConsoleOrgs();
    staffTabAs('gym');
    const gymRow = await screen.findByTestId('staff-tab-u2');
    expect(within(gymRow).getByText('Trainer')).toBeTruthy();
  });

  it('says who runs this studio, and that the member app takes a place (§10.4)', async () => {
    staffTabAs('studio');
    expect(
      await screen.findByText(
        'The people who run your studio. Staff use the console free. Using the member app here takes one of your places. Those who also train here are on In the app too.',
      ),
    ).toBeTruthy();
    expect(await screen.findByText('2 people run your studio')).toBeTruthy();
  });
});
