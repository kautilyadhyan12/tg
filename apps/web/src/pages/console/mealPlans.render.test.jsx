// PLANS IN THE CONSOLE, drawn (ROADMAP Stage 2 24a-i; spec Part 6 §16.6). Only the network is
// mocked: what staff see is read off the real page.
//
// The worst thing the screen could do: save a meal to a day or a meal staff did not open, or
// lose the day's other meals on the way, so every save is checked against the day it was made on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FOOD_ALLERGY_CAUTION } from '@app/shared';

const svc = {
  list: vi.fn(), get: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn(), putDay: vi.fn(), measures: vi.fn(), searchFoods: vi.fn(),
  given: vi.fn(), groups: vi.fn(), givePreview: vi.fn(), give: vi.fn(), stop: vi.fn(),
};
const NOBODY = { gets: 0, groups: [], members: [] };
const orgApi = { getMine: vi.fn() };
vi.mock('../../api/mealPlansApi', () => ({ mealPlansService: svc }));
vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: orgApi };
});

const MealPlans = (await import('./MealPlans')).default;
const { resetConsoleOrgs } = await import('./consoleOrgs');

const ORG = {
  id: 'g1',
  slug: 'iron-house',
  name: 'Iron House',
  staffRole: 'owner',
  privileges: ['members.read', 'plans.manage'],
  timezone: 'Europe/London',
  clockFormat: '24h',
  orgType: 'gym',
  subscription: { status: 'trialing', trialEndsAt: '2099-01-01T00:00:00.000Z' },
};
const item = (canonical, name, gramsPoint, kcalPoint, over = {}) => ({
  name, canonical, gramsPoint, gramsRange: [gramsPoint, gramsPoint], portionSource: 'default', nutritionSource: 'curated',
  kcalPoint, kcalLow: kcalPoint, kcalHigh: kcalPoint, proteinG: 2, carbsG: 20, fatG: 1, ...over,
});
const totalsOf = (items) => ({
  kcalPoint: items.reduce((n, i) => n + i.kcalPoint, 0), kcalLow: 0, kcalHigh: 0,
  proteinG: items.reduce((n, i) => n + i.proteinG, 0), carbsG: items.reduce((n, i) => n + i.carbsG, 0), fatG: items.reduce((n, i) => n + i.fatG, 0),
});
const meal = (mealType, items) => ({ mealType, items, totals: totalsOf(items) });
const BANANA = item('banana', 'Banana', 118, 105);
const RICE = item('rice_white_cooked', 'Rice (white, cooked)', 180, 234);
const DAL = item('own_mum_s_dal', "Mum's dal", 250, 239, { nutritionSource: 'own', proteinG: 12.3, carbsG: 30.1, fatG: 7.7, per100g: { kcal: 95.56, proteinG: 4.92, carbsG: 12.04, fatG: 3.08 } });
const day = (n, meals = []) => {
  const all = meals.flatMap((m) => m.items);
  const t = totalsOf(all);
  return { day: n, meals, planned: { kcal: t.kcalPoint, proteinG: Math.round(t.proteinG), carbsG: Math.round(t.carbsG), fatG: Math.round(t.fatG) }, version: `${String(n).padStart(2, '0')}00000000000000` };
};
const planOf = (days = {}, over = {}) => {
  const week = [1, 2, 3, 4, 5, 6, 7].map((n) => day(n, days[n] ?? []));
  return {
    id: 'p1', name: 'Lean week', writtenBy: 'Sam Lee', changedBy: 'Sam Lee', createdAt: '2026-11-05T10:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z',
    meals: week.reduce((n, d) => n + d.meals.length, 0), days: week, caution: FOOD_ALLERGY_CAUTION, ...over,
  };
};
const SEARCHED_BANANA = {
  canonical: 'banana', name: 'Banana', kcal: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3, fiberG: 2.6, serving: 118, unit: 'g', source: 'curated',
  measures: [{ id: 'g', name: 'g', grams: 1 }, { id: 'piece-1', name: 'medium banana', grams: 118 }], startsAt: { measure: 'piece-1', amount: 1 }, startsKcal: 105,
};
const refusal = (status, error, message) => Object.assign(new Error(message), { response: { status, data: { error, message } } });

