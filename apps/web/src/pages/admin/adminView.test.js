import { describe, expect, it } from 'vitest';
import { allowanceWords, confirmWords, doneWords, namesWords, openUntilWords, planWords } from './adminView';

const person = (name, over = {}) => ({
  id: `id-${name}`,
  name,
  email: `${name.toLowerCase()}@gmail.com`,
  ownPlan: null,
  gyms: [],
  mealScans: { window: 'month', limit: 3, yours: false },
  routePlans: { window: 'month', limit: 2, yours: false },
  ...over,
});

describe('the admin page words', () => {
  it('says until when the page is open, and tomorrow when the 12 hours end on the next day', () => {
    expect(openUntilWords(new Date(2026, 10, 8, 22, 50).toISOString(), new Date(2026, 10, 8, 10, 50))).toBe('10:50 pm');
    expect(openUntilWords(new Date(2026, 10, 9, 5, 56).toISOString(), new Date(2026, 10, 8, 17, 56))).toBe('5:56 am tomorrow');
  });

  it('names the plan: free, their own, through a gym, or both', () => {
    expect(planWords(person('Asha'))).toBe('Free');
    expect(planWords(person('Asha', { ownPlan: 'month' }))).toBe('$10 a month');
    expect(planWords(person('Asha', { ownPlan: 'year' }))).toBe('$110 a year');
    expect(planWords(person('Asha', { gyms: ['Iron Gym', 'Zen Studio'] }))).toBe('Member of Iron Gym, Zen Studio');
    expect(planWords(person('Asha', { ownPlan: 'month', gyms: ['Iron Gym'] }))).toBe('$10 a month · Member of Iron Gym');
  });

  it('says what they get and whether it is your number', () => {
    expect(allowanceWords({ window: 'month', limit: 3, yours: false })).toBe('3 a month');
    expect(allowanceWords({ window: 'day', limit: 15, yours: true })).toBe('15 a day · set by you');
    expect(allowanceWords({ window: 'day', limit: 0, yours: true })).toBe('0 a day · set by you');
  });

  it('names a few people, then how many more', () => {
    expect(namesWords([person('Asha')])).toBe('Asha');
    expect(namesWords([person('Asha'), person('Ben')])).toBe('Asha and Ben');
    expect(namesWords(['A', 'B', 'C', 'D', 'E'].map((n) => person(n)))).toBe('A, B, C, D and E');
    expect(namesWords(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((n) => person(n)))).toBe('A, B, C, D, E and 2 more');
    expect(namesWords([{ id: 'x', name: '', email: 'x@gmail.com' }])).toBe('x@gmail.com');
  });

  it('before setting: who changes and who already has that number', () => {
    const asha = person('Asha');
    const ben = person('Ben', { mealScans: { window: 'day', limit: 15, yours: true } });
    const chen = person('Chen', { mealScans: { window: 'day', limit: 15, yours: false } });
    const w = confirmWords([asha, ben, chen], 'meal_scan', 15);
    expect(w.change.map((p) => p.name)).toEqual(['Asha', 'Chen']);
    expect(w.question).toBe('Give 2 people 15 meal scans a day?');
    expect(w.changeLine).toBe('Asha and Chen');
    expect(w.stayLine).toBe('No change for Ben: already 15 a day.');
  });

  it('before taking back: only those on your number change', () => {
    const asha = person('Asha', { routePlans: { window: 'day', limit: 5, yours: true } });
    const ben = person('Ben');
    const w = confirmWords([asha, ben], 'route_gen', null);
    expect(w.question).toBe("Put 1 person back on their plan's route plans?");
    expect(w.stayLine).toBe("No change for Ben: already on their plan's route plans.");
  });

  it('after: what happened, in one place', () => {
    expect(doneWords({ changed: 2, unchanged: 1, notFound: 0 }, 'meal_scan', 15)).toBe('2 people now have 15 meal scans a day. 1 person already had it.');
    expect(doneWords({ changed: 1, unchanged: 0, notFound: 0 }, 'route_gen', 0)).toBe('1 person now has 0 route plans a day.');
    expect(doneWords({ changed: 1, unchanged: 0, notFound: 0 }, 'meal_scan', null)).toBe("1 person is back on their plan's meal scans.");
    expect(doneWords({ changed: 0, unchanged: 0, notFound: 1 }, 'meal_scan', 5)).toBe('Nothing changed. 1 person could not be changed: the account was deleted.');
  });
});
