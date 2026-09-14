// A poster's code survives sign-in and setup, and is put first (ROADMAP 4b-ii-b).
//
// `/org/join?code=…` is the address a gym's poster points at. It needs a
// signed-in, set-up person, so everybody else is sent away from it — and the
// code used to be lost on the way. These walk the real guards, the real sign-in
// page, the real Google landing, the real setup wizard and the real join page
// from that address, so a code dropped anywhere on the way fails here. The
// other half of every test is that nothing is SENT until the person taps "Ask
// to join": a poster must not ask a gym to take whoever scans it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, configure } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

// The wizard waits on its loads before it shows a screen; in the full suite a
// page change can take longer than the library's one second.
configure({ asyncUtilTimeout: 3000 });
vi.setConfig({ testTimeout: 15_000 });

// One auth state for every guard and page. A proved sign-in code stores the
// session's user, as the real provider does, before the page moves on; and
// `updateUser` merges into it as the provider's does, so a finished setup is
// set up to the guards it passes next.
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
const JoinGym = (await import('./JoinGym')).default;
const { CarryJoinCode, ProtectedRoute, PublicRoute } = await import('../components/common/ProtectedRoute');
const { readJoinCode, rememberJoinCode } = await import('./landingRoute');

const EMPTY = {
  displayName: 'kd.test', weightGoal: null, fitnessGoals: [], age: null, gender: null, heightCm: null, weightKg: null,
  targetWeightKg: null, pace: null, dayActivity: null, fitnessLevel: null, pushUpsMax: null, plankHoldSeconds: null,
  trainingDays: null, sessionMinutes: null, availableEquipment: [], diet: null, mealsPerDay: null,
  onboardingCompleted: false, updatedAt: null,
};
/** Screens 1–6 answered, keeping the weight (so no target screen): stopped at
 *  Equipment. */
const HALFWAY = {
  ...EMPTY, weightGoal: 'maintain', age: 30, gender: 'female', heightCm: 165, weightKg: 70, dayActivity: 'sitting',
  fitnessLevel: 'beginner', trainingDays: 3, sessionMinutes: 45,
};
const ALL = { ...HALFWAY, availableEquipment: ['dumbbells'], diet: 'non_vegetarian', mealsPerDay: 3 };

const NO_HEALTH = {
  answered: false, hasCondition: null, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null,
};
const HEALTH_NO = {
  answered: true, hasCondition: false, checkFirst: null, safeMode: false, noCalorieCut: false,
  updatedAt: '2026-09-13T09:00:00.000Z',
};

const PENDING = {
  outcome: 'pending',
  org: { id: 'gym-1', slug: 'iron-house', name: 'Iron House', orgType: 'gym' },
  application: { applicationId: 'app-1', status: 'pending', expiresAt: null, orgCanConfirm: true, lastNudgeAt: null },
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
  consent.record = vi.fn(async (purpose) => ({
    data: {
      consent: {
        id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', purpose, wordingVersion: 'v2', wording: 'w',
        appVersion: 'web-dev', recordedAt: '2026-09-13T09:00:00.000Z',
      },
    },
  }));
}

/** The routes as App.jsx draws them, each page behind its own guard. */
const draw = (entry) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/auth/google/success" element={<GoogleAuthSuccess />} />
        <Route path="/onboarding" element={<ProtectedRoute requireOnboarding={false}><Onboarding /></ProtectedRoute>} />
        <Route
          path="/org/join"
          element={
            <CarryJoinCode>
              <ProtectedRoute>
                <JoinGym />
              </ProtectedRoute>
            </CarryJoinCode>
          }
        />
        <Route path="/dashboard" element={<p>MEMBER APP</p>} />
        <Route path="/console" element={<p>GYM CONSOLE</p>} />
      </Routes>
    </MemoryRouter>,
  );

