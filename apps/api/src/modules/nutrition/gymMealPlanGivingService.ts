// Who gets a gym's meal plan (spec Part 6 §16.6; ROADMAP Stage 2 24a-ii). Staff with the Plans tick
// give a plan to everybody, a membership type, a tag or members ticked; the member reads the newest
// one that reaches them, as written. Gates in CLAUDE.md §4's order: privilege (a live plan for a
// write), then the rate limit, then the handler.
import {
  FOOD_ALLERGY_CAUTION, GYM_MEAL_PLAN_BOX_NAMES_MAX, GYM_MEAL_PLAN_GIVING_WORDS, GYM_MEAL_PLAN_WORDS,
  gymMealPlanForEntryResponseSchema, gymMealPlanGivePreviewSchema, gymMealPlansResponseSchema, gymMealPlanGivenSchema, gymMealPlanGroupsResponseSchema, memberGymMealPlanResponseSchema,
  type GymMealPlanForEntryResponse, type GymMealPlanGivePreview, type GymMealPlanGiven, type GymMealPlanGivenToSelected,
  type GymMealPlanGroup, type GymMealPlanGroupsResponse, type GymMealPlansResponse, type HeldMembership, type MemberGymMealPlanResponse,
  myGymMealPlansResponseSchema, type LowestKcal, type MealItem, type MemberGymMealPlan, type MyGymMealPlan, type MyGymMealPlansResponse,
} from "@app/shared";
import { dayUnder } from "./targets.js";
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
/** Names on the gym's list are read with the list's own tick: Fitness plans alone shows counts. */
const NAMES = "members.confirm";
const seesNames = (privileges: readonly string[]): boolean => privileges.includes(NAMES);
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

/** The people asked about (every current record, for null), what reaches each, and what each gets.
 *  Memberships are read only for the types a plan is given to (and `alsoType`, a box's own), and for
 *  the people whose list's word is one of them: no other type changes what anybody gets. */
async function whoGets(deps: GivingDeps, gymId: string, ids: readonly string[] | null, alsoType: string | null = null): Promise<WhoGets> {
  const people = await audiences.people(deps.sql, gymId, ids);
  const asked = ids === null ? null : people.map((p) => p.id);
  const given = await audiences.givenOfGym(deps.sql, gymId, asked);
  const types = new Set([...given.flatMap((g) => (g.kind === "membership_type" && g.target !== null ? [g.target] : [])), ...(alsoType === null ? [] : [alsoType])]);
  const held = new Map<string, { typeId: string; membership: HeldMembership }[]>();
  let today = "";
  if (types.size > 0) {
    const byWord = people.flatMap((p) => (p.word !== null && types.has(p.word.typeId) ? [p.id] : []));
    for (const h of await inUseTypesForList(deps.sql, gymId, asked, { typeIds: [...types], entryIds: byWord })) {
      held.set(h.entryId, [...(held.get(h.entryId) ?? []), h]);
    }
    today = dayInTz((deps.now ?? (() => new Date()))(), await audiences.gymTimeZone(deps.sql, gymId));
  }
  const facts = people.map((p) => ({
    entryId: p.id,
    tagIds: p.tagIds,
    typeIds:
      types.size === 0
        ? new Set<string>()
        : typesOf({ held: held.get(p.id) ?? [], word: p.word !== null && types.has(p.word.typeId) ? p.word : null }, today),
  }));
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
  names: boolean,
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
    people: names ? reached.slice(0, GYM_MEAL_PLAN_BOX_NAMES_MAX).map((p) => ({ entryId: p.id, name: p.name })) : [],
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
  const { privileges } = await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const plan = await planNamed(deps.sql, gymId, planId);
  const groupName = await groupAsked(deps.sql, gymId, group);
  const who = await whoGets(deps, gymId, null, group.kind === "membership_type" ? group.membershipTypeId : null);
  const asked = asGiven(group);
  const reached = who.people.filter((_, at) => {
    const facts = who.facts[at];
    return facts !== undefined && reaching([asked], facts).length > 0;
  });
  const held = who.given.find((g) => sameGroup(g, asked));
  const names = held !== undefined && held.planId !== plan.id ? await audiences.planNames(deps.sql, gymId) : null;
  return previewOf(who, plan, reached, { groupName, replaces: held === undefined ? null : names?.get(held.planId) ?? null, gone: 0 }, seesNames(privileges));
}

/** Give a plan to a group: it takes the place of the one the group held. */
export async function giveToGroup(
  deps: GivingDeps, staffId: string, gymId: string, planId: string, group: GymMealPlanGroup, limit: Limit,
): Promise<GymMealPlanGiven | null> {
  const { privileges } = await requireWritablePrivilege(deps, gymId, staffId, TICK);
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
  return await givenReply(deps, gymId, planId, seesNames(privileges));
}

