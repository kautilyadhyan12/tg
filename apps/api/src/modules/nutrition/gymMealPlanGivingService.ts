// Who gets a gym's meal plan (spec Part 6 §16.6; ROADMAP Stage 2 24a-ii). Staff with the Plans tick
// give a plan to everybody, a membership type, a tag or members ticked; the member reads the newest
// one that reaches them, as written. Gates in CLAUDE.md §4's order: privilege (a live plan for a
// write), then the rate limit, then the handler.
import {
  FOOD_ALLERGY_CAUTION, GYM_MEAL_PLAN_BOX_NAMES_MAX, GYM_MEAL_PLAN_GIVING_WORDS, GYM_MEAL_PLAN_WORDS,
  gymMealPlanForEntryResponseSchema, gymMealPlanGivePreviewSchema, gymMealPlansResponseSchema, gymMealPlanGivenSchema, gymMealPlanGroupsResponseSchema, memberGymMealPlanResponseSchema,
  type GymMealPlanForEntryResponse, type GymMealPlanGivePreview, type GymMealPlanGiven, type GymMealPlanGivenToSelected,
  type GymMealPlanGroup, type GymMealPlanGroupsResponse, type GymMealPlansResponse, type HeldMembership, type MemberGymMealPlanResponse,
} from "@app/shared";
import type { Sql } from "postgres";
import { dayInTz } from "../gamification/streak.js";
import { membersAgainstList } from "../orgs/memberList/repo.js";
import { currentRecordOf } from "../orgs/memberList/whose.js";
import { inUseTypesForList } from "../orgs/memberships/heldRepo.js";
import { requirePrivilege, requireWritablePrivilege } from "../orgs/service.js";
import * as audiences from "./gymMealPlanAudienceRepo.js";
import { pickAll, reaching, typesOf, type Given, type PersonFacts } from "./gymMealPlanPick.js";
import * as plans from "./gymMealPlanRepo.js";
import { dayOf, planSummaries } from "./gymMealPlanService.js";
import { NutritionError } from "./service.js";

const TICK = "plans.manage";
type Limit = () => Promise<boolean>;
export interface GivingDeps {
  sql: Sql;
  /** The clock for the gym's day, which decides who is in a membership type; a test moves it. */
  now?: () => Date;
}

const planGone = (): NutritionError => new NutritionError(404, "plan_not_found", GYM_MEAL_PLAN_WORDS.not_found);
const groupGone = (group: GymMealPlanGroup): NutritionError =>
  group.kind === "tag"
    ? new NutritionError(404, "tag_not_found", GYM_MEAL_PLAN_GIVING_WORDS.tag_not_found)
    : new NutritionError(404, "type_not_found", GYM_MEAL_PLAN_GIVING_WORDS.type_not_found);

/** Postgres's answer when a key's row went while the write was made. */
const keyWent = (err: unknown): boolean => typeof err === "object" && err !== null && "code" in err && err.code === "23503";

interface WhoGets {
  people: audiences.PersonRow[];
  facts: PersonFacts[];
  given: Given[];
  got: Map<string, Given>;
}

/** The people asked about (every current record, for null), what reaches each, and what each gets. */
async function whoGets(deps: GivingDeps, gymId: string, ids: readonly string[] | null): Promise<WhoGets> {
  const people = await audiences.people(deps.sql, gymId, ids);
  const asked = ids === null ? null : people.map((p) => p.id);
  const today = dayInTz((deps.now ?? (() => new Date()))(), await audiences.gymTimeZone(deps.sql, gymId));
  const held = new Map<string, { typeId: string; membership: HeldMembership }[]>();
  for (const h of await inUseTypesForList(deps.sql, gymId, asked)) held.set(h.entryId, [...(held.get(h.entryId) ?? []), h]);
  const facts = people.map((p) => ({ entryId: p.id, tagIds: p.tagIds, typeIds: typesOf({ held: held.get(p.id) ?? [], word: p.word }, today) }));
  const given = await audiences.givenOfGym(deps.sql, gymId, asked);
  return { people, facts, given, got: pickAll(given, facts) };
}

