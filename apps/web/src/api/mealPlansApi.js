import { foodSearchResponseSchema, gymMealPlanResponseSchema, gymMealPlansResponseSchema, mealMeasuresResponseSchema } from '@app/shared';
import authApi from './authApi';

// THE MEAL PLANS A GYM GIVES ITS MEMBERS (spec Part 6 §16.6; ROADMAP Stage 2 24a-i), for staff
// holding `plans.manage`. Every answer is read through its contract, so a body this screen
// cannot read is an error, never an empty plan. The server refuses anyone else whatever a
// screen shows.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

async function readThrough(schema, what, request) {
  const res = await request;
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw contractError(what);
  return parsed.data;
}

const plansPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}/meal-plans`;
const planPath = (gymId, planId) => `${plansPath(gymId)}/${encodeURIComponent(planId)}`;
const dayPath = (gymId, planId, day) => `${planPath(gymId, planId)}/days/${encodeURIComponent(String(day))}`;

export const mealPlansService = {
  list: (gymId) => readThrough(gymMealPlansResponseSchema, 'the meal plans', authApi.get(plansPath(gymId))),
  get: (gymId, planId) => readThrough(gymMealPlanResponseSchema, 'the meal plan', authApi.get(planPath(gymId, planId))),
  /** A new, empty plan. `id` is made here: pressed again after a lost reply, it is one plan. */
  create: (gymId, id, name) => readThrough(gymMealPlanResponseSchema, 'the meal plan', authApi.post(plansPath(gymId), { id, name })),
  rename: (gymId, planId, name) => readThrough(gymMealPlanResponseSchema, 'the meal plan', authApi.patch(planPath(gymId, planId), { name })),
  remove: (gymId, planId) => authApi.delete(planPath(gymId, planId)).then(() => undefined),
  /** A day, whole: its meals in order. `version` is the day as the screen showed it. */
  putDay: (gymId, planId, day, body) => readThrough(gymMealPlanResponseSchema, 'the meal plan', authApi.put(dayPath(gymId, planId, day), body)),
  /** Each food of one meal with its own measures, to change its amount. */
  measures: (gymId, planId, day, meal) =>
    readThrough(mealMeasuresResponseSchema, 'the amounts', authApi.get(`${dayPath(gymId, planId, day)}/meals/${encodeURIComponent(String(meal))}/measures`)).then((d) => d.measures),
  /** The food list's search, the phone's own. */
  searchFoods: (q) => readThrough(foodSearchResponseSchema, 'the foods', authApi.get('/v1/nutrition/foods', { params: { q, limit: 10 } })).then((d) => d.items),
};