const heading = (name) => screen.findByRole('heading', { name });
const codeBox = () => screen.getByLabelText('Your join code');
const CODE_LINE = 'Sign in to use your code';
/** The join page forgets the kept code in an effect, which React runs just
 *  after the page is drawn. After a move made from a sign-in or a finish, a
 *  busy machine can draw the heading and run that effect as two separate
 *  tasks, so a check made the moment the heading shows can land between them. */
const forgotten = () => waitFor(() => expect(readJoinCode()).toBeNull());

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

const NEW_ACCOUNT = { id: 'u1', displayName: 'kd.test', onboardingCompleted: false };
const SET_UP = { id: 'u1', displayName: 'kd.test', onboardingCompleted: true };

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  auth.user = null;
  auth.loading = false;
  auth.sendCode = vi.fn().mockResolvedValue({ resendAfterSeconds: 60, expiresInSeconds: 600 });
  orgService.join.mockResolvedValue({ data: PENDING });
  orgService.getMyApplications.mockResolvedValue({ data: { applications: [] } });
  orgService.getMine.mockResolvedValue({ data: { gyms: [] } });
  orgService.getHours.mockResolvedValue({ data: { hours: { mode: 'unset', timezone: 'UTC', week: [], closures: [] } } });
  serve();
});

afterEach(() => cleanup());

describe('signed out, a poster link', () => {
  it('reaches the sign-in page with its code kept and named, and sends nothing', async () => {
    draw('/org/join?code=k7qm2x');
    expect(await screen.findByText(CODE_LINE)).toBeTruthy();
    expect(screen.getByText('K7QM2X')).toBeTruthy();
    expect(readJoinCode()).toBe('K7QM2X');
    expect(orgService.join).not.toHaveBeenCalled();
  });

  it('then a NEW account lands on "Your code" first, filled in, and only the tap sends it', async () => {
    draw('/org/join?code=k7qm2x');
    await screen.findByText(CODE_LINE);
    await signInAs(NEW_ACCOUNT);

    await heading('Your code');
    expect(screen.getByText('Step 1 of 11')).toBeTruthy();
    expect(codeBox().value).toBe('K7QM2X');
    expect(orgService.join).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    expect(await screen.findByText("You've asked to join Iron House.")).toBeTruthy();
    expect(orgService.join).toHaveBeenCalledTimes(1);
    expect(orgService.join).toHaveBeenCalledWith({ code: 'K7QM2X' });
    expect(readJoinCode()).toBeNull();

    // On into the questions, and back: the code has gone, and the box with it.
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await heading('Your goal');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await heading('Your code');
    expect(codeBox().value).toBe('');
    expect(orgService.join).toHaveBeenCalledTimes(1);
  });

  it('then someone already set up lands on the join page with the code in the box, unsent', async () => {
    draw('/org/join?code=k7qm2x');
    await screen.findByText(CODE_LINE);
    await signInAs(SET_UP);

    await heading('Join with a code');
    expect(codeBox().value).toBe('K7QM2X');
    expect(orgService.join).not.toHaveBeenCalled();
    // The address holds it now, so the kept copy is not left to turn up again.
    await forgotten();
  });

  it('still takes the gym door to the console, and the line is not shown under it', async () => {
    draw('/org/join?code=k7qm2x');
    await screen.findByText(CODE_LINE);
    fireEvent.click(screen.getByText('Manage my gym, studio or clients'));
    expect(screen.queryByText(CODE_LINE)).toBeNull();
    fireEvent.click(screen.getByText('Train'));
    expect(screen.getByText(CODE_LINE)).toBeTruthy();
    fireEvent.click(screen.getByText('Manage my gym, studio or clients'));

    await signInAs(NEW_ACCOUNT);
    await screen.findByText('GYM CONSOLE');
    expect(orgService.join).not.toHaveBeenCalled();
  });

  it('keeps nothing from a link whose code is not a code, and the page says nothing about one', async () => {
    draw('/org/join?code=CALL-US-NOW');
    await screen.findByText('Get started.');
    expect(screen.queryByText(CODE_LINE)).toBeNull();
    expect(readJoinCode()).toBeNull();
  });

  // The newest link is the one the person means: an older code kept in the tab
  // must not be named, nor landed on, after a link that carries none.
  it('drops an OLDER kept code when the newer link has no code: sign-in neither names it nor lands on it', async () => {
    rememberJoinCode('AAAAAA');
    draw('/org/join');
    await screen.findByText('Get started.');
    expect(screen.queryByText(CODE_LINE)).toBeNull();
    expect(readJoinCode()).toBeNull();

    await signInAs(SET_UP);
    await screen.findByText('MEMBER APP');
    expect(orgService.join).not.toHaveBeenCalled();
  });

  it('drops an OLDER kept code when the newer link carries something that is not a code', async () => {
    rememberJoinCode('AAAAAA');
    draw('/org/join?code=CALL-US-NOW');
    await screen.findByText('Get started.');
    expect(screen.queryByText(CODE_LINE)).toBeNull();
    expect(screen.queryByText('AAAAAA')).toBeNull();
    expect(readJoinCode()).toBeNull();
  });

  it('keeps the NEWER poster when a second one is scanned', async () => {
    rememberJoinCode('AAAAAA');
    draw('/org/join?code=k7qm2x');
    await screen.findByText(CODE_LINE);
    expect(screen.getByText('K7QM2X')).toBeTruthy();
    expect(screen.queryByText('AAAAAA')).toBeNull();
    expect(readJoinCode()).toBe('K7QM2X');
  });
});

