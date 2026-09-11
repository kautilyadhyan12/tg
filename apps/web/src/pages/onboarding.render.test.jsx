// Onboarding v2, screens 1–7, drawn in a browser-shaped test. The server is a
// small stand-in that stores what it is sent and answers with a plan only once
// the eight core answers are in, as the real route does (the real route is
// proved in apps/api/test/users.onboarding.routes.test.ts). What is pinned
// here is the SCREEN: a tap or a wheel saves at once and a wheel saves nothing
// until it is touched, the name box saves when it is left, the number appears
// only when the server has one and can show how it was worked out, the target
// screen is asked only for a goal that moves the weight, "No equipment" stands
// alone, and Finish opens the training side only when the server agrees.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { missingPlanInputSchema, PLAN_GOAL_BY_MAIN_GOAL } from '@app/shared';

// One auth state serves both the page and the app's own route guard.
const auth = { user: null, loading: false, updateUser: vi.fn(), logout: vi.fn(() => Promise.resolve()) };
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/onboardingApi', async (importOriginal) => ({ ...(await importOriginal()), onboardingService: svc }));

const toast = (await import('react-hot-toast')).default;
const Onboarding = (await import('./Onboarding')).default;
const { ProtectedRoute } = await import('../components/common/ProtectedRoute');

const EMPTY = {
  displayName: 'kd.test', mainGoal: null, age: null, gender: null, heightCm: null, weightKg: null,
  targetWeightKg: null, pace: null, dayActivity: null, fitnessLevel: null, pushUpsMax: null, plankHoldSeconds: null,
  trainingDays: null, sessionMinutes: null, availableEquipment: [], onboardingCompleted: false, updatedAt: null,
};
const ALL = {
  ...EMPTY, mainGoal: 'weight_loss', age: 30, gender: 'female', heightCm: 165, weightKg: 70, targetWeightKg: 65,
  pace: 'steady', dayActivity: 'sitting', fitnessLevel: 'beginner', trainingDays: 3, sessionMinutes: 45,
  availableEquipment: ['dumbbells'],
};

/** The route's golden person (users.onboarding.routes.test.ts), working and all. */
const PLAN = {
  restingBurnKcal: 1420, dailyBurnKcal: 1817, targetKcal: 1267, dailyChangeKcal: -550, proteinG: 140,
  carbsG: 98, fatG: 35, plannedTargetKg: 65, daysToTarget: 70, finishDate: '2026-11-19', flags: [],
  workings: {
    resting: { formula: 'female', weightKg: 70, heightCm: 165, age: 30, constant: -161, kcal: 1420 },
    day: { activity: 'sitting', factor: 1.2, kcal: 1704 },
    training: { kcalPerKgHour: 5, weightKg: 70, trainingDays: 3, sessionMinutes: 45, kcal: 113 },
    change: { pace: 'steady', kgPerWeek: 0.5, kcalPerKg: 7700, kcal: -550 },
    beforeFloorKcal: 1267,
    floorKcal: 1200,
    protein: { gPerKg: 2, weightKg: 70, referenceBmi: null, wantedG: 140 },
    fatShare: 0.25,
    carbsFloorG: 50,
    finish: { kgToMove: 5, kcalPerKg: 7700 },
  },
};

