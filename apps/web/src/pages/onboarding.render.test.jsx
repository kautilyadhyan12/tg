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

const auth = { updateUser: vi.fn(), logout: vi.fn(() => Promise.resolve()) };
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/onboardingApi', async (importOriginal) => ({ ...(await importOriginal()), onboardingService: svc }));

const toast = (await import('react-hot-toast')).default;
const Onboarding = (await import('./Onboarding')).default;

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
    protein: { gPerKg: 2, weightKg: 70, wantedG: 140 },
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

const draw = () =>
  render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/dashboard" element={<p>MEMBER APP</p>} />
      </Routes>
    </MemoryRouter>,
  );

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
  auth.updateUser.mockClear();
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
    // A flick: row 20 of 16…120 is 36.
    fireEvent.wheel(age);
    age.scrollTop = 40 * 20;
    fireEvent.scroll(age);
    await saved({ age: 36 });
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