describe('coming back from Google', () => {
  it('lands a new account on "Your code" first, filled in', async () => {
    rememberJoinCode('k7qm2x');
    auth.user = NEW_ACCOUNT;
    draw('/auth/google/success');
    await heading('Your code');
    expect(codeBox().value).toBe('K7QM2X');
    expect(orgService.join).not.toHaveBeenCalled();
  });

  it('lands someone already set up on the join page with the code', async () => {
    rememberJoinCode('k7qm2x');
    auth.user = SET_UP;
    draw('/auth/google/success');
    await heading('Join with a code');
    expect(codeBox().value).toBe('K7QM2X');
    expect(orgService.join).not.toHaveBeenCalled();
  });
});

describe('signed in', () => {
  it('but not set up: the link goes into setup with "Your code" first, filled in', async () => {
    auth.user = NEW_ACCOUNT;
    draw('/org/join?code=k7qm2x');
    await heading('Your code');
    expect(screen.getByText('Step 1 of 11')).toBeTruthy();
    expect(codeBox().value).toBe('K7QM2X');
    expect(orgService.join).not.toHaveBeenCalled();
  });

  it('and set up: the link opens the join page itself, unsent', async () => {
    auth.user = SET_UP;
    draw('/org/join?code=k7qm2x');
    await heading('Join with a code');
    expect(codeBox().value).toBe('K7QM2X');
    expect(orgService.join).not.toHaveBeenCalled();
  });

  it('and set up, with a kept code, the sign-in page sends them on to the join page', async () => {
    rememberJoinCode('k7qm2x');
    auth.user = SET_UP;
    draw('/login');
    await heading('Join with a code');
    expect(codeBox().value).toBe('K7QM2X');
  });

  it('with no poster, setup opens where it always did, on "Your goal"', async () => {
    auth.user = NEW_ACCOUNT;
    draw('/onboarding');
    await heading('Your goal');
    expect(screen.getByText('Step 1 of 11')).toBeTruthy();
  });
});

