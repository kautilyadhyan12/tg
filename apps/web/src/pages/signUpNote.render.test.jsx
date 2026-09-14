// "Before you start", the sign-up note (RULINGS 2026-09-07: one explicit tap at
// sign-up, stored with the time, the build and the words; ROADMAP 4d). Kd
// picked its own screen straight after signing in, once per account.
//
// The REAL provider and the REAL guard, with only the network stood in: the
// sign-in calls, the profile read whose flag the guard reads, and the tap's
// own request. So these prove the wiring end to end — a flag the provider
// forgot to carry, or a guard that stopped reading it, turns them red — not
// just that the screen draws.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, configure } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CURRENT_DISCLAIMER_VERSION, DISCLAIMER_WORDINGS } from '@app/shared';

configure({ asyncUtilTimeout: 3000 });

const authService = { getMe: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), logout: vi.fn() };
const http = { post: vi.fn() };
vi.mock('../api/authApi', () => ({ default: http, authService }));
const profile = { read: vi.fn() };
vi.mock('../api/userApi', () => ({
  userService: { getProfile: () => profile.read() },
  syncTimezone: vi.fn(async () => {}),
  resetTimezoneSync: vi.fn(),
}));
vi.mock('../utils/storage', () => ({ setCurrentUserId: vi.fn() }));
vi.mock('../sync/syncClient', () => ({ flushSyncQueue: vi.fn(async () => {}) }));
vi.mock('../context/TransitionContext', () => ({
  useTransition: () => ({ triggerTransition: (cb) => cb() }),
}));
vi.mock('react-hot-toast', () => {
  const plain = vi.fn();
  plain.error = vi.fn();
  plain.success = vi.fn();
  return { default: plain };
});

const toast = (await import('react-hot-toast')).default;
const { AuthProvider } = await import('../context/AuthContext');
const { CarryJoinCode, ProtectedRoute, PublicRoute } = await import('../components/common/ProtectedRoute');
const Login = (await import('./Login')).default;
const GoogleAuthSuccess = (await import('./GoogleAuthSuccess')).default;
const { APP_VERSION } = await import('../api/healthApi');
const { GYM_DOOR, readJoinCode, rememberDoor } = await import('./landingRoute');

const WORDS = DISCLAIMER_WORDINGS.sign_up[CURRENT_DISCLAIMER_VERSION.sign_up];

/** The join page's stand-in: it prints the code its address carries. */
function JoinPage() {
  const { search } = useLocation();
  return <p>JOIN PAGE {new URLSearchParams(search).get('code')}</p>;
}

/** The routes as App.jsx draws them, each page behind its own guard. */
const draw = (entry) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/auth/google/success" element={<GoogleAuthSuccess />} />
          <Route path="/onboarding" element={<ProtectedRoute requireOnboarding={false}><p>SET UP YOUR PROFILE</p></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><p>MEMBER APP</p></ProtectedRoute>} />
          <Route path="/console" element={<ProtectedRoute requireOnboarding={false} requireSignUpNote={false}><p>GYM CONSOLE</p></ProtectedRoute>} />
          <Route
            path="/org/join"
            element={
              <CarryJoinCode>
                <ProtectedRoute>
                  <JoinPage />
                </ProtectedRoute>
              </CarryJoinCode>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

const USER = { id: '3f0c1a52-6a3b-4a53-9a55-2d6f3f6b9b10', email: 'new@example.com', displayName: 'new' };

/** The profile the server answers with: the two gates, as this account stands. */
const profileSays = (facts) =>
  profile.read.mockResolvedValue({ data: { user: { ...USER, timezone: 'UTC', ...facts } } });

const signedIn = () => authService.getMe.mockResolvedValue({ data: { user: USER } });

/** Signs in by email code, the way a person does on "Get started". */
const signInByCode = async () => {
  authService.verifyCode.mockResolvedValue({ data: { user: USER, isNewAccount: true } });
  fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'new@example.com' } });
  fireEvent.click(screen.getByText('Continue with email'));
  fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '123456' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
};

const note = () => screen.findByRole('heading', { name: 'Before you start' });
const tick = () => screen.getByRole('checkbox', { name: 'I have read and understood this' });
const continueButton = () => screen.getByRole('button', { name: 'Continue' });

/** Ticks the note and waits for the server to have kept it. */
const tickIt = async () => {
  fireEvent.click(tick());
  await waitFor(() => expect(tick().getAttribute('aria-checked')).toBe('true'));
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  authService.getMe.mockRejectedValue(Object.assign(new Error('unauthorized'), { response: { status: 401 } }));
  authService.sendCode.mockResolvedValue({ data: { resendAfterSeconds: 60, expiresInSeconds: 600 } });
  authService.logout.mockResolvedValue({});
  http.post.mockImplementation(async (_url, body) => ({
    data: {
      consent: {
        id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        purpose: body.purpose,
        wordingVersion: body.wordingVersion,
        wording: DISCLAIMER_WORDINGS[body.purpose][body.wordingVersion],
        appVersion: body.appVersion,
        recordedAt: '2026-09-14T09:00:00.000Z',
      },
    },
  }));
});

afterEach(() => cleanup());

