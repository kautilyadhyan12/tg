// The trial, the banner and the seat meter, ON SCREEN.
//
// `billingView.test.js` next door proves the arithmetic. This proves the three
// surfaces are REACHABLE and draw it — which is a separate claim, and the one
// this project has been burned by: :12518's L-1 found that nothing asserted a
// card's own components could be reached at all, so deleting the route left 857
// tests green while the feature vanished.
//
// **THE TRIAL IS NO LONGER STARTED FROM THIS SCREEN, AND THAT IS A KD RULING**
// (:22921 §1, 2026-08-28): the Overview's pre-trial button is deleted and the
// unskippable prompt in `ConsoleLayout` is the only way a trial starts. The
// cases that pressed that button — a successful start surviving a failed
// refresh, and a permanent refusal offering no Try again — moved WITH it, to
// `planPrompt.render.test.jsx`, along with the guarantee they carried. Nothing
// was dropped in the move; the first of the two is now a promise about the
// shared store rather than about a component, which is where the fact lives.
//
// What this file still proves about the card: it states the plan for a gym that
// HAS one, it says nothing at all for a gym that does not, and it is drawn only
// for somebody who may manage billing.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { attendanceDay, overview } from './__fixtures__/overview';

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

// ── Fixtures ────────────────────────────────────────────────────────────────

const GYM_ID = '11111111-1111-1111-1111-111111111111';

/** An owner's row as `/v1/orgs/mine` now serves it. `privileges` is spelled out
 *  rather than left absent: this screen's gate reads the effective set, and a
 *  fixture that relied on the role fallback would stop testing the tick the day
 *  somebody narrows the fallback. */
const ORG = {
  id: GYM_ID,
  slug: 'iron-house',
  name: 'Iron House',
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
  /** SPELLED OUT, and T3 round 1's Low-3 fix is why it has to be. An ABSENT
   *  `ownerTrialUsed` no longer means "an ordinary gym with no plan" — it means
   *  "this api could not tell us", which the card now answers with a sentence
   *  rather than silence. A fixture leaving it out would be testing that window
   *  while claiming to test the ordinary one. */
  ownerTrialUsed: false,
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
};

/** The same gym read by somebody who may run the roster and NOT the money —
 *  §2.2's Billing row is the owner's alone by default. */
const MANAGER_ORG = {
  ...ORG,
  staffRole: 'manager',
  privileges: ['members.read', 'codes.invite', 'members.confirm', 'members.remove'],
};

const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

const onTrial = (over = {}) => ({
  ...ORG,
  subscription: { status: 'trialing', trialEndsAt: daysFromNow(27), seatCap: 300 },
  seatsUsed: 12,
  ...over,
});

const ownerSeat = {
  userId: 'u1',
  displayName: 'Kd Owner',
  joinedAt: '2026-08-18T09:00:00.000Z',
  groupLabel: 'Front Desk',
  complimentary: true,
  takesSeat: false,
};

const mineIs = (...orgs) => ({ data: { orgs, formerOrgs: [] } });

/** Everything the Overview reads besides the org row. Fixed and boring — this
 *  file is not about the join code or the roster. */
function quietTheRestOfTheScreen() {
  orgService.getCodes.mockResolvedValue({
    data: { codes: [{ code: 'K7QM2X', label: 'Front Desk', paused: false, expiresAt: null, maxUses: null, joined: 0 }] },
  });
  orgService.getMembers.mockResolvedValue({ data: { items: [ownerSeat], nextCursor: null } });
  orgService.getApplications.mockResolvedValue({ data: { items: [], nextCursor: null, pendingCount: 0 } });
  // The numbers zone reads this. QUIET IS THE TRUTHFUL DEFAULT for these
  // fixtures — no attendance, and a roster whose only seat is the owner's
  // complimentary one, which `month.members` excludes — so it draws nothing at
  // all and this suite sees the screen it was written against.
  orgService.getOverview.mockResolvedValue(overview());
  // The names under the numbers read this. EMPTY is the truthful default here
  // for the same reason the overview above is quiet: these fixtures have no
  // attendance, so the preview draws nothing.
  orgService.getAttendanceDay.mockResolvedValue(attendanceDay());
}

/** The console as a person meets it: the shell (which owns §4.2's slot) with a
 *  screen inside it. Rendering the screen alone would test the card and the
 *  meter and silently skip the banner, which is the surface with the most
 *  copy on it. */
function renderConsole(Screen, path = `/console/iron-house`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/console/:orgSlug"
          element={
            <ConsoleLayout>
              <Screen />
            </ConsoleLayout>
          }
        />
        <Route
          path="/console/:orgSlug/members"
          element={
            <ConsoleLayout>
              <Screen />
            </ConsoleLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetConsoleOrgs();
  localStorage.clear();
  setCurrentUserId('u1');
  vi.clearAllMocks();
  quietTheRestOfTheScreen();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  setCurrentUserId(null);
});

