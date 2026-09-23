// THE PROMPT AN OWNER CANNOT SKIP, ON SCREEN — Kd's ruling of 2026-08-28
// (:22215, :22697), and the surface that replaced the Overview's trial button.
//
// `billingView.test.js` next door proves WHICH ARM the rules pick, from the org
// row alone. This file proves the separate claim that the arm reaches a screen,
// covers it, and cannot be got rid of — which is the whole point of the ruling
// and is not something a pure test can say.
//
// THE FOUR GUARANTEES HERE THAT NO PURE TEST CAN MAKE:
//
//   1. **It cannot be closed.** There is no X, no Escape, no click-outside.
//      Those are ABSENCES in the component, so they are asserted from the
//      outside: press Escape, click the backdrop, and the prompt is still there.
//      A test that only checked the prompt APPEARS would stay green against a
//      dialog anybody can dismiss, which is the exact defect Kd found on the
//      screen this replaces — *"a pop up in the middle of the screen is needed
//      for free trial not a button"*.
//
//   2. **It covers every console screen, not just the Overview.** It is drawn
//      from the shell for that reason; mounted on one screen, an owner would
//      walk around it by typing an address.
//
//   3. **A started trial survives the background re-read failing.** Starting a
//      trial kicks a background refresh of the console's gym list, and the store
//      keeps its previous answer when that read fails (:20440). The answer is
//      therefore written into the store itself — without that, a failed refresh
//      would put an UNCLOSABLE prompt straight back over a gym that is now
//      trialling.
//
//   4. **A failed price read is never drawn as an empty price book.** They are
//      different sentences: one is "we could not ask", the other is "there is
//      nothing to buy", and this console has shipped that confusion before.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
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
      getPlans: vi.fn(),
      startTrial: vi.fn(),
      createOrg: vi.fn(),
    },
  };
});

const logout = vi.fn();
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const { setCurrentUserId } = await import('../../utils/storage');
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const Overview = (await import('./Overview')).default;
const Members = (await import('./Members')).default;
const NewGym = (await import('./NewGym')).default;

const GYM_ID = '11111111-1111-1111-1111-111111111111';

/** An owner's row as `/v1/orgs/mine` serves it. `privileges` is spelled out
 *  rather than left absent: the prompt's gate reads the effective set, and a
 *  fixture relying on the role fallback would stop testing the tick the day
 *  somebody narrows that fallback. */
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
  ownerTrialUsed: false,
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
};

/** The same gym, read by somebody who may run the roster and NOT the money.
 *  §2.2's Billing row is the owner's alone by default, and Kd ruled 2026-08-28
 *  that the prompt stops only whoever can pay. */
const TRAINER_ORG = {
  ...ORG,
  staffRole: 'trainer',
  privileges: ['members.read', 'codes.invite'],
};

const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
const mineIs = (...orgs) => ({ data: { orgs, formerOrgs: [] } });

const PLANS = [
  { code: 'org_b1_us_m', priceLabel: '$35', currency: 'USD', interval: 'month', seatCap: 300 },
  { code: 'org_b2_us_m', priceLabel: '$50', currency: 'USD', interval: 'month', seatCap: 500 },
  { code: 'org_b5_us_m', priceLabel: '$129', currency: 'USD', interval: 'month', seatCap: 2100 },
];

/** Everything the screens behind the prompt read. Fixed and boring — this file
 *  is not about the join code or the roster. */
function quietTheRestOfTheScreen() {
  orgService.getCodes.mockResolvedValue({
    data: {
      codes: [{ code: 'K7QM2X', label: 'Front Desk', paused: false, expiresAt: null, maxUses: null, joined: 0 }],
    },
  });
  orgService.getMembers.mockResolvedValue({ data: { items: [], nextCursor: null } });
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
  orgService.getPlans.mockResolvedValue({ data: { plans: PLANS } });
}

/** The console as a person meets it: the shell — which owns the prompt — with a
 *  screen inside it. Rendering a screen alone would skip the prompt entirely,
 *  which is the surface under test. */
