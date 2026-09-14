// Onboarding v2, every screen, drawn in a browser-shaped test. The server is a
// small stand-in that stores what it is sent and answers with a plan only once
// the eight core answers are in, as the real route does (the real route is
// proved in apps/api/test/users.onboarding.routes.test.ts). What is pinned
// here is the SCREEN: a tap or a wheel saves at once and a wheel saves nothing
// until it is touched, the name box saves when it is left, the number appears
// only when the server has one and can show how it was worked out, the target
// screen is asked only for a goal that moves the weight, "No equipment" stands
// alone, and Finish opens the training side only when the server agrees.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within, configure } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHECK_FIRST_OPTIONS, DISCLAIMER_WORDINGS, HEALTH_QUESTION, HEALTH_QUESTION_NOTE, missingPlanInputSchema } from '@app/shared';

// These tests walk the wizard save by save. Alone, the longest takes about
// two seconds; in the full suite, with every other file running at once, a
// save and the page change after it can take longer than the one second the
// library waits and the five seconds a test is given. The waits are longer
// here, not the checks weaker: a screen that never comes still fails.
configure({ asyncUtilTimeout: 3000 });
vi.setConfig({ testTimeout: 15_000 });

// One auth state serves both the page and the app's own route guard.
const auth = { user: null, loading: false, updateUser: vi.fn(), logout: vi.fn(() => Promise.resolve()) };
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
// Screen 11 draws the join door's own two components (4b-ii), which read on
// mount. `...actual` keeps `errorText`, which the page itself uses.
vi.mock('../api/orgsApi', async (importOriginal) => ({
  ...(await importOriginal()),
  orgService: {
    join: vi.fn(),
    getMyApplications: vi.fn(() => Promise.resolve({ data: { applications: [] } })),
    getMine: vi.fn(() => Promise.resolve({ data: { gyms: [] } })),
    nudgeApplication: vi.fn(),
    getHours: vi.fn(() => Promise.resolve({ data: { hours: { mode: 'unset', timezone: 'UTC', week: [], closures: [] } } })),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/onboardingApi', async (importOriginal) => ({ ...(await importOriginal()), onboardingService: svc }));
// Screen 8's answer and its tap live on their own routes (4b-i), so the
// stand-in has a second half: the screening, which the wizard reads before it
// puts anybody on a screen, and the consent log, which takes the tap.
const health = {};
const consent = {};
vi.mock('../api/healthApi', async (importOriginal) => ({
  ...(await importOriginal()),
  healthService: health,
  consentService: consent,
}));

const toast = (await import('react-hot-toast')).default;
const { orgService } = await import('../api/orgsApi');
const { DIETS } = await import('./onboarding/onboardingModel');
const Onboarding = (await import('./Onboarding')).default;
const { ProtectedRoute } = await import('../components/common/ProtectedRoute');

const EMPTY = {
  displayName: 'kd.test', weightGoal: null, fitnessGoals: [], age: null, gender: null, heightCm: null, weightKg: null,
  targetWeightKg: null, pace: null, dayActivity: null, fitnessLevel: null, pushUpsMax: null, plankHoldSeconds: null,
  trainingDays: null, sessionMinutes: null, availableEquipment: [], diet: null, mealsPerDay: null,
  onboardingCompleted: false, updatedAt: null,
};
const ALL = {
  ...EMPTY, weightGoal: 'lose', age: 30, gender: 'female', heightCm: 165, weightKg: 70, targetWeightKg: 65,
  pace: 'steady', dayActivity: 'sitting', fitnessLevel: 'beginner', trainingDays: 3, sessionMinutes: 45,
  availableEquipment: ['dumbbells'], diet: 'non_vegetarian', mealsPerDay: 3,
};

const UNANSWERED_HEALTH = {
  answered: false, hasCondition: null, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null,
};
/** The screening the server would store for one answer, derived as it derives
 *  it: any yes stops the calorie cut, and only a yes with "not yet" is Safe
 *  mode (RULINGS 2026-09-09). */
const screeningOf = ({ hasCondition, checkFirst = null }) => ({
  answered: true,
  hasCondition,
  checkFirst: hasCondition ? checkFirst : null,
  safeMode: hasCondition === true && checkFirst === 'not_yet',
  noCalorieCut: hasCondition === true,
  updatedAt: '2026-09-12T09:00:00.000Z',
});

/** The route's golden person (users.onboarding.routes.test.ts), working and all. */
const PLAN = {
  restingBurnKcal: 1420, dailyBurnKcal: 1817, targetKcal: 1267, dailyChangeKcal: -550,
  dailyChangeKcalByPace: { gentle: -275, steady: -550, brisk: -617 }, proteinG: 140,
  carbsG: 98, fatG: 35, plannedTargetKg: 65, daysToTarget: 70, finishDate: '2026-11-19', flags: [],
  workings: {
    resting: { formula: 'female', weightKg: 70, heightCm: 165, age: 30, constant: -161, kcal: 1420 },
    day: { activity: 'sitting', factor: 1.2, kcal: 1704 },
    training: { kcalPerKgHour: 5, weightKg: 70, trainingDays: 3, sessionMinutes: 45, kcal: 113 },
    change: { pace: 'steady', kgPerWeek: 0.5, kcalPerKg: 7700, kcal: -550 },
    beforeFloorKcal: 1267,
    floorKcal: 1200,
    protein: { gPerKg: 2, weightKg: 70, referenceBmi: null, wantedG: 140, buildMuscle: false },
    fatShare: 0.25,
    carbsFloorG: 50,
    finish: { kgToMove: 5, kcalPerKg: 7700 },
  },
};

function missingOf(a) {
  const moves = a.weightGoal === 'lose' || a.weightGoal === 'gain';
  const present = {
    goal: a.weightGoal !== null, age: a.age !== null, gender: a.gender !== null, heightCm: a.heightCm !== null,
    weightKg: a.weightKg !== null, targetWeightKg: !moves || a.targetWeightKg !== null,
    pace: !moves || a.pace !== null, dayActivity: a.dayActivity !== null,
    trainingDays: a.trainingDays !== null, sessionMinutes: a.sessionMinutes !== null,
  };
  return missingPlanInputSchema.options.filter((k) => !present[k]);
}

const refusal = (missing) =>
  Object.assign(new Error('Request failed with status code 409'), {
    response: {
      status: 409,
      data: { error: 'onboarding_incomplete', message: 'Answer every question before you finish.', requestId: 'r1', missing },
    },
  });

let server;
function serve(initial = {}, screening = UNANSWERED_HEALTH) {
  // `plan` is the number the stand-in answers with once nothing is missing; a
  // test that needs the server to raise a line sets its own.
  server = { answers: { ...EMPTY, ...initial }, health: screening, plan: PLAN, failNext: null, failHealth: null };
  const reply = () => {
    const missing = missingOf(server.answers);
    return { data: { answers: { ...server.answers }, plan: missing.length > 0 ? null : server.plan, missing } };
  };
  svc.get = vi.fn(async () => reply());
  svc.patch = vi.fn(async (body) => {
    if (server.failNext) {
      const err = server.failNext;
      server.failNext = null;
      throw err;
    }
    if (body.onboardingCompleted === true) {
      // What the real route refuses on: everything the plan needs, plus the
      // three the plan itself can do without — the health question (4b-i) and
      // screen 9's two food answers (4b-ii).
      const after = { ...server.answers, ...body };
      const missing = [
        ...missingOf(after),
        ...(server.health.answered ? [] : ['health']),
        ...(after.diet === null ? ['diet'] : []),
        ...(after.mealsPerDay === null ? ['mealsPerDay'] : []),
      ];
      if (missing.length > 0) throw refusal(missing);
    }
    Object.assign(server.answers, body);
    return reply();
  });
  health.get = vi.fn(async () => ({ data: { healthScreening: server.health } }));
  health.put = vi.fn(async (body) => {
    if (server.failHealth) {
      const err = server.failHealth;
      server.failHealth = null;
      throw err;
    }
    server.health = screeningOf(body);
    return { data: { healthScreening: server.health } };
  });
  consent.record = vi.fn(async (purpose) => ({
    data: {
      consent: {
        id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', purpose, wordingVersion: 'v2', wording: 'w',
        appVersion: 'web-dev', recordedAt: '2026-09-12T09:00:00.000Z',
      },
    },
  }));
}

/** Onboarding behind the guard App.jsx puts it behind, so a redirect added to
 *  that guard would show here. */
const draw = (entry = '/onboarding') =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute requireOnboarding={false}>
              <Onboarding />
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<p>LOGIN</p>} />
        <Route path="/dashboard" element={<p>MEMBER APP</p>} />
        <Route path="/nutrition" element={<p>NUTRITION</p>} />
      </Routes>
    </MemoryRouter>,
  );
/** Arriving from the macro rings' "Answer now". */
const FROM_RINGS = { pathname: '/onboarding', state: { returnTo: '/nutrition' } };

const heading = (name) => screen.findByRole('heading', { name });
const button = (name) => screen.getByRole('button', { name });
const tap = (name) => fireEvent.click(button(name));
const pressed = (name) => button(name).getAttribute('aria-pressed');
const panel = () => screen.getByRole('region', { name: 'Your plan' });
const spin = (name) => screen.getByRole('spinbutton', { name });
/** Taps a number on a wheel, as a finger would. */
const tapRow = (wheel, text) => fireEvent.click(within(spin(wheel)).getByText(text));
const nameBox = () => screen.getByLabelText('What should we call you?');
const saved = (body) => waitFor(() => expect(svc.patch).toHaveBeenCalledWith(body));
/** What the server holds. Answers given while a save is out travel together
 *  in the next one (the queue), so a test that wants "it was saved" reads the
 *  server, not the shape of each request. */
const stored = (answers) => waitFor(() => expect(server.answers).toMatchObject(answers));
/** Longer than a wheel takes to settle after its last scroll. */
const settleWheels = () => new Promise((resolve) => setTimeout(resolve, 250));
const next = async (title) => {
  tap(/continue/i);
  await heading(title);
};
/** From the health screen on to the LAST one, your plan, where Finish lives
 *  (4c). The screens in between are answered in these fixtures, so it is
 *  Continue, three times. */
const toPlan = async () => {
  await next('Food');
  await next('Your code');
  await next('Your plan');
};
/** Back to the health screen from where a person with every answer in lands —
 *  the last screen, their plan — by the step bar, which reaches any screen
 *  already answered. */
const onHealth = async () => {
  await heading('Your plan');
  tap('Health');
  await heading('Health');
};

/** A disclaimer tap. There are two, and Finish waits for both: the health
 *  step's, made on screen 8, and the plan screen's own (4c). Each screen has
 *  only its own box. */
const agreeBox = () => screen.getByRole('checkbox', { name: 'I have read and understood this' });
const agree = async () => {
  fireEvent.click(agreeBox());
  await waitFor(() => expect(consent.record).toHaveBeenCalledWith('health_step'));
};
/** The plan screen's tap, unless it is already made on this visit. */
const agreePlan = async () => {
  if (agreeBox().getAttribute('aria-checked') === 'true') return;
  fireEvent.click(agreeBox());
  await waitFor(() => expect(consent.record).toHaveBeenCalledWith('plan_screen'));
  await waitFor(() => expect(agreeBox().getAttribute('aria-checked')).toBe('true'));
};
/** On to the plan, its own note ticked: at Finish, which then waits only on
 *  whatever the test is about. */
const toFinish = async () => {
  await toPlan();
  await agreePlan();
};
/** From a screen the plan sent the person to — an Adjust, or a "Go to …" under
 *  Finish — straight back to it: one tap, the button that screen offers. */
const backToPlan = async () => {
  await waitFor(() => expect(button('Back to your plan').disabled).toBe(false));
  tap('Back to your plan');
  await heading('Your plan');
};
const backToFinish = async () => {
  await backToPlan();
  await agreePlan();
};
/** The health step's tap, reached FROM the last screen by the sentence that
 *  names it, and back again — the walk a person makes when they get to Finish
 *  without having ticked it (4b-ii moved Finish two screens on from the tap). */
const agreeOnHealth = async () => {
  tap('Go to Health');
  await heading('Health');
  await agree();
  await backToFinish();
};

/** Screen 2 in kilograms and centimetres, each answer a tap on its wheel. */
const aboutYou = async () => {
  tap(/kg · cm/);
  tapRow('Age', '30');
  tap(/^Female$/);
  tapRow('Height in centimetres', '165');
  tapRow('Weight in whole kilograms', '70');
  await stored({ age: 30, gender: 'female', heightCm: 165, weightKg: 70 });
};

beforeEach(() => {
  // Signed in, setup not finished; the app and the server agree on the name.
  auth.user = { onboardingCompleted: false, displayName: 'kd.test' };
  auth.updateUser.mockClear();
  auth.logout.mockClear();
  toast.error.mockClear();
  // Screen 11's own reads and its one write (4b-ii): nobody is in a gym, and
  // no code has been sent, unless a test says so.
  orgService.join.mockReset();
  orgService.join.mockRejectedValue(new Error('no join expected in this test'));
  orgService.getMyApplications.mockResolvedValue({ data: { applications: [] } });
  orgService.getMine.mockResolvedValue({ data: { gyms: [] } });
});
afterEach(() => cleanup());

describe('onboarding screens 1–7', () => {
  it('starts a new person on the goal screen, with no number box until there is a number', async () => {
    serve();
    draw();
    await heading('Your goal');
    expect(screen.queryByRole('region', { name: 'Your plan' })).toBeNull();
    expect(button(/continue/i).disabled).toBe(true);
  });

  it('saves a tap at once, and shows the number only once "your week" is answered', async () => {
    serve();
    draw();
    await heading('Your goal');
    tap(/Lose weight/);
    await saved({ weightGoal: 'lose' });
    await next('About you');
    await aboutYou();

    await next('Your target');
    tapRow('Target weight in whole kilograms', '65');
    tap(/^Steady/);
    await stored({ targetWeightKg: 65, pace: 'steady' });
    await next('Your day');
    tap(/Mostly sitting/);
    await next('Your training');
    tap(/^Beginner/);
    await next('Your week');
    expect(screen.queryByRole('region', { name: 'Your plan' })).toBeNull();

    tap('3 days a week');
    tap('45 min');
    await waitFor(() => expect(panel().textContent).toContain('1,267kcal a day'));
    expect(panel().textContent).toContain('550 less than the 1,817 you burn a day.');
    expect(panel().textContent).toContain('Reach 65 kg around Nov 19, 2026.');
    expect(panel().textContent).toContain('not medical advice');
    expect(panel().textContent).not.toContain('follow their advice');
  });

  it('opens "How is this worked out?" under the number, with the server\'s own steps', async () => {
    serve({ ...ALL, availableEquipment: [] });
    draw();
    await heading('Equipment');
    expect(panel().textContent).not.toContain('Resting burn');
    expect(button('How is this worked out?').getAttribute('aria-expanded')).toBe('false');
    tap('How is this worked out?');
    expect(button('How is this worked out?').getAttribute('aria-expanded')).toBe('true');
    const text = panel().textContent;
    expect(text).toContain('10 × 70 kg + 6.25 × 165 cm − 5 × 30 years − 161 = 1,420 kcal');
    expect(text).toContain('1,704 + 113 = 1,817 kcal a day');
    expect(text).toContain('1,817 − 550 = 1,267 kcal a day');
    expect(text).toContain('Mifflin-St Jeor equation (1990)');
    expect(text).toContain('Each step is rounded to a whole calorie or gram.');
    expect(text).not.toContain('follow their advice');
  });

  it('jumps straight to any screen already reached from the step bar', async () => {
    serve({ ...ALL, availableEquipment: [] });
    draw();
    await heading('Equipment');
    tap('Your goal');
    await heading('Your goal');
    tap('Your week'); // forward, to a screen already reached
    await heading('Your week');
  });

  it('never lets the step bar skip a question', async () => {
    serve({ weightGoal: 'lose' });
    draw();
    await heading('About you');
    expect(button('Your goal').disabled).toBe(false);
    expect(button('Your target').disabled).toBe(true);
    expect(button('Equipment').disabled).toBe(true);
  });

  it('does not ask for a target when the weight choice keeps the weight, Build muscle ticked or not', async () => {
    // Building muscle is not gaining weight (RULINGS 2026-09-11).
    serve();
    draw();
    await heading('Your goal');
    tap(/Build muscle/);
    await saved({ fitnessGoals: ['muscle_gain'] });
    tap(/Keep my weight/);
    await stored({ weightGoal: 'maintain', fitnessGoals: ['muscle_gain'] });
    await next('About you');
    expect(screen.getByText('Step 2 of 10')).toBeTruthy(); // eleven screens, less the target this goal never asks
    await aboutYou();
    await next('Your day');
    tap(/back/i);
    await heading('About you');
  });

  it('brings a returning person back to the first screen they have not answered', async () => {
    serve({ weightGoal: 'lose', age: 30, gender: 'female', heightCm: 165, weightKg: 70 });
    draw();
    await heading('Your target');
  });

  it('keeps the plan number on every screen once it exists', async () => {
    serve({ ...ALL, availableEquipment: [] });
    draw();
    await heading('Equipment');
    expect(panel().textContent).toContain('1,267kcal a day');
  });

  it('opens "About you" with the name the account has, and saves a new one when the box is left', async () => {
    serve({ weightGoal: 'maintain' });
    draw();
    await heading('About you');
    // The name opens the screen, before the units and the numbers.
    const box = nameBox();
    expect(box.compareDocumentPosition(button(/kg · cm/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.value).toBe('kd.test');
    fireEvent.change(box, { target: { value: '  Kd  ' } });
    fireEvent.blur(box);
    await saved({ displayName: 'Kd' });
    // A name is never blank: an empty box says so and saves nothing.
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.blur(box);
    expect(await screen.findByText('Type the name we should call you.')).toBeTruthy();
    expect(svc.patch.mock.calls.filter(([body]) => 'displayName' in body)).toHaveLength(1);
  });

  it('will not leave "About you" while the name box is blank', async () => {
    serve({ ...ALL, availableEquipment: [] });
    draw();
    await heading('Equipment');
    tap('About you');
    await heading('About you');
    fireEvent.change(nameBox(), { target: { value: '' } });
    tap(/continue/i);
    expect(await screen.findByText('Type the name we should call you.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'About you' })).toBeTruthy();
    expect(svc.patch.mock.calls.some(([body]) => 'displayName' in body)).toBe(false);
  });

  it('the wheels read "Not set" and save nothing until they are touched', async () => {
    serve({ weightGoal: 'maintain' });
    draw();
    await heading('About you');
    tap(/kg · cm/);
    for (const wheel of ['Age', 'Height in centimetres', 'Weight in whole kilograms', 'Weight, tenths of a kilogram']) {
      expect(spin(wheel).getAttribute('aria-valuetext'), wheel).toBe('Not set');
    }
    await settleWheels();
    expect(svc.patch).not.toHaveBeenCalled();
    // Nobody under 16 can be picked: the wheel starts there.
    expect(within(spin('Age')).queryByText('15')).toBeNull();
    // The first touch saves: + moves one row on from the resting 30.
    tap('Age: one more');
    await saved({ age: 31 });
    expect(spin('Age').getAttribute('aria-valuetext')).toBe('31');
  });

  it('a flick saves the number the wheel settles on; a scroll the person did not make saves nothing', async () => {
    serve({ weightGoal: 'maintain' });
    draw();
    await heading('About you');
    const age = spin('Age');
    age.scrollTop = 40 * 20;
    fireEvent.scroll(age);
    await settleWheels();
    expect(svc.patch).not.toHaveBeenCalled();
    expect(age.scrollTop).toBe(40 * 14); // back on its resting row, 30
    // A flick on a wheel the person has touched: row 20 of 16…120 is 36.
    fireEvent.focus(age);
    fireEvent.wheel(age);
    age.scrollTop = 40 * 20;
    fireEvent.scroll(age);
    await saved({ age: 36 });
  });

  it('an untouched wheel lets the page scroll past it, so scrolling the page never sets an answer', async () => {
    // Screen 2 is taller than a laptop or a phone and its wheels are full
    // width: a wheel that took every scroll over it would set the age, or
    // write a weigh-in, while the person was only scrolling down the page.
    serve({ weightGoal: 'maintain' });
    draw();
    await heading('About you');
    const age = spin('Age');
    expect(age.className).toContain('overflow-y-hidden');
    // The test browser cannot scroll for real, so the worst case is acted
    // out: a mouse wheel and a thumb over the untouched wheel, and the wheel
    // moving all the same. It picks nothing and goes back to its row.
    fireEvent.wheel(age);
    fireEvent.touchStart(age);
    fireEvent.pointerDown(age);
    age.scrollTop = 40 * 20;
    fireEvent.scroll(age);
    fireEvent.touchEnd(age);
    await settleWheels();
    expect(svc.patch).not.toHaveBeenCalled();
    expect(age.scrollTop).toBe(40 * 14);
    expect(age.getAttribute('aria-valuetext')).toBe('Not set');
    // Tapped or focused, it turns under the person's flick…
    fireEvent.focus(age);
    expect(age.className).toContain('overflow-y-scroll');
    // …and a press anywhere else lets it go again.
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'About you' }));
    expect(spin('Age').className).toContain('overflow-y-hidden');
  });

  // Each way a gesture on a touched wheel can end without scrolling. Each must
  // end it on its own, or the next scroll the code makes (switching the units
  // makes one) would pick a row the person never chose.
  it.each([
    ['a press that is let go (a right-click, a press above the first row)', (el) => {
      fireEvent.pointerDown(el, { button: 2 });
      fireEvent.pointerUp(el, { button: 2 });
    }],
    ['a mouse wheel at an end of the column', (el) => fireEvent.wheel(el)],
    ['a finger that lifts', (el) => {
      fireEvent.touchStart(el);
      fireEvent.touchEnd(el);
    }],
    ['a touch the browser cancels', (el) => {
      fireEvent.touchStart(el);
      fireEvent.touchCancel(el);
    }],
    ['a press the browser cancels', (el) => {
      fireEvent.pointerDown(el);
      fireEvent.pointerCancel(el);
    }],
  ])('%s ends the gesture, so a later scroll the code makes picks nothing', async (_, gesture) => {
    serve({ weightGoal: 'maintain' });
    draw();
    await heading('About you');
    const age = spin('Age');
    fireEvent.focus(age);
    gesture(age);
    await settleWheels();
    age.scrollTop = 40 * 20;
    fireEvent.scroll(age);
    await settleWheels();
    expect(svc.patch).not.toHaveBeenCalled();
    expect(age.scrollTop).toBe(40 * 14); // back on its resting row, 30
  });

  it('Tab away lets a wheel go, so a mouse wheel over it afterwards moves nothing', async () => {
    serve({ weightGoal: 'maintain' });
    draw();
    await heading('About you');
    const age = spin('Age');
    fireEvent.focus(age);
    expect(age.className).toContain('overflow-y-scroll');
    fireEvent.blur(age); // Tab moves the focus on
    expect(age.className).toContain('overflow-y-hidden');
    fireEvent.wheel(age);
    age.scrollTop = 40 * 20;
    fireEvent.scroll(age);
    await settleWheels();
    expect(svc.patch).not.toHaveBeenCalled();
    expect(age.scrollTop).toBe(40 * 14);
  });

  it('a slow drag that rests and goes on saves where the finger lifts, not where it rested', async () => {
    serve({ weightGoal: 'maintain' });
    draw();
    await heading('About you');
    const age = spin('Age');
    fireEvent.focus(age);
    // A finger on a phone: the browser takes the drag over to scroll, which
    // cancels the pointer at once, while the touch runs on to the lift.
    fireEvent.pointerDown(age);
    fireEvent.touchStart(age);
    fireEvent.pointerCancel(age);
    age.scrollTop = 40 * 20; // resting on 36…
    fireEvent.scroll(age);
    await settleWheels(); // …for longer than a wheel takes to settle
    expect(svc.patch).not.toHaveBeenCalled();
    expect(age.scrollTop).toBe(40 * 20); // still under the finger
    age.scrollTop = 40 * 29; // on to 45, then the finger lifts
    fireEvent.scroll(age);
    fireEvent.touchEnd(age);
    await saved({ age: 45 });
    expect(svc.patch).toHaveBeenCalledTimes(1);
  });

  it('re-picking the weight and height on show saves nothing, though they were stored in kilograms and centimetres', async () => {
    // 70 kg reads 154.3 lb and 175 cm reads 5 ft 9 in. Picked back, those rows
    // mean 69.99 kg and 175.26 cm: a "typed by me" weigh-in and a height the
    // person never changed (RULINGS 2026-09-10).
    serve({ weightGoal: 'maintain', age: 30, gender: 'female', heightCm: 175, weightKg: 70 });
    draw();
    await heading('Your day');
    tap('About you');
    await heading('About you');
    expect(pressed(/lb · ft/)).toBe('true'); // the test browser is en-US
    tapRow('Weight in whole pounds', '154');
    tapRow('Weight, tenths of a pound', '.3');
    tapRow('Height, feet', '5 ft');
    tapRow('Height, inches', '9 in');
    await settleWheels();
    expect(svc.patch).not.toHaveBeenCalled();
    expect(screen.getByText('154.3 lb')).toBeTruthy();
    // A different row is a new answer.
    tapRow('Weight, tenths of a pound', '.4');
    await saved({ weightKg: 70.03 });
  });

  it('re-picking in kilograms and centimetres a weight and height stored from pounds and inches saves nothing', async () => {
    // 154.0 lb is stored as 69.85 kg and 5 ft 9 in as 175.26 cm.
    serve({ weightGoal: 'maintain', age: 30, gender: 'female', heightCm: 175.26, weightKg: 69.85 });
    draw();
    await heading('Your day');
    tap('About you');
    await heading('About you');
    tap(/kg · cm/);
    for (const wheel of ['Weight in whole kilograms', 'Weight, tenths of a kilogram', 'Height in centimetres']) {
      tapRow(wheel, spin(wheel).getAttribute('aria-valuetext'));
    }
    await settleWheels();
    expect(svc.patch).not.toHaveBeenCalled();
    expect(spin('Height in centimetres').getAttribute('aria-valuetext')).toBe('175');
  });

  it('after a switch to kilograms a target never reads the same as the weight, and sits on a row of its wheel', async () => {
    // 140.0 lb is stored as 63.5 kg and a target of 139.9 lb as 63.46 kg. In
    // kilograms both round to 63.5, and 63.5 is not a row a loss can offer.
    serve({ ...ALL, weightKg: 63.5, targetWeightKg: 63.46 });
    draw();
    await heading('Health'); // every screen before it is answered, so it lands on the last
    tap('Your target');
    await heading('Your target');
    expect(screen.getByText(/You weigh 140\.0 lb\./)).toBeTruthy();
    tap(/kg · cm/);
    expect(spin('Target weight in whole kilograms').getAttribute('aria-valuetext')).toBe('63');
    expect(spin('Target weight, tenths of a kilogram').getAttribute('aria-valuetext')).toBe('.4');
    const target = screen.getByRole('group', { name: 'Target weight' });
    expect(within(target).getByText('63.4 kg')).toBeTruthy();
    expect(screen.getByText(/You weigh 63\.5 kg\./)).toBeTruthy();
    expect(button(/continue/i).disabled).toBe(false);
    // The rows on show are the answer already stored: picked again, nothing is saved.
    tapRow('Target weight, tenths of a kilogram', '.4');
    tapRow('Target weight in whole kilograms', '63');
    await settleWheels();
    expect(svc.patch).not.toHaveBeenCalled();
  });

  it('a stored target past the ends of the target wheel is still on it', async () => {
    serve({ ...ALL, weightGoal: 'gain', weightKg: 240, targetWeightKg: 260 });
    draw();
    await heading('Health');
    tap('Your target');
    await heading('Your target');
    tap(/kg · cm/);
    expect(spin('Target weight in whole kilograms').getAttribute('aria-valuetext')).toBe('260');
    expect(spin('Target weight, tenths of a kilogram').getAttribute('aria-valuetext')).toBe('.0');
  });

  it('the target wheel cannot be set on the wrong side of the weight', async () => {
    // Kd, 2026-09-11: "Lose weight", 70 kg, target 83 was accepted without a word.
    serve({ weightGoal: 'lose', age: 30, gender: 'female', heightCm: 165, weightKg: 70 });
    draw();
    await heading('Your target');
    tap(/kg · cm/);
    const wholes = spin('Target weight in whole kilograms');
    expect(within(wholes).queryByText('83')).toBeNull();
    expect(within(wholes).queryByText('70')).toBeNull();
    expect(within(wholes).getByText('69')).toBeTruthy();
    expect(screen.getByText(/You weigh 70\.0 kg\./)).toBeTruthy();
    // + from the resting row (69.0, the whole number just under the weight)
    // cannot climb past the weight: it saves the row it rests on.
    tap('Target weight: one more');
    await stored({ targetWeightKg: 69 });
    tapRow('Target weight in whole kilograms', '65');
    await stored({ targetWeightKg: 65 });

    // Gain weight: the same wheel offers only weights above.
    tap('Your goal');
    await heading('Your goal');
    tap(/Gain weight/);
    await stored({ weightGoal: 'gain' });
    await next('About you');
    await next('Your target');
    const gainWholes = spin('Target weight in whole kilograms');
    expect(within(gainWholes).queryByText('69')).toBeNull();
    expect(within(gainWholes).getByText('71')).toBeTruthy();
  });

  it('names a stored target already on the wrong side, and will not continue until it is moved', async () => {
    serve({ ...ALL, targetWeightKg: 83 }); // the old form, or a weight changed since
    draw();
    await heading('Your target'); // the first screen still open
    tap(/kg · cm/);
    expect(screen.getByText('83.0 kg is not below your current 70.0 kg. Pick a weight below it.')).toBeTruthy();
    // No row on the wheel is the stored 83, so the wheel reads "Not set", never its resting row.
    expect(spin('Target weight in whole kilograms').getAttribute('aria-valuetext')).toBe('Not set');
    expect(spin('Target weight, tenths of a kilogram').getAttribute('aria-valuetext')).toBe('Not set');
    expect(button(/continue/i).disabled).toBe(true);
    expect(button('Your day').disabled).toBe(true);
    tapRow('Target weight in whole kilograms', '65');
    await stored({ targetWeightKg: 65 });
    await waitFor(() => expect(button(/continue/i).disabled).toBe(false));
    expect(screen.queryByText(/is not below/)).toBeNull();
  });

  it('says a target under the lowest healthy weight the moment the wheel lands on it, lets it be picked, and drops the line above it', async () => {
    // Kd, 2026-09-14: said as it is picked, not first on the plan. Female, 30,
    // 165 cm: the lowest healthy weight is 50.4 kg. There is no plan yet on a
    // first walk, so the line is the screen's own, from the shared rule.
    serve({ weightGoal: 'lose', age: 30, gender: 'female', heightCm: 165, weightKg: 70 });
    draw();
    await heading('Your target');
    tap(/kg · cm/);
    expect(screen.queryByText(/lowest healthy weight/)).toBeNull();
    tapRow('Target weight in whole kilograms', '45');
    expect(
      screen.getByText('Your target is below the lowest healthy weight for your height, 50.4 kg. Your plan will not take you below it.'),
    ).toBeTruthy();
    await stored({ targetWeightKg: 45 });
    tap(/^Steady/);
    await stored({ pace: 'steady' });
    await waitFor(() => expect(button(/continue/i).disabled).toBe(false));
    expect(screen.queryByRole('region', { name: 'Your plan' })).toBeNull();
    tapRow('Target weight in whole kilograms', '55');
    expect(screen.queryByText(/lowest healthy weight/)).toBeNull();
    await stored({ targetWeightKg: 55 });
  });

  it('tells someone who already weighs less than that weight that the plan will not lower theirs', async () => {
    serve({ weightGoal: 'lose', age: 30, gender: 'female', heightCm: 165, weightKg: 50 });
    draw();
    await heading('Your target');
    tap(/kg · cm/);
    tapRow('Target weight in whole kilograms', '45');
    expect(
      screen.getByText(
        'Your target is below the lowest healthy weight for your height, 50.4 kg. You already weigh less, so your plan will not lower your weight.',
      ),
    ).toBeTruthy();
    await stored({ targetWeightKg: 45 });
  });

  it('keeps the line in the number box too, said exactly where screen 3 says it, in the units on show', async () => {
    // The stand-in raises the flag as the real plan does at 165 cm, whatever the
    // target, so only the target on screen decides the box's line here.
    serve({ ...ALL, targetWeightKg: 45 }, screeningOf({ hasCondition: false }));
    server.plan = { ...PLAN, flags: [{ code: 'target_below_healthy_weight', floorKg: 50.4 }] };
    draw();
    await heading('Your plan');
    const box = 'Your target is below the lowest healthy weight for your height, 111.1 lb.'; // the test browser is en-US
    expect(panel().textContent).toContain(box);
    tap('Adjust Your target');
    await heading('Your target');
    expect(panel().textContent).toContain(box);
    expect(screen.getByText(`${box} Your plan will not take you below it.`)).toBeTruthy();
    // 111.1 lb is stored as 50.39 kg: under 50.4 kg, and read as it. The plan
    // runs to 50.4 kg, which reads 111.1 lb, so neither place says a word.
    tapRow('Target weight in whole pounds', '111');
    tapRow('Target weight, tenths of a pound', '.1');
    await stored({ targetWeightKg: 50.39 });
    await waitFor(() => expect(panel().textContent).not.toContain('lowest healthy weight'));
    expect(screen.queryByText(/lowest healthy weight/)).toBeNull();
    // One row down reads under it, and both say so again.
    tapRow('Target weight, tenths of a pound', '.0');
    await stored({ targetWeightKg: 50.35 });
    await waitFor(() => expect(panel().textContent).toContain(box));
    expect(screen.getByText(`${box} Your plan will not take you below it.`)).toBeTruthy();
  });

  it('saves pounds as kilograms, and feet and inches as centimetres', async () => {
    serve({ weightGoal: 'maintain' });
    draw();
    await heading('About you');
    expect(pressed(/lb · ft/)).toBe('true'); // the test browser is en-US
    tapRow('Weight in whole pounds', '154');
    await stored({ weightKg: 69.85 });
    tapRow('Height, feet', '5 ft');
    await stored({ heightCm: 170.18 }); // 5 ft and the resting 7 in
    tapRow('Height, inches', '9 in');
    await stored({ heightCm: 175.26 });
  });

  it('asks screen 5 as two plain questions, and "Not sure" clears an answer', async () => {
    serve({ ...ALL, pushUpsMax: 12, plankHoldSeconds: 45, availableEquipment: [] });
    draw();
    await heading('Equipment');
    tap('Your training');
    await heading('Your training');
    expect(spin('Push-ups in a row').getAttribute('aria-valuetext')).toBe('12');
    expect(spin('Plank hold').getAttribute('aria-valuetext')).toBe('45 s');
    // No stopwatch and no test to take.
    expect(screen.queryByText(/time my plank|quick checks|skip these/i)).toBeNull();

    tap('Not sure how many push-ups');
    await saved({ pushUpsMax: null });
    expect(pressed('Not sure how many push-ups')).toBe('true');
    const pushUps = screen.getByRole('group', { name: 'How many push-ups can you do in a row?' });
    expect(within(pushUps).getByText('Not sure')).toBeTruthy();

    tap('Plank: one more');
    await saved({ plankHoldSeconds: 50 });
  });

  it('makes "No equipment" stand alone as you tap', async () => {
    serve({ ...ALL, availableEquipment: [] });
    draw();
    await heading('Equipment');
    tap(/Dumbbells/);
    await saved({ availableEquipment: ['dumbbells'] });
    tap(/No equipment/);
    await saved({ availableEquipment: ['none'] });
    expect(pressed(/Dumbbells/)).toBe('false');
    tap(/Kettlebells/);
    await saved({ availableEquipment: ['kettlebells'] });
    expect(pressed(/No equipment/)).toBe('false');
  });

  it('offers a gym beside the home equipment, and "No equipment" still stands alone', async () => {
    serve({ ...ALL, availableEquipment: [] });
    draw();
    await heading('Equipment');
    tap(/A gym/);
    await saved({ availableEquipment: ['gym'] });
    tap(/Dumbbells/);
    await stored({ availableEquipment: ['dumbbells', 'gym'] });
    tap(/No equipment/);
    await stored({ availableEquipment: ['none'] });
    expect(pressed(/A gym/)).toBe('false');
  });

  it('asks screen 1 as one grid under one heading, the weight choice on top: a goal tap never touches the weight choice', async () => {
    serve();
    draw();
    await heading('Your goal');
    // Kd, at 4a-iv's click-through: one heading and no second question; three
    // to a row, four even rows. The screen's own area is the twelve tiles and
    // nothing else, so no question or hint can sit above them in any form.
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Your goal']);
    const grid = screen.getByRole('group', { name: 'Your goal' });
    const tiles = within(grid).getAllByRole('button');
    expect(tiles).toHaveLength(12);
    expect(grid.parentElement.textContent).toBe(tiles.map((t) => t.textContent).join(''));
    // The one line under the heading that every screen has, which Kd passed.
    expect(screen.getByText('Pick one from the top row, and any of the rest')).toBeTruthy();
    tap(/Build muscle/);
    await saved({ fitnessGoals: ['muscle_gain'] });
    tap(/Better balance/);
    await stored({ fitnessGoals: ['muscle_gain', 'balance'] });
    // Goals alone do not answer the screen: the weight choice does.
    expect(button(/continue/i).disabled).toBe(true);
    tap(/Lose weight/);
    await stored({ weightGoal: 'lose', fitnessGoals: ['muscle_gain', 'balance'] });
    await waitFor(() => expect(button(/continue/i).disabled).toBe(false));
    // Building muscle while losing weight: both stay picked, and unticking a
    // goal leaves the weight choice alone.
    tap(/Build muscle/);
    await stored({ weightGoal: 'lose', fitnessGoals: ['balance'] });
    expect(pressed(/Lose weight/)).toBe('true');
    expect(pressed(/Build muscle/)).toBe('false');
    expect(svc.patch.mock.calls.every(([body]) => !('mainGoal' in body))).toBe(true);
  });

  it('someone who picked Build muscle before the split lands on screen 1 with it ticked, and one tap on Gain weight brings the number back', async () => {
    // Where migration 0028 leaves them (RULINGS 2026-09-11).
    auth.user = { onboardingCompleted: true, displayName: 'kd.test' };
    serve({ ...ALL, weightGoal: null, fitnessGoals: ['muscle_gain'], targetWeightKg: 75 });
    draw(FROM_RINGS);
    await heading('Your goal');
    expect(pressed(/Build muscle/)).toBe('true');
    for (const choice of [/Lose weight/, /Keep my weight/, /Gain weight/]) expect(pressed(choice)).toBe('false');
    expect(screen.queryByRole('region', { name: 'Your plan' })).toBeNull();
    tap(/Gain weight/);
    await saved({ weightGoal: 'gain' });
    await waitFor(() => expect(panel().textContent).toContain('kcal a day'));
  });

  it('loads an old answer of "none" beside equipment without the "none", and finishes with that', async () => {
    serve({ ...ALL, availableEquipment: ['none', 'dumbbells'] }, screeningOf({ hasCondition: false }));
    draw();
    await heading('Your plan'); // the last screen: every question has an answer
    tap('Equipment'); // back to it from the step bar
    await heading('Equipment');
    expect(pressed(/No equipment/)).toBe('false');
    expect(pressed(/Dumbbells/)).toBe('true');
    await next('Health');
    await agree();
    await toFinish();
    tap(/finish setup/i);
    await screen.findByText('MEMBER APP');
    expect(svc.patch).toHaveBeenLastCalledWith({ availableEquipment: ['dumbbells'], onboardingCompleted: true });
    // The rest of the app greets the person by the name saved here.
    expect(auth.updateUser).toHaveBeenCalledWith({ onboardingCompleted: true, displayName: 'kd.test' });
  });

  // ── Screen 8: the one health question, and the tap beside it ─────────────

  it('asks the health question in the words the ruling gives it, and stores a no at once', async () => {
    serve(ALL);
    draw();
    await heading('Health'); // the only screen without an answer
    expect(screen.getByText(HEALTH_QUESTION)).toBeTruthy();
    // What the app keeps of this answer is told where the answer is given, so
    // the line is checked on the screen, not only in the shared words' test.
    expect(screen.getByText(HEALTH_QUESTION_NOTE)).toBeTruthy();
    // Nobody goes past this screen without answering it: the question holds
    // Continue exactly as every other screen's does (Finish is on the last
    // screen, two on from here, since 4b-ii).
    expect(button(/continue/i).disabled).toBe(true);

    tap('No');
    await waitFor(() => expect(health.put).toHaveBeenCalledWith({ hasCondition: false }));
    // A health answer can move the daily number (any yes stops the calorie
    // cut), so the plan is read again the moment one lands.
    await waitFor(() => expect(svc.patch).toHaveBeenCalledWith({}));
  });

  it('opens "Check first" on a yes and stores NOTHING until one of the two is picked', async () => {
    serve(ALL);
    draw();
    await heading('Health');
    tap('Yes');
    expect(screen.getByText('Check first')).toBeTruthy();
    expect(screen.getByText('Pick one of the two to save your answer.')).toBeTruthy();
    // A yes with no choice is not an answer the server takes, so none is sent.
    expect(health.put).not.toHaveBeenCalled();
    expect(button(/continue/i).disabled).toBe(true);

    tap(/^Not yet/);
    await waitFor(() => expect(health.put).toHaveBeenCalledWith({ hasCondition: true, checkFirst: 'not_yet' }));
    expect(server.health).toMatchObject({ hasCondition: true, checkFirst: 'not_yet', safeMode: true, noCalorieCut: true });
  });

  it('will not finish until the question is answered AND the disclaimer is agreed to, and records that tap', async () => {
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await onHealth();
    // Answered, but nobody has agreed to anything yet.
    expect(screen.getByText(DISCLAIMER_WORDINGS.health_step.v2)).toBeTruthy();
    expect(screen.getByText('Tick this to finish setup.')).toBeTruthy();

    // THE TAP IS THREE SCREENS BACK FROM FINISH SINCE 4c, so the last screen
    // has to say what is holding the button and offer the way to it. A dead
    // Finish with its reason on a screen the person has left is the defect
    // this names. (The plan screen's own tap is made on the way: `toFinish`.)
    await toFinish();
    expect(button(/finish setup/i).disabled).toBe(true);
    expect(screen.getByText('Read the note on the Health screen and tick it.')).toBeTruthy();
    tap('Go to Health');
    await heading('Health');

    await agree();
    expect(agreeBox().getAttribute('aria-checked')).toBe('true');
    // And back in one tap, as from an Adjust — not a Continue through Food and
    // Your code.
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull();
    await backToFinish();
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(false));
    expect(screen.queryByText('Read the note on the Health screen and tick it.')).toBeNull();
    tap(/finish setup/i);
    await screen.findByText('MEMBER APP');
  });

  it('keeps the person on the health screen while its question is open', async () => {
    // With the question unanswered there is no way forward at all: Continue is
    // shut, so the last screen — and Finish with it — cannot be reached, and
    // the step bar cannot jump past it either.
    serve(ALL); // every other answer in, the health one open
    draw();
    await heading('Health');
    await agree();
    expect(button(/continue/i).disabled).toBe(true);
    expect(button('Food').disabled).toBe(true);
    expect(button('Your code').disabled).toBe(true);
    expect(button('Your plan').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /finish setup/i })).toBeNull();
    expect(screen.queryByText('MEMBER APP')).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();

    // Answered, the way on opens.
    tap('No');
    await waitFor(() => expect(button(/continue/i).disabled).toBe(false));
  });

  it('names it again when the SERVER is the one that refuses, not the screen', async () => {
    // The screen believes the question is answered; the server knows better —
    // a reset on another device clears it (4b-i). The 409 must reach the person
    // as a sentence they can act on, not as a failure they cannot read.
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await onHealth();
    await agree();
    await toFinish();
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(false));
    server.health = UNANSWERED_HEALTH;
    tap(/finish setup/i);
    expect(await screen.findByText('Before you finish, answer the health question.')).toBeTruthy();
    expect(screen.queryByText('MEMBER APP')).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(true));

    // …and the person can DO what the sentence asks. The question is not on
    // this screen any more (4b-ii put two screens behind it), so the way back
    // to it is offered — and what that screen then shows must be the SERVER's
    // answer, which is none. Showing the old answer as chosen would make the
    // only way out "answer something you can see you already answered", and
    // the tap would be swallowed as one already stored.
    tap('Go to Health');
    await heading('Health');
    expect(pressed('No')).toBe('false');
    expect(pressed('Yes')).toBe('false');
    tap('No');
    await waitFor(() => expect(health.put).toHaveBeenCalledWith({ hasCondition: false }));
    // The sentence goes when the question is answered, rather than standing
    // over a question the person has just answered, and Finish finishes.
    await backToFinish();
    await waitFor(() => expect(screen.queryByText('Before you finish, answer the health question.')).toBeNull());
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(false));
    tap(/finish setup/i);
    await screen.findByText('MEMBER APP');
  });

  it('will not let Finish race the health answer it was just given', async () => {
    // The answer shows the moment it is tapped, so the person can walk on to
    // the last screen before the server holds it. Finish waits for it there:
    // otherwise the finish overtakes the save and comes back "answer the
    // health question" to somebody who just answered it.
    serve(ALL);
    draw();
    await heading('Health');
    await agree();
    let land;
    health.put = vi.fn(
      (body) =>
        new Promise((resolve) => {
          land = () => {
            server.health = screeningOf(body);
            resolve({ data: { healthScreening: server.health } });
          };
        }),
    );
    tap('No');
    await waitFor(() => expect(pressed('No')).toBe('true'));
    await toFinish();
    expect(button(/finish setup/i).disabled).toBe(true);
    land();
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(false));
  });

  it('shuts every way back to the health question while a finish is out, so a refusal cannot forget an answer the server took', async () => {
    // A finish refused over this question forgets the answer the screen holds,
    // because the server has just said it holds none. An answer given WHILE the
    // finish is in flight can reach the server first and be stored — and then
    // the (rightly stale) refusal would forget it, leaving the question with
    // nothing chosen over an answer the server now has, and the sentence asking
    // for something already given.
    //
    // Since 4b-ii the question and Finish are never on one screen, so what
    // closes that window is the WAY BACK being shut: while a finish is out the
    // step bar takes no jump, and Back takes none either. The question's own
    // buttons wait on the same flag, and the test after this one pins that in
    // the one wait the question IS on screen for.
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await onHealth();
    await agree();
    await toFinish();
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(false));

    let refuse;
    const patch = svc.patch;
    svc.patch = vi.fn((body) =>
      body.onboardingCompleted === true
        ? new Promise((_resolve, reject) => {
            refuse = () => reject(refusal(['health']));
          })
        : patch(body),
    );
    tap(/finish setup/i);
    await waitFor(() => expect(button('Health').disabled).toBe(true));
    expect(button('Food').disabled).toBe(true);
    expect(button(/^back$/i).disabled).toBe(true);
    // The plan screen's Adjust is a way back too (4c), and waits the same.
    expect(button('Adjust Health').disabled).toBe(true);
    expect(button('Adjust Food').disabled).toBe(true);

    refuse();
    // The refusal lands, the way back opens, and the question is asked again
    // with nothing chosen — so the next tap is a real save.
    const goBack = await screen.findByRole('button', { name: 'Go to Health' });
    fireEvent.click(goBack);
    await heading('Health');
    expect(pressed('No')).toBe('false');
    expect(health.put).not.toHaveBeenCalled();
  });

  it('takes no health answer while the page waits on its saves — a Continue from this screen included', async () => {
    // `health.saving` carries the page's own wait (`busy`), not only the health
    // save's. A finish is the wait that matters most (the test above), and a
    // Continue from this screen is the wait the question is on screen for: it
    // waits on the plan's read-back that follows every health answer. A Yes
    // tapped then would be left half-given — "Check first" open, nothing saved —
    // as the page moves on to Food.
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await onHealth();

    // Hold the read-back of the plan that follows a health answer.
    let land;
    const patch = svc.patch;
    svc.patch = vi.fn(
      (body) =>
        new Promise((resolve, reject) => {
          land = () => patch(body).then(resolve, reject);
        }),
    );
    tap('Yes');
    tap(/^Not yet/);
    await waitFor(() => expect(health.put).toHaveBeenCalledWith({ hasCondition: true, checkFirst: 'not_yet' }));
    await waitFor(() => expect(svc.patch).toHaveBeenCalledWith({}));
    // The health save itself has landed, so the question is open to a tap…
    await waitFor(() => expect(button('No').disabled).toBe(false));

    // …until Continue is pressed, which waits on the read-back still out.
    tap(/continue/i);
    await waitFor(() => expect(button('No').disabled).toBe(true));
    expect(button('Yes').disabled).toBe(true);
    expect(button(/^A professional has cleared me/).disabled).toBe(true);

    land();
    await heading('Food');
    expect(health.put).toHaveBeenCalledTimes(1);
  });

  it('waits for the health answer as well as the others before it puts anybody on a screen', async () => {
    serve(ALL, screeningOf({ hasCondition: false }));
    let land;
    health.get = vi.fn(
      () => new Promise((resolve) => { land = () => resolve({ data: { healthScreening: server.health } }); }),
    );
    draw();
    await waitFor(() => expect(svc.get).toHaveBeenCalled());
    // Where a person lands is "the first screen still unanswered", which cannot
    // be worked out while one of the answers is still unknown.
    expect(screen.queryByRole('heading', { name: 'Health' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Your goal' })).toBeNull();
    land();
    await heading('Your plan'); // every answer in, so the last screen
  });

  it('says so when the health answer cannot be read, and Try again retries the read that failed', async () => {
    serve(ALL, screeningOf({ hasCondition: false }));
    const failed = vi.fn(() => Promise.reject(new Error('down')));
    health.get = failed;
    draw();
    const retry = await screen.findByRole('button', { name: /try again/i });
    expect(screen.queryByRole('heading', { name: 'Health' })).toBeNull();
    // The other read landed, so a retry aimed at THAT one would leave the
    // person on this message for ever.
    const answersRead = svc.get.mock.calls.length;
    health.get = vi.fn(async () => ({ data: { healthScreening: server.health } }));
    fireEvent.click(retry);
    await heading('Your plan');
    expect(failed).toHaveBeenCalledTimes(1);
    expect(svc.get.mock.calls.length).toBe(answersRead);
  });

  it('writes nothing when the answer tapped is the one already stored', async () => {
    serve(ALL, screeningOf({ hasCondition: true, checkFirst: 'not_yet' }));
    draw();
    await onHealth();
    tap('Yes');
    tap(/^Not yet/);
    await settleWheels();
    expect(health.put).not.toHaveBeenCalled();
    expect(button(/^Not yet/).getAttribute('aria-pressed')).toBe('true');
    expect(pressed('Yes')).toBe('true');
  });

  it('puts the stored answer back when a save fails, so the screen never keeps one the server refused', async () => {
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await onHealth();
    server.failHealth = new Error('down');
    tap('Yes');
    tap(/^Not yet/);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(pressed('No')).toBe('true');
    expect(pressed('Yes')).toBe('false');
    expect(server.health).toMatchObject({ hasCondition: false });
  });

  // ── Screens 9 and 11: food, and the gym code ─────────────────────────────

  it('asks the diet and the meals, saves each tap at once, and leaves the plan panel as it was', async () => {
    serve({ ...ALL, diet: null, mealsPerDay: null }, screeningOf({ hasCondition: false }));
    draw();
    await heading('Food'); // the first screen still open
    const before = panel().textContent;
    expect(button(/continue/i).disabled).toBe(true);

    tap(/^Vegetarian with eggs/);
    await saved({ diet: 'vegetarian_eggs' });
    expect(button(/continue/i).disabled).toBe(true); // one of the two is not an answer

    tap('4 meals a day');
    await stored({ diet: 'vegetarian_eggs', mealsPerDay: 4 });
    await waitFor(() => expect(button(/continue/i).disabled).toBe(false));
    // The screen leaves the number it is showing alone. Whether the SERVER's
    // number moves with a food answer is not something this stand-in can say —
    // its plan never reads a diet — so that is proved against the real route
    // (users.onboarding.routes "screen 9 stores the diet and the meals…").
    expect(panel().textContent).toBe(before);
  });

  it('asks exactly two things on screen 9, the diet and the meals, and so no cuisine by any name (RULINGS 2026-09-12)', async () => {
    serve({ ...ALL, diet: null, mealsPerDay: null }, screeningOf({ hasCondition: false }));
    draw();
    await heading('Food');
    expect(screen.getByText('How do you eat?')).toBeTruthy();
    expect(screen.getByText('How many meals a day?')).toBeTruthy();
    // Every choice on the screen, by name. A third question adds choices here
    // however it is worded, where a search for "cuisine" would let "Where is
    // your food from?" through.
    const choices = screen
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('aria-pressed'))
      .map((b) => b.getAttribute('aria-label') ?? b.textContent);
    expect(choices).toEqual([
      ...DIETS.map((d) => `${d.label}${d.desc}`),
      '2 meals a day', '3 meals a day', '4 meals a day', '5 meals a day', '6 meals a day',
    ]);
    // Nothing to type, and nothing to pick from a list.
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    expect(screen.queryAllByRole('combobox')).toEqual([]);
  });

  it('makes the diet one choice: a second tap moves it rather than adding to it', async () => {
    serve({ ...ALL, diet: 'vegan' }, screeningOf({ hasCondition: false }));
    draw();
    await onHealth();
    await next('Food');
    expect(pressed(/^Vegan/)).toBe('true');
    tap(/^Non-vegetarian/);
    await stored({ diet: 'non_vegetarian' });
    await waitFor(() => expect(pressed(/^Vegan/)).toBe('false'));
    expect(pressed(/^Non-vegetarian/)).toBe('true');
    // The answer already on screen is not written again.
    svc.patch.mockClear();
    tap(/^Non-vegetarian/);
    await settleWheels();
    expect(svc.patch).not.toHaveBeenCalled();
  });

  it('holds Finish while a food answer is open, names it, and offers the way back', async () => {
    serve({ ...ALL, mealsPerDay: null }, screeningOf({ hasCondition: false }));
    draw();
    await heading('Food');
    tap('3 meals a day');
    await stored({ mealsPerDay: 3 });
    await next('Your code');
    await next('Your plan');
    // Cleared from another device meanwhile: the server refuses the finish and
    // names it, though no plan number is missing.
    server.answers.mealsPerDay = null;
    await agreeOnHealth();
    tap(/finish setup/i);
    expect(await screen.findByText('Before you finish, answer how many meals a day.')).toBeTruthy();
    expect(screen.queryByText('MEMBER APP')).toBeNull();
    tap('Go to Food');
    await heading('Food');
    tap('5 meals a day');
    await stored({ mealsPerDay: 5 });
    await backToPlan();
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(false));
    tap(/finish setup/i);
    await screen.findByText('MEMBER APP');
  });

  it('asks for a gym code without ever holding anyone, in the join door\'s own words', async () => {
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await heading('Your plan'); // every answer in: the last screen
    tap('Your code');
    await heading('Your code');
    expect(screen.getByText('Have a code from your gym, studio or trainer?')).toBeTruthy();
    expect(screen.getByLabelText('Your join code')).toBeTruthy();
    expect(screen.getByRole('button', { name: /ask to join/i })).toBeTruthy();
    // Nothing here is an answer: with no code typed at all, the plan and its
    // Finish are one Continue on, and Finish is offered once the notes are ticked.
    expect(screen.getByText(/No code\? Carry on/)).toBeTruthy();
    await next('Your plan');
    await agreeOnHealth();
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(false));
    tap(/finish setup/i);
    await screen.findByText('MEMBER APP');
    // Setup finished without one, and none was ever sent.
    expect(orgService.join).not.toHaveBeenCalled();
  });

  it('applies a code on screen 11 through the join door itself, and finishes after it', async () => {
    orgService.join.mockResolvedValue({
      data: {
        outcome: 'pending',
        org: { id: 'gym-1', slug: 'iron-house', name: 'Iron House', orgType: 'gym' },
        application: { applicationId: 'app-1', status: 'pending', expiresAt: null, orgCanConfirm: true, lastNudgeAt: null },
      },
    });
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await heading('Your plan');
    tap('Your code');
    await heading('Your code');
    fireEvent.change(screen.getByLabelText('Your join code'), { target: { value: 'abc123' } });
    fireEvent.click(button(/ask to join/i));
    await waitFor(() => expect(orgService.join).toHaveBeenCalledWith({ code: 'ABC123' }));
    expect(await screen.findByText("You've asked to join Iron House.")).toBeTruthy();
    // The panel's usual way out is a dead end mid-setup — an unfinished
    // account is sent straight back here — so it is not offered.
    expect(screen.queryByRole('link', { name: /back to your dashboard/i })).toBeNull();

    await next('Your plan');
    await agreeOnHealth();
    tap(/finish setup/i);
    await screen.findByText('MEMBER APP');
  });

  it("a refused or expired request's Try again puts the cursor in the code box below, and never leaves setup", async () => {
    // The card's Try again links to the join door everywhere else. From here
    // that address sends an unfinished account straight back to this wizard,
    // so on screen 11 it goes to the box that is already on the screen.
    orgService.getMyApplications.mockResolvedValue({
      data: {
        applications: [
          {
            id: 'app-1', status: 'rejected', appliedAt: '2026-08-19T09:00:00.000Z', expiresAt: '2026-09-02T09:00:00.000Z',
            decidedAt: null, nudgedAt: null,
            org: {
              id: 'gym-1', slug: 'iron-house', name: 'Iron House', city: null, orgType: 'gym', timezone: 'UTC',
              locale: 'en', currencyDisplay: 'USD', status: 'active',
            },
          },
        ],
      },
    });
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await heading('Your plan');
    tap('Your code');
    await heading('Your code');
    expect(await screen.findByText("Iron House didn't confirm your request")).toBeTruthy();
    expect(screen.queryByRole('link', { name: /try again/i })).toBeNull();
    const codeBox = screen.getByLabelText('Your join code');
    expect(document.activeElement).not.toBe(codeBox);

    tap(/try again/i);
    expect(document.activeElement).toBe(codeBox);
    // Still here, on the code screen of setup.
    expect(screen.getByRole('heading', { name: 'Your code' })).toBeTruthy();
    expect(screen.queryByText('MEMBER APP')).toBeNull();
  });

  it('when the server refuses Finish, names what is open and offers the way back to it', async () => {
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await onHealth(); // every question answered, so it opens on the last screen
    await agree();
    await toFinish();
    server.answers.dayActivity = null; // cleared from another device meanwhile
    tap(/finish setup/i);
    expect(await screen.findByText('Before you finish, answer your day.')).toBeTruthy();
    expect(screen.queryByText('MEMBER APP')).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(true));
    tap('Go to Your day');
    await heading('Your day');
  });

  // ── The last screen: your plan (4c) ─────────────────────────────────────

  const built = () => screen.getByRole('region', { name: 'Your answers' });
  const workouts = () => screen.getByRole('region', { name: 'Your workouts' });

  it('ends on your plan: the number, the week of workouts, every answer with its Adjust, and its own note, which Finish waits for', async () => {
    serve({ ...ALL, fitnessGoals: ['posture'] }, screeningOf({ hasCondition: false }));
    draw();
    await heading('Your plan'); // every answer in, so it lands on the plan
    expect(screen.getByText('Step 11 of 11')).toBeTruthy();
    // The live number, as on every screen; its note's first sentence is left to
    // the whole note below, rather than said twice.
    expect(panel().textContent).toContain('1,267kcal a day');
    expect(panel().textContent).not.toContain('not medical advice');
    expect(workouts().textContent).toContain('3 workouts a week, 45 minutes each');
    expect(workouts().textContent).toContain('Beginner · Dumbbells');
    expect(workouts().textContent).not.toContain('Follow their advice');
    // Every screen that asks something, each with its answer and a way back to it.
    const rows = [
      ['Your goal', 'Lose weight · Posture'],
      ['About you', /^kd\.test · 30 years · Female · /],
      ['Your target', /^143\.3 lb · Steady, /], // the test browser is en-US
      ['Your day', 'Mostly sitting'],
      ['Your training', 'Beginner'],
      ['Your week', '3 days a week · 45 minutes'],
      ['Equipment', 'Dumbbells'],
      ['Health', 'No'],
      ['Food', 'Non-vegetarian · 3 meals a day'],
    ];
    expect(within(built()).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(rows.map(([t]) => `Adjust ${t}`));
    for (const [, value] of rows) expect(within(built()).getByText(value)).toBeTruthy();
    // Headed as what they are, the person's answers, whatever the plan made of them.
    expect(within(built()).getByText('Your answers')).toBeTruthy();
    expect(screen.queryByText(/built on/i)).toBeNull();

    // The plan's own note, whole, and its tap: the second one Finish waits for.
    expect(screen.getByText(DISCLAIMER_WORDINGS.plan_screen.v2)).toBeTruthy();
    tap('Go to Health');
    await heading('Health');
    await agree();
    await backToPlan();
    expect(button(/finish setup/i).disabled).toBe(true);
    expect(screen.getByText('Tick this to finish setup.')).toBeTruthy();
    expect(consent.record).not.toHaveBeenCalledWith('plan_screen');
    fireEvent.click(agreeBox());
    await waitFor(() => expect(consent.record).toHaveBeenCalledWith('plan_screen'));
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(false));
    tap(/finish setup/i);
    await screen.findByText('MEMBER APP');
  });

  it('each disclaimer tap shows as ticked only once the server has recorded it, and Finish waits for both to land', async () => {
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await heading('Your plan');
    // Every tap is held on its way to the consent log until the test lets it land.
    const land = {};
    const record = consent.record;
    consent.record = vi.fn(
      (purpose) =>
        new Promise((resolve) => {
          land[purpose] = () => resolve(record(purpose));
        }),
    );

    // The health step's tap, still on its way when the person goes back.
    tap('Go to Health');
    await heading('Health');
    fireEvent.click(agreeBox());
    await waitFor(() => expect(consent.record).toHaveBeenCalledWith('health_step'));
    expect(agreeBox().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Tick this to finish setup.')).toBeTruthy();
    await backToPlan();
    expect(screen.getByText('Read the note on the Health screen and tick it.')).toBeTruthy();

    // The plan screen's tap: not ticked before it lands, and once it has,
    // Finish still waits for the health step's.
    fireEvent.click(agreeBox());
    await waitFor(() => expect(consent.record).toHaveBeenCalledWith('plan_screen'));
    expect(agreeBox().getAttribute('aria-checked')).toBe('false');
    expect(button(/finish setup/i).disabled).toBe(true);
    land.plan_screen();
    await waitFor(() => expect(agreeBox().getAttribute('aria-checked')).toBe('true'));
    expect(button(/finish setup/i).disabled).toBe(true);

    land.health_step();
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(false));
    expect(screen.queryByText('Read the note on the Health screen and tick it.')).toBeNull();
    // And the health step's box shows it, back where it was made.
    tap('Health');
    await heading('Health');
    expect(agreeBox().getAttribute('aria-checked')).toBe('true');
  });

  it('a plan note tap that fails says so, stays unticked and keeps Finish shut', async () => {
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await heading('Your plan');
    tap('Go to Health');
    await heading('Health');
    await agree();
    await backToPlan();
    consent.record = vi.fn(() => Promise.reject(new Error('Network Error')));
    fireEvent.click(agreeBox());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't reach the server. Check your connection and try again."));
    expect(consent.record).toHaveBeenCalledWith('plan_screen');
    await waitFor(() => expect(agreeBox().disabled).toBe(false));
    expect(agreeBox().getAttribute('aria-checked')).toBe('false');
    expect(button(/finish setup/i).disabled).toBe(true);
  });

  it('Adjust opens the screen that asked, and "Back to your plan" brings the person straight back', async () => {
    serve(ALL, screeningOf({ hasCondition: false }));
    draw();
    await heading('Your plan');
    tap('Adjust Your day');
    await heading('Your day');
    expect(screen.queryByRole('button', { name: /continue/i })).toBeNull();
    tap(/On my feet most of the day/);
    await stored({ dayActivity: 'active' });
    tap('Back to your plan');
    await heading('Your plan'); // one tap, not five screens of Continue
    expect(within(built()).getByText('On my feet most of the day')).toBeTruthy();
    // Back on the plan, the adjustment is over: a walk from the start is an
    // ordinary one again.
    tap('Your goal');
    await heading('Your goal');
    await next('About you');
  });

  it('an Adjust that opens a new question goes to that question before the plan', async () => {
    serve({ ...ALL, weightGoal: 'maintain', targetWeightKg: null, pace: null }, screeningOf({ hasCondition: false }));
    draw();
    await heading('Your plan');
    expect(screen.getByText('Step 10 of 10')).toBeTruthy(); // keeping the weight asks no target
    tap('Adjust Your goal');
    await heading('Your goal');
    expect(button('Back to your plan')).toBeTruthy();
    tap(/Lose weight/);
    await stored({ weightGoal: 'lose' });
    // Losing weight asks for a target the plan has not got: Continue, to it.
    await next('Your target');
    tap(/kg · cm/);
    tapRow('Target weight in whole kilograms', '65');
    tap(/^Steady/);
    await stored({ targetWeightKg: 65, pace: 'steady' });
    await waitFor(() => expect(button('Back to your plan').disabled).toBe(false));
    tap('Back to your plan');
    await heading('Your plan');
    expect(screen.getByText('Step 11 of 11')).toBeTruthy();
    expect(within(built()).getByText('65.0 kg · Steady, about 0.5 kg a week')).toBeTruthy();
  });

  it('Safe mode shows no workout plan and says what still works; cleared, the week comes back with a line to follow the professional', async () => {
    // RULINGS 2026-09-07: Safe mode shows no workout or run plan; 2026-09-09: a
    // cleared person gets the normal plan plus a "follow your professional" line.
    serve(ALL, screeningOf({ hasCondition: true, checkFirst: 'not_yet' }));
    draw();
    await heading('Your plan');
    expect(within(workouts()).getByText(CHECK_FIRST_OPTIONS.not_yet.detail)).toBeTruthy();
    expect(workouts().textContent).not.toMatch(/a week/);
    expect(workouts().textContent).not.toContain('Beginner');
    // The answers stay, the week's among them, each with its way back.
    expect(within(built()).getByText('3 days a week · 45 minutes')).toBeTruthy();
    expect(within(built()).getByText('Yes · Not yet')).toBeTruthy();

    tap('Adjust Health');
    await heading('Health');
    tap(/^A professional has cleared me/);
    await waitFor(() => expect(health.put).toHaveBeenCalledWith({ hasCondition: true, checkFirst: 'cleared' }));
    await waitFor(() => expect(button('Back to your plan').disabled).toBe(false));
    tap('Back to your plan');
    await heading('Your plan');
    expect(workouts().textContent).toContain('3 workouts a week, 45 minutes each');
    expect(within(workouts()).getByText('You told us a professional has cleared you. Follow their advice.')).toBeTruthy();
    expect(workouts().textContent).not.toContain(CHECK_FIRST_OPTIONS.not_yet.detail);
    expect(within(built()).getByText('Yes · A professional has cleared me')).toBeTruthy();
  });

  it('building muscle while losing weight: the plan says a steep cut mostly stops muscle growing, and the gentle pace is marked where paces are picked', async () => {
    // Kd, 2026-09-13: tell them, and keep their pace. The line is the server's
    // (the stand-in raises it here as the real route does at the steady pace).
    serve({ ...ALL, fitnessGoals: ['muscle_gain'] }, screeningOf({ hasCondition: false }));
    server.plan = {
      ...PLAN,
      proteinG: 154,
      carbsG: 84,
      flags: [{ code: 'cut_limits_muscle_gain', limitKcal: 500, suggestedPace: 'gentle' }],
      workings: { ...PLAN.workings, protein: { ...PLAN.workings.protein, gPerKg: 2.2, wantedG: 154, buildMuscle: true } },
    };
    draw();
    await heading('Your plan');
    expect(panel().textContent).toContain(
      'Building muscle while losing weight: a cut of more than 500 kcal a day mostly stops muscle growing. The gentle pace leaves room for it.',
    );
    tap('Adjust Your target');
    await heading('Your target');
    expect(button(/^Gentle/).textContent).toContain('Best if you also build muscle');
    for (const pace of [/^Steady/, /^Brisk/]) expect(button(pace).textContent).not.toContain('Best if');
    // Their pace stays theirs: nothing was saved by showing it.
    expect(svc.patch).not.toHaveBeenCalled();

    // Without Build muscle, no card is marked.
    tap('Your goal');
    await heading('Your goal');
    tap(/Build muscle/);
    await stored({ fitnessGoals: [] });
    tap('Your target');
    await heading('Your target');
    for (const pace of [/^Gentle/, /^Steady/, /^Brisk/]) expect(button(pace).textContent).not.toContain('Best if');
  });

  it('marks no pace for building muscle once a yes to the health question stops every cut', async () => {
    // Any yes means no calorie cut, cleared or not (RULINGS 2026-09-09): every
    // pace then eats the same, so a mark would point at a choice that changes
    // nothing. The answer comes from its own route, beside the others.
    serve({ ...ALL, fitnessGoals: ['muscle_gain'] }, screeningOf({ hasCondition: false }));
    draw();
    await heading('Your plan');
    tap('Adjust Your target');
    await heading('Your target');
    expect(button(/^Gentle/).textContent).toContain('Best if you also build muscle');

    tap('Health');
    await heading('Health');
    tap('Yes');
    tap(/^A professional has cleared me/);
    await waitFor(() => expect(health.put).toHaveBeenCalledWith({ hasCondition: true, checkFirst: 'cleared' }));
    tap('Your target');
    await heading('Your target');
    await waitFor(() => {
      for (const pace of [/^Gentle/, /^Steady/, /^Brisk/]) expect(button(pace).textContent).not.toContain('Best if');
    });
  });

  it('marks no pace where the plan says every pace eats the same, and marks it once another pace would cut more', async () => {
    // As on the calorie floor: the stand-in's plan has every pace eat 19 kcal
    // over the burn, so no pace leaves muscle more room than another.
    serve({ ...ALL, fitnessGoals: ['muscle_gain'] }, screeningOf({ hasCondition: false }));
    server.plan = { ...PLAN, dailyChangeKcalByPace: { gentle: 19, steady: 19, brisk: 19 } };
    draw();
    await heading('Your plan');
    tap('Adjust Your target');
    await heading('Your target');
    for (const pace of [/^Gentle/, /^Steady/, /^Brisk/]) expect(button(pace).textContent).not.toContain('Best if');

    // The plan the next answer brings back is the one the cards read.
    server.plan = PLAN;
    tap(/^Brisk/);
    await stored({ pace: 'brisk' });
    await waitFor(() => expect(button(/^Gentle/).textContent).toContain('Best if you also build muscle'));
  });

  it('a person who already finished setup can go back to the app, and can still sign out', async () => {
    auth.user = { onboardingCompleted: true, displayName: 'kd.test' };
    serve({ ...ALL, dayActivity: null }); // the one question the plan still needs
    draw(FROM_RINGS);
    await heading('Your day'); // it opens on that question
    expect(button(/sign out/i)).toBeTruthy();
    tap(/back to the app/i);
    await screen.findByText('NUTRITION');
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('Back to the app saves the name box first, and stays while it is blank', async () => {
    auth.user = { onboardingCompleted: true, displayName: 'kd.test' };
    serve({ ...ALL, age: null }); // "About you" is the open screen
    draw(FROM_RINGS);
    await heading('About you');
    fireEvent.change(nameBox(), { target: { value: '   ' } });
    tap(/back to the app/i);
    expect(await screen.findByText('Type the name we should call you.')).toBeTruthy();
    expect(screen.queryByText('NUTRITION')).toBeNull();
    fireEvent.change(nameBox(), { target: { value: 'Kd' } });
    tap(/back to the app/i);
    await screen.findByText('NUTRITION');
    expect(server.answers.displayName).toBe('Kd');
    // …and the app they go back to calls them by it (the sidebar, the dashboard's greeting).
    expect(auth.updateUser).toHaveBeenCalledWith({ displayName: 'Kd' });
  });

  it('a name saved on the way forward reaches the rest of the app at once, not only at Finish', async () => {
    serve({ ...ALL, availableEquipment: [] });
    draw();
    await heading('Equipment');
    tap('About you');
    await heading('About you');
    fireEvent.change(nameBox(), { target: { value: '  Kd  ' } });
    tap(/continue/i);
    await heading('Your target');
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ displayName: 'Kd' }));
  });

  it("a name the server did not take leaves the app's name as it was", async () => {
    serve({ ...ALL, availableEquipment: [] });
    draw();
    await heading('Equipment');
    tap('About you');
    await heading('About you');
    server.failNext = new Error('Network Error');
    fireEvent.change(nameBox(), { target: { value: 'Kd' } });
    tap(/continue/i);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't reach the server. Check your connection and try again."));
    // Every save answered, the read-back of what the server holds among them.
    await waitFor(() => expect(button(/continue/i).disabled).toBe(false));
    expect(svc.patch).toHaveBeenLastCalledWith({});
    expect(auth.updateUser).not.toHaveBeenCalledWith({ displayName: 'Kd' });
    expect(screen.getByRole('heading', { name: 'About you' })).toBeTruthy();
  });

  it('Back to the app waits for the saves, and a save that failed keeps them here with its message', async () => {
    auth.user = { onboardingCompleted: true, displayName: 'kd.test' };
    serve({ ...ALL, dayActivity: null });
    draw(FROM_RINGS);
    await heading('Your day');
    server.failNext = new Error('Network Error');
    tap(/Mostly sitting/);
    tap(/back to the app/i);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't reach the server. Check your connection and try again."));
    await waitFor(() => expect(button(/back to the app/i).disabled).toBe(false));
    expect(screen.queryByText('NUTRITION')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your day' })).toBeTruthy();
  });

  it('answering the open question and finishing brings them back to the rings', async () => {
    auth.user = { onboardingCompleted: true, displayName: 'kd.test' };
    serve({ ...ALL, dayActivity: null }, screeningOf({ hasCondition: false }));
    draw(FROM_RINGS);
    await heading('Your day');
    tap(/Mostly sitting/);
    await stored({ dayActivity: 'sitting' });
    await next('Your training');
    await next('Your week');
    await next('Equipment');
    await next('Health');
    await agree();
    await toFinish();
    tap(/finish setup/i);
    await screen.findByText('NUTRITION');
  });

  it('goes to the dashboard for any other address in the page state', async () => {
    auth.user = { onboardingCompleted: true, displayName: 'kd.test' };
    serve({ ...ALL, dayActivity: null });
    draw({ pathname: '/onboarding', state: { returnTo: 'https://example.com/' } });
    await heading('Your day');
    tap(/back to the app/i);
    await screen.findByText('MEMBER APP');
  });

  it('someone who has not finished setup keeps Sign out, and no way back without finishing', async () => {
    serve();
    draw(FROM_RINGS);
    await heading('Your goal');
    expect(screen.queryByRole('button', { name: /back to the app/i })).toBeNull();
    tap(/sign out/i);
    await waitFor(() => expect(auth.logout).toHaveBeenCalled());
  });

  it('puts a tap back and says so when its save fails, then reads what the server holds', async () => {
    serve();
    draw();
    await heading('Your goal');
    server.failNext = new Error('Network Error'); // no response: the connection dropped
    tap(/Lose weight/);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't reach the server. Check your connection and try again."));
    await waitFor(() => expect(svc.patch).toHaveBeenLastCalledWith({}));
    await waitFor(() => expect(pressed(/Lose weight/)).toBe('false'));
    expect(button(/continue/i).disabled).toBe(true);
  });
});
