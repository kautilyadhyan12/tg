// The crossing between the member app and the gym console is CLOSED, and both
// screens that had no exit now have one. Kd's ruling, 2026-08-19, mid-smoke.
//
// Three guarantees, one ruling — which is why they share a file. Splitting them
// is how half a ruling survives an edit: restoring either shortcut ALONE is
// worse than restoring neither, because it makes the crossing work in one
// direction only, which is the "works sometimes" door `landingRoute` exists to
// prevent.
//
//   1. the console offers SIGN OUT and no way into the member app
//   2. the member sidebar offers no way into the console
//   3. the setup questionnaire — the one screen a person can be sent to with no
//      sidebar at all — offers sign out
//
// These are RENDER assertions rather than source greps on purpose: a source
// grep is satisfied by spelling the link differently, and the point of 1 and 3
// is that a real click really ends the session.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// One mutable auth object serves all three subjects. `logout` is the thing under
// test in two of them, so it is a spy that resolves.
const authState = {
  user: { id: 'u1', displayName: 'Kd' },
  loading: false,
  logout: vi.fn(() => Promise.resolve()),
  updateUser: vi.fn(),
};
vi.mock('../context/AuthContext', () => ({ useAuth: () => authState }));

// The overlay's real 500 ms timer would make every assertion race a clock.
vi.mock('../context/TransitionContext', () => ({
  useTransition: () => ({ triggerTransition: (cb) => cb() }),
}));

vi.mock('../hooks/useXp', () => ({ useXp: () => ({ xp: null }) }));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

// THE GYM LIST IS MOCKED BECAUSE THE SIDEBAR NOW ASKS FOR IT. `My Gyms` (Kd,
// 2026-09-02) is drawn only for a member, so this suite can put a person on
// either side of that gate — and the positive case is the one that matters
// here: the new item must NOT be a way across the crossing this file guards.
const orgs = { getMine: vi.fn(), getHours: vi.fn() };
vi.mock('../api/orgsApi', () => ({
  orgService: orgs,
  errorText: (_err, fallback) => fallback,
}));

const ConsoleLayout = (await import('../components/console/ConsoleLayout')).default;
const Sidebar = (await import('../components/common/Sidebar')).default;
const Onboarding = (await import('./Onboarding')).default;
const { resetConsoleOrgs } = await import('./console/consoleOrgs');

const MEMBER_OF = {
  id: 'g1',
  name: 'Iron House',
  slug: 'iron-house',
  isMember: true,
  manualAttendanceEnabled: true,
  staffRole: null,
};

// Landing markers rather than a spied `useNavigate`: the real router resolves
// the real path, so a destination that is not a route fails here instead of
// passing as a string comparison.
const drawConsole = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house']}>
      <Routes>
        <Route
          path="/console/:orgSlug"
          element={<ConsoleLayout><p>GYM CONSOLE</p></ConsoleLayout>}
        />
        <Route path="/login" element={<p>THE LOGIN PAGE</p>} />
        <Route path="/dashboard" element={<p>MEMBER APP</p>} />
      </Routes>
    </MemoryRouter>,
  );

const drawSidebar = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Sidebar />
    </MemoryRouter>,
  );

const drawOnboarding = () =>
  render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/login" element={<p>THE LOGIN PAGE</p>} />
        <Route path="/dashboard" element={<p>MEMBER APP</p>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  authState.logout.mockClear();
  resetConsoleOrgs();
  // Nobody's gyms by default — the state every assertion in this file except
  // the two `My Gyms` cases is about.
  orgs.getMine.mockReset().mockResolvedValue({ data: { orgs: [], formerOrgs: [] } });
  orgs.getHours.mockReset().mockResolvedValue({ data: { hours: { mode: 'unset' } } });
});
afterEach(() => {
  cleanup();
  resetConsoleOrgs();
});

describe('the gym console', () => {
  // TWO exits render, and the count is the assertion. The shell draws a desktop
  // rail and a phone top bar, each with its own control, and CSS hides one —
  // which jsdom does not apply, so both are in the tree here. Pinning the count
  // is what stops a later edit turning ONE of them back into a link into the
  // member app: on a phone that is the only control there is, so half the
  // ruling would be undone on the surface Kd asked to work from a phone.
  it('offers Sign out on BOTH the desktop rail and the phone bar', () => {
    drawConsole();
    expect(screen.getAllByRole('button', { name: /sign out/i })).toHaveLength(2);
  });

  it('offers NO way into the member app', () => {
    drawConsole();
    // The removed link read "Back to the app" and pointed at /dashboard. Both
    // halves are asserted: the words, and any anchor to the member app at all,
    // so re-adding it under a friendlier name still fails.
    expect(screen.queryByText(/back to the app/i)).toBeNull();
    const toMemberApp = Array.from(document.querySelectorAll('a[href]')).filter((a) =>
      a.getAttribute('href').startsWith('/dashboard'),
    );
    expect(toMemberApp).toHaveLength(0);
  });

  // Each control is driven separately. One test clicking "the first one" would
  // leave the phone bar — the only exit at phone width — unexercised.
  //
  // THE CONTROLS ARE FOUND BY WHERE THEY LIVE, NOT BY INDEX (T3 round 1, L2).
  // With `[0]`/`[1]`, the D12 mutant — which turns the RAIL into a link — made
  // the case named "from the desktop rail" silently drive the phone bar and
  // PASS, while `[1]` came back undefined and the OTHER case caught it. Nothing
  // was hidden, but a case that does not drive what its name says is a case that
  // will mislead the next person to read a red run.
  const signOutIn = (where) => {
    const buttons = screen.getAllByRole('button', { name: /sign out/i });
    const found = buttons.find((b) => (where === 'rail' ? b.closest('aside') !== null : b.closest('aside') === null));
    if (!found) throw new Error(`no Sign out control in the ${where} — it is not a button any more`);
    return found;
  };

  it.each([
    ['desktop rail', 'rail'],
    ['phone bar', 'bar'],
  ])('ends the session and returns to the login page from the %s', async (_label, where) => {
    drawConsole();
    fireEvent.click(signOutIn(where));
    await waitFor(() => expect(screen.getByText('THE LOGIN PAGE')).toBeTruthy());
    // Landing on /login is not enough on its own — a link would do that while
    // leaving the person signed in. The session must actually end.
    expect(authState.logout).toHaveBeenCalledTimes(1);
  });
});

