// A MEAL PLAN GIVEN TO THE PEOPLE TICKED, drawn (ROADMAP Stage 2 24a-ii; spec Part 6 §16.6): the
// Members bar's box and a person's page. Only the network is mocked.
//
// The worst thing the screen could do: give a plan to somebody who was not ticked, so the press is
// checked to send exactly the selection the box was opened for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MEMBER_LIST_SELECTION_CHANGED_WORDS } from '@app/shared';

const svc = { list: vi.fn(), previewSelected: vi.fn(), giveSelected: vi.fn(), forRecord: vi.fn() };
vi.mock('../../api/mealPlansApi', () => ({ mealPlansService: svc }));

const { GiveMealPlanSheet, PersonMealPlan } = await import('./MealPlanGiving');

const WORDS = { person: 'member', people: 'members' };
const PLANS = { plans: [{ id: 'p1', name: 'Lean week' }, { id: 'p2', name: 'Muscle week' }] };
const TICKED = { kind: 'ticked', entryIds: ['e1', 'e2', 'e3'] };
const sheet = () => within(screen.getByTestId('give-meal-plan'));

beforeEach(() => {
  for (const fn of Object.values(svc)) fn.mockReset();
});
afterEach(cleanup);

describe('the Members bar’s Meal plan box', () => {
  it('names who will get it and who won’t, then gives it to the ticked people and nobody else', async () => {
    svc.list.mockResolvedValue(PLANS);
    svc.previewSelected.mockResolvedValue({
      plan: { id: 'p2', name: 'Muscle week' }, groupName: null, count: 2, people: [{ entryId: 'e1', name: 'Ann Lee' }, { entryId: 'e2', name: 'Bob Ray' }],
      switching: 1, replaces: null, gone: 1, already: 0,
    });
    svc.giveSelected.mockResolvedValue({ count: 2, plan: 'Muscle week' });
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <GiveMealPlanSheet gymId="g1" gymSlug="iron-house" selection={TICKED} words={WORDS} onClose={onClose} />
      </MemoryRouter>,
    );
    const pick = await sheet().findByRole('combobox', { name: 'Meal plan' });
    expect(sheet().getByRole('button', { name: 'Give it' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(pick, { target: { value: 'p2' } });
    expect(await sheet().findByText('2 members will get Muscle week:')).toBeTruthy();
    expect(sheet().getByText('Ann Lee')).toBeTruthy();
    expect(sheet().getByText('1 of them gets another meal plan now. Muscle week takes its place.')).toBeTruthy();
    expect(sheet().getByText('1 is no longer on your list and won’t get it.')).toBeTruthy();
    expect(svc.previewSelected).toHaveBeenCalledWith('g1', 'p2', TICKED);
    fireEvent.click(sheet().getByRole('button', { name: 'Give to 2 members' }));
    expect(await sheet().findByText('Muscle week given to 2 members.')).toBeTruthy();
    expect(svc.giveSelected).toHaveBeenCalledTimes(1);
    expect(svc.giveSelected).toHaveBeenCalledWith('g1', 'p2', TICKED);
    expect(sheet().getByRole('link', { name: 'Open Muscle week' }).getAttribute('href')).toBe('/console/iron-house/plans/p2');
    fireEvent.click(sheet().getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('a Select all whose people changed gives nobody anything and says so', async () => {
    svc.list.mockResolvedValue(PLANS);
    const moved = Object.assign(new Error('changed'), {
      response: { status: 409, data: { error: 'selection_changed', message: 'x', count: 5, digest: 'a'.repeat(64) } },
    });
    svc.previewSelected.mockRejectedValue(moved);
    const onSelectionChanged = vi.fn();
    render(
      <MemoryRouter>
        <GiveMealPlanSheet gymId="g1" gymSlug="iron-house" selection={{ kind: 'all', filter: {}, count: 4, digest: 'b'.repeat(64) }} words={WORDS} onSelectionChanged={onSelectionChanged} onClose={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.change(await sheet().findByRole('combobox', { name: 'Meal plan' }), { target: { value: 'p1' } });
    expect(await sheet().findByText(MEMBER_LIST_SELECTION_CHANGED_WORDS)).toBeTruthy();
    expect(onSelectionChanged).toHaveBeenCalledWith({ count: 5, digest: 'a'.repeat(64) });
    expect(svc.giveSelected).not.toHaveBeenCalled();
  });

  it('with no meal plans yet, opens Plans to write one', async () => {
    svc.list.mockResolvedValue({ plans: [] });
    render(
      <MemoryRouter>
        <GiveMealPlanSheet gymId="g1" gymSlug="iron-house" selection={TICKED} words={WORDS} onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(await sheet().findByText('You have no meal plans yet.')).toBeTruthy();
    expect(sheet().getByRole('link', { name: 'Write a meal plan' }).getAttribute('href')).toBe('/console/iron-house/plans');
  });
});

describe('a person’s page', () => {
  it('names the plan they get and why, and Change opens the box for them alone', async () => {
    svc.forRecord.mockResolvedValue({ plan: { id: 'p1', name: 'Lean week' }, through: { kind: 'membership_type', name: 'Gold Monthly' } });
    svc.list.mockResolvedValue(PLANS);
    svc.previewSelected.mockResolvedValue({ plan: { id: 'p2', name: 'Muscle week' }, groupName: null, count: 1, people: [], switching: 1, replaces: null, gone: 0, already: 0 });
    render(
      <MemoryRouter>
        <PersonMealPlan gymId="g1" gymSlug="iron-house" entryId="e7" words={WORDS} readOnly={false} />
      </MemoryRouter>,
    );
    const box = within(screen.getByTestId('person-meal-plan'));
    expect((await box.findByRole('link', { name: 'Lean week' })).getAttribute('href')).toBe('/console/iron-house/plans/p1');
    expect(box.getByText('From their Gold Monthly membership')).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Change' }));
    fireEvent.change(await sheet().findByRole('combobox', { name: 'Meal plan' }), { target: { value: 'p2' } });
    expect(svc.previewSelected).toHaveBeenCalledWith('g1', 'p2', { kind: 'ticked', entryIds: ['e7'] });
  });

  it('with none, says so and offers Give a meal plan', async () => {
    svc.forRecord.mockResolvedValue({ plan: null, through: null });
    render(
      <MemoryRouter>
        <PersonMealPlan gymId="g1" gymSlug="iron-house" entryId="e7" words={WORDS} readOnly={false} />
      </MemoryRouter>,
    );
    const box = within(screen.getByTestId('person-meal-plan'));
    expect(await box.findByText('No meal plan given.')).toBeTruthy();
    expect(box.getByRole('button', { name: 'Give a meal plan' })).toBeTruthy();
  });
});
