// Who gets a gym's meal plan (spec Part 6 §16.6; ROADMAP Stage 2 24a-ii). Staff with the Plans tick
// give a plan to everybody, a membership type, a tag, or members ticked on Members. Each group holds
// one plan at a time; a member reached by several gets the newest given. The member reads it as
// written, with the writer's name, at `GET /v1/orgs/:gymId/meal-plans/mine` (Stage 5's 31g).
import { z } from "zod";
import { gymMealPlanDaySchema } from "./gymMealPlans.js";
import { memberListSelectionSchema } from "./memberList.js";
import { FOOD_ALLERGY_CAUTION } from "./nutrition.js";

const idSchema = z.string().uuid().toLowerCase();

/** How many people a box names before "and N more". */
export const GYM_MEAL_PLAN_BOX_NAMES_MAX = 5;
/** The most groups one press of Stop giving takes off a plan. */
export const GYM_MEAL_PLAN_STOP_MOST = 500;

/** A group a plan is given to from the plan's own page. Members ticked are given from Members. */
export const gymMealPlanGroupSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("everyone") }).strict(),
  z.object({ kind: z.literal("membership_type"), membershipTypeId: idSchema }).strict(),
  z.object({ kind: z.literal("tag"), tagId: idSchema }).strict(),
]);
export type GymMealPlanGroup = z.infer<typeof gymMealPlanGroupSchema>;

export const giveGymMealPlanRequestSchema = z.object({ to: gymMealPlanGroupSchema }).strict();
export type GiveGymMealPlanRequest = z.infer<typeof giveGymMealPlanRequestSchema>;

/** The members ticked on Members, or one person's page. */
export const giveGymMealPlanToSelectedRequestSchema = z.object({ planId: idSchema, selection: memberListSelectionSchema }).strict();
export type GiveGymMealPlanToSelectedRequest = z.infer<typeof giveGymMealPlanToSelectedRequestSchema>;

export const stopGymMealPlanRequestSchema = z.object({ audienceIds: z.array(idSchema).min(1).max(GYM_MEAL_PLAN_STOP_MOST) }).strict();
export type StopGymMealPlanRequest = z.infer<typeof stopGymMealPlanRequestSchema>;

const personSchema = z.object({ entryId: z.string().uuid(), name: z.string() }).strict();
export type GymMealPlanPerson = z.infer<typeof personSchema>;

/** The box before Give: who gets it, and what it changes for them. */
export const gymMealPlanGivePreviewSchema = z.object({
  plan: z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict(),
  /** The type's or tag's name; null for everybody and for members ticked. */
  groupName: z.string().nullable(),
  /** How many people on the list it reaches now. */
  count: z.number().int().nonnegative(),
  /** The first of them by name; empty, the count kept, for staff who give plans but cannot open Members. */
  people: z.array(personSchema).max(GYM_MEAL_PLAN_BOX_NAMES_MAX),
  /** Of them, how many get another of the gym's meal plans now: this one takes its place. */
  switching: z.number().int().nonnegative(),
  /** The plan this group was given before, which this one replaces there; null for members ticked. */
  replaces: z.string().nullable(),
  /** Members ticked who are no longer on the list: left out. */
  gone: z.number().int().nonnegative(),
  /** Already given this plan, ticked again: nothing changes for them. */
  already: z.number().int().nonnegative(),
}).strict();
export type GymMealPlanGivePreview = z.infer<typeof gymMealPlanGivePreviewSchema>;
export const gymMealPlanGivePreviewResponseSchema = z.object({ preview: gymMealPlanGivePreviewSchema }).strict();

const byNameSchema = z.string().min(1).nullable();

export const gymMealPlanGivenGroupSchema = z.object({
  audienceId: z.string().uuid(),
  kind: z.enum(["everyone", "membership_type", "tag"]),
  /** The type's or tag's name; null for everybody. */
  name: z.string().nullable(),
  /** How many people on the list the group holds now. */
  size: z.number().int().nonnegative(),
  /** Of them, how many get this plan (the rest were given a newer one another way). */
  gets: z.number().int().nonnegative(),
  givenBy: byNameSchema,
  givenAt: z.string().datetime({ offset: true }),
}).strict();
export type GymMealPlanGivenGroup = z.infer<typeof gymMealPlanGivenGroupSchema>;

