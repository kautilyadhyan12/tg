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
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
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
      getAttendanceDay: vi.fn(),
      getStaff: vi.fn(),
      updateOrg: vi.fn(),
      getHours: vi.fn(() =>
        Promise.resolve({
          data: { hours: { mode: 'unset', timezone: 'UTC', week: [], closures: [] } },
        }),
      ),
      setHours: vi.fn(),
      closeDay: vi.fn(),
      removeClosure: vi.fn(),
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
  mountAs(orgType, '/console/flow-studio/members', <Members />, '/console/:orgSlug/members');
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
  it('names the tabs and the heading after the org type', async () => {
    settingsAs('studio');
    // The rail and the mobile bar both carry it, hence `getAllBy`.
    await waitFor(() => expect(screen.getAllByText('Studio console').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Clients').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Studio').length).toBeGreaterThan(0);
    expect(screen.queryByText('Gym console')).toBeNull();
    expect(screen.queryByText('Members')).toBeNull();
  });

  it('leaves a gym’s tabs exactly as they were — the control', async () => {
    settingsAs('gym');
    await waitFor(() => expect(screen.getAllByText('Gym console').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Members').length).toBeGreaterThan(0);
    expect(screen.queryByText('Studio console')).toBeNull();
    expect(screen.queryByText('Clients')).toBeNull();
  });

  /** **THE TWO-NOUN SPLIT, ON SCREEN.** A personal trainer runs a *business*
   *  and their client joined a *trainer*; the console is the owner's side, so
   *  it is the business word that belongs in the shell. */
  it('calls a personal trainer’s console their Business, not their Trainer', async () => {
    settingsAs('personal_trainer');
    await waitFor(() => expect(screen.getAllByText('Business console').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Clients').length).toBeGreaterThan(0);
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
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect(await screen.findByText(/Share your join code and clients will appear here\./i)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Members' })).toBeNull();
  });

  it('is headed Members for a gym — the control', async () => {
    orgService.getMembers.mockResolvedValue({ data: { items: [], nextCursor: null } });
    membersAs('gym');
    expect(await screen.findByRole('heading', { name: 'Members' })).toBeTruthy();
    expect(await screen.findByText(/Share your join code and members will appear here\./i)).toBeTruthy();
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
   *  have a Coach. The row's own meta line is where an owner reads it. */
  it('calls the third staff role Coach at a studio and Trainer at a gym', async () => {
    settingsAs('studio');
    await openSection('Staff');
    const staffRow = await screen.findByText('Priya Sen');
    await waitFor(() =>
      expect(staffRow.parentElement.textContent).toMatch(/Coach/),
    );
    expect(staffRow.parentElement.textContent).not.toMatch(/Trainer/);

    cleanup();
    resetConsoleOrgs();
    settingsAs('gym');
    await openSection('Staff');
    const gymRow = await screen.findByText('Priya Sen');
    await waitFor(() => expect(gymRow.parentElement.textContent).toMatch(/Trainer/));
  });

  it('says who runs this studio, and that staff cost no client seat', async () => {
    settingsAs('studio');
    expect(
      await screen.findByText(/Who can help you run this studio\..*paid client seats/),
    ).toBeTruthy();
    expect(await screen.findByText('2 people run this studio')).toBeTruthy();
  });

  it('tells a studio’s owner the switch lets CLIENTS mark themselves in', async () => {
    settingsAs('studio');
    // The switch's state rides on the section HEADING, so it is readable
    // without opening the section — which is the point of that summary.
    expect(
      await screen.findByRole('button', { name: /Marking attendance Clients can mark themselves in/ }),
    ).toBeTruthy();
    await openSection('Marking attendance');
    expect(await screen.findByText(/Let clients mark themselves in/)).toBeTruthy();
  });
});
