// Settings → Fitness, the goal chips. A person may tick many goals but never
// two that fight (RULINGS 2026-09-10), and ticking Muscle Gain must not leave
// Weight Loss ticked to be undone by hand (Kd, 2026-09-11). What is pinned is
// the SCREEN: a tap unticks the goal it fights, the save sends the goals the
// chips show, and a list stored before the rule loads without its contradiction.
// What the server does with the list is proved in
// apps/api/test/users.onboarding.routes.test.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = { putFitnessProfile: vi.fn(() => Promise.resolve({ data: {} })) };
vi.mock('../api/userApi', async (importOriginal) => ({ ...(await importOriginal()), userService: svc }));

const { FitnessTab } = await import('./Settings');

const draw = (fitnessGoals) =>
  render(<FitnessTab profile={{ fitnessGoals, availableEquipment: [], onboardingCompleted: true }} onSaved={vi.fn()} />);
const chip = (name) => screen.getByRole('button', { name });
const pressed = (name) => chip(name).getAttribute('aria-pressed');

afterEach(() => {
  cleanup();
  svc.putFitnessProfile.mockClear();
});

describe('Settings → Fitness goal chips', () => {
  it('ticking one weight goal unticks the other, and the save sends the goals the chips show', async () => {
    draw(['weight_loss', 'flexibility']);
    fireEvent.click(chip(/Muscle Gain/));
    expect(pressed(/Muscle Gain/)).toBe('true');
    expect(pressed(/Weight Loss/)).toBe('false');
    expect(pressed(/Flexibility/)).toBe('true');
    fireEvent.click(chip(/Weight Loss/));
    expect(pressed(/Weight Loss/)).toBe('true');
    expect(pressed(/Muscle Gain/)).toBe('false');
    fireEvent.click(chip(/Posture/)); // goals that keep the weight stack as before
    fireEvent.click(chip(/save changes/i));
    await waitFor(() =>
      expect(svc.putFitnessProfile).toHaveBeenCalledWith(
        expect.objectContaining({ fitnessGoals: ['flexibility', 'weight_loss', 'posture'] }),
      ),
    );
  });

  it('loads a list stored with both weight goals showing only the first of them', () => {
    draw(['muscle_gain', 'posture', 'weight_loss']);
    expect(pressed(/Muscle Gain/)).toBe('true');
    expect(pressed(/Weight Loss/)).toBe('false');
    expect(pressed(/Posture/)).toBe('true');
  });
});
