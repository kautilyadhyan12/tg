// Settings → Account → Reset onboarding (RULINGS 2026-07-20: it wipes every
// answer). What is pinned is the SCREEN: the confirm box says what goes and
// what stays, the reset is the onboarding route's (which clears the answers
// only the setup screens ask, as the old full-profile PUT {} could not), and
// the person is sent back through setup at once. That what the box says is
// true is proven on the server, by the reset test in
// apps/api/test/users.onboarding.routes.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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
const onboarding = { reset: vi.fn() };
vi.mock('../api/onboardingApi', async (importOriginal) => ({ ...(await importOriginal()), onboardingService: onboarding }));

const toast = (await import('react-hot-toast')).default;
const Settings = (await import('./Settings')).default;

const CONFIRM =
  'This clears your answers, including your medical notes, and takes you through setup again. Your name, your weigh-ins and any answer you gave to the health question are kept. Continue?';

/** A person who finished setup: losing weight, Better balance ticked. */
const ANSWERED = {
  age: 30, gender: 'female', heightCm: 165, targetWeightKg: 65, fitnessLevel: 'beginner',
  fitnessGoals: ['balance'], weightGoal: 'lose', exerciseFrequency: 3, availableEquipment: [],
  sessionDurationMin: 45, preferredWorkoutTime: null, medicalConditions: null, onboardingCompleted: true,
  updatedAt: null,
};
/** What the fitness-profile route answers once the reset has removed the row:
 *  the server's empty profile. */
const CLEARED = {
  age: null, gender: null, heightCm: null, targetWeightKg: null, fitnessLevel: null,
  fitnessGoals: [], weightGoal: null, exerciseFrequency: null, availableEquipment: [],
  sessionDurationMin: null, preferredWorkoutTime: null, medicalConditions: null, onboardingCompleted: false,
  updatedAt: null,
};

/** The two profile routes, answering from what the server holds: ANSWERED
 *  until the reset, CLEARED after it. */
let held;
function serve() {
  held = ANSWERED;
  svc.getProfile = vi.fn(async () => ({
    data: {
      user: {
        id: 'u1', email: 'kd@example.com', displayName: 'Kd', weightKg: 70,
        onboardingCompleted: held.onboardingCompleted, createdAt: '2026-09-01T00:00:00.000Z',
      },
    },
  }));
  svc.getFitnessProfile = vi.fn(async () => ({ data: { fitnessProfile: held } }));
  svc.putFitnessProfile = vi.fn(async () => ({ data: {} }));
}

let confirm;
beforeEach(() => {
  auth.updateUser.mockClear();
  toast.error.mockClear();
  onboarding.reset.mockReset();
  onboarding.reset.mockImplementation(() => {
    held = CLEARED;
    return Promise.resolve({ data: {} });
  });
  serve();
});
afterEach(() => {
  cleanup();
  confirm?.mockRestore();
});

/** The page, opened on the Account tab, with the confirm box answering `yes`. */
const pressReset = async (yes) => {
  confirm = vi.spyOn(window, 'confirm').mockReturnValue(yes);
  render(<Settings />);
  await screen.findByDisplayValue('Kd');
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reset' }));
};

describe('Settings → Reset onboarding', () => {
  it('says what goes and what stays, clears every answer through the onboarding route, and sends the person back through setup', async () => {
    await pressReset(true);
    expect(confirm).toHaveBeenCalledWith(CONFIRM);
    await waitFor(() => expect(onboarding.reset).toHaveBeenCalledTimes(1));
    // Not the full-profile PUT {}: that one never reached the answers only the setup screens ask.
    expect(svc.putFitnessProfile).not.toHaveBeenCalled();
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ onboardingCompleted: false }));
  });

  it('reads the profile again after the reset, so a Fitness-tab save cannot write the cleared answers back', async () => {
    await pressReset(true);
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ onboardingCompleted: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Fitness' }));
    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(svc.putFitnessProfile).toHaveBeenCalledTimes(1));
    // The save starts from the cleared answers, never the copy from before the
    // reset, which would put "setup finished" and every answer back.
    expect(svc.putFitnessProfile.mock.calls[0][0]).toMatchObject({
      weightGoal: null, fitnessGoals: [], age: null, targetWeightKg: null, onboardingCompleted: false,
    });
  });

  it('does nothing when the person says no', async () => {
    await pressReset(false);
    expect(confirm).toHaveBeenCalledWith(CONFIRM);
    expect(onboarding.reset).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it('says so when the reset fails, and leaves the person where they are', async () => {
    onboarding.reset.mockImplementation(() => Promise.reject(new Error('down')));
    await pressReset(true);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to reset onboarding'));
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