// ── The button ──────────────────────────────────────────────────────────────

describe('the plan card', () => {
  it('draws nothing at all for a gym on no plan', async () => {
    // The card is silent here, and the owner is not: the unskippable prompt is
    // over this whole screen. There is deliberately no second way to start a
    // trial (:22921 §1) — a card offering one is the dismissible control that
    // ruling replaced.
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    renderConsole(Overview);

    await screen.findByText('Iron House');
    expect(screen.queryByText('Plan')).toBeNull();
    expect(screen.queryByText(/places used/)).toBeNull();
    // THE ONLY TRIAL BUTTON ON SCREEN IS THE PROMPT'S, and asserting WHERE it
    // lives is the point: this used to assert there was none at all, which
    // stopped being true the moment the fixture said "never trialled" — and a
    // bare "no such button" would now pass just as well over a card that had
    // quietly grown one back.
    const modal = screen.getByTestId('plan-modal');
    const trialButtons = screen.getAllByRole('button', { name: /start your 10-day free trial/i });
    expect(trialButtons).toHaveLength(1);
    expect(modal.contains(trialButtons[0])).toBe(true);
    // And no banner, because there is no plan for §4.2 to have a state about.
    expect(screen.queryByTestId('console-banner')).toBeNull();
  });

  it('is not drawn at all for somebody without the billing tick', async () => {
    // §2.2's Billing row. A manager who may run the roster sees no billing card
    // — not a disabled one, which is the defect §2.2's own rules warn about.
    //
    // **THE GYM IS ON A TRIAL ON PURPOSE, and without that this test would pass
    // for the wrong reason.** A gym on no plan draws no card whatever the
    // viewer's privileges, so a fixture with `subscription: null` is satisfied
    // by a card with NO privilege gate at all — C88's redundancy shape, one
    // component over. Trialling, the privilege check is the only thing that can
    // hide it.
    orgService.getMine.mockResolvedValue(
      mineIs({
        ...MANAGER_ORG,
        subscription: { status: 'trialing', trialEndsAt: daysFromNow(27), seatCap: 300 },
        seatsUsed: 12,
      }),
    );
    renderConsole(Overview);

    await screen.findByText('Iron House');
    expect(screen.queryByText('Plan')).toBeNull();
    expect(screen.queryByText('Free trial')).toBeNull();
    expect(screen.queryByText(/places used/)).toBeNull();
  });

  it('shows a trial already running, with its end date and its meter', async () => {
    orgService.getMine.mockResolvedValue(mineIs(onTrial()));
    renderConsole(Overview);

    expect(await screen.findByText('Free trial')).toBeTruthy();
    expect(screen.getByText(/^Ends /)).toBeTruthy();
    expect(screen.getByText(/12 of 300 places used/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /start your 10-day free trial/i })).toBeNull();
  });

  it('does NOT print an end date for a gym that is past its trial', async () => {
    // `trialEndsAt` is never cleared, so a paying gym answers with the date its
    // old trial ran out. A card keying on the field rather than the status
    // would put a stale date under a live plan.
    orgService.getMine.mockResolvedValue(
      mineIs({
        ...ORG,
        subscription: { status: 'active', trialEndsAt: daysFromNow(-200), seatCap: 300 },
        seatsUsed: 40,
      }),
    );
    renderConsole(Overview);

    expect(await screen.findByText('On a plan')).toBeTruthy();
    expect(screen.queryByText(/^Ends /)).toBeNull();
    expect(screen.queryByText(/free trial/i)).toBeNull();
  });
});

// ── §4.2's banner ───────────────────────────────────────────────────────────