function missingOf(a) {
  const moves = a.mainGoal !== null && PLAN_GOAL_BY_MAIN_GOAL[a.mainGoal] !== 'maintain';
  const present = {
    goal: a.mainGoal !== null, age: a.age !== null, gender: a.gender !== null, heightCm: a.heightCm !== null,
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
function serve(initial = {}) {
  server = { answers: { ...EMPTY, ...initial }, failNext: null };
  const reply = () => {
    const missing = missingOf(server.answers);
    return { data: { answers: { ...server.answers }, plan: missing.length > 0 ? null : PLAN, missing } };
  };
  svc.get = vi.fn(async () => reply());
  svc.patch = vi.fn(async (body) => {
    if (server.failNext) {
      const err = server.failNext;
      server.failNext = null;
      throw err;
    }
    if (body.onboardingCompleted === true) {
      const missing = missingOf({ ...server.answers, ...body });
      if (missing.length > 0) throw refusal(missing);
    }
    Object.assign(server.answers, body);
    return reply();
  });
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
  auth.user = { onboardingCompleted: false }; // signed in, setup not finished
  auth.updateUser.mockClear();
  auth.logout.mockClear();
  toast.error.mockClear();
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
    await saved({ mainGoal: 'weight_loss' });
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
    serve({ mainGoal: 'weight_loss' });
    draw();
    await heading('About you');
    expect(button('Your goal').disabled).toBe(false);
    expect(button('Your target').disabled).toBe(true);
    expect(button('Equipment').disabled).toBe(true);
  });

  it('does not ask for a target when the goal keeps the weight', async () => {
    serve();
    draw();
    await heading('Your goal');
    tap(/Get fitter/);
    await saved({ mainGoal: 'general_fitness' });
    await next('About you');
    expect(screen.getByText('Step 2 of 6')).toBeTruthy();
    await aboutYou();
    await next('Your day');
    tap(/back/i);
    await heading('About you');
  });

  it('brings a returning person back to the first screen they have not answered', async () => {
    serve({ mainGoal: 'weight_loss', age: 30, gender: 'female', heightCm: 165, weightKg: 70 });
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
    serve({ mainGoal: 'posture' });
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
    serve({ mainGoal: 'posture' });
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
    serve({ mainGoal: 'posture' });
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
    serve({ mainGoal: 'posture' });
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
    serve({ mainGoal: 'posture' });
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
    serve({ mainGoal: 'posture' });
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
    serve({ mainGoal: 'posture' });
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
    serve({ mainGoal: 'posture', age: 30, gender: 'female', heightCm: 175, weightKg: 70 });
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
    serve({ mainGoal: 'posture', age: 30, gender: 'female', heightCm: 175.26, weightKg: 69.85 });
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
    await heading('Equipment');
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
    serve({ ...ALL, mainGoal: 'muscle_gain', weightKg: 240, targetWeightKg: 260 });
    draw();
    await heading('Equipment');
    tap('Your target');
    await heading('Your target');
    tap(/kg · cm/);
    expect(spin('Target weight in whole kilograms').getAttribute('aria-valuetext')).toBe('260');
    expect(spin('Target weight, tenths of a kilogram').getAttribute('aria-valuetext')).toBe('.0');
  });

  it('the target wheel cannot be set on the wrong side of the weight', async () => {
    // Kd, 2026-09-11: "Lose weight", 70 kg, target 83 was accepted without a word.
    serve({ mainGoal: 'weight_loss', age: 30, gender: 'female', heightCm: 165, weightKg: 70 });
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

    // Build muscle: the same wheel offers only weights above.
    tap('Your goal');
    await heading('Your goal');
    tap(/Build muscle/);
    await stored({ mainGoal: 'muscle_gain' });
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

  it('saves pounds as kilograms, and feet and inches as centimetres', async () => {
    serve({ mainGoal: 'posture' });
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

  it('loads an old answer of "none" beside equipment without the "none", and finishes with that', async () => {
    serve({ ...ALL, availableEquipment: ['none', 'dumbbells'] });
    draw();
    await heading('Equipment');
    expect(pressed(/No equipment/)).toBe('false');
    expect(pressed(/Dumbbells/)).toBe('true');
    tap(/finish setup/i);
    await screen.findByText('MEMBER APP');
    expect(svc.patch).toHaveBeenLastCalledWith({ availableEquipment: ['dumbbells'], onboardingCompleted: true });
    // The rest of the app greets the person by the name saved here.
    expect(auth.updateUser).toHaveBeenCalledWith({ onboardingCompleted: true, displayName: 'kd.test' });
  });

  it('when the server refuses Finish, names what is open and offers the way back to it', async () => {
    serve(ALL);
    draw();
    await heading('Equipment');
    server.answers.dayActivity = null; // cleared from another device meanwhile
    tap(/finish setup/i);
    expect(await screen.findByText('Before you finish, answer your day.')).toBeTruthy();
    expect(screen.queryByText('MEMBER APP')).toBeNull();
    expect(auth.updateUser).not.toHaveBeenCalled();
    await waitFor(() => expect(button(/finish setup/i).disabled).toBe(true));
    tap('Go to Your day');
    await heading('Your day');
  });

  it('a person who already finished setup can go back to the app, and can still sign out', async () => {
    auth.user = { onboardingCompleted: true };
    serve({ ...ALL, dayActivity: null }); // the one question the plan still needs
    draw(FROM_RINGS);
    await heading('Your day'); // it opens on that question
    expect(button(/sign out/i)).toBeTruthy();
    tap(/back to the app/i);
    await screen.findByText('NUTRITION');
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('Back to the app saves the name box first, and stays while it is blank', async () => {
    auth.user = { onboardingCompleted: true };
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
  });

  it('Back to the app waits for the saves, and a save that failed keeps them here with its message', async () => {
    auth.user = { onboardingCompleted: true };
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
    auth.user = { onboardingCompleted: true };
    serve({ ...ALL, dayActivity: null });
    draw(FROM_RINGS);
    await heading('Your day');
    tap(/Mostly sitting/);
    await stored({ dayActivity: 'sitting' });
    await next('Your training');
    await next('Your week');
    await next('Equipment');
    tap(/finish setup/i);
    await screen.findByText('NUTRITION');
  });

  it('goes to the dashboard for any other address in the page state', async () => {
    auth.user = { onboardingCompleted: true };
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
