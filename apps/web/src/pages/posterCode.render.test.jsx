// An old poster's link, now that join codes are switched off (ROADMAP 3c; spec Part 3
// §10.6). `/org/join?code=…` was the address a gym's poster pointed at, and the code
// used to be kept through sign-in and setup and put first. Now the address opens the
// invitations page, sign-in and setup read no kept code, and setup's "Your gym" screen
// shows the invitations with no code box. These walk the real guards, the real
// sign-in page, the real Google landing and the real setup wizard.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, configure } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';

// The wizard waits on its loads before it shows a screen; in the full suite a
// page change can take longer than the library's one second.
configure({ asyncUtilTimeout: 3000 });
vi.setConfig({ testTimeout: 15_000 });

// One auth state for every guard and page. A proved sign-in code stores the
// session's user, as the real provider does, before the page moves on; and
// `updateUser` merges into it as the provider's does.
const auth = {
  user: null,
  loading: false,
  sendCode: vi.fn(),
  verifyCode: vi.fn(),
  updateUser: vi.fn((patch) => {
    auth.user = { ...auth.user, ...patch };
  }),
  logout: vi.fn(() => Promise.resolve()),
};
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../context/TransitionContext', () => ({
  useTransition: () => ({ triggerTransition: (cb) => cb() }),
}));
vi.mock('react-hot-toast', () => {
  const plain = vi.fn();
  plain.error = vi.fn();
  plain.success = vi.fn();
  return { default: plain };
});
vi.mock('../api/orgsApi', async (importOriginal) => ({
  ...(await importOriginal()),
  orgService: {
    join: vi.fn(),
    getMyApplications: vi.fn(),
    getInvitations: vi.fn(),
    getMine: vi.fn(),
    nudgeApplication: vi.fn(),
    getHours: vi.fn(),
  },
}));
const onboarding = {};
vi.mock('../api/onboardingApi', async (importOriginal) => ({ ...(await importOriginal()), onboardingService: onboarding }));
const health = {};
const consent = {};
vi.mock('../api/healthApi', async (importOriginal) => ({
  ...(await importOriginal()),
  healthService: health,
  consentService: consent,
}));

const { orgService } = await import('../api/orgsApi');
const Login = (await import('./Login')).default;
const GoogleAuthSuccess = (await import('./GoogleAuthSuccess')).default;
const Onboarding = (await import('./Onboarding')).default;
const { ProtectedRoute, PublicRoute } = await import('../components/common/ProtectedRoute');
const { readJoinCode, rememberJoinCode } = await import('./landingRoute');
const { forgetInvitations, sayNotNow } = await import('../components/gym/invitationsStore');

const EMPTY = {
  displayName: 'kd.test', weightGoal: null, fitnessGoals: [], age: null, gender: null, heightCm: null, weightKg: null,
  targetWeightKg: null, pace: null, dayActivity: null, fitnessLevel: null, pushUpsMax: null, plankHoldSeconds: null,
  trainingDays: null, sessionMinutes: null, availableEquipment: [], diet: null, mealsPerDay: null,
  onboardingCompleted: false, updatedAt: null,
};
/** Every question answered, keeping the weight (so no target screen). */
const ALL = {
  ...EMPTY, weightGoal: 'maintain', age: 30, gender: 'female', heightCm: 165, weightKg: 70, dayActivity: 'sitting',
  fitnessLevel: 'beginner', trainingDays: 3, sessionMinutes: 45, availableEquipment: ['dumbbells'],
  diet: 'non_vegetarian', mealsPerDay: 3,
};

const NO_HEALTH = {
  answered: false, hasCondition: null, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null,
};
const HEALTH_NO = {
  answered: true, hasCondition: false, checkFirst: null, safeMode: false, noCalorieCut: false,
  updatedAt: '2026-09-13T09:00:00.000Z',
};

/** The answers and health routes, holding what they are sent. The plan number
 *  plays no part here, so the stand-in never makes one. */
