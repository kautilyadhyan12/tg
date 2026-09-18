// The switch over the macro rings (ROADMAP 7a-iv-e; RULINGS 2026-09-17):
// App's plan · My own. What is pinned here is the WIRING, end to end — the
// server's answer reaching the switch, the tap reaching the PUT, and the reply
// reaching the rings and "Remaining today" — because every rule behind it is
// the server's and a screen that showed the right words while sending the wrong
// body would look exactly like a pass.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));
const svc = {};
vi.mock('../api/nutritionApi', async (importOriginal) => ({ ...(await importOriginal()), nutritionService: svc }));

const Nutrition = (await import('./Nutrition')).default;

const PLAN = { bmr: 1420, tdee: 1817, kcal: 1267, proteinG: 140, carbsG: 98, fatG: 35, noCalorieCut: false };
const OWN = { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 };
/** The rings' answer as the server sends it, with the app's plan by default. */
const answer = (over = {}) => ({
  targets: PLAN, missing: [], targetWrongSide: false,
  source: 'app', appTargets: PLAN, own: null, ownHeld: null, ...over,
});

/** Today with no meals, `data` from the targets route, and a PUT that answers
 *  with `next` (or throws `refusal`, shaped as the axios error the page sees). */
function serve(data, { next = null, refusal = null } = {}) {
  svc.listMealsForDay = vi.fn(async () => ({ meals: [], truncated: false }));
  svc.listDishware = vi.fn(async () => ({ data: { items: [], nextCursor: null } }));
  svc.getTargets = vi.fn(async () => ({ data }));
  svc.putTargets = vi.fn(async () => {
    if (refusal !== null) throw { response: { data: { error: 'own_targets_below_floor', message: refusal } } };
    return { data: next ?? data };
  });
  render(
    <MemoryRouter initialEntries={['/nutrition']}>
      <Nutrition />
    </MemoryRouter>,
  );
}

