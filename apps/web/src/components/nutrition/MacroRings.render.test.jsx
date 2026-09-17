// The macro rings (ROADMAP 4a-iii): the server's plan numbers, or the honest
// empty state that names the questions the plan still needs, in the onboarding
// screens' own words, and opens onboarding on them.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import MacroRings from './MacroRings';

afterEach(() => cleanup());

function Arrived() {
  const { pathname, state } = useLocation();
  return <p>{`AT ${pathname}, BACK TO ${state?.returnTo ?? 'nowhere'}`}</p>;
}

const TOTALS = { kcal: 500, protein_g: 40, carbs_g: 60, fat_g: 10 };

const draw = (props) =>
  render(
    <MemoryRouter initialEntries={['/nutrition']}>
      <Routes>
        <Route path="/nutrition" element={<MacroRings totals={TOTALS} {...props} />} />
        <Route path="/onboarding" element={<Arrived />} />
        <Route path="/settings" element={<p>SETTINGS</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('the macro rings', () => {
  it('with no number, names the questions the plan still needs, in the screens\' words', () => {
    // What someone who finished the old form is missing.
    draw({ targets: null, missingInputs: ['goal', 'dayActivity'] });
    expect(screen.getByText('To see your daily calories and macros, answer your weight goal and your day.')).toBeTruthy();
    expect(screen.queryByText(/Settings/)).toBeNull();
  });

  it('"Answer now" opens onboarding, to come back to the rings', () => {
    draw({ targets: null, missingInputs: ['targetWeightKg', 'pace'] });
    expect(screen.getByText('To see your daily calories and macros, answer your target weight and a pace.')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Answer now' }));
    expect(screen.getByText('AT /onboarding, BACK TO /nutrition')).toBeTruthy();
  });

  it('never blames the person when the numbers could not be read', () => {
    draw({ targets: undefined, missingInputs: [] });
    expect(screen.getByText(/Couldn.t load your targets/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Answer now' })).toBeNull();
  });

  it('shows the server\'s numbers on the rings, with nothing to answer', () => {
    draw({ targets: { kcal: 1267, protein_g: 140, carbs_g: 98, fat_g: 35 }, missingInputs: [] });
    for (const text of ['/ 1267', '/ 140 g', '/ 98 g', '/ 35 g']) expect(screen.getByText(text), text).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Answer now' })).toBeNull();
  });

  it('with the target on the wrong side of the weight (a goal changed, or the target reached), asks for a new one, never says it is unanswered', () => {
    draw({ targets: null, missingInputs: [], targetWrongSide: true });
    expect(
      screen.getByText('Time to set a new target weight. Pick one to see your daily calories and macros.'),
    ).toBeTruthy();
    expect(screen.queryByText(/answer/i)).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Pick a new target' }));
    expect(screen.getByText('AT /onboarding, BACK TO /nutrition')).toBeTruthy();
  });
});