function renderConsole(Screen, path = '/console/iron-house') {
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

// ── ARM 1 · never trialled ─────────────────────────────────────────────────

describe('the forced trial prompt', () => {
  it('stops an owner whose gym has never had a plan', async () => {
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    renderConsole(Overview);

    expect(await screen.findByTestId('plan-modal')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: /start your 10-day free trial/i })).toBeTruthy();
    // The trial length, in Kd's number (RULINGS 2026-09-23), written out here.
    expect(screen.getByText('Your first 10 days are free. No card needed.')).toBeTruthy();
    // It must not promise a number nobody has been told yet: the seat cap comes
    // off the price book and the server picks the band.
    expect(screen.queryByText(/300/)).toBeNull();
    // And it does not ask for prices — there is nothing to choose between.
    expect(orgService.getPlans).not.toHaveBeenCalled();
  });

  it('CANNOT BE CLOSED — no X, no Escape, no click-outside', async () => {
    // GUARANTEE 1, and all three are absences in the component, so they are
    // driven from the outside. A prompt with any of them is the dismissible card
    // Kd rejected: "a pop up ... not a button".
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    renderConsole(Overview);

    const modal = await screen.findByTestId('plan-modal');

    // There is no close control of any kind.
    expect(screen.queryByRole('button', { name: /close|dismiss|not now|later|skip|×/i })).toBeNull();

    // Escape does nothing.
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    fireEvent.keyDown(modal, { key: 'Escape', code: 'Escape' });
    expect(screen.getByTestId('plan-modal')).toBeTruthy();

    // Nor does clicking the backdrop, which is the click a person makes next.
    fireEvent.click(modal);
    expect(screen.getByTestId('plan-modal')).toBeTruthy();
    expect(screen.getByRole('button', { name: /start your 10-day free trial/i })).toBeTruthy();

    // AND ON THE DIALOG ITSELF, not only the backdrop — T3 round 1's instrument
    // note. Focus now moves INTO the dialog, so a real Escape press lands there;
    // a handler added to this element would have gone undetected by the two
    // lines above, and it is the likely place somebody adds one.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    expect(screen.getByTestId('plan-modal')).toBeTruthy();
  });

  it('CONTAINS THE KEYBOARD, not just the mouse', async () => {
    // T3 round 1, Low-1 — the one finding that touched the ruling itself. The
    // overlay stops a mouse; it did not stop TAB, so focus walked out to the
    // rail's links and the phone tab bar behind it, invisible under a 94%-opaque
    // cover but still activatable with Enter.
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    renderConsole(Overview);

    const dialog = await screen.findByRole('dialog');
    // Focus lands in the dialog rather than on whatever the screen behind had.
    await waitFor(() => expect(document.activeElement).toBe(dialog));

    // ── WHAT THIS CAN AND CANNOT ASSERT, because the first version of this test
    // was a LIAR and mutant C103 is what caught it ─────────────────────────────
    //
    // **jsdom does not implement Tab.** `fireEvent.keyDown` moves no focus, so
    // "after Tab, focus is still inside the dialog" is true whether the trap
    // exists or not — it was green with the handler deleted, which is exactly
    // rule 4's category. What IS observable is the handler's own work: at each
    // EDGE it calls `preventDefault` and moves focus to the other end. Without
    // it, focus does not move at all. So both edges are asserted by WHERE focus
    // lands, never by "still inside".
    //
    // The middle of the cycle is the browser's own business and is not asserted
    // here — in a real browser Tab walks the dialog's own controls in order, and
    // the two edges are the only places it could escape.
    const reachable = [...dialog.querySelectorAll('a[href], button:not([disabled])')];
    expect(reachable.length).toBeGreaterThan(1);
    const first = reachable[0];
    const last = reachable[reachable.length - 1];
    // The shell's own controls are in the document — this is the escape route
    // being closed, not an absence of anywhere to escape to.
    expect(screen.getAllByRole('link', { name: 'Your organisations' }).length).toBeGreaterThan(1);

    // Tab off the LAST control wraps to the FIRST instead of leaving for the rail.
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    // And Shift-Tab off the FIRST wraps back to the LAST rather than reaching the
    // screen behind.
    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('covers the MEMBERS screen too, not only the gym screen', async () => {
    // GUARANTEE 2. Mounted on the Overview, an owner would walk around it by
    // typing an address — which is a prompt, not an unskippable one.
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    renderConsole(Members, '/console/iron-house/members');

    expect(await screen.findByTestId('plan-modal')).toBeTruthy();
  });

  it('offers a way OUT of the gym without a way PAST the prompt', async () => {
    // Kd's call at the plan gate, against an arm offering sign-out alone: an
    // owner of two gyms who opens the lapsed one must not be stuck on it. Both
    // exits leave this gym's console shut.
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    renderConsole(Overview);

    // Scoped INSIDE the prompt on purpose: the shell's rail and its phone tab
    // bar both carry a "Your organisations" link and a Sign out of their own, and they
    // are BEHIND this overlay — unreachable while it is up. An unscoped query
    // would pass on those and say nothing about the exits that can be pressed.
    const modal = await screen.findByTestId('plan-modal');
    const out = within(modal).getByRole('link', { name: 'Your organisations' });
    expect(out.getAttribute('href')).toBe('/console');
    expect(within(modal).getByRole('button', { name: /sign out/i })).toBeTruthy();
  });

  it('starts the trial, and the prompt goes when the gym has a plan', async () => {
    // THE REAL SEQUENCE, and the fixture says so deliberately: the first read
    // finds a gym on nothing, and the background re-read that follows the press
    // finds it trialling — because the write committed before the server
    // answered, so a re-read that SUCCEEDS cannot be older than the trial. (The
    // case where that read fails is the next test, and it is the one the store
    // patch exists for.)
    orgService.getMine.mockResolvedValueOnce(mineIs(ORG));
    orgService.getMine.mockResolvedValue(
      mineIs({
        ...ORG,
        ownerTrialUsed: true,
        subscription: { status: 'trialing', trialEndsAt: daysFromNow(30), seatCap: 300 },
      }),
    );
    orgService.startTrial.mockResolvedValue({
      data: {
        outcome: 'started',
        subscription: { status: 'trialing', trialEndsAt: daysFromNow(30), seatCap: 300 },
      },
    });
    renderConsole(Overview);

    fireEvent.click(await screen.findByRole('button', { name: /start your 10-day free trial/i }));

    await waitFor(() => expect(screen.queryByTestId('plan-modal')).toBeNull());
    expect(orgService.startTrial).toHaveBeenCalledTimes(1);
    expect(orgService.startTrial).toHaveBeenCalledWith(GYM_ID);
    // …and the screen behind it now states the plan the server just created.
    expect(screen.getByText('Free trial')).toBeTruthy();
    expect(screen.getByText(/0 of 300 places used/)).toBeTruthy();
  });

  it('STAYS GONE when the background re-read never confirms it', async () => {
    // GUARANTEE 3, and the reason the answer is written into the store rather
    // than held in this component. `getMine` fails on the refresh — which is
    // what a dropped connection looks like from here — and the store keeps its
    // previous answer by design (:20440). Held in the component, this prompt
    // would be back over a gym that IS trialling, and it cannot be closed.
    orgService.getMine.mockResolvedValueOnce(mineIs(ORG));
    orgService.getMine.mockRejectedValue(new Error('network'));
    orgService.startTrial.mockResolvedValue({
      data: {
        outcome: 'started',
        subscription: { status: 'trialing', trialEndsAt: daysFromNow(30), seatCap: 300 },
      },
    });
    renderConsole(Overview);

    fireEvent.click(await screen.findByRole('button', { name: /start your 10-day free trial/i }));
    await waitFor(() => expect(screen.queryByTestId('plan-modal')).toBeNull());

    // The refresh has now failed; the true thing is still on screen.
    await waitFor(() => expect(orgService.getMine).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('plan-modal')).toBeNull();
    expect(screen.getByText('Free trial')).toBeTruthy();
  });

  it('prints the server’s refusal and offers no Try again', async () => {
    // Both of the trial door's refusals are permanent, so a retry button would
    // promise that pressing again might work.
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    orgService.startTrial.mockRejectedValue({
      response: {
        status: 409,
        data: {
          error: 'no_plan_for_currency',
          message: "We're not open for business in your country yet.",
        },
      },
    });
    renderConsole(Overview);

    fireEvent.click(await screen.findByRole('button', { name: /start your 10-day free trial/i }));

    await waitFor(() => expect(screen.getByText(/not open for business/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
    expect(screen.getByTestId('plan-modal')).toBeTruthy();
  });

  it('turns into the PLANS when the server says the trial is already spent', async () => {
    // A kept answer can go stale — the owner started their one trial on another
    // gym in another tab. Without this the owner is left pressing a button that
    // can only ever refuse, behind a prompt they cannot close.
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    orgService.startTrial.mockRejectedValue({
      response: {
        status: 409,
        data: {
          error: 'trial_already_used',
          message: "You've already used your free trial. It's one per person, not one per gym.",
        },
      },
    });
    renderConsole(Overview);

    fireEvent.click(await screen.findByRole('button', { name: /start your 10-day free trial/i }));

    await waitFor(() => expect(screen.getByText(/one per person, not one per gym/i)).toBeTruthy());
    expect(await screen.findByTestId('plan-list')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /start your 10-day free trial/i })).toBeNull();
  });
});

// ── THE MOMENT A GYM IS CREATED ────────────────────────────────────────────

describe('the screen that says the gym is ready', () => {
  /** The create form and its success screen, drawn the way `App.jsx` draws them
   *  — inside the shell, at `/console/new`, where there is NO gym in the address.
   *  That is the whole reason this case exists: the shell's own copy of the
   *  prompt resolves no org there and correctly draws nothing. */
  function renderNewGym() {
    return render(
      <MemoryRouter initialEntries={['/console/new']}>
        <Routes>
          <Route
            path="/console/new"
            element={
              <ConsoleLayout>
                <NewGym />
              </ConsoleLayout>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  const createGym = async () => {
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House' } });
    fireEvent.click(screen.getByLabelText('Country'));
    fireEvent.click(await screen.findByText('United States'));
    fireEvent.click(screen.getByText('Create'));
  };

  it('is COVERED by the prompt, so a gym on no plan is not handing out its code', async () => {
    // KD FOUND THIS IN A BROWSER, 2026-08-28: *"i cretaed gym but this one shows
    // then i click only after that pop shows this is wrong wtf"*.
    //
    // He is right and it is his ruling rather than a preference: :22215 puts the
    // prompt at the moment a gym is CREATED, and this screen was handing out the
    // join code — under "Give this code to your members" — to a gym on no plan.
    // That is the exact state the ruling exists to remove, and the prompt
    // arriving one click later made the wrong thing the first thing.
    //
    // Nothing is removed: the code screen is still there, behind the prompt, and
    // it appears the moment the trial starts.
    orgService.createOrg.mockResolvedValue({
      data: { org: { ...ORG }, joinCode: { code: 'K7QM2X', label: 'Front Desk' } },
    });
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    renderNewGym();
    await createGym();

    // The gym exists and its code screen has been drawn…
    expect(await screen.findByText(/Iron House is ready/i)).toBeTruthy();
    // …and the prompt is over it.
    expect(await screen.findByTestId('plan-modal')).toBeTruthy();
    expect(screen.getByRole('button', { name: /start your 10-day free trial/i })).toBeTruthy();
    // With the same two exits and no way past.
    const modal = screen.getByTestId('plan-modal');
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    fireEvent.click(modal);
    expect(screen.getByTestId('plan-modal')).toBeTruthy();
  });

  it('reveals the code once the trial has started', async () => {
    // THE CONTROL (:7104's PG1), and without it the case above is satisfied by a
    // prompt that never goes away — which would be a worse defect than the one
    // it fixes. The order is the point: start the trial, THEN hand out the code.
    orgService.createOrg.mockResolvedValue({
      data: { org: { ...ORG }, joinCode: { code: 'K7QM2X', label: 'Front Desk' } },
    });
    orgService.getMine.mockResolvedValue(mineIs(ORG));
    orgService.startTrial.mockResolvedValue({
      data: {
        outcome: 'started',
        subscription: { status: 'trialing', trialEndsAt: daysFromNow(30), seatCap: 300 },
      },
    });
    renderNewGym();
    await createGym();

    fireEvent.click(await screen.findByRole('button', { name: /start your 10-day free trial/i }));

    await waitFor(() => expect(screen.queryByTestId('plan-modal')).toBeNull());
    expect(screen.getByText('K7QM2X')).toBeTruthy();
  });

  it('draws no PROMPT before the console has been told the gym exists — but still covers the code', async () => {
    // Two guarantees that pull in opposite directions, and T3 round 1's Low-4 is
    // what separated them.
    //
    // The create response carries no `ownerTrialUsed`, so the prompt is drawn
    // from the shared store's row and until that read lands there is no row: a
    // prompt that cannot be closed must never be drawn on a guess.
    //
    // **The COVER does not depend on that at all** — a gym created one second
    // ago demonstrably has no plan — and without it this screen showed the join
    // code and its live Copy button for the whole round trip, which is Kd's own
    // defect in miniature.
    orgService.createOrg.mockResolvedValue({
      data: { org: { ...ORG }, joinCode: { code: 'K7QM2X', label: 'Front Desk' } },
    });
    orgService.getMine.mockImplementation(() => new Promise(() => {}));
    renderNewGym();
    await createGym();

    expect(await screen.findByTestId('gym-setup-cover')).toBeTruthy();
    expect(screen.queryByTestId('plan-modal')).toBeNull();
    // It claims no outcome it cannot deliver — the read may never answer.
    expect(screen.queryByText(/starting your trial|loading your plan/i)).toBeNull();
  });

  it('KEEPS the code covered when that read fails outright', async () => {
    // The half that is not merely slow: a failed read leaves `createdOrg` null
    // for ever, so without the cover the code sat uncovered permanently.
    orgService.createOrg.mockResolvedValue({
      data: { org: { ...ORG }, joinCode: { code: 'K7QM2X', label: 'Front Desk' } },
    });
    orgService.getMine.mockRejectedValue(new Error('network'));
    renderNewGym();
    await createGym();

    expect(await screen.findByTestId('gym-setup-cover')).toBeTruthy();
    await waitFor(() => expect(orgService.getMine).toHaveBeenCalled());
    expect(screen.getByTestId('gym-setup-cover')).toBeTruthy();
  });
});

// ── ARM 2 · the trial is spent ─────────────────────────────────────────────

describe('the forced subscribe prompt', () => {
  const spent = { ...ORG, ownerTrialUsed: true };

  it('shows the real plans at their real prices, and says the trial is used', async () => {
    // Kd, :22697: "they will be showed subscription option that they can take
    // and say that they alreday ahd a free trial".
    orgService.getMine.mockResolvedValue(mineIs(spent));
    renderConsole(Overview);

    await screen.findByTestId('plan-list');
    expect(screen.getByText(/already used your one free trial/i)).toBeTruthy();
    expect(orgService.getPlans).toHaveBeenCalledWith(GYM_ID);

    // Each row is the server's own price string beside the only human fact the
    // plan row carries. Nothing here is computed.
    expect(screen.getByText('$35 a month')).toBeTruthy();
    expect(screen.getByText('Up to 300 members')).toBeTruthy();
    expect(screen.getByText('$129 a month')).toBeTruthy();
    expect(screen.getByText('Up to 2100 members')).toBeTruthy();

    // No trial button — that owner's one trial is spent, and a button whose only
    // answer is a 409 is the brick wall the ruling exists to remove.
    expect(screen.queryByRole('button', { name: /free trial/i })).toBeNull();
  });

  it('promises no payment it cannot take', async () => {
    // Paddle is unbuilt, the admin "mark as paid" tool is unbuilt, and the
    // contact channel is owed — Kd was told all three before ruling. So the arm
    // says we will be in touch, as a sentence: a button here would either do
    // nothing when pressed or promise a message nothing can send.
    orgService.getMine.mockResolvedValue(mineIs(spent));
    renderConsole(Overview);

    await screen.findByTestId('plan-list');
    expect(screen.getByText(/no way to pay online yet/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /pay|subscribe|checkout|choose/i })).toBeNull();
  });

  it('says something TRUE when the price book has nothing in the gym’s currency', async () => {
    // The empty-list case deferred to this card by T3 round 1 on the server half
    // (:22921, its own OWED line): the route reads a STORED currency column
    // while the guard proving every currency has a book walks the country map,
    // so a gym carrying a dropped currency gets a 200 and no plans.
    //
    // DECIDED HERE: the screen says the true thing, rather than the service
    // refusing. A refusal would leave the owner on an error card behind a prompt
    // that cannot be closed — a dead end dressed as a failure.
    orgService.getMine.mockResolvedValue(mineIs(spent));
    orgService.getPlans.mockResolvedValue({ data: { plans: [] } });
    renderConsole(Overview);

    await screen.findByTestId('plan-modal');
    await waitFor(() =>
      expect(screen.getByText(/don’t have plans listed in your gym’s currency yet|don't have plans listed in your gym's currency yet/i)).toBeTruthy(),
    );
    // The way forward is the same one the arm always ends on, so the prompt is
    // never a dead end.
    expect(screen.getByText(/no way to pay online yet/i)).toBeTruthy();
    expect(screen.queryByTestId('plan-list')).toBeNull();
  });

  it('does NOT draw a failed price read as an empty price book', async () => {
    // GUARANTEE 4. "We could not ask" and "there is nothing to buy" are
    // different sentences, and the second one told to an owner whose connection
    // blipped is a gym owner concluding this product has no plans for them.
    orgService.getMine.mockResolvedValue(mineIs(spent));
    orgService.getPlans.mockRejectedValue(new Error('network'));
    renderConsole(Overview);

    await screen.findByTestId('plan-modal');
    await waitFor(() => expect(screen.getByText(/couldn’t reach the server|couldn't reach the server/i)).toBeTruthy());
    expect(screen.queryByText(/don’t have plans listed|don't have plans listed/i)).toBeNull();
    expect(screen.queryByTestId('plan-list')).toBeNull();
    // A dropped read is worth retrying, unlike the trial's permanent refusals.
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('asks again when Try again is pressed, and draws what comes back', async () => {
    orgService.getMine.mockResolvedValue(mineIs(spent));
    orgService.getPlans.mockRejectedValueOnce(new Error('network'));
    orgService.getPlans.mockResolvedValue({ data: { plans: PLANS } });
    renderConsole(Overview);

    await screen.findByTestId('plan-modal');
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByTestId('plan-list')).toBeTruthy();
    expect(screen.getByText('$35 a month')).toBeTruthy();
  });
});

// ── WHO IS STOPPED, AND WHO IS NOT ─────────────────────────────────────────

describe('who the prompt stops', () => {
  it('does not stop a trainer, who has no way to pay anyway', async () => {
    // Kd's ruling, :22921 §1. Blocking somebody who cannot subscribe is the
    // brick wall pointed at the wrong person.
    orgService.getMine.mockResolvedValue(mineIs(TRAINER_ORG));
    renderConsole(Overview);

    await screen.findByText('Iron House');
    expect(screen.queryByTestId('plan-modal')).toBeNull();
    expect(orgService.getPlans).not.toHaveBeenCalled();
  });

  it('does not stop anybody when the server never said whether the trial is spent', async () => {
    // An api older than this bundle omits `ownerTrialUsed`. Guessing there
    // seals a person out of their own console over a missing field.
    const { ownerTrialUsed, ...WITHOUT } = ORG;
    expect(ownerTrialUsed).toBe(false); // the fixture really did carry it
    orgService.getMine.mockResolvedValue(mineIs(WITHOUT));
    renderConsole(Overview);

    await screen.findByText('Iron House');
    expect(screen.queryByTestId('plan-modal')).toBeNull();
  });

  it('SAYS SO in that window, rather than leaving the owner a blank screen', async () => {
    // T3 round 1, Low-3. The prompt refuses to draw on an unknown (correctly —
    // it cannot be closed) and the plan card refuses to draw a plan that does
    // not exist, so between them an owner got NOTHING and no way to start a
    // trial, where before this card the Overview's button worked regardless.
    // The window heals itself, and "blocked from finishing" is still what
    // happens inside it, so it gets a true sentence (:12660).
    const { ownerTrialUsed, ...WITHOUT } = ORG;
    expect(ownerTrialUsed).toBe(false);
    orgService.getMine.mockResolvedValue(mineIs(WITHOUT));
    renderConsole(Overview);

    expect(await screen.findByText(/couldn’t check this gym’s plan|couldn't check this gym's plan/i)).toBeTruthy();
    // It promises nothing about a trial it cannot confirm they may have.
    expect(screen.queryByRole('button', { name: /free trial/i })).toBeNull();
  });

  it('says nothing in that window to somebody who could not act on it anyway', async () => {
    // The control (:7104's PG1): the sentence above is for whoever can pay. A
    // trainer meets neither the prompt nor an explanation they can do nothing
    // with — and without this, a card drawn for everybody would pass the case
    // above just as well.
    const { ownerTrialUsed, ...WITHOUT } = TRAINER_ORG;
    expect(ownerTrialUsed).toBe(false);
    orgService.getMine.mockResolvedValue(mineIs(WITHOUT));
    renderConsole(Overview);

    await screen.findByText('Iron House');
    expect(screen.queryByText(/couldn’t check this gym’s plan|couldn't check this gym's plan/i)).toBeNull();
    expect(screen.queryByTestId('plan-modal')).toBeNull();
  });

  it('does not stop a gym that is already trialling', async () => {
    orgService.getMine.mockResolvedValue(
      mineIs({
        ...ORG,
        ownerTrialUsed: true,
        subscription: { status: 'trialing', trialEndsAt: daysFromNow(27), seatCap: 300 },
        seatsUsed: 12,
      }),
    );
    renderConsole(Overview);

    await screen.findByText('Free trial');
    expect(screen.queryByTestId('plan-modal')).toBeNull();
  });

  it('does not stop a gym whose trial is past its end date but not yet swept', async () => {
    // :22697 §4's second open question, answered without a ruling: the prompt
    // keys on STATUS and never on the date (:21580's rule (c)). Until the 04:00
    // sweep moves the row the gym is still `trialing` and still has its console.
    orgService.getMine.mockResolvedValue(
      mineIs({
        ...ORG,
        ownerTrialUsed: true,
        subscription: { status: 'trialing', trialEndsAt: daysFromNow(-1), seatCap: 300 },
        seatsUsed: 12,
      }),
    );
    renderConsole(Overview);

    await screen.findByText('Free trial');
    expect(screen.queryByTestId('plan-modal')).toBeNull();
  });

  it('DOES stop that gym once the sweep has ended its trial', async () => {
    // The other side of the same rule, and the defect this card closes: the
    // sweep writes `expired`, the row leaves §4.1's live statuses, and the
    // console reads `subscription: null` — which used to be indistinguishable
    // from a gym that never trialled, so the owner was offered a trial that
    // answers 409 (:22341 §7). `ownerTrialUsed` is what tells them apart.
    orgService.getMine.mockResolvedValue(mineIs({ ...ORG, ownerTrialUsed: true }));
    renderConsole(Overview);

    await screen.findByTestId('plan-list');
    expect(screen.queryByRole('button', { name: /start your 10-day free trial/i })).toBeNull();
    expect(screen.getByText(/already used your one free trial/i)).toBeTruthy();
  });
});
