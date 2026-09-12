// Settings → Fitness → Health (ROADMAP Stage 1 item 4b-i). Kd ruled the answer
// changeable once signed in, with everything that reads it updating at once
// (RULINGS 2026-09-09), so Settings asks the SAME question screen 8 asks, and
// saves it on the tap through its own route.
//
// What is pinned here is the SCREEN: the question is asked in the shared words,
// a yes stores nothing until "Check first" is answered, and THE OLD FREE-TEXT
// "Medical Conditions / Notes" BOX IS GONE — with it went the hint that the
// notes helped the AI give safer advice, untrue since the chat coach was
// switched off (RULINGS 2026-08-18), and every note ever typed (migration
// 0029). That the notes are really gone from the database is proved on the
// server, by the 0029 test in apps/api/test/db.migration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CHECK_FIRST_OPTIONS, HEALTH_QUESTION } from '@app/shared';

const auth = { user: { displayName: 'Kd' }, updateUser: vi.fn(), logout: vi.fn() };
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../context/TransitionContext', () => ({ useTransition: () => ({ triggerTransition: vi.fn() }) }));
vi.mock('../hooks/useMyGyms', () => ({ useMyGyms: () => ({ gyms: [] }) }));
vi.mock('../api/mlApi', () => ({
  default: { get: vi.fn(() => Promise.reject(new Error('old backend down'))), patch: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/userApi', async (importOriginal) => ({ ...(await importOriginal()), userService: svc }));
const health = {};
vi.mock('../api/healthApi', async (importOriginal) => ({ ...(await importOriginal()), healthService: health }));

const toast = (await import('react-hot-toast')).default;
const Settings = (await import('./Settings')).default;

const UNANSWERED = {
  answered: false, hasCondition: null, checkFirst: null, safeMode: false, noCalorieCut: false, updatedAt: null,
};
const screeningOf = ({ hasCondition, checkFirst = null }) => ({
  answered: true,
  hasCondition,
  checkFirst: hasCondition ? checkFirst : null,
  safeMode: hasCondition === true && checkFirst === 'not_yet',
  noCalorieCut: hasCondition === true,
  updatedAt: '2026-09-12T09:00:00.000Z',
});

const PROFILE = {
  age: 30, gender: 'female', heightCm: 165, targetWeightKg: 65, fitnessLevel: 'beginner',
  fitnessGoals: ['balance'], weightGoal: 'lose', exerciseFrequency: 3, availableEquipment: ['dumbbells'],
  sessionDurationMin: 45, preferredWorkoutTime: null, onboardingCompleted: true, updatedAt: null,
};

let server;
function serve(screening = UNANSWERED) {
  server = { health: screening, failNext: null };
  svc.getProfile = vi.fn(async () => ({
    data: {
      user: {
        id: 'u1', email: 'kd@example.com', displayName: 'Kd', weightKg: 70,
        onboardingCompleted: true, createdAt: '2026-09-01T00:00:00.000Z',
      },
    },
  }));
  svc.getFitnessProfile = vi.fn(async () => ({ data: { fitnessProfile: PROFILE } }));
  svc.putFitnessProfile = vi.fn(async () => ({ data: {} }));
  health.get = vi.fn(async () => ({ data: { healthScreening: server.health } }));
  health.put = vi.fn(async (body) => {
    if (server.failNext) {
      const err = server.failNext;
      server.failNext = null;
      throw err;
    }
    server.health = screeningOf(body);
    return { data: { healthScreening: server.health } };
  });
}

beforeEach(() => {
  toast.error.mockClear();
  serve();
});
afterEach(() => cleanup());

const button = (name) => screen.getByRole('button', { name });
const pressed = (name) => button(name).getAttribute('aria-pressed');

/** The page, opened on the Fitness tab, with the health card loaded. */
const openFitness = async () => {
  render(<Settings />);
  await screen.findByDisplayValue('Kd');
  fireEvent.click(screen.getByRole('button', { name: 'Fitness' }));
  await screen.findByText(HEALTH_QUESTION);
};

describe('Settings → Fitness → Health', () => {
  it('asks the one question in the shared words, and no longer offers the free-text notes box', async () => {
    await openFitness();
    expect(screen.getByRole('heading', { name: 'Health' })).toBeTruthy();
    // The box, its label and its untrue hint are all gone.
    expect(screen.queryByText('Medical Conditions / Notes')).toBeNull();
    expect(screen.queryByText('Optional. Helps the AI give safer advice.')).toBeNull();
    expect(screen.queryByPlaceholderText('e.g. lower back pain, knee injury')).toBeNull();
    // Nothing is pre-answered: unanswered is never a default (RULINGS 2026-07-15).
    expect(pressed('Yes')).toBe('false');
    expect(pressed('No')).toBe('false');
  });

  it('stores a no on the tap, through the health route and not the profile PUT', async () => {
    await openFitness();
    fireEvent.click(button('No'));
    await waitFor(() => expect(health.put).toHaveBeenCalledWith({ hasCondition: false }));
    expect(server.health).toMatchObject({ answered: true, hasCondition: false, noCalorieCut: false });
    expect(svc.putFitnessProfile).not.toHaveBeenCalled();
  });

  it('stores nothing for a yes until "Check first" is answered, then stores both', async () => {
    await openFitness();
    fireEvent.click(button('Yes'));
    expect(screen.getByText(CHECK_FIRST_OPTIONS.cleared.detail)).toBeTruthy();
    expect(health.put).not.toHaveBeenCalled();
    fireEvent.click(button(/^A professional has cleared me/));
    await waitFor(() => expect(health.put).toHaveBeenCalledWith({ hasCondition: true, checkFirst: 'cleared' }));
    // Any yes stops the calorie cut, cleared or not (RULINGS 2026-09-09).
    expect(server.health).toMatchObject({ hasCondition: true, checkFirst: 'cleared', safeMode: false, noCalorieCut: true });
  });

  it('shows the answer the person already gave, and changing it takes effect at once', async () => {
    serve(screeningOf({ hasCondition: true, checkFirst: 'not_yet' }));
    await openFitness();
    expect(pressed('Yes')).toBe('true');
    expect(button(/^Not yet/).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button('No'));
    await waitFor(() => expect(health.put).toHaveBeenCalledWith({ hasCondition: false }));
    // Safe mode is off the moment the answer changes; nothing is asked again.
    expect(server.health).toMatchObject({ hasCondition: false, safeMode: false, noCalorieCut: false });
    await waitFor(() => expect(pressed('No')).toBe('true'));
  });

  it('says so when a save fails, and puts the stored answer back', async () => {
    serve(screeningOf({ hasCondition: false }));
    await openFitness();
    server.failNext = new Error('down');
    fireEvent.click(button('Yes'));
    fireEvent.click(button(/^Not yet/));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(pressed('No')).toBe('true');
    expect(server.health).toMatchObject({ hasCondition: false });
  });

  it('saves the fitness preferences without the field the notes box used to send', async () => {
    await openFitness();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(svc.putFitnessProfile).toHaveBeenCalledTimes(1));
    // The PUT is .strict(): a body still carrying `medicalConditions` would be
    // a 400 on every save from this tab.
    expect(Object.keys(svc.putFitnessProfile.mock.calls[0][0])).not.toContain('medicalConditions');
    expect(svc.putFitnessProfile.mock.calls[0][0]).toMatchObject({ weightGoal: 'lose', onboardingCompleted: true });
  });
});