describe('the banner above every console screen', () => {
  it('counts the trial down and can be put away until tomorrow', async () => {
    orgService.getMine.mockResolvedValue(mineIs(onTrial()));
    renderConsole(Overview);

    const banner = await screen.findByTestId('console-banner');
    expect(banner.textContent).toMatch(/27 days left/);

    fireEvent.click(screen.getByRole('button', { name: /dismiss until tomorrow/i }));
    await waitFor(() => expect(screen.queryByTestId('console-banner')).toBeNull());
  });

  it('stays away across a fresh mount on the same day', async () => {
    // The press writes to per-user storage, which is what makes the dismissal
    // survive moving between console screens rather than only surviving a
    // re-render.
    orgService.getMine.mockResolvedValue(mineIs(onTrial()));
    renderConsole(Overview);
    fireEvent.click(await screen.findByRole('button', { name: /dismiss until tomorrow/i }));
    await waitFor(() => expect(screen.queryByTestId('console-banner')).toBeNull());

    cleanup();
    renderConsole(Overview);
    await screen.findByText('Iron House');
    expect(screen.queryByTestId('console-banner')).toBeNull();
  });

  it('cannot be dismissed once the trial is nearly over', async () => {
    // §4.2: "amber, not dismissible".
    orgService.getMine.mockResolvedValue(
      mineIs(onTrial({ subscription: { status: 'trialing', trialEndsAt: daysFromNow(2), seatCap: 300 } })),
    );
    renderConsole(Overview);

    const banner = await screen.findByTestId('console-banner');
    expect(banner.textContent).toMatch(/Trial ends/);
    expect(screen.queryByRole('button', { name: /dismiss until tomorrow/i })).toBeNull();
  });

  it('shows the amber notice even with a dismissal already stored against it', async () => {
    // MUTANT C91 SURVIVED WITHOUT THIS TEST, and the survival was the finding:
    // the "is this banner dismissible at all" guard could be deleted with the
    // suite green, because no test ever put a dismissal in front of a
    // non-dismissible banner. Nothing in the product can WRITE that record —
    // the button is the only writer and it is not drawn here — so the subject
    // has to be planted, exactly as :15093 closed O92 with a fixture the
    // product does not produce.
    //
    // The guard stays and is defence in depth, not decoration: storage is data
    // from a previous session and a previous VERSION of this app, and §4.2 says
    // this state is not dismissible full stop — not "unless something in the
    // browser says otherwise".
    localStorage.setItem(
      `user_u1_console_banner_dismissed_${GYM_ID}`,
      JSON.stringify({ key: 'trial_urgent', at: Date.now() }),
    );
    orgService.getMine.mockResolvedValue(
      mineIs(onTrial({ subscription: { status: 'trialing', trialEndsAt: daysFromNow(2), seatCap: 300 } })),
    );
    renderConsole(Overview);

    expect((await screen.findByTestId('console-banner')).textContent).toMatch(/Trial ends/);
  });

  it('appears on the MEMBERS screen too, not only on the gym screen', async () => {
    // "sits above all screens" — the reason it lives in the shell. A banner on
    // the Overview alone would miss the owner who is standing on the roster.
    orgService.getMine.mockResolvedValue(mineIs(onTrial()));
    renderConsole(Members, '/console/iron-house/members');

    expect((await screen.findByTestId('console-banner')).textContent).toMatch(/27 days left/);
  });

  it('says nothing at all for a gym on no plan', async () => {
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    renderConsole(Overview);
    await screen.findByText('Iron House');
    expect(screen.queryByTestId('console-banner')).toBeNull();
  });
});

// ── §4.3's seat meter ───────────────────────────────────────────────────────

describe('the seat meter', () => {
  it('reports the server’s count against the cap', async () => {
    orgService.getMine.mockResolvedValue(mineIs(onTrial({ seatsUsed: 42 })));
    renderConsole(Members, '/console/iron-house/members');

    expect((await screen.findByTestId('seat-meter')).textContent).toMatch(/42 of 300 places used/);
  });

  it('is NOT the length of the roster page', async () => {
    // The meter's whole reason for existing on the server. The page below holds
    // one row; the gym holds 280. `items.length` would read "1 of 300".
    orgService.getMine.mockResolvedValue(mineIs(onTrial({ seatsUsed: 280 })));
    renderConsole(Members, '/console/iron-house/members');

    expect((await screen.findByTestId('seat-meter')).textContent).toMatch(/280 of 300/);
  });

  it('says why nobody else can join once the gym is full', async () => {
    orgService.getMine.mockResolvedValue(mineIs(onTrial({ seatsUsed: 300 })));
    renderConsole(Members, '/console/iron-house/members');

    expect((await screen.findByTestId('seat-meter')).textContent).toMatch(/full/i);
  });

  it('draws no meter at all for a gym on no plan', async () => {
    // Nothing caps it, so there is no denominator — and "0 of 0" is a number
    // nobody computed.
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    renderConsole(Members, '/console/iron-house/members');

    // The HEADING, not the text: "Members" is also the shell's nav tab, twice
    // over (rail and phone bar), so a bare text query is ambiguous and fails for
    // a reason that has nothing to do with the meter.
    await screen.findByRole('heading', { name: 'Members' });
    expect(screen.queryByTestId('seat-meter')).toBeNull();
  });

  it('survives the roster failing to load', async () => {
    // The numbers come off the org row, so how full a gym is does not depend on
    // the member list arriving.
    orgService.getMine.mockResolvedValue(mineIs(onTrial({ seatsUsed: 42 })));
    orgService.getMembers.mockRejectedValue(new Error('network'));
    renderConsole(Members, '/console/iron-house/members');

    expect((await screen.findByTestId('seat-meter')).textContent).toMatch(/42 of 300/);
  });
});
