// THE JOURNEY BETWEEN TWO GYMS — the surface this console keeps shipping
// defects onto, and the one nothing was watching.
//
// FOUR Critical/High findings have now lived here (:20712, :20867, :20986 and
// the trial card below), and every one of them is the same sentence: **a
// console route is ONE route, so walking from gym A to gym B does not remount
// anything, and any state a panel holds outlives the gym it was about.** The
// fixes were four `key` props. :20986's own carry-forward named the gap in as
// many words — *"the guard watches the mechanism; nothing watches the
// journey"* — and :5348 rule 5 says a class found this often is owed an
// automated check rather than a fifth patch.
//
// This file is that check. It is deliberately NOT organised by component: it
// asks ONE question of every console surface, in the shape a person would
// experience it.
//
//     Do something on gym A. Walk to gym B. Is anything on screen still
//     about gym A?
//
// **ADDING A CONSOLE PANEL MEANS ADDING A CASE HERE.** That is the whole
// instruction. A panel that holds no state passes for free and costs one test;
// a panel that holds state is exactly the one this file exists for.
//
// ── WHAT THIS FILE IS AND IS NOT, measured 2026-08-28 ──────────────────────
// **NONE of these defects is reachable by a user TODAY, and that was not known
// when the file was opened.** The console offers no gym switcher: every path
// from one gym to another goes through "Your gyms", which remounts the screen
// and clears its state on the way past. Measured on that real journey, with the
// real list and the real rail link — gym A's join code appears x0 under gym B
// both WITH the round-2 fix and WITHOUT it.
//
// So this file guards a journey the app does not yet offer, and it is kept, for
// two reasons stated plainly rather than assumed: the state leakage is REAL and
// sits in the screens right now, needing only a direct link to become visible;
// and a gym switcher is the obvious next thing to build for an owner of two
// gyms. **What must not happen is this file being read as evidence that a user
// was ever shown the wrong gym's data.** They were not.
//
// The duplicate-key guard armed at :20986 (`test-setup.js`) is a different
// instrument and does not overlap: it catches two children sharing a key, which
// is what round 3's fix caused. Nothing there can see a key that is ABSENT.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Link } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMembers: vi.fn(),
      getCodes: vi.fn(),
      getApplications: vi.fn(),
      startTrial: vi.fn(),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const { setCurrentUserId } = await import('../../utils/storage');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const Overview = (await import('./Overview')).default;
const Members = (await import('./Members')).default;

const A_ID = '11111111-1111-1111-1111-111111111111';
const B_ID = '22222222-2222-2222-2222-222222222222';

/** An owner of BOTH gyms, holding every tick — so nothing here passes merely
 *  because a control was hidden from the viewer. */
const owner = {
  city: 'Austin',
  country: 'US',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
  staffRole: 'owner',
  privileges: [
    'members.read',
    'codes.invite',
    'codes.manage',
    'members.confirm',
    'members.remove',
    'staff.manage',
    'org.manage',
    'billing.manage',
  ],
  subscription: null,
  seatsUsed: 0,
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
};

const GYM_A = { ...owner, id: A_ID, slug: 'gym-a', name: 'Gym A' };
const GYM_B = { ...owner, id: B_ID, slug: 'gym-b', name: 'Gym B' };

const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

// ── Round 2's C/H, and the two reasons this file could not see it ──────────
//
// **(1) BOTH GYMS WERE GIVEN THE SAME ANSWER.** The `beforeEach` below hands
// every gym one join code and one empty roster, so gym A's answer and gym B's
// are identical strings and no assertion can tell them apart. These fixtures
// differ, so "still about gym A" becomes a thing a test can SAY.
//
// **(2) AND THE ANSWER ARRIVED TOO FAST — the half that would still have hidden
// it.** A `mockResolvedValue` settles in a microtask, which React has already
// flushed by the time `findBy*` returns; the stale window is zero frames wide
// and a test written the obvious way PASSES OVER THE BROKEN SCREEN. Measured:
// with per-gym fixtures and instant answers, the overview case below is GREEN
// on the unfixed code. A real request is ~200 ms, and that is the whole defect.
// So gym B's read is HELD OPEN here, and released only once the assertions
// about the window have been made.
//
// **Anything added to this file copies both halves.** Different data per gym,
// and the second gym's read held — otherwise the case is decoration.
const A_CODE = { code: 'AAAAAA', label: 'A desk', paused: false, expiresAt: null, maxUses: null, joined: 0 };
const B_CODE = { code: 'BBBBBB', label: 'B desk', paused: false, expiresAt: null, maxUses: null, joined: 0 };