async function planNamed(sql: Sql, gymId: string, planId: string): Promise<{ id: string; name: string }> {
  const plan = await plans.getPlan(sql, gymId, planId);
  if (plan === null) throw planGone();
  return { id: plan.id, name: plan.name };
}

/** Who a press reaches and what it changes for them. */
function previewOf(
  who: WhoGets, plan: { id: string; name: string }, reached: readonly audiences.PersonRow[],
  extra: { groupName: string | null; replaces: string | null; gone: number },
): GymMealPlanGivePreview {
  let switching = 0;
  let already = 0;
  for (const p of reached) {
    const got = who.got.get(p.id);
    if (got === undefined) continue;
    if (got.planId === plan.id) already += 1;
    else switching += 1;
  }
  return gymMealPlanGivePreviewSchema.parse({
    plan,
    groupName: extra.groupName,
    count: reached.length,
    people: reached.slice(0, GYM_MEAL_PLAN_BOX_NAMES_MAX).map((p) => ({ entryId: p.id, name: p.name })),
    switching,
    replaces: extra.replaces,
    gone: extra.gone,
    already,
  });
}

async function groupAsked(sql: Sql, gymId: string, group: GymMealPlanGroup): Promise<string | null> {
  const named = await audiences.groupName(sql, gymId, group);
  if (named === null) throw groupGone(group);
  return named.name;
}

const asGiven = (group: GymMealPlanGroup): Given => ({
  audienceId: "",
  planId: "",
  kind: group.kind,
  target: group.kind === "tag" ? group.tagId : group.kind === "membership_type" ? group.membershipTypeId : null,
  givenAt: new Date(0),
});
const sameGroup = (a: Given, b: Given): boolean => a.kind === b.kind && a.target === b.target;

/** The box before Give, for a group. */
export async function previewGiveToGroup(
  deps: GivingDeps, staffId: string, gymId: string, planId: string, group: GymMealPlanGroup, limit: Limit,
): Promise<GymMealPlanGivePreview | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const plan = await planNamed(deps.sql, gymId, planId);
  const groupName = await groupAsked(deps.sql, gymId, group);
  const who = await whoGets(deps, gymId, null);
  const asked = asGiven(group);
  const reached = who.people.filter((_, at) => {
    const facts = who.facts[at];
    return facts !== undefined && reaching([asked], facts).length > 0;
  });
  const held = who.given.find((g) => sameGroup(g, asked));
  const names = held !== undefined && held.planId !== plan.id ? await audiences.planNames(deps.sql, gymId) : null;
  return previewOf(who, plan, reached, { groupName, replaces: held === undefined ? null : names?.get(held.planId) ?? null, gone: 0 });
}

/** Give a plan to a group: it takes the place of the one the group held. */
export async function giveToGroup(
  deps: GivingDeps, staffId: string, gymId: string, planId: string, group: GymMealPlanGroup, limit: Limit,
): Promise<GymMealPlanGiven | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  await planNamed(deps.sql, gymId, planId);
  await groupAsked(deps.sql, gymId, group);
  try {
    await audiences.giveToGroup(deps.sql, gymId, planId, staffId, group);
  } catch (err) {
    if (!keyWent(err)) throw err;
    if ((await plans.getPlan(deps.sql, gymId, planId)) === null) throw planGone();
    throw groupGone(group);
  }
  return await givenReply(deps, gymId, planId);
}

/** The box before Give, for the records ticked (the caller has checked the asker may tick them). */
export async function previewGiveToRecords(deps: GivingDeps, gymId: string, planId: string, ids: readonly string[]): Promise<GymMealPlanGivePreview> {
  const plan = await planNamed(deps.sql, gymId, planId);
  const unique = [...new Set(ids)];
  const who = await whoGets(deps, gymId, unique);
  return previewOf(who, plan, who.people, { groupName: null, replaces: null, gone: unique.length - who.people.length });
}

