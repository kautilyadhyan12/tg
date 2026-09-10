// The Settings profile form, rendered: a save sends the weight only when the
// person changed it. The form loads the current weight into its box, and the
// server saves any weight it is sent as a "typed by me" weigh-in, so the
// number already showing must never be sent back with a name change.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const svc = {};
vi.mock('../api/userApi', async (importOriginal) => ({ ...(await importOriginal()), userService: svc }));
vi.mock('../api/mlApi', () => ({
  default: { get: vi.fn(() => Promise.reject(new Error('old backend down'))), patch: vi.fn() },
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock('../context/TransitionContext', () => ({ useTransition: () => ({ triggerTransition: vi.fn() }) }));
vi.mock('../hooks/useMyGyms', () => ({ useMyGyms: () => ({ gyms: [] }) }));

const Settings = (await import('./Settings')).default;

const user = { id: 'u-1', email: 'kd@example.com', displayName: 'Kd', weightKg: 90, onboardingCompleted: true };
const fitnessProfile = {
  age: 30, gender: 'male', heightCm: 175, targetWeightKg: 80, fitnessLevel: 'beginner',
  fitnessGoals: [], exerciseFrequency: 3, availableEquipment: [], sessionDurationMin: 30,
  preferredWorkoutTime: 'morning', medicalConditions: null, onboardingCompleted: true,
};

beforeEach(() => {
  svc.getProfile = vi.fn().mockResolvedValue({ data: { user } });
  svc.getFitnessProfile = vi.fn().mockResolvedValue({ data: { fitnessProfile } });
  svc.putFitnessProfile = vi.fn().mockResolvedValue({ data: { fitnessProfile } });
  svc.updateProfile = vi.fn().mockResolvedValue({ data: { user } });
});
afterEach(() => cleanup());

/** Draws the page, replaces each box showing `from` with `to`, presses Save,
 *  and waits for the save to finish (the page reloads the profile when it does). */
const saveWith = async (edits) => {
  render(<Settings />);
  for (const [from, to] of edits) {
    fireEvent.change(await screen.findByDisplayValue(from), { target: { value: to } });
  }
  fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));
  await waitFor(() => expect(svc.getProfile).toHaveBeenCalledTimes(2));
};

describe('the Settings profile form', () => {
  it('a name change alone sends the name, not the weight the form loaded', async () => {
    await saveWith([['Kd', 'Kd Renamed']]);
    expect(svc.updateProfile).toHaveBeenCalledTimes(1);
    expect(svc.updateProfile.mock.calls[0][0]).toEqual({ displayName: 'Kd Renamed' });
  });

  it('a weight the person typed is sent', async () => {
    await saveWith([['90', '85']]);
    expect(svc.updateProfile).toHaveBeenCalledTimes(1);
    expect(svc.updateProfile.mock.calls[0][0]).toEqual({ weightKg: 85 });
  });

  it('a save that changes neither the name nor the weight sends nothing to /v1/users/me', async () => {
    await saveWith([]);
    expect(svc.putFitnessProfile).toHaveBeenCalledTimes(1);
    expect(svc.updateProfile).not.toHaveBeenCalled();
  });
});