const A_ROSTER = {
  data: {
    items: [
      {
        userId: 'ua',
        displayName: 'Alice Anderson',
        email: 'alice@example.com',
        status: 'active',
        joinedAt: '2026-08-18T09:00:00.000Z',
        staffRole: null,
      },
    ],
    nextCursor: null,
  },
};
const B_ROSTER = { data: { items: [], nextCursor: null } };

/** Gym B's reads, still in flight. One handle each, because the overview waits
 *  on BOTH before it writes anything — releasing one and not the other would
 *  leave the screen exactly where it was and prove nothing. */
let releaseBCodes;
let releaseBMembers;
const heldCodesForB = () =>
  new Promise((resolve) => {
    releaseBCodes = resolve;
  });
const heldMembersForB = () =>
  new Promise((resolve) => {
    releaseBMembers = resolve;
  });

/** The console, with a way to walk between two gyms that does NOT remount the
 *  route — which is the whole subject. The link sits OUTSIDE `<Routes>` on
 *  purpose: it must survive the navigation it performs.
 *
 *  **THIS LINK IS FABRICATED AND THE APP DOES NOT OFFER IT — measured, and the
 *  header above says why that does not make the file pointless.** Every
 *  gym-to-gym path the console actually draws goes through "Your gyms"
 *  (`/console`), which puts `ConsoleHome` in the slot `Overview` was in; a
 *  different component type in the same position is an unmount, so the screen's
 *  state is cleared on the way past and none of these defects can be SEEN by a
 *  user today. Measured both ways on the real journey, through the real
 *  `ConsoleHome` and the real rail link: gym A's join code appears x0 under gym
 *  B with the fix AND x0 without it.
 *
 *  It said "exactly as the browser's own back button and the shell's nav do"
 *  until 2026-08-28. That was wrong about the shell's nav, in the direction
 *  that flatters the file, and is corrected rather than deleted (:5748). */
