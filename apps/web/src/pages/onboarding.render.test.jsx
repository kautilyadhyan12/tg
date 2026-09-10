// Onboarding v2, screens 1–7, drawn in a browser-shaped test. The server is a
// small stand-in that stores what it is sent and answers with a plan only once
// the eight core answers are in, as the real route does (the real route is
// proved in apps/api/test/users.onboarding.routes.test.ts). What is pinned
// here is the SCREEN: a tap saves at once, the number appears only when the
// server has one, the target screen is asked only for a goal that moves the
// weight, "No equipment" stands alone, and Finish opens the training side
// only when the server agrees.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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
  mainGoal: null, age: null, gender: null, heightCm: null, weightKg: null, targetWeightKg: null, pace: null,
  dayActivity: null, fitnessLevel: null, pushUpsMax: null, plankHoldSeconds: null, trainingDays: null,
  sessionMinutes: null, availableEquipment: [], onboardingCompleted: false, updatedAt: null,
};
const ALL = {
  ...EMPTY, mainGoal: 'weight_loss', age: 30, gender: 'female', heightCm: 165, weightKg: 70, targetWeightKg: 65,
  pace: 'steady', dayActivity: 'sitting', fitnessLevel: 'beginner', trainingDays: 3, sessionMinutes: 45,
  availableEquipment: ['dumbbells'],
};

/** The route's golden person (users.onboarding.routes.test.ts). */
const PLAN = {
  restingBurnKcal: 1420, dailyBurnKcal: 1817, targetKcal: 1267, dailyChangeKcal: -550, proteinG: 140,
  carbsG: 98, fatG: 35, plannedTargetKg: 65, daysToTarget: 70, finishDate: '2026-11-19', flags: [],
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
const type = (label, value) => {
  const box = screen.getByLabelText(label);
  fireEvent.change(box, { target: { value } });
  fireEvent.blur(box);
};
const saved = (body) => waitFor(() => expect(svc.patch).toHaveBeenCalledWith(body));
/** What the server holds. Answers given while a save is out travel together
 *  in the next one (the queue), so a test that wants "it was saved" reads the
 *  server, not the shape of each request. */
const stored = (answers) => waitFor(() => expect(server.answers).toMatchObject(answers));
const next = async (title) => {
  tap(/continue/i);
  await heading(title);
};

/** Screen 2 in kilograms and centimetres. */
const aboutYou = async () => {
  tap('kg · cm');
  type('Age', '30');
  tap(/^Female$/);
  type('Height in centimetres', '165');
  type('Weight', '70');
  await stored({ age: 30, gender: 'female', heightCm: 165, weightKg: 70 });
};

beforeEach(() => {
  auth.updateUser.mockClear();
  toast.error.mockClear();
});
afterEach(() => cleanup());

describe('onboarding screens 1–7', () => {
  it('starts a new person on the goal screen, with no number and a list of what it needs', async () => {
    serve();
    draw();
    await heading('Your goal');
    expect(panel().textContent).toContain('It appears once you have answered your goal, your age');
    expect(panel().textContent).not.toMatch(/kcal/);
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
    type('Target weight', '65');
    tap(/^Steady/);
    await stored({ targetWeightKg: 65, pace: 'steady' });
    await next('Your day');
    tap(/Mostly sitting/);
    await next('Your training');
    tap(/^Beginner/);
    await next('Your week');
    await waitFor(() => expect(panel().textContent).toContain('training days a week and session length'));
    expect(panel().textContent).not.toMatch(/kcal/);

    tap('3 days a week');
    tap('45 min');
    await waitFor(() => expect(panel().textContent).toContain('1,267kcal a day'));
    expect(panel().textContent).toContain('550 less than the 1,817 you burn a day.');
    expect(panel().textContent).toContain('Reach 65 kg around Nov 19, 2026.');
    expect(panel().textContent).toContain('not medical advice');
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

  it('saves pounds as kilograms, and a height in feet and inches once, when the pair is left', async () => {
    serve({ mainGoal: 'posture' });
    draw();
    await heading('About you');
    expect(pressed('lb · ft')).toBe('true'); // the test browser is en-US
    type('Weight', '154');
    await stored({ weightKg: 69.85 });

    const ft = screen.getByLabelText('Height in feet');
    const inch = screen.getByLabelText('Height in inches');
    fireEvent.change(ft, { target: { value: '5' } });
    fireEvent.blur(ft, { relatedTarget: inch }); // moving between the two boxes saves nothing
    fireEvent.change(inch, { target: { value: '9' } });
    fireEvent.blur(inch);
    await stored({ heightCm: 175.26 });
    expect(svc.patch.mock.calls.filter(([body]) => 'heightCm' in body)).toHaveLength(1);
  });

  it('refuses an age under 16 on the spot and saves nothing', async () => {
    serve({ mainGoal: 'posture' });
    draw();
    await heading('About you');
    type('Age', '15');
    expect(await screen.findByText('This app is for people aged 16 and over.')).toBeTruthy();
    expect(svc.patch.mock.calls.some(([body]) => 'age' in body)).toBe(false);
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
    expect(auth.updateUser).toHaveBeenCalledWith({ onboardingCompleted: true });
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