/** The box before Give, for the records ticked (the caller has checked the asker opens the list). */
export async function previewGiveToRecords(deps: GivingDeps, gymId: string, planId: string, ids: readonly string[]): Promise<GymMealPlanGivePreview> {
  const plan = await planNamed(deps.sql, gymId, planId);
  const unique = [...new Set(ids)];
  const who = await whoGets(deps, gymId, unique);
  return previewOf(who, plan, who.people, { groupName: null, replaces: null, gone: unique.length - who.people.length }, true);
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

/** A plan's Who gets it. Without the list's tick, the people chosen are a count, never names. */
async function givenReply(deps: GivingDeps, gymId: string, planId: string, showNames: boolean): Promise<GymMealPlanGiven> {
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
    chosen: members.length,
    members: showNames ? members.filter((m) => byId.has(m.entryId)) : [],
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
  const { privileges } = await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  await planNamed(deps.sql, gymId, planId);
  return await givenReply(deps, gymId, planId, seesNames(privileges));
}

/** Stop giving a plan to some of its groups or people. Stopped already is not a fault. */
export async function stopGiving(
  deps: GivingDeps, staffId: string, gymId: string, planId: string, audienceIds: readonly string[], limit: Limit,
): Promise<GymMealPlanGiven | null> {
  const { privileges } = await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  await planNamed(deps.sql, gymId, planId);
  await audiences.stop(deps.sql, gymId, planId, audienceIds);
  return await givenReply(deps, gymId, planId, seesNames(privileges));
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

/** A person's page: the plan this record gets, and through which group. For staff who open the list
 *  and give plans; a record that is not one of this gym's current ones is not found. */
export async function planForRecord(deps: GivingDeps, staffId: string, gymId: string, entryId: string, limit: Limit): Promise<GymMealPlanForEntryResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  await requirePrivilege(deps, gymId, staffId, NAMES);
  if (!(await limit())) return null;
  const who = await whoGets(deps, gymId, [entryId]);
  if (who.people.length === 0) throw new NutritionError(404, "entry_not_found", GYM_MEAL_PLAN_GIVING_WORDS.entry_not_found);
  const got = who.got.get(entryId);
  if (got === undefined) return gymMealPlanForEntryResponseSchema.parse({ plan: null, through: null });
  const plan = await planNamed(deps.sql, gymId, got.planId);
  const name = got.kind === "membership_type" || got.kind === "tag" ? (await audiences.labels(deps.sql, gymId)).get(got.audienceId)?.name ?? null : null;
  return gymMealPlanForEntryResponseSchema.parse({ plan, through: { kind: got.kind, name } });
}

/** The member's own: the plan the gym gives them, as written, or none. Only somebody on the gym's list
 *  gets one, as the console counts: their own record's; where the list holds them but cannot say which
 *  record is theirs (a family sharing one email), only Everybody's; off the list, nothing. */
export async function myGymMealPlan(deps: GivingDeps, userId: string, gymId: string, limit: Limit): Promise<MemberGymMealPlanResponse | null> {
  if (!(await audiences.isLiveMember(deps.sql, gymId, userId))) {
    throw new NutritionError(404, "not_member", GYM_MEAL_PLAN_GIVING_WORDS.not_member);
  }
  if (!(await limit())) return null;
  return memberGymMealPlanResponseSchema.parse({ plan: await planGivenTo(deps, userId, gymId) });
}

/** The plan this gym gives this member, as written, or null; the caller has checked they are a live
 *  member. The rule of `myGymMealPlan`, read once for each gym on the phone (31g). */
async function planGivenTo(deps: GivingDeps, userId: string, gymId: string): Promise<MemberGymMealPlan | null> {
  const member = (await membersAgainstList(deps.sql, gymId, { email: null, phone: null, userIds: [userId] })).find((m) => m.userId === userId);
  const entryId = member === undefined ? null : currentRecordOf(member);
  const got =
    entryId !== null
      ? (await whoGets(deps, gymId, [entryId])).got.get(entryId)
      : member?.unsure !== null && member?.unsure !== undefined
        ? (await audiences.givenOfGym(deps.sql, gymId, [])).find((g) => g.kind === "everyone")
        : undefined;
  if (got === undefined) return null;
  const plan = await plans.getPlan(deps.sql, gymId, got.planId);
  // Deleted between the two reads: nothing is given now.
  if (plan === null) return null;
  return {
    id: plan.id,
    name: plan.name,
    writtenBy: plan.writtenBy,
    updatedAt: plan.updatedAt.toISOString(),
    givenAt: got.givenAt.toISOString(),
    days: plan.days.map((meals, at) => dayOf(at + 1, meals)),
    caution: FOOD_ALLERGY_CAUTION,
  };
}

/** Each gym this person is a live member of, and the plan it gives them (Stage 5's 31g): the phone's
 *  Recommended For You, and the choice the diet plan starts at. Keyed on the caller's own id alone. */
export async function gymPlansOf(deps: GivingDeps, userId: string): Promise<{ gym: audiences.LiveGymRow; plan: MemberGymMealPlan | null }[]> {
  const gyms = await audiences.liveGymsOf(deps.sql, userId);
  return await Promise.all(gyms.map(async (gym) => ({ gym, plan: await planGivenTo(deps, userId, gym.gymId) })));
}

/** The phone's read: every gym and its plan, each day with the least this person may eat where it holds less. */
/** What the phone's reply needs of the member: the least they may eat, the foods their diet doesn't
 *  eat, and the label line their diet gets. */
export interface GymPlanReader {
  lowest: LowestKcal;
  outsideDiet: (items: readonly MealItem[]) => string[];
  labelCaution: MyGymMealPlan["labelCaution"];
}

export async function myGymMealPlans(deps: GivingDeps, userId: string, reader: GymPlanReader): Promise<MyGymMealPlansResponse> {
  const got = await gymPlansOf(deps, userId);
  return myGymMealPlansResponseSchema.parse({
    gyms: got.map(({ gym, plan }) => ({
      gymId: gym.gymId,
      name: gym.name,
      orgType: gym.orgType,
      contact: { phone: gym.contactPhone, email: gym.contactEmail },
      plan: plan === null ? null : {
        ...plan,
        days: plan.days.map((d) => ({
          ...d,
          meals: d.meals.map((m) => ({ ...m, outsideDiet: reader.outsideDiet(m.items) })),
          under: dayUnder(d.planned.kcal, d.meals.length, reader.lowest),
        })),
        labelCaution: reader.labelCaution,
      },
    })),
  });
}