describe('the member sidebar', () => {
  it('offers NO way into the gym console', () => {
    drawSidebar();
    // The removed item read `My Gym` and pointed at /console. **THE DESTINATION
    // IS THE ASSERTION, NOT THE WORDS**, and that changed on 2026-09-02: Kd
    // ruled a MEMBER section called `My Gyms` into this same list, so a test
    // banning the phrase would now fail on a screen he asked for — and, worse,
    // would read to the next chat as though his 2026-08-19 ruling had been
    // reversed. The two items are told apart by where they GO: `/console` is
    // the crossing and stays shut; `/my-gyms` is a member screen about the
    // member's own gym. Re-adding the old shortcut under any name still fails
    // here, which is what the ruling actually protects.
    const toConsole = Array.from(document.querySelectorAll('a[href]')).filter((a) =>
      a.getAttribute('href').startsWith('/console'),
    );
    expect(toConsole).toHaveLength(0);
  });

  it('still offers the screens that were NOT removed', () => {
    // Non-vacuity: the assertion above passes on a sidebar that failed to
    // render at all, which is exactly how a guard quietly stops guarding.
    drawSidebar();
    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  // THE POSITIVE CONTROL FOR THE ASSERTION ABOVE. Without it, "no link to the
  // console" is also satisfied by a sidebar that draws no gym item at all — so
  // the case that could hide a re-opened crossing is the one where a gym item
  // IS on screen. It is here rather than in the My Gyms suite because it is
  // this file's ruling that it could break.
  it('draws My Gyms for a member WITHOUT opening the crossing', async () => {
    orgs.getMine.mockResolvedValue({ data: { orgs: [MEMBER_OF], formerOrgs: [] } });
    drawSidebar();
    await waitFor(() => expect(screen.getByText('My Gyms')).toBeTruthy());
    const links = Array.from(document.querySelectorAll('a[href]'));
    expect(links.some((a) => a.getAttribute('href') === '/my-gyms')).toBe(true);
    expect(links.filter((a) => a.getAttribute('href').startsWith('/console'))).toHaveLength(0);
    // T3 ROUND 1, L-2 — THE HREF FILTER ALONE LEFT A GAP THE OLD WORDS BAN HAD
    // COVERED: a crossing built as a BUTTON with an onClick navigate, or one
    // pointing at an innocent path, has no `/console` href to find. So the
    // words come back — ANCHORED and SINGULAR, banning exactly the item Kd
    // removed (`My Gym`) while leaving the member section he asked for
    // (`My Gyms`) alone.
    //
    // **IT LIVES IN THIS CASE AND NOT IN THE ONE ABOVE, and that is the whole
    // lesson of where it was first put.** The case above renders a sidebar for
    // somebody with NO gyms, where no gym item is drawn at all — a ban on a
    // label is vacuous against a screen that draws no labels. It has to be
    // asserted where an item actually renders, which is here.
    expect(screen.queryByText(/^\s*my gym\s*$/i)).toBeNull();
  });
});

describe('the setup questionnaire', () => {
  it('offers Sign out', () => {
    drawOnboarding();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeTruthy();
  });

  it('ends the session and returns to the login page when Sign out is pressed', async () => {
    drawOnboarding();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(screen.getByText('THE LOGIN PAGE')).toBeTruthy());
    expect(authState.logout).toHaveBeenCalledTimes(1);
  });

  it('signing out is NOT a skip — it never lands in the member app', async () => {
    // T3 round 1, L1: THIS TEST USED TO ASSERT ITS CLAIM WITHOUT EVER CLICKING.
    // It rendered the wizard, checked "Basic Info" was on screen and that
    // "MEMBER APP" was not — both true of a page nobody had touched — so the
    // reviewer turned `handleSignOut` into `navigate('/dashboard')`, an actual
    // skip, and it stayed GREEN while only its sibling went red. Its own comment
    // claimed it caught exactly that. A test whose subject is a click has to do
    // the click.
    drawOnboarding();
    // Non-vacuity first: the wizard really is what is on screen before the
    // press. ("Basic Info" is both the step chip and the heading, hence All.)
    expect(screen.getAllByText('Basic Info').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    // The distinct claim of THIS test, and the one the sibling does not make:
    // an un-onboarded account is never walked INTO the member app. Under the
    // skip mutant both of these fail.
    await waitFor(() => expect(screen.getByText('THE LOGIN PAGE')).toBeTruthy());
    expect(screen.queryByText('MEMBER APP')).toBeNull();
  });
});