/** Give a plan to the records ticked: each its own row; a past or another gym's record is nobody. */
export async function giveToRecords(deps: GivingDeps, staffId: string, gymId: string, planId: string, ids: readonly string[]): Promise<GymMealPlanGivenToSelected> {
  const plan = await planNamed(deps.sql, gymId, planId);
  try {
    const count = await audiences.giveToRecords(deps.sql, gymId, planId, staffId, [...new Set(ids)]);
    return { count, plan: plan.name };
  } catch (err) {
    if (keyWent(err)) throw planGone();
    throw err;
  }
}

async function givenReply(deps: GivingDeps, gymId: string, planId: string): Promise<GymMealPlanGiven> {
  const who = await whoGets(deps, gymId, null);
  const labels = await audiences.labels(deps.sql, gymId);
  const names = await audiences.planNames(deps.sql, gymId);
  const mine = who.given.filter((g) => g.planId === planId).sort((a, b) => a.givenAt.getTime() - b.givenAt.getTime() || (a.audienceId < b.audienceId ? -1 : 1));
  const groups = mine.filter((g) => g.kind !== "member").sort((a, b) => Number(b.kind === "everyone") - Number(a.kind === "everyone"));
  const byId = new Map(who.people.map((p) => [p.id, p]));
  const members = who.people.flatMap((p) => {
    const g = mine.find((m) => m.kind === "member" && m.target === p.id);
    if (g === undefined) return [];
    const got = who.got.get(p.id);
    return [{
      audienceId: g.audienceId, entryId: p.id, name: p.name,
      instead: got !== undefined && got.planId !== planId ? names.get(got.planId) ?? null : null,
      givenBy: labels.get(g.audienceId)?.givenBy ?? null, givenAt: g.givenAt.toISOString(),
    }];
  });
  let gets = 0;
  for (const got of who.got.values()) if (got.planId === planId) gets += 1;
  return gymMealPlanGivenSchema.parse({
    gets,
    groups: groups.map((g) => ({
      audienceId: g.audienceId,
      kind: g.kind,
      name: labels.get(g.audienceId)?.name ?? null,
      size: who.facts.filter((f) => reaching([g], f).length > 0).length,
      gets: [...who.got.values()].filter((got) => got.audienceId === g.audienceId).length,
      givenBy: labels.get(g.audienceId)?.givenBy ?? null,
      givenAt: g.givenAt.toISOString(),
    })),
    members: members.filter((m) => byId.has(m.entryId)),
  });
}

/** What a plan can be given to from its page. */
export async function groupChoices(deps: GivingDeps, staffId: string, gymId: string, limit: Limit): Promise<GymMealPlanGroupsResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  return gymMealPlanGroupsResponseSchema.parse(await audiences.groupChoices(deps.sql, gymId));
}

/** A plan's Given to. */
export async function givenOf(deps: GivingDeps, staffId: string, gymId: string, planId: string, limit: Limit): Promise<GymMealPlanGiven | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  await planNamed(deps.sql, gymId, planId);
  return await givenReply(deps, gymId, planId);
}

/** Stop giving a plan to some of its groups or people. Stopped already is not a fault. */
export async function stopGiving(
  deps: GivingDeps, staffId: string, gymId: string, planId: string, audienceIds: readonly string[], limit: Limit,
): Promise<GymMealPlanGiven | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  await planNamed(deps.sql, gymId, planId);
  await audiences.stop(deps.sql, gymId, planId, audienceIds);
  return await givenReply(deps, gymId, planId);
}

/** The Plans list: each plan with who it is given to and how many on the list get it now. */
export async function listGymMealPlans(deps: GivingDeps, staffId: string, gymId: string, limit: Limit): Promise<GymMealPlansResponse | null> {
  const summaries = await planSummaries(deps, staffId, gymId, limit);
  if (summaries === null) return null;
  const reach = await reachOfPlans(deps, gymId);
  return gymMealPlansResponseSchema.parse({
    plans: summaries.map((p) => ({ ...p, ...(reach.get(p.id) ?? { givenTo: { everyone: false, groups: [], members: 0 }, gets: 0 }) })),
  });
}

