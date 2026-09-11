// Settings → Account → Reset onboarding (RULINGS 2026-07-20: it wipes every
// answer). What is pinned is the SCREEN: the confirm box says what goes and
// what stays, the reset is the onboarding route's (which clears the answers
// only the setup screens ask, as the old full-profile PUT {} could not), and
// the person is sent back through setup at once.
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
  'This clears your answers and takes you through setup again. Your name and your weigh-ins are kept. Continue?';

/** The two profile routes, for a person who finished setup: losing weight,
 *  Better balance ticked. */
function serve() {
  svc.getProfile = vi.fn(async () => ({
    data: {
      user: {
        id: 'u1', email: 'kd@example.com', displayName: 'Kd', weightKg: 70, onboardingCompleted: true,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    },
  }));
  svc.getFitnessProfile = vi.fn(async () => ({
    data: {
      fitnessProfile: {
        age: 30, gender: 'female', heightCm: 165, targetWeightKg: 65, fitnessLevel: 'beginner',
        fitnessGoals: ['balance'], weightGoal: 'lose', exerciseFrequency: 3, availableEquipment: [],
        sessionDurationMin: 45, preferredWorkoutTime: null, medicalConditions: null, onboardingCompleted: true,
        updatedAt: null,
      },
    },
  }));
  svc.putFitnessProfile = vi.fn(async () => ({ data: {} }));
}

let confirm;
beforeEach(() => {
  auth.updateUser.mockClear();
  toast.error.mockClear();
  onboarding.reset.mockReset();
  onboarding.reset.mockImplementation(() => Promise.resolve({ data: {} }));
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
