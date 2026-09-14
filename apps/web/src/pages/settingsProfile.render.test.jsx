// Settings → Profile, drawn as the whole Settings page. What is pinned is the
// SCREEN: the page shows the person's name, a new name reaches the rest of the
// app as the server holds it (the sidebar and the dashboard's greeting read the
// app's copy, not this page's), and the target box never takes a weight on the
// wrong side of the current one for the goal the calories follow (RULINGS
// 2026-09-11), saying why in screen 3's own words.
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

const toast = (await import('react-hot-toast')).default;
const Settings = (await import('./Settings')).default;

/** A small stand-in for the two profile routes: it stores what it is sent and
 *  reads it back, as the real ones do. Losing weight, 70 kg, target 65. */
let server;
function serve({ me = {}, fitness = {} } = {}) {
  server = {
    me: {
      id: 'u1', email: 'kd@example.com', displayName: 'Kd', weightKg: 70, onboardingCompleted: true,
      createdAt: '2026-09-01T00:00:00.000Z', ...me,
    },
    fitness: {
      age: 30, gender: 'female', heightCm: 165, targetWeightKg: 65, fitnessLevel: 'beginner',
      fitnessGoals: [], weightGoal: 'lose', exerciseFrequency: 3, availableEquipment: [],
      sessionDurationMin: 45, preferredWorkoutTime: null, onboardingCompleted: true,
      updatedAt: null, ...fitness,
    },
  };
  svc.getProfile = vi.fn(async () => ({ data: { user: { ...server.me } } }));
  svc.getFitnessProfile = vi.fn(async () => ({ data: { fitnessProfile: { ...server.fitness } } }));
  svc.updateProfile = vi.fn(async (patch) => {
    Object.assign(server.me, patch);
    return { data: { user: { ...server.me } } };
  });
  svc.putFitnessProfile = vi.fn(async (body) => {
    Object.assign(server.fitness, body);
    return { data: { fitnessProfile: { ...server.fitness } } };
  });
}

const type = (shown, text) => fireEvent.change(screen.getByDisplayValue(shown), { target: { value: text } });
const save = () => fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
const loaded = () => screen.findByDisplayValue('Kd');

beforeEach(() => {
  auth.updateUser.mockClear();
  toast.error.mockClear();
});
afterEach(() => cleanup());