/** The rings' own card, which the switch sits in. */
const macros = async () => (await screen.findByText("Today's Macros")).closest('.card-glass');
/** The calories ring's "/ N" line — the only one of the four with no unit. */
const ringTarget = async () => within(await macros()).getByText(/^\/ \d+$/).textContent;
/** What "Remaining today" prints beside its Calories row. */
const remaining = async () => {
  const box = (await screen.findByText('Remaining today')).closest('.card-glass');
  return within(box).getByText('Calories').nextElementSibling.textContent;
};
const pill = (name) => screen.getByRole('button', { name });
const editor = () => screen.getByLabelText('Calories a day');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('the switch over the rings', () => {
  it('offers both sets with their own numbers, and shows neither as picked but the app’s', async () => {
    serve(answer());
    expect(await screen.findByRole('button', { name: /App's plan/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /My own/ }).textContent).toContain('Set my own');
    // A four-digit figure is written as the rest of the page writes one.
    expect(screen.getByRole('button', { name: /App's plan/ }).textContent).toContain('1,267 kcal');
    expect(screen.getByRole('button', { name: /App's plan/ }).getAttribute('aria-pressed')).toBe('true');
    // Nothing typed yet: no editor, and no pencil to open one.
    expect(screen.queryByLabelText('Calories a day')).toBeNull();
    expect(screen.queryByLabelText('Edit my own numbers')).toBeNull();
  });

  it('starts "My own" from the app’s numbers, sends the four typed, and puts the answer on the rings', async () => {
    const mine = { ...PLAN, ...OWN };
    serve(answer(), { next: { ...answer({ source: 'own', own: OWN }), targets: mine } });
    fireEvent.click(await screen.findByRole('button', { name: /My own/ }));
    // Pre-filled with the app's plan — never a number the screen invented.
    expect(editor().value).toBe('1267');
    expect(screen.getByLabelText('Protein a day').value).toBe('140');
    // Nothing is sent by opening the box.
    expect(svc.putTargets).not.toHaveBeenCalled();

    fireEvent.change(editor(), { target: { value: '2000' } });
    fireEvent.change(screen.getByLabelText('Protein a day'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Carbs a day'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Fat a day'), { target: { value: '60' } });
    // What the macros come to is said, and never forced onto the calories.
    expect(screen.getByText(/come to 1,940 kcal/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use my numbers' }));

    await screen.findByText(/^\/ 2000$/);
    expect(svc.putTargets).toHaveBeenCalledWith({ source: 'own', ...OWN });
    expect(await ringTarget()).toBe('/ 2000');
    // "Remaining today" counts against the picked set, not the plan's.
    expect(await remaining()).toBe('2000 kcal');
    // The editor closed on the save it made.
    expect(screen.queryByLabelText('Calories a day')).toBeNull();
  });

  it('shows the server’s own refusal and leaves the rings on the app’s plan', async () => {
    serve(answer(), { refusal: 'Daily calories cannot go below 1,200 kcal.' });
    fireEvent.click(await screen.findByRole('button', { name: /My own/ }));
    fireEvent.change(editor(), { target: { value: '900' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use my numbers' }));
    expect(await screen.findByText('Daily calories cannot go below 1,200 kcal.')).toBeTruthy();
    expect(await ringTarget()).toBe('/ 1267');
    // The box stays open on what was typed, so the number can be fixed.
    expect(editor().value).toBe('900');
  });

  it('switches back to the app’s plan without retyping, and keeps the numbers', async () => {
    const mine = { ...PLAN, ...OWN };
    serve({ ...answer({ source: 'own', own: OWN }), targets: mine }, { next: answer({ own: OWN }) });
    expect(await ringTarget()).toBe('/ 2000');
    expect(screen.getByRole('button', { name: /My own/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(pill(/App's plan/));
    await screen.findByText(/^\/ 1267$/);
    expect(svc.putTargets).toHaveBeenCalledWith({ source: 'app' });
    expect(await ringTarget()).toBe('/ 1267');
    // Kept, not cleared: the pill still offers them, and one tap sends them back.
    expect(screen.getByRole('button', { name: /My own/ }).textContent).toContain('2,000 kcal');
    fireEvent.click(screen.getByRole('button', { name: /My own/ }));
    expect(svc.putTargets).toHaveBeenLastCalledWith({ source: 'own', ...OWN });
  });

  it('says why stored numbers cannot be used, and opens the editor on them', async () => {
    serve(answer({
      own: OWN,
      ownHeld: { code: 'no_cut_below_maintenance', maintenanceKcal: 1817, reasons: ['health_answer'] },
    }));
    expect(await screen.findByText(/the rings cannot use your own calories below 1,817 kcal/)).toBeTruthy();
    expect(await ringTarget()).toBe('/ 1267');
    // A held set is not switched to by tapping the pill — that would be asking
    // the server for a refusal. The editor opens on the person's own numbers.
    fireEvent.click(screen.getByRole('button', { name: /My own/ }));
    expect(svc.putTargets).not.toHaveBeenCalled();
    expect(editor().value).toBe('2000');
  });

  it('keeps the figure that binds in sight while a held set is edited, until a refusal replaces it', async () => {
    const refusal = 'Your plan holds no calorie cut, so daily calories cannot go below 1,817 kcal — what keeps your weight.';
    serve(answer({
      own: { ...OWN, kcal: 1500 },
      ownHeld: { code: 'no_cut_below_maintenance', maintenanceKcal: 1817, reasons: ['health_answer'] },
    }), { refusal });
    const hold = /the rings cannot use your own calories below 1,817 kcal/;
    fireEvent.click(await screen.findByLabelText('Edit my own numbers'));
    // Said once, and inside the open box, where the numbers are being changed.
    const box = screen.getByText('My own numbers').closest('.p-3');
    expect(screen.getAllByText(hold)).toHaveLength(1);
    expect(within(box).getByText(hold)).toBeTruthy();
    expect(editor().value).toBe('1500');
    // Still too low: the server's refusal is the newer word, and takes its place.
    fireEvent.change(editor(), { target: { value: '1600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use my numbers' }));
    expect(await within(box).findByText(refusal)).toBeTruthy();
    expect(screen.queryByText(hold)).toBeNull();
  });

  it('a plan with an answer missing says the numbers are kept, beside the questions', async () => {
    serve({
      targets: null, missing: ['goal', 'dayActivity'], targetWrongSide: false,
      source: 'app', appTargets: null, own: OWN, ownHeld: { code: 'plan_incomplete' },
    });
    expect(await screen.findByText('To see your daily calories and macros, answer your weight goal and your day.')).toBeTruthy();
    expect(screen.getByText('Your own numbers are kept: answer the setup questions to use them.')).toBeTruthy();
    // No switch: with no plan to check them against, every pick would be refused.
    expect(screen.queryByRole('button', { name: /App's plan/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /My own/ })).toBeNull();
  });

  // A stale target blanks the APP's numbers, not the person's own — so the
  // "new target" card must still reach them, or the one way back to the rings
  // without picking a target is gone (reachable: save own numbers, switch back,
  // then change the weight goal in Settings).
  it('a stale target keeps the switch to numbers left behind "App\'s plan"', async () => {
    const stale = { targets: null, missing: [], targetWrongSide: true, source: 'app', appTargets: null, own: OWN, ownHeld: null };
    serve(stale, { next: { ...stale, targets: { ...PLAN, ...OWN }, source: 'own' } });
    expect(await screen.findByText('Time to set a new target weight. Pick one to see your daily calories and macros.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pick a new target' })).toBeTruthy();
    expect(pill(/App's plan/).textContent).toContain('No number yet');
    expect(pill(/My own/).textContent).toContain('2,000 kcal');
    fireEvent.click(pill(/My own/));
    expect(svc.putTargets).toHaveBeenCalledWith({ source: 'own', ...OWN });
    await screen.findByText(/^\/ 2000$/);
    expect(await ringTarget()).toBe('/ 2000');
  });

  it('a stale target with a held set left behind: the switch, the hold, and the editor on tap', async () => {
    serve({
      targets: null, missing: [], targetWrongSide: true, source: 'app', appTargets: null,
      own: { ...OWN, kcal: 900 }, ownHeld: { code: 'below_floor', floorKcal: 1200 },
    });
    expect(await screen.findByText("The rings cannot use your own calories below the app's floor of 1,200 kcal.")).toBeTruthy();
    fireEvent.click(pill(/My own/));
    expect(svc.putTargets).not.toHaveBeenCalled();
    expect(editor().value).toBe('900');
  });

  it('a stale target with nothing stored offers no switch — there is nothing to start from', async () => {
    serve({ targets: null, missing: [], targetWrongSide: true, source: 'app', appTargets: null, own: null, ownHeld: null });
    expect(await screen.findByRole('link', { name: 'Pick a new target' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /My own/ })).toBeNull();
  });

  it('a wrong-side target blanks the app’s numbers, not the person’s own', async () => {
    serve({
      targets: { ...PLAN, ...OWN }, missing: [], targetWrongSide: true,
      source: 'own', appTargets: null, own: OWN, ownHeld: null,
    });
    expect(await ringTarget()).toBe('/ 2000');
    expect(screen.getByRole('button', { name: /App's plan/ }).textContent).toContain('No number yet');
  });
});