/** For each plan of the gym: who it is given to, and how many on the list get it now. */
async function reachOfPlans(
  deps: GivingDeps, gymId: string,
): Promise<Map<string, { givenTo: { everyone: boolean; groups: string[]; members: number }; gets: number }>> {
  const who = await whoGets(deps, gymId, null);
  const labels = await audiences.labels(deps.sql, gymId);
  const current = new Set(who.people.map((p) => p.id));
  const out = new Map<string, { givenTo: { everyone: boolean; groups: string[]; members: number }; gets: number }>();
  const of = (planId: string) => {
    const known = out.get(planId);
    if (known !== undefined) return known;
    const made = { givenTo: { everyone: false, groups: [] as string[], members: 0 }, gets: 0 };
    out.set(planId, made);
    return made;
  };
  for (const g of [...who.given].sort((a, b) => a.givenAt.getTime() - b.givenAt.getTime())) {
    const r = of(g.planId);
    if (g.kind === "everyone") r.givenTo.everyone = true;
    else if (g.kind === "member") r.givenTo.members += g.target !== null && current.has(g.target) ? 1 : 0;
    else r.givenTo.groups.push(labels.get(g.audienceId)?.name ?? "");
  }
  for (const got of who.got.values()) of(got.planId).gets += 1;
  return out;
}

/** A person's page: the plan this record gets, and through which group. */
export async function planForRecord(deps: GivingDeps, staffId: string, gymId: string, entryId: string, limit: Limit): Promise<GymMealPlanForEntryResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const got = (await whoGets(deps, gymId, [entryId])).got.get(entryId);
  if (got === undefined) return gymMealPlanForEntryResponseSchema.parse({ plan: null, through: null });
  const plan = await planNamed(deps.sql, gymId, got.planId);
  const name = got.kind === "membership_type" || got.kind === "tag" ? (await audiences.labels(deps.sql, gymId)).get(got.audienceId)?.name ?? null : null;
  return gymMealPlanForEntryResponseSchema.parse({ plan, through: { kind: got.kind, name } });
}

/** The member's own: the plan the gym gives them, as written, or none. A record the list cannot say
 *  for certain is theirs (a family sharing one email) gives them nothing of its own: only Everybody. */
export async function myGymMealPlan(deps: GivingDeps, userId: string, gymId: string, limit: Limit): Promise<MemberGymMealPlanResponse | null> {
  if (!(await audiences.isLiveMember(deps.sql, gymId, userId))) {
    throw new NutritionError(404, "not_member", GYM_MEAL_PLAN_GIVING_WORDS.not_member);
  }
  if (!(await limit())) return null;
  const member = (await membersAgainstList(deps.sql, gymId, { email: null, phone: null, userIds: [userId] })).find((m) => m.userId === userId);
  const entryId = member === undefined ? null : currentRecordOf(member);
  const got =
    entryId === null
      ? (await audiences.givenOfGym(deps.sql, gymId, [])).find((g) => g.kind === "everyone")
      : (await whoGets(deps, gymId, [entryId])).got.get(entryId);
  if (got === undefined) return memberGymMealPlanResponseSchema.parse({ plan: null });
  const plan = await plans.getPlan(deps.sql, gymId, got.planId);
  // Deleted between the two reads: nothing is given now.
  if (plan === null) return memberGymMealPlanResponseSchema.parse({ plan: null });
  return memberGymMealPlanResponseSchema.parse({
    plan: {
      id: plan.id,
      name: plan.name,
      writtenBy: plan.writtenBy,
      updatedAt: plan.updatedAt.toISOString(),
      givenAt: got.givenAt.toISOString(),
      days: plan.days.map((meals, at) => dayOf(at + 1, meals)),
      caution: FOOD_ALLERGY_CAUTION,
    },
  });
}