describe('the sign-up note', () => {
  it('comes straight after the email code, before setup, and nothing else shows until it is ticked and Continue is pressed', async () => {
    profileSays({ onboardingCompleted: false, signUpDisclaimerAgreed: false });
    draw('/login');
    await signInByCode();

    await note();
    expect(screen.getByText(WORDS)).toBeTruthy();
    expect(screen.queryByText('SET UP YOUR PROFILE')).toBeNull();

    // Continue waits for the tick, and says so.
    expect(screen.getByText('Tick this to continue.')).toBeTruthy();
    expect(continueButton().disabled).toBe(true);
    fireEvent.click(continueButton());
    expect(screen.queryByText('SET UP YOUR PROFILE')).toBeNull();
    expect(http.post).not.toHaveBeenCalled();

    await tickIt();
    // One tap, kept with the note's own words version and the build.
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.post).toHaveBeenCalledWith('/v1/users/me/consents', {
      purpose: 'sign_up',
      wordingVersion: CURRENT_DISCLAIMER_VERSION.sign_up,
      appVersion: APP_VERSION,
    });
    expect(screen.queryByText('Tick this to continue.')).toBeNull();
    expect(screen.queryByText('SET UP YOUR PROFILE')).toBeNull();

    fireEvent.click(continueButton());
    expect(await screen.findByText('SET UP YOUR PROFILE')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Before you start' })).toBeNull();
  });

  // Kd, 2026-09-14, from the click-through: *"it should show to someone who
  // trains not to someone who create organisation"*.
  it('is not shown on the console: someone who pressed the Manage door goes straight there', async () => {
    rememberDoor(GYM_DOOR);
    profileSays({ onboardingCompleted: false, signUpDisclaimerAgreed: false });
    draw('/login');
    await signInByCode();

    expect(await screen.findByText('GYM CONSOLE')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Before you start' })).toBeNull();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('is shown when someone who runs an organisation comes to train', async () => {
    signedIn();
    profileSays({ onboardingCompleted: false, signUpDisclaimerAgreed: false });
    draw('/console');
    expect(await screen.findByText('GYM CONSOLE')).toBeTruthy();
    cleanup();

    // The Train door lands an account not yet set up in setup: the note first.
    draw('/onboarding');
    await note();
    expect(screen.queryByText('SET UP YOUR PROFILE')).toBeNull();
    await tickIt();
    fireEvent.click(continueButton());
    expect(await screen.findByText('SET UP YOUR PROFILE')).toBeTruthy();
  });

  it('comes after a Google sign-in, which leaves the site and comes back signed in', async () => {
    signedIn();
    profileSays({ onboardingCompleted: true, signUpDisclaimerAgreed: false });
    draw('/auth/google/success');

    await note();
    expect(screen.queryByText('MEMBER APP')).toBeNull();
    await tickIt();
    fireEvent.click(continueButton());
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
  });

  it("keeps a poster link's address: someone set up goes on to the join page with its code", async () => {
    signedIn();
    profileSays({ onboardingCompleted: true, signUpDisclaimerAgreed: false });
    draw('/org/join?code=K7QM2X');

    await note();
    expect(screen.queryByText(/JOIN PAGE/)).toBeNull();
    await tickIt();
    fireEvent.click(continueButton());
    expect(await screen.findByText('JOIN PAGE K7QM2X')).toBeTruthy();
  });

  it("keeps a poster link's code for someone not set up, who goes on into setup with it", async () => {
    signedIn();
    profileSays({ onboardingCompleted: false, signUpDisclaimerAgreed: false });
    draw('/org/join?code=k7qm2x');

    await note();
    await waitFor(() => expect(readJoinCode()).toBe('K7QM2X'));
    await tickIt();
    fireEvent.click(continueButton());
    expect(await screen.findByText('SET UP YOUR PROFILE')).toBeTruthy();
    expect(readJoinCode()).toBe('K7QM2X');
  });

  it('never shows to an account that has ticked it', async () => {
    signedIn();
    profileSays({ onboardingCompleted: true, signUpDisclaimerAgreed: true });
    draw('/dashboard');

    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Before you start' })).toBeNull();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('never shows after the email code to an account that has ticked it', async () => {
    profileSays({ onboardingCompleted: true, signUpDisclaimerAgreed: true });
    draw('/login');
    await signInByCode();

    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Before you start' })).toBeNull();
  });

  it('shows when the profile cannot be read, rather than letting someone in with no record of the tap', async () => {
    signedIn();
    profile.read.mockRejectedValue(new Error('Network Error'));
    draw('/dashboard');

    await note();
    expect(screen.queryByText('MEMBER APP')).toBeNull();
  });

  it('says so when the tap cannot be kept, and holds Continue', async () => {
    signedIn();
    profileSays({ onboardingCompleted: true, signUpDisclaimerAgreed: false });
    http.post.mockRejectedValue(new Error('Network Error'));
    draw('/dashboard');

    await note();
    fireEvent.click(tick());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't reach the server. Check your connection and try again."));
    await waitFor(() => expect(tick().disabled).toBe(false));
    expect(tick().getAttribute('aria-checked')).toBe('false');
    expect(continueButton().disabled).toBe(true);
    fireEvent.click(continueButton());
    expect(screen.queryByText('MEMBER APP')).toBeNull();

    // It can be tried again, and then it goes on.
    http.post.mockReset();
    http.post.mockResolvedValue({
      data: {
        consent: {
          id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
          purpose: 'sign_up',
          wordingVersion: CURRENT_DISCLAIMER_VERSION.sign_up,
          wording: WORDS,
          appVersion: APP_VERSION,
          recordedAt: '2026-09-14T09:00:00.000Z',
        },
      },
    });
    await tickIt();
    fireEvent.click(continueButton());
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
  });

  it('offers Sign out, which ends the session and returns to Get started', async () => {
    signedIn();
    profileSays({ onboardingCompleted: true, signUpDisclaimerAgreed: false });
    draw('/dashboard');

    await note();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Get started.' })).toBeTruthy();
    expect(authService.logout).toHaveBeenCalledTimes(1);
    expect(http.post).not.toHaveBeenCalled();
  });
});
