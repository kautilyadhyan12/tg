import {
  foodSearchResponseSchema, gymMealPlanForEntryResponseSchema, gymMealPlanGivePreviewResponseSchema, gymMealPlanGivenResponseSchema,
  gymMealPlanGivenToSelectedResponseSchema, gymMealPlanGroupsResponseSchema, gymMealPlanResponseSchema, gymMealPlansResponseSchema,
  mealMeasuresResponseSchema,
} from '@app/shared';
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
  // Who gets a plan (24a-ii).
  /** The gym's membership types and tags a plan can be given to. */
  groups: (gymId) => readThrough(gymMealPlanGroupsResponseSchema, 'the memberships and tags', authApi.get(`${plansPath(gymId)}/groups`)),
  given: (gymId, planId) => readThrough(gymMealPlanGivenResponseSchema, 'who gets this plan', authApi.get(`${planPath(gymId, planId)}/given`)).then((d) => d.given),
  /** `to`: `{ kind: 'everyone' }`, `{ kind: 'membership_type', membershipTypeId }` or `{ kind: 'tag', tagId }`. */
  givePreview: (gymId, planId, to) =>
    readThrough(gymMealPlanGivePreviewResponseSchema, 'who would get it', authApi.post(`${planPath(gymId, planId)}/give-preview`, { to })).then((d) => d.preview),
  give: (gymId, planId, to) => readThrough(gymMealPlanGivenResponseSchema, 'who gets this plan', authApi.post(`${planPath(gymId, planId)}/give`, { to })).then((d) => d.given),
  stop: (gymId, planId, audienceIds) =>
    readThrough(gymMealPlanGivenResponseSchema, 'who gets this plan', authApi.post(`${planPath(gymId, planId)}/stop`, { audienceIds })).then((d) => d.given),
  /** A person's page: the plan this record gets. */
  forRecord: (gymId, entryId) =>
    readThrough(gymMealPlanForEntryResponseSchema, 'their meal plan', authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}/meal-plan`)),
  /** The people selected on Members. A "Select all" that moved is refused as every selected press is. */
  previewSelected: (gymId, planId, selection) =>
    readThrough(gymMealPlanGivePreviewResponseSchema, 'who would get it', authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/selected/meal-plan-preview`, { planId, selection })).then((d) => d.preview),
  giveSelected: (gymId, planId, selection) =>
    readThrough(gymMealPlanGivenToSelectedResponseSchema, 'the meal plan given', authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/selected/meal-plan`, { planId, selection })).then((d) => d.given),
};
