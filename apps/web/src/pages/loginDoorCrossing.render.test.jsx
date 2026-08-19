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

const ConsoleLayout = (await import('../components/console/ConsoleLayout')).default;
const Sidebar = (await import('../components/common/Sidebar')).default;
const Onboarding = (await import('./Onboarding')).default;

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
});
afterEach(cleanup);

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
    expect(screen.queryByText(/my gym/i)).toBeNull();
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