export const gymMealPlanGivenMemberSchema = z.object({
  audienceId: z.string().uuid(),
  entryId: z.string().uuid(),
  name: z.string(),
  /** The plan they get instead, given to them later another way; null when they get this one. */
  instead: z.string().nullable(),
  givenBy: byNameSchema,
  givenAt: z.string().datetime({ offset: true }),
}).strict();
export type GymMealPlanGivenMember = z.infer<typeof gymMealPlanGivenMemberSchema>;

/** Who a plan is given to, and how many on the list get it now. */
export const gymMealPlanGivenSchema = z.object({
  gets: z.number().int().nonnegative(),
  groups: z.array(gymMealPlanGivenGroupSchema),
  /** How many people on the list it is given to by name. */
  chosen: z.number().int().nonnegative(),
  /** Those people, for staff who can open Members; empty for anybody else. */
  members: z.array(gymMealPlanGivenMemberSchema),
}).strict();
export type GymMealPlanGiven = z.infer<typeof gymMealPlanGivenSchema>;
export const gymMealPlanGivenResponseSchema = z.object({ given: gymMealPlanGivenSchema }).strict();
export type GymMealPlanGivenResponse = z.infer<typeof gymMealPlanGivenResponseSchema>;

/** After Give from Members: how many it was given to. */
export const gymMealPlanGivenToSelectedSchema = z.object({ count: z.number().int().nonnegative(), plan: z.string().min(1) }).strict();
export type GymMealPlanGivenToSelected = z.infer<typeof gymMealPlanGivenToSelectedSchema>;
export const gymMealPlanGivenToSelectedResponseSchema = z.object({ given: gymMealPlanGivenToSelectedSchema }).strict();

/** A person's page: the plan this person gets, and through which group. */
export const gymMealPlanForEntryResponseSchema = z.object({
  plan: z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict().nullable(),
  through: z.object({ kind: z.enum(["everyone", "membership_type", "tag", "member"]), name: z.string().nullable() }).strict().nullable(),
}).strict();
export type GymMealPlanForEntryResponse = z.infer<typeof gymMealPlanForEntryResponseSchema>;
export const gymMealPlanEntryParamsSchema = z.object({ gymId: z.string().uuid(), entryId: idSchema }).strict();
export const gymMealPlanAudienceParamsSchema = z.object({ gymId: z.string().uuid(), planId: idSchema }).strict();

/** The member's own: the gym's plan for them, as written, with the writer's name. */
export const memberGymMealPlanSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  writtenBy: byNameSchema,
  updatedAt: z.string().datetime({ offset: true }),
  givenAt: z.string().datetime({ offset: true }),
  days: z.array(gymMealPlanDaySchema).length(7),
  caution: z.literal(FOOD_ALLERGY_CAUTION),
}).strict();
export type MemberGymMealPlan = z.infer<typeof memberGymMealPlanSchema>;
export const memberGymMealPlanResponseSchema = z.object({ plan: memberGymMealPlanSchema.nullable() }).strict();
export type MemberGymMealPlanResponse = z.infer<typeof memberGymMealPlanResponseSchema>;

/** What a plan can be given to from its page: the gym's live membership types and its tags. */
export const gymMealPlanGroupsResponseSchema = z.object({
  membershipTypes: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict()),
  tags: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1) }).strict()),
}).strict();
export type GymMealPlanGroupsResponse = z.infer<typeof gymMealPlanGroupsResponseSchema>;

export const GYM_MEAL_PLAN_GIVING_WORDS = {
  type_not_found: "This membership was deleted. Pick another.",
  tag_not_found: "This tag was deleted. Pick another.",
  not_member: "You aren’t a member of this gym.",
  entry_not_found: "This person is no longer on your list.",
} as const;
