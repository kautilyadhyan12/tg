// The Nutrition page hands the macro rings the server's answer as it came:
// the plan's numbers, the questions still open, or a target on the wrong side
// of the weight (ROADMAP 4a-iii). The rings' own words are pinned in
// components/nutrition/MacroRings.render.test.jsx; this pins the hand-over.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;

/** Today with no meals, and the targets route answering `targets`. */
function serve(targets) {
  svc.listMealsForDay = vi.fn(async () => ({ meals: [], truncated: false }));
  svc.listDishware = vi.fn(async () => ({ data: { items: [], nextCursor: null } }));
  svc.getTargets = vi.fn(async () => ({ data: targets }));
}

const draw = () =>
  render(
    <MemoryRouter initialEntries={['/nutrition']}>
      <Nutrition />
    </MemoryRouter>,
  );

afterEach(() => cleanup());

describe("the Nutrition page hands the rings the server's answer", () => {
  it('a target on the wrong side of the weight', async () => {
    serve({ targets: null, missing: [], targetWrongSide: true });
    draw();
    expect(
      await screen.findByText('Time to set a new target weight. Pick one to see your daily calories and macros.'),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pick a new target' })).toBeTruthy();
  });

  it('the questions still open', async () => {
    serve({ targets: null, missing: ['goal', 'dayActivity'], targetWrongSide: false });
    draw();
    expect(await screen.findByText('To see your daily calories and macros, answer your goal and your day.')).toBeTruthy();
    expect(screen.queryByText(/new target weight/)).toBeNull();
  });

  it("the plan's numbers", async () => {
    serve({
      targets: { bmr: 1420, tdee: 1817, kcal: 1267, proteinG: 140, carbsG: 98, fatG: 35, noCalorieCut: false },
      missing: [],
      targetWrongSide: false,
    });
    draw();
    expect(await screen.findByText('/ 1267')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /answer now|pick a new target/i })).toBeNull();
  });
});
