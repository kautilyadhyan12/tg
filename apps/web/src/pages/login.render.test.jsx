// The login door, in a browser-shaped test.
//
// The pure helpers next door prove the decision; these prove the SCREEN offers
// it and that pressing a door actually changes where a real sign-in ends up.
// Both are needed: a source assertion can be spelled around, and the decision
// being right is worth nothing if the button is not wired to it.
//
// `PublicRoute` is exercised here too — it is the second place a signed-in
// person gets sent somewhere, and it used to spell the destination itself.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// One mutable auth state serves both subjects: `Login` reads `login`, and
// `ProtectedRoute` (which imports the same module) reads `user`/`loading`.
const authState = { user: null, loading: false, login: vi.fn() };
vi.mock('../context/AuthContext', () => ({ useAuth: () => authState }));

// The overlay's real 500 ms timer would make every assertion race a clock; the
// navigation it wraps is the subject, so it runs straight through.
vi.mock('../context/TransitionContext', () => ({
  useTransition: () => ({ triggerTransition: (cb) => cb() }),
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

const Login = (await import('./Login')).default;
const { PublicRoute } = await import('../components/common/ProtectedRoute');
const { GYM_DOOR, MEMBER_DOOR, readDoor } = await import('./landingRoute');

// Landing markers. Asserting on these rather than on a spied `useNavigate` means
// the real router resolves the real path — a destination that does not exist as
// a route would fail here rather than pass as a string comparison.
const drawLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<p>MEMBER APP</p>} />
        <Route path="/console" element={<p>GYM CONSOLE</p>} />
        <Route path="/onboarding" element={<p>SET UP YOUR PROFILE</p>} />
      </Routes>
    </MemoryRouter>,
  );

const drawPublicRoute = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicRoute>
              <p>THE LOGIN FORM</p>
            </PublicRoute>
          }
        />
        <Route path="/dashboard" element={<p>MEMBER APP</p>} />
        <Route path="/console" element={<p>GYM CONSOLE</p>} />
        <Route path="/onboarding" element={<p>SET UP YOUR PROFILE</p>} />
      </Routes>
    </MemoryRouter>,
  );

const pressDoor = (label) => fireEvent.click(screen.getByText(label));

const signIn = () => {
  fireEvent.change(document.querySelector('input[autocomplete="email"]'), {
    target: { value: 'kd@example.com' },
  });
  fireEvent.change(document.querySelector('input[autocomplete="current-password"]'), {
    target: { value: 'Passw0rd!' },
  });
  fireEvent.click(screen.getByText('Sign In'));
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  authState.user = null;
  authState.loading = false;
  authState.login = vi.fn().mockResolvedValue({ user: { id: 'u1', onboardingCompleted: true } });
});

afterEach(() => cleanup());

// ── The door on screen ──────────────────────────────────────────────────────

describe('the login page asks which door you came for', () => {
  it('offers both doors, with the member one chosen by default', () => {
    drawLogin();
    expect(screen.getByText("I'm a member").getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('I run a gym').getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps ONE email and password box whichever door is pressed', () => {
    // Two DOORS, one ACCOUNT: the door must not turn into a second sign-in form,
    // because the same person is deliberately both a member and an owner.
    drawLogin();
    pressDoor('I run a gym');
    expect(document.querySelectorAll('input[autocomplete="email"]').length).toBe(1);
    expect(document.querySelectorAll('input[autocomplete="current-password"]').length).toBe(1);
  });
});

// ── Where a sign-in ends up ─────────────────────────────────────────────────

describe('the door decides where signing in ends up', () => {
  it('takes the gym door to the console', async () => {
    drawLogin();
    pressDoor('I run a gym');
    signIn();
    expect(await screen.findByText('GYM CONSOLE')).toBeTruthy();
  });

  it('takes the member door to the app', async () => {
    drawLogin();
    signIn();
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
  });

  it('sends an unfinished MEMBER sign-in to the wizard first', async () => {
    authState.login = vi.fn().mockResolvedValue({ user: { id: 'u1', onboardingCompleted: false } });
    drawLogin();
    signIn();
    expect(await screen.findByText('SET UP YOUR PROFILE')).toBeTruthy();
  });

  it('takes an unfinished GYM sign-in straight to the console — the questionnaire waits', async () => {
    // Kd amendment 2026-08-19, and the exact moment he hit it in his own smoke:
    // he registered, pressed "I run a gym", and was handed five screens of
    // fitness questions before his business tool. The wizard now waits until
    // the owner crosses into the member app.
    authState.login = vi.fn().mockResolvedValue({ user: { id: 'u1', onboardingCompleted: false } });
    drawLogin();
    pressDoor('I run a gym');
    signIn();
    expect(await screen.findByText('GYM CONSOLE')).toBeTruthy();
  });
});

// ── Surviving a reload ──────────────────────────────────────────────────────

describe('the door survives leaving the page', () => {
  it('is remembered across a reload, so Continue with Google comes back to it', async () => {
    // THE ASSERTION THIS TEST EXISTS FOR. Google sign-in leaves the site
    // entirely, so a door held only in React state is gone by the time the
    // person comes back — and the button would have promised the console and
    // delivered the member app.
    drawLogin();
    pressDoor('I run a gym');
    expect(readDoor()).toBe(GYM_DOOR);

    cleanup();
    drawLogin();
    await waitFor(() =>
      expect(screen.getByText('I run a gym').getAttribute('aria-pressed')).toBe('true'),
    );
  });

  it('records the member door when it is pressed back', () => {
    drawLogin();
    pressDoor('I run a gym');
    pressDoor("I'm a member");
    expect(readDoor()).toBe(MEMBER_DOOR);
  });
});

// ── Coming back already signed in ───────────────────────────────────────────

describe('landing on the login page while already signed in', () => {
  it('follows the door rather than always the dashboard', async () => {
    authState.user = { id: 'u1', onboardingCompleted: true };
    window.sessionStorage.setItem('aihg_login_door', GYM_DOOR);
    drawPublicRoute();
    expect(await screen.findByText('GYM CONSOLE')).toBeTruthy();
  });

  it('goes to the member app when no door was chosen', async () => {
    authState.user = { id: 'u1', onboardingCompleted: true };
    drawPublicRoute();
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
  });

  it('still shows the form to somebody with no session', () => {
    drawPublicRoute();
    expect(screen.getByText('THE LOGIN FORM')).toBeTruthy();
  });
});