const open = (path = '/console/iron-house/plans/p1', org = ORG) => {
  orgApi.getMine.mockResolvedValue({ data: { orgs: [org], formerOrgs: [] } });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/console/:orgSlug/plans" element={<MealPlans />} />
        <Route path="/console/:orgSlug/plans/:planId" element={<MealPlans />} />
      </Routes>
    </MemoryRouter>,
  );
};
const dayTab = (name) => screen.getByRole('tab', { name });
const mealCard = (name) => screen.getByRole('heading', { name, level: 3 }).closest('li');
const box = () => within(screen.getByTestId('meal-box'));

beforeEach(() => {
  resetConsoleOrgs();
  for (const fn of Object.values(svc)) fn.mockReset();
  svc.given.mockResolvedValue(NOBODY);
  vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a meal is saved to the day and the meal it was opened on, the rest of the day kept', () => {
  it('changing Tuesday’s lunch sends Tuesday, with its breakfast as it was and lunch changed', async () => {
    const plan = planOf({ 1: [meal('lunch', [RICE])], 2: [meal('breakfast', [BANANA]), meal('lunch', [RICE, DAL])] });
    svc.get.mockResolvedValue(plan);
    svc.measures.mockResolvedValue([[{ id: 'g', name: 'g', grams: 1 }, { id: 'usda-1', name: 'cup', grams: 158 }], [{ id: 'g', name: 'g', grams: 1 }]]);
    svc.putDay.mockImplementation((_g, _p, n, body) => Promise.resolve(planOf({ ...{ 1: plan.days[0].meals }, [n]: [meal('breakfast', [BANANA]), meal('lunch', [item('rice_white_cooked', 'Rice (white, cooked)', 200, 260), DAL])] }, { meals: 3, ...(body ? {} : {}) })));
    open();
    await screen.findByRole('heading', { name: 'Lean week' });
    fireEvent.click(dayTab('Tuesday'));
    fireEvent.click(within(mealCard('Lunch')).getByRole('button', { name: 'Change Lunch' }));
    await waitFor(() => expect(svc.measures).toHaveBeenCalledWith('g1', 'p1', 2, 1));
    const grams = await box().findByRole('spinbutton', { name: 'How much Rice (white, cooked)' });
    fireEvent.change(grams, { target: { value: '200' } });
    fireEvent.click(box().getByRole('button', { name: 'Save to plan' }));
    await screen.findByText('Lunch saved to Tuesday.');
    expect(svc.putDay).toHaveBeenCalledTimes(1);
    const [gymId, planId, dayNumber, body] = svc.putDay.mock.calls[0];
    expect([gymId, planId, dayNumber]).toEqual(['g1', 'p1', 2]);
    expect(body.version).toBe(plan.days[1].version);
    expect(body.meals).toEqual([
      { mealType: 'breakfast', items: [{ canonical: 'banana', grams: 118 }] },
      { mealType: 'lunch', items: [{ canonical: 'rice_white_cooked', grams: 200 }, { name: "Mum's dal", grams: 250, own: { proteinG: 12.3, carbsG: 30.1, fatG: 7.7 } }] },
    ]);
  });

  it('a new breakfast on Monday from the search goes in before Monday’s lunch, as the phone orders a day, by the food’s own measure', async () => {
    svc.get.mockResolvedValue(planOf({ 1: [meal('lunch', [RICE])] }));
    svc.searchFoods.mockResolvedValue([SEARCHED_BANANA]);
    svc.putDay.mockResolvedValue(planOf({ 1: [meal('lunch', [RICE]), meal('breakfast', [BANANA])] }));
    open();
    await screen.findByRole('heading', { name: 'Lean week' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a meal' }));
    fireEvent.click(within(screen.getByTestId('pick-meal')).getByRole('button', { name: 'Breakfast' }));
    fireEvent.change(box().getByRole('searchbox', { name: 'Search food' }), { target: { value: 'banana' } });
    fireEvent.click(await box().findByRole('button', { name: 'Add Banana' }, { timeout: 2000 }));
    expect(box().getByRole('combobox', { name: 'Measure of Banana' }).value).toBe('piece-1');
    // Picked, the list closes: Save sits under the meal's foods.
    expect(box().queryByRole('searchbox', { name: 'Search food' })).toBeNull();
    expect(box().getByRole('button', { name: 'Add another food' })).toBeTruthy();
    fireEvent.click(box().getByRole('button', { name: 'Save to plan' }));
    await screen.findByText('Breakfast saved to Monday.');
    const [, , n, body] = svc.putDay.mock.calls[0];
    expect(n).toBe(1);
    expect(body.meals).toEqual([
      { mealType: 'breakfast', items: [{ canonical: 'banana', measure: 'piece-1', amount: 1 }] },
      { mealType: 'lunch', items: [{ canonical: 'rice_white_cooked', grams: 180 }] },
    ]);
  });

  it('Breakfast picked again on a day that has one opens that breakfast, and its new food joins it; a second snack is a meal of its own', async () => {
    svc.get.mockResolvedValue(planOf({ 1: [meal('breakfast', [BANANA]), meal('snack', [BANANA])] }));
    svc.measures.mockResolvedValue([[{ id: 'g', name: 'g', grams: 1 }]]);
    svc.searchFoods.mockResolvedValue([{ ...SEARCHED_BANANA, canonical: 'rice_white_cooked', name: 'Rice (white, cooked)', measures: [{ id: 'g', name: 'g', grams: 1 }], startsAt: { measure: 'g', amount: 150 } }]);
    svc.putDay.mockResolvedValue(planOf({ 1: [meal('breakfast', [BANANA, RICE]), meal('snack', [BANANA])] }));
    open();
    await screen.findByRole('heading', { name: 'Lean week' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a meal' }));
    fireEvent.click(within(screen.getByTestId('pick-meal')).getByRole('button', { name: 'Breakfast' }));
    expect(box().getByRole('heading', { name: 'Breakfast · Monday' })).toBeTruthy();
    expect(box().getByText('Banana')).toBeTruthy();
    await waitFor(() => expect(svc.measures).toHaveBeenCalledWith('g1', 'p1', 1, 0));
    fireEvent.change(box().getByRole('searchbox', { name: 'Search food' }), { target: { value: 'rice' } });
    fireEvent.click(await box().findByRole('button', { name: 'Add Rice (white, cooked)' }, { timeout: 2000 }));
    fireEvent.click(box().getByRole('button', { name: 'Save to plan' }));
    await screen.findByText('Breakfast saved to Monday.');
    expect(svc.putDay.mock.calls[0][3].meals).toEqual([
      { mealType: 'breakfast', items: [{ canonical: 'banana', grams: 118 }, { canonical: 'rice_white_cooked', grams: 150 }] },
      { mealType: 'snack', items: [{ canonical: 'banana', grams: 118 }] },
    ]);
    // A snack picked again is a second snack.
    fireEvent.click(screen.getByRole('button', { name: 'Add a meal' }));
    fireEvent.click(within(screen.getByTestId('pick-meal')).getByRole('button', { name: 'Snack' }));
    expect(box().getByRole('heading', { name: 'Snack · Monday' })).toBeTruthy();
    expect(box().getByText('No foods in this meal yet.')).toBeTruthy();
  });

  it('a food of the writer’s own is sent with its name, grams, protein, carbs and fat, and refused when they weigh more than it', async () => {
    svc.get.mockResolvedValue(planOf());
    svc.putDay.mockResolvedValue(planOf({ 1: [meal('dinner', [DAL])] }));
    open();
    await screen.findByRole('heading', { name: 'Lean week' });
    fireEvent.click(screen.getByRole('button', { name: 'Add a meal' }));
    fireEvent.click(within(screen.getByTestId('pick-meal')).getByRole('button', { name: 'Dinner' }));
    fireEvent.click(box().getByRole('button', { name: 'Add your own food' }));
    const own = within(screen.getByTestId('own-food'));
    fireEvent.change(own.getByRole('textbox', { name: 'Name' }), { target: { value: 'Chicken curry' } });
    fireEvent.change(own.getByRole('spinbutton', { name: 'Grams' }), { target: { value: '100' } });
    fireEvent.change(own.getByRole('spinbutton', { name: 'Protein (g)' }), { target: { value: '60' } });
    fireEvent.change(own.getByRole('spinbutton', { name: 'Carbs (g)' }), { target: { value: '50' } });
    fireEvent.click(own.getByRole('button', { name: 'Add to this meal' }));
    expect(own.getByRole('alert').textContent).toBe('Protein, carbs and fat together can’t weigh more than the food.');
    fireEvent.change(own.getByRole('spinbutton', { name: 'Carbs (g)' }), { target: { value: '10' } });
    fireEvent.change(own.getByRole('spinbutton', { name: 'Fat (g)' }), { target: { value: '5' } });
    fireEvent.click(own.getByRole('button', { name: 'Add to this meal' }));
    fireEvent.click(box().getByRole('button', { name: 'Save to plan' }));
    await screen.findByText('Dinner saved to Monday.');
    expect(svc.putDay.mock.calls[0][3].meals).toEqual([{ mealType: 'dinner', items: [{ name: 'Chicken curry', grams: 100, own: { proteinG: 60, carbsG: 10, fatG: 5 } }] }]);
  });
});

describe('the page', () => {
  it('lists the gym’s plans, and New meal plan makes one and opens it', async () => {
    svc.list.mockResolvedValue({ plans: [{ id: 'p0', name: 'Bulk week', writtenBy: 'Sam Lee', changedBy: 'Priya Shah', createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-04T10:00:00.000Z', meals: 21, givenTo: { everyone: true, groups: ['Gold Monthly'], members: 2 }, gets: 140 }, { id: 'p2', name: 'Cut week', writtenBy: 'Sam Lee', changedBy: 'Sam Lee', createdAt: '2026-11-03T10:00:00.000Z', updatedAt: '2026-11-03T10:00:00.000Z', meals: 0, givenTo: { everyone: false, groups: [], members: 0 }, gets: 0 }] });
    svc.create.mockResolvedValue(planOf({}, { id: 'p1', name: 'Lean week', meals: 0 }));
    svc.get.mockResolvedValue(planOf({}, { meals: 0 }));
    open('/console/iron-house/plans');
    await screen.findByRole('link', { name: 'Bulk week' });
    expect(screen.getByText('21 meals a week · By Sam Lee · Changed 4 Nov by Priya Shah')).toBeTruthy();
    // A plan nobody has changed since it was made says so.
    expect(screen.getByText('No meals yet · By Sam Lee · Made 3 Nov')).toBeTruthy();
    // Who each is given to, and how many get it, on the list.
    expect(screen.getAllByTestId('plan-given').map((p) => p.textContent)).toEqual(['Given to everybody, Gold Monthly and 2 members · 140 get it', 'Not given to anyone yet']);
    fireEvent.click(screen.getByRole('button', { name: 'New meal plan' }));
    const made = within(screen.getByTestId('new-plan'));
    fireEvent.click(made.getByRole('button', { name: 'Make plan' }));
    expect(made.getByRole('alert').textContent).toBe('Give the plan a name.');
    fireEvent.change(made.getByRole('textbox', { name: 'Name' }), { target: { value: ' Lean week ' } });
    fireEvent.click(made.getByRole('button', { name: 'Make plan' }));
    await screen.findByText('Lean week is ready. Add its meals, a day at a time.');
    expect(svc.create).toHaveBeenCalledWith('g1', '00000000-0000-4000-8000-000000000001', 'Lean week');
    expect(screen.getByText('No meals on Monday yet.')).toBeTruthy();
    expect(screen.getByText(FOOD_ALLERGY_CAUTION)).toBeTruthy();
  });

  it('with no plans, says how to write the first', async () => {
    svc.list.mockResolvedValue({ plans: [] });
    open('/console/iron-house/plans');
    expect(await screen.findByText('No meal plans yet. Write your first one with New meal plan.')).toBeTruthy();
  });

  it('Remove asks first; Keep it changes nothing, Remove meal sends the day without it', async () => {
    svc.get.mockResolvedValue(planOf({ 1: [meal('breakfast', [BANANA]), meal('lunch', [RICE])] }));
    svc.putDay.mockResolvedValue(planOf({ 1: [meal('lunch', [RICE])] }));
    open();
    await screen.findByRole('heading', { name: 'Lean week' });
    fireEvent.click(within(mealCard('Breakfast')).getByRole('button', { name: 'Remove Breakfast' }));
    const ask = screen.getByRole('dialog', { name: 'Remove Breakfast?' });
    expect(within(ask).getByText('Remove Breakfast from Monday?')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(svc.putDay).not.toHaveBeenCalled();
    fireEvent.click(within(mealCard('Breakfast')).getByRole('button', { name: 'Remove Breakfast' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Remove Breakfast?' })).getByRole('button', { name: 'Remove meal' }));
    await screen.findByText('Breakfast removed from Monday.');
    expect(svc.putDay.mock.calls[0][3].meals).toEqual([{ mealType: 'lunch', items: [{ canonical: 'rice_white_cooked', grams: 180 }] }]);
  });

  it('a day changed by somebody else meanwhile: the save is refused, the box closes, and the page says why with the day read again', async () => {
    svc.get.mockResolvedValueOnce(planOf({ 1: [meal('lunch', [RICE])] })).mockResolvedValue(planOf({ 1: [meal('lunch', [RICE]), meal('dinner', [DAL])] }));
    svc.measures.mockResolvedValue([[{ id: 'g', name: 'g', grams: 1 }]]);
    svc.putDay.mockRejectedValue(refusal(409, 'plan_changed', 'This day was changed by someone else. Open it again to make this change.'));
    open();
    await screen.findByRole('heading', { name: 'Lean week' });
    fireEvent.click(within(mealCard('Lunch')).getByRole('button', { name: 'Change Lunch' }));
    fireEvent.change(await box().findByRole('spinbutton', { name: 'How much Rice (white, cooked)' }), { target: { value: '150' } });
    fireEvent.click(box().getByRole('button', { name: 'Save to plan' }));
    // Refused, the box closes and the page says why, beside the day as it is now.
    expect((await screen.findByRole('alert')).textContent).toBe('This day was changed by someone else. Open it again to make this change.');
    await waitFor(() => expect(svc.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('meal-box')).toBeNull();
    expect(await screen.findByRole('heading', { name: 'Dinner', level: 3 })).toBeTruthy();
  });

  it('Delete asks, names what goes, and takes staff back to the list', async () => {
    svc.get.mockResolvedValue(planOf({ 1: [meal('lunch', [RICE])] }));
    svc.remove.mockResolvedValue(undefined);
    svc.list.mockResolvedValue({ plans: [] });
    open();
    await screen.findByRole('heading', { name: 'Lean week' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const ask = screen.getByRole('dialog', { name: 'Delete Lean week?' });
    expect(within(ask).getByText('Its meals are deleted with it. This can’t be undone.')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete plan' }));
    await screen.findByText('Lean week was deleted.');
    expect(svc.remove).toHaveBeenCalledWith('g1', 'p1');
  });

  it('somebody without the tick reads who can open Plans', async () => {
    svc.list.mockRejectedValue(refusal(403, 'forbidden', "Your role doesn't allow that."));
    open('/console/iron-house/plans', { ...ORG, staffRole: 'manager', privileges: ['members.read'] });
    expect(await screen.findByText('Only the owner, and staff the owner has given Write meal plans on the Staff page, can open Fitness plans.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New meal plan' })).toBeNull();
  });

  it('a plan deleted meanwhile says so, with the way back to the list', async () => {
    svc.get.mockRejectedValue(refusal(404, 'plan_not_found', 'This meal plan was deleted.'));
    open();
    expect(await screen.findByText('This meal plan was deleted.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All meal plans' }).getAttribute('href')).toBe('/console/iron-house/plans');
  });
});

describe('a meal box is never saved over a day changed since, and its unsaved foods are never lost without a question', () => {
  const MONDAY = [meal('breakfast', [BANANA]), meal('lunch', [RICE]), meal('dinner', [DAL])];
  const openLunchAndChange = async () => {
    open();
    await screen.findByRole('heading', { name: 'Lean week' });
    fireEvent.click(within(mealCard('Lunch')).getByRole('button', { name: 'Change Lunch' }));
    fireEvent.change(await box().findByRole('spinbutton', { name: 'How much Rice (white, cooked)' }), { target: { value: '150' } });
  };

  it('somebody else removes breakfast while lunch is open: the save is sent on the day as it was opened, refused, the box closes and says why', async () => {
    const opened = planOf({ 1: MONDAY });
    const since = planOf({ 1: [MONDAY[1], MONDAY[2]] });
    since.days[0].version = '01ffffffffffffff';
    svc.get.mockResolvedValueOnce(opened).mockResolvedValue(since);
    svc.measures.mockResolvedValue([[{ id: 'g', name: 'g', grams: 1 }]]);
    svc.putDay.mockRejectedValue(refusal(409, 'plan_changed', 'This day was changed by someone else. Open it again to make this change.'));
    await openLunchAndChange();
    // Staff come back to the window: the page reads the plan again under the open box.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(svc.get).toHaveBeenCalledTimes(2));
    fireEvent.click(box().getByRole('button', { name: 'Save to plan' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This day was changed by someone else. Open it again to make this change.');
    const [, , n, body] = svc.putDay.mock.calls[0];
    expect(n).toBe(1);
    expect(body.version).toBe(opened.days[0].version);
    expect(body.meals.map((m) => m.mealType)).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(body.meals[1].items).toEqual([{ canonical: 'rice_white_cooked', grams: 150 }]);
    // The box is gone: there is no Save to press again, and the day is shown as it is now.
    expect(screen.queryByTestId('meal-box')).toBeNull();
    expect(svc.putDay).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('heading', { name: 'Breakfast', level: 3 })).toBeNull();
  });

  it('another day pressed with unsaved foods asks first: Keep editing keeps them, Leave without saving goes and sends nothing', async () => {
    svc.get.mockResolvedValue(planOf({ 1: MONDAY }));
    svc.measures.mockResolvedValue([[{ id: 'g', name: 'g', grams: 1 }]]);
    await openLunchAndChange();
    fireEvent.click(dayTab('Tuesday'));
    const ask = screen.getByRole('dialog', { name: 'Save your changes?' });
    expect(within(ask).getByText('Your changes to Lunch on Monday aren’t saved yet.')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }));
    expect(box().getByRole('spinbutton', { name: 'How much Rice (white, cooked)' }).value).toBe('150');
    expect(dayTab('Monday').getAttribute('aria-selected')).toBe('true');
    for (const press of [
      () => fireEvent.click(within(mealCard('Dinner')).getByRole('button', { name: 'Change Dinner' })),
      () => fireEvent.click(screen.getByRole('button', { name: 'Rename' })),
      () => fireEvent.click(screen.getByRole('button', { name: 'Delete' })),
    ]) {
      press();
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Save your changes?' })).getByRole('button', { name: 'Keep editing' }));
      expect(box().getByRole('spinbutton', { name: 'How much Rice (white, cooked)' }).value).toBe('150');
    }
    fireEvent.click(dayTab('Tuesday'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Save your changes?' })).getByRole('button', { name: 'Leave without saving' }));
    expect(dayTab('Tuesday').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('No meals on Tuesday yet.')).toBeTruthy();
    expect(svc.putDay).not.toHaveBeenCalled();
  });

  it('Save to plan in the question saves Monday, then opens the day pressed', async () => {
    svc.get.mockResolvedValue(planOf({ 1: MONDAY }));
    svc.measures.mockResolvedValue([[{ id: 'g', name: 'g', grams: 1 }]]);
    svc.putDay.mockResolvedValue(planOf({ 1: MONDAY }));
    await openLunchAndChange();
    fireEvent.click(dayTab('Wednesday'));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Save your changes?' })).getByRole('button', { name: 'Save to plan' }));
    await screen.findByText('Lunch saved to Monday.');
    expect(svc.putDay.mock.calls[0][2]).toBe(1);
    expect(dayTab('Wednesday').getAttribute('aria-selected')).toBe('true');
  });

  it('a link (All meal plans, the menu) with unsaved foods asks first, and goes once left', async () => {
    svc.get.mockResolvedValue(planOf({ 1: MONDAY }));
    svc.measures.mockResolvedValue([[{ id: 'g', name: 'g', grams: 1 }]]);
    svc.list.mockResolvedValue({ plans: [] });
    await openLunchAndChange();
    fireEvent.click(screen.getByRole('link', { name: 'All meal plans' }));
    expect(svc.list).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Save your changes?' })).getByRole('button', { name: 'Leave without saving' }));
    expect(await screen.findByText('No meal plans yet. Write your first one with New meal plan.')).toBeTruthy();
    expect(svc.putDay).not.toHaveBeenCalled();
  });

  it('amounts that fail to load say so, with Try again', async () => {
    svc.get.mockResolvedValue(planOf({ 1: MONDAY }));
    svc.measures.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([[{ id: 'g', name: 'g', grams: 1 }]]);
    open();
    await screen.findByRole('heading', { name: 'Lean week' });
    fireEvent.click(within(mealCard('Lunch')).getByRole('button', { name: 'Change Lunch' }));
    expect(await box().findByText('We couldn’t load the amounts.')).toBeTruthy();
    fireEvent.click(box().getByRole('button', { name: 'Try again' }));
    expect(await box().findByRole('spinbutton', { name: 'How much Rice (white, cooked)' })).toBeTruthy();
    expect(box().queryByText('We couldn’t load the amounts.')).toBeNull();
  });
});

const GIVEN = {
  gets: 41,
  groups: [
    { audienceId: 'a1', kind: 'everyone', name: null, size: 40, gets: 38, givenBy: 'Sam Lee', givenAt: '2026-11-05T10:00:00.000Z' },
    { audienceId: 'a2', kind: 'tag', name: 'Beginners', size: 3, gets: 3, givenBy: 'Sam Lee', givenAt: '2026-11-05T11:00:00.000Z' },
  ],
  members: [
    { audienceId: 'a3', entryId: 'e1', name: 'Ann Lee', instead: null, givenBy: 'Sam Lee', givenAt: '2026-11-05T12:00:00.000Z' },
    { audienceId: 'a4', entryId: 'e2', name: 'Bob Ray', instead: 'Muscle week', givenBy: 'Sam Lee', givenAt: '2026-11-05T12:00:00.000Z' },
  ],
};
const given = () => within(screen.getByTestId('given'));

describe('who gets a plan', () => {
  it('shows each group and each member chosen, with who gets a newer plan', async () => {
    svc.get.mockResolvedValue(planOf({ 1: [meal('lunch', [RICE])] }));
    svc.given.mockResolvedValue(GIVEN);
    open();
    await screen.findByTestId('given');
    expect(await given().findByText('41 members get it now')).toBeTruthy();
    expect(given().getByText('Everybody')).toBeTruthy();
    expect(given().getByText('40 members')).toBeTruthy();
    expect(given().getByText('38 of them get it. 2 were given a newer meal plan.')).toBeTruthy();
    expect(given().getByText('Beginners tag')).toBeTruthy();
    expect(given().getByText('Chosen members (2)')).toBeTruthy();
    expect(given().getByText('Gets Muscle week instead')).toBeTruthy();
    // Delete says who stops getting it.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Its meals are deleted with it, and the 41 members who get it stop getting it. This can’t be undone.')).toBeTruthy();
  });

  it('Give to members: a tag, who it reaches and what it replaces, then Give sends that tag and nothing else', async () => {
    svc.get.mockResolvedValue(planOf({ 1: [meal('lunch', [RICE])] }));
    svc.groups.mockResolvedValue({ membershipTypes: [{ id: 't1', name: 'Gold Monthly' }], tags: [{ id: 'g1', name: 'Beginners' }, { id: 'g2', name: 'Seniors' }] });
    svc.givePreview.mockImplementation((gymId, planId, to) =>
      Promise.resolve({
        plan: { id: 'p1', name: 'Lean week' },
        groupName: to.kind === 'tag' ? (to.tagId === 'g2' ? 'Seniors' : 'Beginners') : to.kind === 'everyone' ? null : 'Gold Monthly',
        count: 7,
        people: [{ entryId: 'e1', name: 'Ann Lee' }, { entryId: 'e2', name: 'Bob Ray' }],
        switching: 2,
        replaces: to.kind === 'tag' ? 'Muscle week' : null,
        gone: 0,
        already: 0,
      }),
    );
    svc.give.mockResolvedValue({ ...NOBODY, gets: 7, groups: [{ audienceId: 'a9', kind: 'tag', name: 'Seniors', size: 7, gets: 7, givenBy: 'Sam Lee', givenAt: '2026-11-06T10:00:00.000Z' }] });
    open();
    await screen.findByTestId('given');
    await given().findByText('Not given to anyone yet.');
    fireEvent.click(given().getByRole('button', { name: 'Give to members' }));
    const box = within(await screen.findByTestId('give-box'));
    // Everybody is the first choice, asked about at once.
    expect(await box.findByText('7 members will get Lean week:')).toBeTruthy();
    fireEvent.click(box.getByRole('radio', { name: 'A tag' }));
    fireEvent.change(box.getByRole('combobox', { name: 'Tag' }), { target: { value: 'g2' } });
    expect(await box.findByText('The Seniors tag had Muscle week. Lean week takes its place there.')).toBeTruthy();
    expect(box.getByText('2 of them get another meal plan now. Lean week takes its place.')).toBeTruthy();
    expect(box.getByText('Anyone given this tag later gets it too.')).toBeTruthy();
    expect(svc.give).not.toHaveBeenCalled();
    fireEvent.click(box.getByRole('button', { name: 'Give to 7 members' }));
    expect(await screen.findByText('Lean week given to the Seniors tag.')).toBeTruthy();
    expect(svc.give).toHaveBeenCalledTimes(1);
    expect(svc.give).toHaveBeenCalledWith('g1', 'p1', { kind: 'tag', tagId: 'g2' });
    expect(screen.queryByTestId('give-box')).toBeNull();
    expect(given().getByText('Seniors tag')).toBeTruthy();
  });

  it('Members you choose opens Members; no memberships yet says where to add one', async () => {
    svc.get.mockResolvedValue(planOf({ 1: [meal('lunch', [RICE])] }));
    svc.groups.mockResolvedValue({ membershipTypes: [], tags: [] });
    svc.givePreview.mockResolvedValue({ plan: { id: 'p1', name: 'Lean week' }, groupName: null, count: 0, people: [], switching: 0, replaces: null, gone: 0, already: 0 });
    open();
    await screen.findByTestId('given');
    await given().findByText('Not given to anyone yet.');
    fireEvent.click(given().getByRole('button', { name: 'Give to members' }));
    const box = within(await screen.findByTestId('give-box'));
    fireEvent.click(await box.findByRole('radio', { name: 'A membership' }));
    expect(box.getByText('You have no memberships yet.')).toBeTruthy();
    // Staff who cannot open Memberships are told who can.
    expect(box.getByText('The owner can add memberships on the Memberships page.')).toBeTruthy();
    expect(box.queryByRole('link', { name: 'Open Memberships' })).toBeNull();
    fireEvent.click(box.getByRole('radio', { name: 'Members you choose' }));
    expect(box.getByText('Tick the members on Members, then press Meal plan.')).toBeTruthy();
    expect(box.getByRole('link', { name: 'Choose on Members' }).getAttribute('href')).toBe('/console/iron-house/members');
    expect(box.queryByRole('button', { name: /^Give/ })).toBeNull();
  });

  it('Stop asks first, then stops that one group only', async () => {
    svc.get.mockResolvedValue(planOf({ 1: [meal('lunch', [RICE])] }));
    svc.given.mockResolvedValue(GIVEN);
    svc.stop.mockResolvedValue({ ...GIVEN, groups: [GIVEN.groups[0]] });
    open();
    await screen.findByTestId('given');
    await given().findByText('Beginners tag');
    const row = given().getByText('Beginners tag').closest('li');
    fireEvent.click(within(row).getByRole('button', { name: 'Stop' }));
    const ask = within(row).getByRole('group', { name: 'Stop giving Lean week to the Beginners tag?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep it' }));
    expect(svc.stop).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: 'Stop' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Stop giving' }));
    expect(await screen.findByText('Lean week is no longer given to the Beginners tag.')).toBeTruthy();
    expect(svc.stop).toHaveBeenCalledWith('g1', 'p1', ['a2']);
    expect(given().queryByText('Beginners tag')).toBeNull();
  });
});