let stored;
function serve(answers = EMPTY, screening = NO_HEALTH) {
  stored = { answers: { ...answers }, health: screening };
  const reply = () => ({ data: { answers: { ...stored.answers }, plan: null, missing: [] } });
  onboarding.get = vi.fn(async () => reply());
  onboarding.patch = vi.fn(async (body) => {
    Object.assign(stored.answers, body);
    return reply();
  });
  health.get = vi.fn(async () => ({ data: { healthScreening: stored.health } }));
  health.put = vi.fn();
  consent.record = vi.fn();
}

/** The routes as App.jsx draws them, each page behind its own guard. */
const draw = (entry) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/auth/google/success" element={<GoogleAuthSuccess />} />
        <Route path="/onboarding" element={<ProtectedRoute requireOnboarding={false}><Onboarding /></ProtectedRoute>} />
        <Route path="/org/join" element={<Navigate to="/invitations" replace />} />
        <Route path="/invitations" element={<ProtectedRoute requireInvitations={false}><p>INVITATIONS PAGE</p></ProtectedRoute>} />
        <Route path="/dashboard" element={<p>MEMBER APP</p>} />
        <Route path="/console" element={<p>GYM CONSOLE</p>} />
      </Routes>
    </MemoryRouter>,
  );

const heading = (name) => screen.findByRole('heading', { name });
const CODE_LINE = 'Sign in to use your code';
const noCodeBox = () => expect(screen.queryByLabelText(/your join code/i)).toBeNull();

/** Signs in by email code as `user`, the way a person does on the page. */
const signInAs = async (user) => {
  auth.verifyCode = vi.fn(async () => {
    auth.user = user;
    return { user, isNewAccount: user.onboardingCompleted === false };
  });
  fireEvent.change(document.querySelector('input[autocomplete="email"]'), { target: { value: 'new@example.com' } });
  fireEvent.click(screen.getByText('Continue with email'));
  await screen.findByText('6-digit code');
  fireEvent.change(document.querySelector('input[autocomplete="one-time-code"]'), { target: { value: '123456' } });
  fireEvent.click(screen.getByText('Continue'));
};

// Both have ticked the sign-up note, which its own test file covers.
const NEW_ACCOUNT = { id: 'u1', displayName: 'kd.test', onboardingCompleted: false, signUpDisclaimerAgreed: true };
const SET_UP = { id: 'u1', displayName: 'kd.test', onboardingCompleted: true, signUpDisclaimerAgreed: true };

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  forgetInvitations();
  auth.user = null;
  auth.loading = false;
  auth.sendCode = vi.fn().mockResolvedValue({ resendAfterSeconds: 60, expiresInSeconds: 600 });
  orgService.getInvitations.mockResolvedValue({ data: { address: 'new@example.com', addressProved: true, invitations: [] } });
  orgService.getMine.mockResolvedValue({ data: { orgs: [], formerOrgs: [] } });
  orgService.getHours.mockResolvedValue({ data: { hours: { mode: 'unset', timezone: 'UTC', week: [], closures: [] } } });
  serve();
});

afterEach(() => cleanup());

describe('signed out, an old poster link', () => {
  it('reaches the sign-in page, which names no code and keeps none', async () => {
    draw('/org/join?code=k7qm2x');
    await screen.findByText('Continue with email');
    expect(screen.queryByText(CODE_LINE)).toBeNull();
    expect(screen.queryByText('K7QM2X')).toBeNull();
    expect(readJoinCode()).toBeNull();
  });

  it('then someone already set up lands in the app, never on a join page', async () => {
    draw('/org/join?code=k7qm2x');
    await screen.findByText('Continue with email');
    await signInAs(SET_UP);
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
  });

  it('then a NEW account starts setup at its first question, not at a code', async () => {
    draw('/org/join?code=k7qm2x');
    await screen.findByText('Continue with email');
    await signInAs(NEW_ACCOUNT);
    await heading('Your goal');
    expect(screen.getByText('Step 1 of 11')).toBeTruthy();
    noCodeBox();
  });
});

