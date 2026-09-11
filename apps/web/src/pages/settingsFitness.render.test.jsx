// Settings → Fitness asks screen 1's two questions and screen 7's equipment
// (4a-iv), in the screens' own words and line icons: ONE weight choice, any
// number of goals beside it, and "No equipment" standing alone. What is
// pinned is the SCREEN: a tap picks, ticks or unticks as the screens do, and
// the save sends exactly what is showing. What the server does with it is
// proved in apps/api/test/users.onboarding.routes.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = { putFitnessProfile: vi.fn(() => Promise.resolve({ data: {} })) };
vi.mock('../api/userApi', async (importOriginal) => ({ ...(await importOriginal()), userService: svc }));

const { FitnessTab } = await import('./Settings');

const draw = (profile) =>
  render(
    <FitnessTab
      profile={{ fitnessGoals: [], weightGoal: null, availableEquipment: [], onboardingCompleted: true, ...profile }}
      onSaved={vi.fn()}
    />,
  );
const chip = (name) => screen.getByRole('button', { name });
const pressed = (name) => chip(name).getAttribute('aria-pressed');
/** Presses Save and returns the one body it sent. */
const save = async () => {
  fireEvent.click(chip(/save changes/i));
  await waitFor(() => expect(svc.putFitnessProfile).toHaveBeenCalledTimes(1));
  return svc.putFitnessProfile.mock.calls[0][0];
};

afterEach(() => {
  cleanup();
  svc.putFitnessProfile.mockClear();
});

describe("Settings → Fitness: screen 1's two questions", () => {
  it('one weight choice: a tap picks it and lets the one before go', async () => {
    draw({ weightGoal: 'lose' });
    expect(pressed(/Lose weight/)).toBe('true');
    fireEvent.click(chip(/Keep my weight/));
    expect(pressed(/Keep my weight/)).toBe('true');
    expect(pressed(/Lose weight/)).toBe('false');
    // Tapping the one already picked keeps it: once given, there is always an answer.
    fireEvent.click(chip(/Keep my weight/));
    expect(pressed(/Keep my weight/)).toBe('true');
    expect(await save()).toMatchObject({ weightGoal: 'maintain' });
  });

  it('any number of goals beside it, and no tap unticks another: building muscle while losing weight included', async () => {
    draw({ weightGoal: 'lose', fitnessGoals: ['flexibility'] });
    fireEvent.click(chip(/Build muscle/));
    fireEvent.click(chip(/Better balance/));
    for (const name of [/Build muscle/, /Better balance/, /Flexibility/, /Lose weight/]) expect(pressed(name)).toBe('true');
    fireEvent.click(chip(/Flexibility/)); // unticked; the others stay
    expect(pressed(/Flexibility/)).toBe('false');
    expect(await save()).toMatchObject({ weightGoal: 'lose', fitnessGoals: ['muscle_gain', 'balance'] });
  });

  it('someone who has not made the weight choice sees none picked, and a save leaves it unmade', async () => {
    // Where the people who chose Build muscle before 4a-iv land (RULINGS 2026-09-11).
    draw({ weightGoal: null, fitnessGoals: ['muscle_gain'] });
    for (const name of [/Lose weight/, /Keep my weight/, /Gain weight/]) expect(pressed(name)).toBe('false');
    expect(pressed(/Build muscle/)).toBe('true');
    expect(await save()).toMatchObject({ weightGoal: null, fitnessGoals: ['muscle_gain'] });
  });

  it('draws line icons, never emoji', () => {
    draw({});
    for (const name of [/Lose weight/, /Build muscle/, /A gym/]) expect(chip(name).querySelector('svg')).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('Settings → Fitness: equipment', () => {
  it('offers "A gym", and makes "No equipment" stand alone as you tap', async () => {
    draw({ availableEquipment: ['dumbbells'] });
    fireEvent.click(chip(/A gym/));
    expect(pressed(/A gym/)).toBe('true');
    expect(pressed(/Dumbbells/)).toBe('true');
    fireEvent.click(chip(/No equipment/));
    expect(pressed(/No equipment/)).toBe('true');
    expect(pressed(/A gym/)).toBe('false');
    expect(pressed(/Dumbbells/)).toBe('false');
    fireEvent.click(chip(/Kettlebells/));
    expect(pressed(/No equipment/)).toBe('false');
    expect(await save()).toMatchObject({ availableEquipment: ['kettlebells'] });
  });

  it('loads an old "none" beside equipment as the equipment alone', async () => {
    draw({ availableEquipment: ['none', 'dumbbells'] });
    expect(pressed(/No equipment/)).toBe('false');
    expect(pressed(/Dumbbells/)).toBe('true');
    expect(await save()).toMatchObject({ availableEquipment: ['dumbbells'] });
  });
});