describe('Settings → Profile', () => {
  it('shows the name, and a new name reaches the rest of the app as the server holds it', async () => {
    serve();
    // This server keeps its own spelling of a new name, so the app must pass
    // on the one it sends back, not the one typed.
    svc.updateProfile = vi.fn(async () => {
      server.me.displayName = 'Kd R.';
      return { data: { user: { ...server.me } } };
    });
    render(<Settings />);
    expect(await screen.findByText('Kd')).toBeTruthy(); // the page's own header
    type('Kd', 'Kd Renamed');
    save();
    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ displayName: 'Kd R.' }));
    expect(svc.updateProfile).toHaveBeenCalledWith({ displayName: 'Kd Renamed' });
    // The header reads the name back from the server.
    expect(await screen.findByText('Kd R.')).toBeTruthy();
  });

  it('a rename the server refuses leaves the name the app shows as it was', async () => {
    serve();
    svc.updateProfile = vi.fn(async () => {
      throw Object.assign(new Error('server down'), { response: { status: 500 } });
    });
    render(<Settings />);
    await loaded();
    type('Kd', 'Kd Renamed');
    save();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update profile'));
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(screen.getByText('Kd')).toBeTruthy(); // the page's own header
  });

  it("keeps screen 9's diet and meals when the Profile tab saves, though it never shows them", async () => {
    // The route is a full-document PUT, so what this tab does not show still
    // has to go back with every save, or the diet the person gave setup is
    // cleared by a change of age. The Fitness tab passes both explicitly; this
    // tab relies on the merge carrying them, which is what is pinned here.
    serve({ fitness: { diet: 'vegan', mealsPerDay: 5 } });
    render(<Settings />);
    await loaded();
    type('30', '31');
    save();
    await waitFor(() => expect(svc.putFitnessProfile).toHaveBeenCalledTimes(1));
    expect(svc.putFitnessProfile.mock.calls[0][0]).toMatchObject({ age: 31, diet: 'vegan', mealsPerDay: 5 });
  });

  it('shows the name on the Account tab', async () => {
    serve();
    render(<Settings />);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    await waitFor(() => expect(screen.getAllByText('Kd')).toHaveLength(2)); // the header and the Name row
  });

  it("refuses a target typed on the wrong side of the weight, in screen 3's words, and sends nothing", async () => {
    serve();
    render(<Settings />);
    await loaded();
    type('65', '83');
    const why = '83.0 kg is not below your current 70.0 kg. Pick a weight below it.';
    expect(screen.getByText(why)).toBeTruthy();
    save();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(why));
    expect(svc.putFitnessProfile).not.toHaveBeenCalled();
    expect(svc.updateProfile).not.toHaveBeenCalled();
  });

  it("says a target under the lowest healthy weight in screen 3's words, and still saves it (Kd, 2026-09-14)", async () => {
    serve(); // Female, 30, 165 cm, 70 kg, losing weight: the lowest healthy weight is 50.4 kg
    render(<Settings />);
    await loaded();
    const line = 'Your target is below the lowest healthy weight for your height, 50.4 kg. Your plan will not take you below it.';
    expect(screen.queryByText(line)).toBeNull();
    type('65', '45');
    expect(screen.getByText(line)).toBeTruthy();
    save();
    await waitFor(() => expect(svc.putFitnessProfile).toHaveBeenCalledWith(expect.objectContaining({ targetWeightKg: 45 })));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('holds that target to the age and height typed beside it', async () => {
    serve();
    render(<Settings />);
    await loaded();
    type('65', '49');
    expect(screen.getByText(/below the lowest healthy weight for your height, 50\.4 kg\./)).toBeTruthy();
    type('30', '16'); // a girl of 16 at 165 cm: 48.8 kg (Cole and colleagues, 2007)
    expect(screen.queryByText(/lowest healthy weight/)).toBeNull();
    type('165', '175'); // and at 175 cm, 54.8 kg
    expect(screen.getByText(/below the lowest healthy weight for your height, 54\.8 kg\./)).toBeTruthy();
  });

  it('holds the target to the weight typed beside it', async () => {
    serve();
    render(<Settings />);
    await loaded();
    type('70', '64');
    type('65', '66'); // below the stored 70, but not below the 64 being saved
    const why = '66.0 kg is not below your current 64.0 kg. Pick a weight below it.';
    expect(screen.getByText(why)).toBeTruthy();
    save();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(why));
    expect(svc.putFitnessProfile).not.toHaveBeenCalled();
  });

  it('names a stored target left on the wrong side, and still saves the rest of the form', async () => {
    // A loss target kept when the weight choice changed to Gain weight on the Fitness tab.
    serve({ fitness: { fitnessGoals: ['flexibility'], weightGoal: 'gain' } });
    render(<Settings />);
    await loaded();
    expect(screen.getByText('65.0 kg is not above your current 70.0 kg. Pick a weight above it.')).toBeTruthy();
    type('Kd', 'Kd Renamed');
    save();
    await waitFor(() => expect(svc.updateProfile).toHaveBeenCalledWith({ displayName: 'Kd Renamed' }));
    expect(svc.putFitnessProfile).toHaveBeenCalledWith(expect.objectContaining({ targetWeightKg: 65 }));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("saves a target on the weight choice's side, and any target when the choice keeps the weight or is not made", async () => {
    serve({ fitness: { weightGoal: 'gain' } });
    render(<Settings />);
    await loaded();
    type('65', '75');
    expect(screen.queryByText(/is not above/)).toBeNull();
    save();
    await waitFor(() => expect(svc.putFitnessProfile).toHaveBeenCalledWith(expect.objectContaining({ targetWeightKg: 75 })));
    cleanup();

    serve({ fitness: { fitnessGoals: ['posture'], weightGoal: 'maintain' } });
    render(<Settings />);
    await loaded();
    type('65', '83');
    expect(screen.queryByText(/is not (above|below)/)).toBeNull();
    save();
    await waitFor(() => expect(svc.putFitnessProfile).toHaveBeenCalledWith(expect.objectContaining({ targetWeightKg: 83 })));
    cleanup();

    // Building muscle is not gaining weight (RULINGS 2026-09-11): ticked with no
    // weight choice made, it holds a target to neither side, and the save keeps
    // the choice unmade.
    serve({ fitness: { fitnessGoals: ['muscle_gain'], weightGoal: null } });
    render(<Settings />);
    await loaded();
    type('65', '83');
    expect(screen.queryByText(/is not (above|below)/)).toBeNull();
    save();
    await waitFor(() =>
      expect(svc.putFitnessProfile).toHaveBeenCalledWith(expect.objectContaining({ targetWeightKg: 83, weightGoal: null })),
    );
  });
});

// A save sends the weight only when the person changed it. The form loads the
// current weight into its box, and the server saves any weight it is sent as a
// "typed by me" weigh-in, so the number already showing must never be sent
// back with a name change.
describe('the Settings profile form sends only what changed', () => {
  /** Draws the page, replaces each box showing `from` with `to`, presses Save,
   *  and waits for the save to finish (the page reloads the profile when it does). */
  const saveWith = async (edits) => {
    serve({ me: { weightKg: 90 }, fitness: { targetWeightKg: 80, fitnessGoals: [], weightGoal: null } });
    render(<Settings />);
    for (const [from, to] of edits) {
      fireEvent.change(await screen.findByDisplayValue(from), { target: { value: to } });
    }
    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(svc.getProfile).toHaveBeenCalledTimes(2));
  };

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