describe('a code an older visit kept in this browser', () => {
  beforeEach(() => {
    rememberJoinCode('k7qm2x');
  });

  it('is not named on the sign-in page, and does not steer where sign-in lands', async () => {
    draw('/login');
    await screen.findByText('Continue with email');
    expect(screen.queryByText(CODE_LINE)).toBeNull();
    await signInAs(SET_UP);
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
  });

  it('does not steer the Google return either', async () => {
    auth.user = SET_UP;
    draw('/auth/google/success');
    expect(await screen.findByText('MEMBER APP')).toBeTruthy();
  });

  it('is not put first in setup', async () => {
    auth.user = NEW_ACCOUNT;
    draw('/onboarding');
    await heading('Your goal');
    noCodeBox();
  });
});

describe('signed in, an old poster link', () => {
  it('opens the invitations page for someone set up', async () => {
    auth.user = SET_UP;
    draw('/org/join?code=k7qm2x');
    expect(await screen.findByText('INVITATIONS PAGE')).toBeTruthy();
  });

  it('goes into setup for someone not set up', async () => {
    auth.user = NEW_ACCOUNT;
    draw('/org/join?code=k7qm2x');
    await heading('Your goal');
  });
});

describe('setup\'s "Your gym" screen', () => {
  it('shows the invitations waiting for this address and no code box', async () => {
    auth.user = NEW_ACCOUNT;
    serve(ALL, HEALTH_NO);
    // Past the "You're invited" screen that comes before setup, as "Not now" leaves it.
    sayNotNow(NEW_ACCOUNT.id);
    orgService.getInvitations.mockResolvedValue({
      data: {
        address: 'new@example.com',
        addressProved: true,
        invitations: [
          {
            id: '6c1f8a2e-6a1b-4f43-9a55-0d6f3f6b9b11',
            state: 'pending',
            gym: { id: '7d2a9b3f-7b2c-4a54-8b66-1e7a4a7c0c22', name: 'Iron House', city: 'Leeds', orgType: 'gym' },
            canTakeMembers: true,
            notMe: false,
            yourPlan: null,
          },
        ],
      },
    });
    draw('/onboarding');
    await heading('Your plan');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await heading('Your gym');
    expect(screen.getByText('Invited by a gym, studio or trainer?')).toBeTruthy();
    expect(await screen.findAllByText(/Iron House/)).not.toHaveLength(0);
    noCodeBox();
    expect(screen.queryByRole('button', { name: /ask to join/i })).toBeNull();
    expect(orgService.join).not.toHaveBeenCalled();
    expect(orgService.getMyApplications).not.toHaveBeenCalled();
  });
});

// App.jsx is the route table and no test renders it (it pulls in every page),
// so `draw` above is a copy of its routes. Each is read from the source here and
// must be guarded exactly as `draw` guards it. (`AppLayout` is the one difference:
// the page's frame, which `draw` leaves out.)
describe('App.jsx guards these routes as the tests above draw them', () => {
  const APP = '../App.jsx';
  const stripComments = (raw) => raw.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const src = stripComments(readFileSync(fileURLToPath(new URL(APP, import.meta.url)), 'utf8'));
  const elementOf = (path) => {
    const routes = [...src.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]*?)\}\s*\/>/g)];
    const found = routes.filter((r) => r[1] === path);
    return found.length === 1 ? found[0][2].replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim() : `${found.length} routes`;
  };

  it.each([
    ['/login', '<PublicRoute><Login /></PublicRoute>'],
    ['/auth/google/success', '<GoogleAuthSuccess />'],
    ['/onboarding', '<ProtectedRoute requireOnboarding={false}><Onboarding /></ProtectedRoute>'],
    ['/org/join', '<Navigate to="/invitations" replace />'],
    ['/invitations', '<ProtectedRoute requireInvitations={false}><AppLayout><Invitations /></AppLayout></ProtectedRoute>'],
  ])('%s', (path, element) => {
    expect(elementOf(path)).toBe(element);
  });
});