describe('in setup with a poster code', () => {
  beforeEach(() => {
    auth.user = NEW_ACCOUNT;
  });

  it('someone who stopped halfway goes from "Your code" on to their first open question', async () => {
    serve(HALFWAY);
    rememberJoinCode('k7qm2x');
    draw('/onboarding');
    await heading('Your code');
    expect(screen.getByText('Step 1 of 10')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await heading('Equipment');
    expect(orgService.join).not.toHaveBeenCalled();
  });

  it('a reload keeps the code first until it is sent, and not after', async () => {
    rememberJoinCode('k7qm2x');
    draw('/onboarding');
    await heading('Your code');
    cleanup();

    draw('/onboarding');
    await heading('Your code');
    expect(codeBox().value).toBe('K7QM2X');
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await screen.findByText("You've asked to join Iron House.");
    cleanup();

    draw('/onboarding');
    await heading('Your goal');
  });

  it('a different code typed over it and sent still forgets the poster code', async () => {
    rememberJoinCode('k7qm2x');
    draw('/onboarding');
    await heading('Your code');
    fireEvent.change(codeBox(), { target: { value: 'zzzzzz' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await waitFor(() => expect(orgService.join).toHaveBeenCalledWith({ code: 'ZZZZZZ' }));
    await screen.findByText("You've asked to join Iron House.");
    expect(readJoinCode()).toBeNull();
  });

  /** From "Your code", with every question answered: Continue goes to the last
   *  screen, your plan, where Finish is, and the two disclaimer taps are what
   *  is still to do — the one on Health, and the plan's own (4c). "Go to
   *  Health" works as an Adjust, so Health offers the one tap back. */
  const readyToFinish = async () => {
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await heading('Your plan');
    fireEvent.click(screen.getByRole('button', { name: 'Go to Health' }));
    await heading('Health');
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have read and understood this' }));
    await waitFor(() => expect(consent.record).toHaveBeenCalledWith('health_step'));
    fireEvent.click(screen.getByRole('button', { name: 'Back to your plan' }));
    await heading('Your plan');
    fireEvent.click(screen.getByRole('checkbox', { name: 'I have read and understood this' }));
    await waitFor(() => expect(consent.record).toHaveBeenCalledWith('plan_screen'));
  };

  // Kd, 2026-09-13: the code the person scanned the poster for is not dropped
  // at Finish. They are set up now, and a set-up person with a code lands on
  // the join page with it, still to be sent by their own tap.
  it('finishing setup without sending it lands on the join page, the code in the box and still unsent', async () => {
    serve(ALL, HEALTH_NO);
    rememberJoinCode('k7qm2x');
    draw('/onboarding');
    await heading('Your code');
    await readyToFinish();
    expect(readJoinCode()).toBe('K7QM2X');

    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));
    await heading('Join with a code');
    expect(codeBox().value).toBe('K7QM2X');
    expect(orgService.join).not.toHaveBeenCalled();
    // The address holds it now, so the kept copy is not left to turn up again.
    await forgotten();
  });

  it('finishing setup after the code was sent goes on to the app, not back to the join page', async () => {
    serve(ALL, HEALTH_NO);
    rememberJoinCode('k7qm2x');
    draw('/onboarding');
    await heading('Your code');
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await screen.findByText("You've asked to join Iron House.");
    await readyToFinish();

    fireEvent.click(screen.getByRole('button', { name: /finish setup/i }));
    await screen.findByText('MEMBER APP');
    expect(orgService.join).toHaveBeenCalledTimes(1);
  });

  it('is not put first for someone already set up, sent back to answer a question', async () => {
    auth.user = SET_UP;
    serve(HALFWAY);
    rememberJoinCode('k7qm2x');
    draw('/onboarding');
    await heading('Equipment');
  });
});

// App.jsx is the route table and no test renders it (it pulls in every page),
// so `draw` above is a copy of four of its routes. Each is read from the source
// here and must be guarded exactly as `draw` guards it — otherwise App.jsx could
// drop `PublicRoute` from the sign-in page, or change the guard on setup, and
// every test above would still pass on the copy. (`AppLayout` is the one
// difference: the page's frame, which `draw` leaves out.) The path is a
// variable because the build rewrites `new URL('<literal>', import.meta.url)`
// into a served address.
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
    ['/org/join', '<CarryJoinCode><ProtectedRoute><AppLayout><JoinGym /></AppLayout></ProtectedRoute></CarryJoinCode>'],
  ])('%s', (path, element) => {
    expect(elementOf(path)).toBe(element);
  });
});