function renderConsole(initial = '/console/gym-a') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Link to="/console/gym-a">go to A</Link>
      <Link to="/console/gym-b">go to B</Link>
      <Link to="/console/gym-a/members">members A</Link>
      <Link to="/console/gym-b/members">members B</Link>
      <Routes>
        <Route
          path="/console/:orgSlug"
          element={
            <ConsoleLayout>
              <Overview />
            </ConsoleLayout>
          }
        />
        {/* The roster is a SECOND screen with the same shape of state, and
            round 2's C/H was on it too — so the journey is asked of both. */}
        <Route
          path="/console/:orgSlug/members"
          element={
            <ConsoleLayout>
              <Members />
            </ConsoleLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const walkTo = async (name) => {
  fireEvent.click(screen.getByText(`go to ${name}`));
  await screen.findByRole('heading', { name: `Gym ${name}` });
};

beforeEach(() => {
  resetConsoleOrgs();
  localStorage.clear();
  setCurrentUserId('u1');
  vi.clearAllMocks();
  releaseBCodes = undefined;
  releaseBMembers = undefined;
  orgService.getCodes.mockResolvedValue({
    data: {
      codes: [{ code: 'K7QM2X', label: 'Front Desk', paused: false, expiresAt: null, maxUses: null, joined: 0 }],
    },
  });
  orgService.getMembers.mockResolvedValue({ data: { items: [], nextCursor: null } });
  orgService.getApplications.mockResolvedValue({ data: { items: [], nextCursor: null, pendingCount: 0 } });
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  setCurrentUserId(null);
});

describe('walking from one gym to another', () => {
  it('does not carry gym A’s new trial onto gym B', async () => {
    // THE C/H THIS FILE WAS OPENED FOR. `justStarted` holds the server's own
    // answer to the button — deliberately, so a failed background re-read cannot
    // put "Start your free trial" back over a gym that is now trialling. Held
    // across a gym change it becomes the opposite defect: gym B, on NOTHING,
    // showed "Free trial", a seat meter reading a cap it does not have, and NO
    // start button — so its trial could not be started at all.
    orgService.getMine.mockResolvedValue({ data: { orgs: [GYM_A, GYM_B], formerOrgs: [] } });
    orgService.startTrial.mockResolvedValue({
      data: {
        outcome: 'started',
        subscription: { status: 'trialing', trialEndsAt: daysFromNow(30), seatCap: 300 },
      },
    });

    renderConsole();
    fireEvent.click(await screen.findByRole('button', { name: /start your 30-day free trial/i }));
    await waitFor(() => expect(screen.getByText('Free trial')).toBeTruthy());

    await walkTo('B');

    // Gym B is on no plan, so it says so by saying nothing about a plan…
    expect(screen.queryByText('Free trial')).toBeNull();
    expect(screen.queryByText(/places used/)).toBeNull();
    // …and — the half that BLOCKS somebody rather than merely misinforming them
    // — it offers its own trial.
    expect(screen.getAllByRole('button', { name: /start your 30-day free trial/i })).toHaveLength(1);
  });

  it('still shows gym A’s trial when the owner walks back to it', async () => {
    // THE CONTROL, and without it the test above is satisfied by a card that
    // simply forgets everything — :7104's PG1, where a guard that only ever
    // fires is indistinguishable from a door that is permanently shut.
    //
    // **THE FIRST DRAFT OF THIS CONTROL ASSERTED A GUARANTEE THE DESIGN DOES NOT
    // MAKE, and the guard is what caught it.** It left the shared gym list
    // answering "no plan" for ever and expected the card's HELD answer
    // (`justStarted`) to survive the round trip. It cannot, and it should not:
    // the key exists precisely so a panel keeps nothing across a gym change, and
    // `justStarted` is a one-second bridge until the background re-read lands,
    // not a store. Asserting otherwise would have pinned the defect.
    //
    // So this drives the REAL sequence: starting a trial triggers that re-read,
    // and from then on the plan is a fact on the org row, which survives any
    // number of walks because it is not state at all.
    orgService.getMine.mockResolvedValueOnce({ data: { orgs: [GYM_A, GYM_B], formerOrgs: [] } });
    const A_TRIALLING = {
      ...GYM_A,
      subscription: { status: 'trialing', trialEndsAt: daysFromNow(30), seatCap: 300 },
      seatsUsed: 0,
    };
    orgService.getMine.mockResolvedValue({ data: { orgs: [A_TRIALLING, GYM_B], formerOrgs: [] } });
    orgService.startTrial.mockResolvedValue({
      data: {
        outcome: 'started',
        subscription: { status: 'trialing', trialEndsAt: daysFromNow(30), seatCap: 300 },
      },
    });

    renderConsole();
    fireEvent.click(await screen.findByRole('button', { name: /start your 30-day free trial/i }));
    await waitFor(() => expect(screen.getByText('Free trial')).toBeTruthy());

    await walkTo('B');
    // Gym B is untouched by any of it — the other half of the same guarantee.
    expect(screen.queryByText('Free trial')).toBeNull();
    expect(screen.getAllByRole('button', { name: /start your 30-day free trial/i })).toHaveLength(1);

    await walkTo('A');
    await waitFor(() => expect(screen.getByText('Free trial')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /start your 30-day free trial/i })).toBeNull();
  });

  it('does not let a banner dismissed on gym A silence gym B’s', async () => {
    // Same class, one component over, and the harm is silence rather than a
    // falsehood: `closedAt` exists only to re-render on the press, and it is
    // gym-agnostic, so it short-circuited ahead of the per-gym stored record.
    const aTrial = {
      ...GYM_A,
      subscription: { status: 'trialing', trialEndsAt: daysFromNow(20), seatCap: 300 },
      seatsUsed: 3,
    };
    const bTrial = {
      ...GYM_B,
      subscription: { status: 'trialing', trialEndsAt: daysFromNow(10), seatCap: 300 },
      seatsUsed: 4,
    };
    orgService.getMine.mockResolvedValue({ data: { orgs: [aTrial, bTrial], formerOrgs: [] } });

    renderConsole();
    const banner = await screen.findByTestId('console-banner');
    expect(banner.textContent).toContain('20 days left');

    fireEvent.click(screen.getByRole('button', { name: /dismiss until tomorrow/i }));
    await waitFor(() => expect(screen.queryByTestId('console-banner')).toBeNull());

    await walkTo('B');

    // Gym B's own banner, with gym B's own number — a different claim on the
    // owner's attention, which is why the stored record is per gym.
    const bBanner = await screen.findByTestId('console-banner');
    expect(bBanner.textContent).toContain('10 days left');
  });

  it('keeps gym A’s banner dismissed when the owner walks back to it', async () => {
    // The control for the case above: the dismissal must survive the journey,
    // or "dismiss until tomorrow" would be a promise the console breaks the
    // moment somebody looks at their other gym.
    const aTrial = {
      ...GYM_A,
      subscription: { status: 'trialing', trialEndsAt: daysFromNow(20), seatCap: 300 },
      seatsUsed: 3,
    };
    const bTrial = {
      ...GYM_B,
      subscription: { status: 'trialing', trialEndsAt: daysFromNow(10), seatCap: 300 },
      seatsUsed: 4,
    };
    orgService.getMine.mockResolvedValue({ data: { orgs: [aTrial, bTrial], formerOrgs: [] } });

    renderConsole();
    await screen.findByTestId('console-banner');
    fireEvent.click(screen.getByRole('button', { name: /dismiss until tomorrow/i }));
    await waitFor(() => expect(screen.queryByTestId('console-banner')).toBeNull());

    await walkTo('B');
    await screen.findByTestId('console-banner');
    await walkTo('A');

    // Still dismissed — the record is stored per gym and per user, so the walk
    // changes nothing about it.
    await waitFor(() => expect(screen.queryByTestId('console-banner')).toBeNull());
  });

  it('does not show gym A’s join code on gym B while gym B is still answering', async () => {
    // ROUND 2's C/H, and the fifth appearance of the class. The three panes hold
    // their answers in the screen's own state; the effect refetches when the gym
    // changes but does NOT clear them first, while the gym's NAME comes off a row
    // that is already in hand. So for one round trip the screen is gym B's
    // heading over GYM A'S JOIN CODE — twice, with a live Copy button on it —
    // and gym A's member count. A code copied there puts the person who scans it
    // into the wrong gym.
    orgService.getMine.mockResolvedValue({ data: { orgs: [GYM_A, GYM_B], formerOrgs: [] } });
    orgService.getCodes.mockImplementation((gymId) =>
      gymId === A_ID ? Promise.resolve({ data: { codes: [A_CODE] } }) : heldCodesForB(),
    );
    orgService.getMembers.mockImplementation((gymId) =>
      gymId === A_ID ? Promise.resolve(A_ROSTER) : heldMembersForB(),
    );

    renderConsole();
    await screen.findAllByText('AAAAAA');

    await walkTo('B');

    // Gym B has answered nothing yet, so the screen says nothing about a code…
    expect(screen.queryAllByText('AAAAAA')).toHaveLength(0);
    // …and nothing about a roster it has not read. "1 member" was gym A's count.
    expect(screen.queryByText(/1 member/)).toBeNull();

    // THE CONTROL (:7104's PG1): gym B's own answer still lands, so this cannot
    // pass on a screen that has merely stopped showing join codes.
    releaseBCodes({ data: { codes: [B_CODE] } });
    releaseBMembers(B_ROSTER);
    await waitFor(() => expect(screen.queryAllByText('BBBBBB').length).toBeGreaterThan(0));
  });

  it('does not show gym A’s members on gym B while gym B is still answering', async () => {
    // The same class on the roster screen, where the stale row carries a live
    // Remove button — so the window offers an action against a person who is not
    // in the gym on screen.
    //
    // The arrival signal is the READ ITSELF rather than anything drawn, because
    // what is drawn differs between the broken and fixed screens: unfixed, the
    // subtitle reads "Gym B · 1 member" over gym A's roster; fixed, the screen is
    // loading and prints no subtitle at all. Waiting on the call is true in both.
    orgService.getMine.mockResolvedValue({ data: { orgs: [GYM_A, GYM_B], formerOrgs: [] } });
    orgService.getMembers.mockImplementation((gymId) =>
      gymId === A_ID ? Promise.resolve(A_ROSTER) : heldMembersForB(),
    );

    renderConsole('/console/gym-a/members');
    await screen.findByText('Alice Anderson');

    fireEvent.click(screen.getByText('members B'));
    await waitFor(() =>
      expect(orgService.getMembers).toHaveBeenCalledWith(B_ID, expect.anything()),
    );

    expect(screen.queryByText('Alice Anderson')).toBeNull();
    expect(screen.queryByRole('button', { name: /^remove$/i })).toBeNull();

    // THE CONTROL: gym B's roster lands and the screen is gym B's.
    releaseBMembers(B_ROSTER);
    await waitFor(() => expect(screen.getByText(/^Gym B ·/)).toBeTruthy());
    expect(screen.queryByText('Alice Anderson')).toBeNull();
  });
});
