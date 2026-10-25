// Members in Square (ROADMAP 18d-iii-b-ii-b-i; spec Part 3 §14.8; rulings/2026-10-26-18d-iii-b-ii-b-i.md).
//
// The owner presses Add members to Square in Settings → Payments. The press checks Square first: it reads
// the business's customers a page at a time (ListCustomers), keeps only those sharing an email or a phone
// with a current record here, or naming one of its records as their reference, and decides for each
// current record not yet in Square who it is there (`squareMembersPlan.ts`); it then asks Square's own
// Subscriptions whether any of the customers it would link are charged there already. The box names who is
// added, linked or left out, and whom Square charges itself, and waits an hour for the press of Add, which
// does what the box said and nothing for anybody it did not name: a record changed since the check is left
// for the next look. Then each new member is added by itself, looked up by their email and phone
// (SearchCustomers) whenever the list moves on, and anybody left out or refused is looked at again a day on.
//
// Only the gym's own owner presses: the members' names, emails and phones go into the Square account the
// owner chose (as Connect Square is the owner's, 2026-10-19). Every member of staff reads the box.
//
// Work is done a page at a time, leased (`gym_square_member_runs.lease_until`): the press does the first
// pages itself, so a small gym's box answers at once, and the worker's minute does the rest, a few pages a
// gym, so no gym's check holds the others' card charges up. Square giving no answer (a 429 or a 5xx) stops
// the step and it is tried again on the next minute; nothing is lost. Everything written names the run, so
// a check started again meanwhile is never written over by the one it replaced, and a customer is made at
// Square once per record with one idempotency key, the one card saves use (`cardsRepo.claimCustomer`).
import { randomUUID } from "node:crypto";
import {
  SQUARE_MEMBERS,
  SQUARE_MEMBERS_WORDS,
  cardNameParts,
  squareMembersNamesResponseSchema,
  squareMembersResponseSchema,
  type SquareMembersNamesQuery,
  type SquareMembersNamesResponse,
  type SquareMembersResponse,
  type SquareMembersState,
} from "@app/shared";
import { lockGym } from "../memberList/repo.js";
import { readCountry } from "../memberList/phone.js";
import { OrgsError, requireStaff, requireWritableGym } from "../service.js";
import * as cards from "./cardsRepo.js";
import * as repo from "./repo.js";
import { accessContext, requireGymOwner, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import * as members from "./squareMembersRepo.js";
import { squareEmail, squareMembersPlan, squarePhone, type PlanCustomer, type PlanMember } from "./squareMembersPlan.js";

export const SQUARE_MEMBERS_WORK = {
  /** Calls to Square a press (Add members to Square, Check again, Add) makes itself before it answers: a
   *  page of 100 customers, a customer made, or a member looked up is one each. */
  callsByPress: 20,
  /** And the worker's minute, for every gym together. Square's test area made 150 customers in 40 seconds
   *  two at a time, and turned 163 of 400 away four at a time (measured 2026-10-26,
   *  `.cost/18d-iii-b-ii-b-i/probe-customers.mts`): 150 calls two at a time keep the minute under one. */
  callsByWorker: 150,
  /** Customers made at Square at the same moment, for one gym. */
  addsAtOnce: 2,
  /** New members looked up a gym a minute, at most. */
  looksByWorker: 15,
  /** Gyms the worker takes a minute. */
  gymsPerRun: 10,
  leaseMs: 5 * 60_000,
  /** Somebody left out, refused or not added is looked at again this long after. */
  lookAgainMs: 24 * 60 * 60_000,
} as const;

export interface SquareMembersRun {
  pages: number;
  added: number;
  linked: number;
  looked: number;
  unanswered: number;
}

/** Calls to Square still allowed: shared by every gym of one minute's work. */
interface Budget {
  left: number;
}

const notConnected = (): OrgsError => new OrgsError(409, "square_not_connected", SQUARE_MEMBERS_WORDS.not_connected);

/** What Square needs to have allowed for the check: its own subscriptions read (added for this job). */
export const readsSubscriptions = (row: repo.ConnectionRow): boolean => row.scopes.includes("SUBSCRIPTIONS_READ");

interface Ready {
  square: SquareSettings;
  row: repo.ConnectionRow & { locationId: string };
  token: string;
}

/** The gym connected to Square with its location, its token opened; null where it is not. */
async function readyFor(deps: PaymentsDeps, gymId: string): Promise<Ready | null> {
  const square = deps.square;
  if (square === null) return null;
  const row = await repo.readConnection(deps.sql, gymId, square.environment);
  if (row?.state !== "connected" || row.locationId === null || row.accessToken === null) return null;
  const token = square.tokens.open(row.accessToken, accessContext(gymId));
  if (token === null) {
    deps.log.error({ event: "square.token_unreadable", gymId }, "a gym's Square token could not be opened");
    return null;
  }
  return { square, row: { ...row, locationId: row.locationId }, token };
}

const tell = (deps: PaymentsDeps, gymId: string): void => {
  deps.news?.tell(gymId, { what: "squareMembers" });
};

// ── The box ───────────────────────────────────────────────────────────────────

/** The box, for anybody on the gym's staff; names for the owner alone. */
export async function readSquareMembers(deps: PaymentsDeps, userId: string, gymId: string): Promise<SquareMembersResponse> {
  await requireStaff(deps, gymId, userId);
  const gym = await repo.readGym(deps.sql, gymId);
  if (gym === null) throw new OrgsError(404, "org_not_found", "Organisation not found.");
  const square = deps.square;
  const row = square === null ? null : await repo.readConnection(deps.sql, gymId, square.environment);
  if (square === null || row?.state !== "connected") throw notConnected();
  const isOwner = gym.ownerUserId === userId;
  const run = await members.readRun(deps.sql, gymId, square.environment);
  const mine = run !== null && run.accountId === row.accountId ? run : null;
  const counts = await members.countMembers(deps.sql, gymId, square.environment, row.accountId);
  const state: SquareMembersState = mine?.state ?? "none";
  const now = deps.now();
  const groups =
    mine !== null && (state === "checked" || state === "adding")
      ? await members.checkedGroups(deps.sql, gymId, square.environment, mine.runId, isOwner)
      : await members.notInGroups(deps.sql, gymId, square.environment, row.accountId, isOwner);
  return squareMembersResponseSchema.parse({
    members: {
      state,
      runId: mine?.runId ?? null,
      canAdd: isOwner,
      automatic: mine?.automatic === true,
      looked: mine?.state === "checking" ? mine.looked : 0,
      unanswered: mine?.unansweredAt != null,
      failure: mine?.failure ?? null,
      checkedAt: mine?.checkedAt?.toISOString() ?? null,
      expired: mine?.state === "checked" && mine.checkedAt !== null && mine.checkedAt.getTime() < now.getTime() - SQUARE_MEMBERS.checkValidMs,
      members: counts.members,
      inSquare: counts.inSquare,
      progress: mine?.state === "adding" ? await members.progressOf(deps.sql, gymId, square.environment, mine.runId) : null,
      groups,
    },
  });
}

/** See all: a page of one group's names, for the owner. */
export async function readSquareMembersNames(deps: PaymentsDeps, userId: string, gymId: string, q: SquareMembersNamesQuery): Promise<SquareMembersNamesResponse> {
  await requireGymOwner(deps, gymId, userId, SQUARE_MEMBERS_WORDS.owner_only);
  const square = deps.square;
  const row = square === null ? null : await repo.readConnection(deps.sql, gymId, square.environment);
  if (square === null || row?.state !== "connected") throw notConnected();
  const run = await members.readRun(deps.sql, gymId, square.environment);
  const mine = run !== null && run.accountId === row.accountId ? run : null;
  const checked = mine !== null && (mine.state === "checked" || mine.state === "adding");
  const page = SQUARE_MEMBERS.namesPage;
  const names = await members.groupNames(deps.sql, {
    gymId,
    environment: square.environment,
    accountId: row.accountId,
    runId: mine?.runId ?? null,
    checked,
    group: q.group,
    from: q.from,
    limit: page + 1,
  });
  return squareMembersNamesResponseSchema.parse({ names: names.slice(0, page), next: names.length > page ? q.from + page : null });
}

/** The owner, at a gym open to changes, connected with the permission the check needs. */
async function ownerReady(deps: PaymentsDeps, userId: string, gymId: string): Promise<Ready> {
  const { org } = await requireGymOwner(deps, gymId, userId, SQUARE_MEMBERS_WORDS.owner_only);
  await requireWritableGym(deps, org);
  const ready = await readyFor(deps, gymId);
  if (ready === null) throw notConnected();
  if (!readsSubscriptions(ready.row)) throw new OrgsError(409, "square_members_need_allow", SQUARE_MEMBERS_WORDS.needs_allow);
  return ready;
}

/** Add members to Square, and Check again: a new check, its first pages read before the answer. */
export async function checkSquareMembers(deps: PaymentsDeps, userId: string, gymId: string): Promise<SquareMembersResponse> {
  const ready = await ownerReady(deps, userId, gymId);
  const now = deps.now();
  const run = await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    return await members.startRun(tx, {
      gymId,
      environment: ready.square.environment,
      accountId: ready.row.accountId,
      runId: randomUUID(),
      userId,
      now,
      leaseUntil: new Date(now.getTime() + SQUARE_MEMBERS_WORK.leaseMs),
    });
  });
  if (run === null) throw new OrgsError(409, "square_members_busy", SQUARE_MEMBERS_WORDS.busy);
  try {
    await checkSome(deps, ready, run, { left: SQUARE_MEMBERS_WORK.callsByPress });
  } finally {
    await members.releaseRun(deps.sql, run);
  }
  tell(deps, gymId);
  return await readSquareMembers(deps, userId, gymId);
}

/** Add: what the check the box showed decided, once, its first people done before the answer. */
export async function addSquareMembers(deps: PaymentsDeps, userId: string, gymId: string, runId: string): Promise<SquareMembersResponse> {
  const ready = await ownerReady(deps, userId, gymId);
  const now = deps.now();
  const run = await members.startAdding(deps.sql, {
    gymId,
    environment: ready.square.environment,
    runId,
    checkedSince: new Date(now.getTime() - SQUARE_MEMBERS.checkValidMs),
    leaseUntil: new Date(now.getTime() + SQUARE_MEMBERS_WORK.leaseMs),
  });
  if (run === null) {
    const current = await members.readRun(deps.sql, gymId, ready.square.environment);
    // The same press twice: the first is adding or has added them.
    if (current?.runId === runId && (current.state === "adding" || current.state === "added")) return await readSquareMembers(deps, userId, gymId);
    const old = current?.runId === runId && current.state === "checked";
    throw new OrgsError(409, old ? "square_members_check_expired" : "square_members_check_changed", old ? SQUARE_MEMBERS_WORDS.check_expired : SQUARE_MEMBERS_WORDS.check_changed);
  }
  if (run.accountId !== ready.row.accountId) throw new OrgsError(409, "square_members_check_changed", SQUARE_MEMBERS_WORDS.check_changed);
  try {
    await addSome(deps, ready, run, { left: SQUARE_MEMBERS_WORK.callsByPress });
  } finally {
    await members.releaseRun(deps.sql, run);
  }
  tell(deps, gymId);
  return await readSquareMembers(deps, userId, gymId);
}

// ── The check ─────────────────────────────────────────────────────────────────

type Step = "more" | "done" | "unanswered" | "stopped";

/** Pages of Square's customers while the budget lasts, then, at the end of the list, the decision. */
async function checkSome(deps: PaymentsDeps, ready: Ready, run: members.RunRow, budget: Budget): Promise<Step> {
  const { square, token } = ready;
  const at = { gymId: run.gymId, environment: run.environment, runId: run.runId };
  const gym = await repo.readGym(deps.sql, run.gymId);
  if (gym === null) return "stopped";
  const country = readCountry(gym.country);
  let cursor = run.cursor;
  let listed = run.listedAt !== null;
  if (!listed) {
    const known = await members.contactsOf(deps.sql, run.gymId);
    while (budget.left > 0) {
      budget.left -= 1;
      const page = await square.api.listCustomers(token, cursor);
      if (page.kind === "unavailable") {
        await members.setUnanswered(deps.sql, { ...at, now: deps.now() });
        return "unanswered";
      }
      if (page.kind === "refused") {
        // A page Square will not give from where it stopped (a cursor it no longer knows): from the start, once.
        if (cursor !== null && page.status === 400) {
          deps.log.warn({ event: "square.members_cursor_refused", gymId: run.gymId, code: page.code }, "Square refused to go on listing customers; starting again");
          await members.restartListing(deps.sql, at);
          cursor = null;
          continue;
        }
        return await stop(deps, run, page.status === 401 ? "square_unauthorized" : "square_refused", page.code);
      }
      const kept: members.CandidateRow[] = [];
      for (const c of page.value.customers) {
        const email = squareEmail(c.email_address);
        const phone = squarePhone(c.phone_number, country);
        const ref = c.reference_id ?? null;
        if ((email !== null && known.emails.has(email)) || (phone !== null && known.phones.has(phone)) || (ref !== null && known.recordIds.has(ref))) {
          kept.push({ customerId: c.id, givenName: c.given_name ?? null, familyName: c.family_name ?? null, email: c.email_address ?? null, phone, referenceId: ref });
        }
      }
      await members.insertCandidates(deps.sql, at, kept);
      cursor = page.value.cursor;
      listed = cursor === null;
      const looked = page.value.customers.length + page.value.unread;
      if (!(await members.saveListing(deps.sql, { ...at, cursor, looked, listed: listed ? deps.now() : null }))) return "stopped";
      if (listed) break;
    }
    if (!listed) return "more";
  }
  return await decide(deps, ready, run);
}

/** The end of Square's list: each current record not in Square decided, and Square's own subscriptions read
 *  for the customers they would be linked to. */
async function decide(deps: PaymentsDeps, ready: Ready, run: members.RunRow): Promise<Step> {
  const at = { gymId: run.gymId, environment: run.environment, runId: run.runId };
  const environment = run.environment;
  const [people, candidates, taken, known] = await Promise.all([
    members.recordsToPlace(deps.sql, run.gymId, environment, run.accountId),
    members.readCandidates(deps.sql, at),
    members.takenCustomers(deps.sql, run.gymId, environment, run.accountId),
    members.contactsOf(deps.sql, run.gymId),
  ]);
  const plan = squareMembersPlan(
    people.map((p): PlanMember => ({ entryId: p.entryId, fullName: p.fullName, email: p.email, phone: p.phone })),
    candidates.map((c): PlanCustomer => ({ id: c.customerId, givenName: c.givenName, familyName: c.familyName, email: c.email, phone: c.phone, referenceId: c.referenceId })),
    { taken, recordIds: known.recordIds },
  );
  const linking = [...new Set([...plan.values()].flatMap((p) => (p.kind === "ours" || p.kind === "link" ? [p.customerId] : [])))];
  const billed = await chargedBySquare(deps, ready, linking);
  if (billed === "unanswered") {
    await members.setUnanswered(deps.sql, { ...at, now: deps.now() });
    return "unanswered";
  }
  if (billed === "refused") return await stop(deps, run, "square_refused", "subscriptions");
  const rows = people.flatMap((p) => {
    const one = plan.get(p.entryId);
    return one === undefined
      ? []
      : [{ entryId: p.entryId, plan: one, digest: p.digest, billed: (one.kind === "ours" || one.kind === "link") && billed.has(one.customerId) }];
  });
  const finished = await deps.sql.begin(async (tx) => {
    await lockGym(tx, run.gymId);
    return await members.finishCheck(tx, { ...at, now: deps.now() }, rows);
  });
  if (!finished) return "stopped";
  // Nobody to add or link (everybody in Square already, or left out): nothing waits for a press, and new
  // members are added by themselves from now, as the owner's press asked.
  if (!rows.some((r) => r.plan.kind === "ours" || r.plan.kind === "link" || r.plan.kind === "add")) {
    const now = deps.now();
    const adding = await members.startAdding(deps.sql, { ...at, checkedSince: now, leaseUntil: new Date(now.getTime() + SQUARE_MEMBERS_WORK.leaseMs) });
    if (adding !== null) await members.finishAdding(deps.sql, { ...at, now });
  }
  return "done";
}

/** The customers among these whom Square's own subscriptions still charge. */
async function chargedBySquare(deps: PaymentsDeps, ready: Ready, customerIds: readonly string[]): Promise<Set<string> | "unanswered" | "refused"> {
  const charged = new Set<string>();
  for (let from = 0; from < customerIds.length; from += 100) {
    const ids = customerIds.slice(from, from + 100);
    let cursor: string | null = null;
    do {
      const page = await ready.square.api.searchSubscriptions(ready.token, { customerIds: ids, cursor });
      if (page.kind === "unavailable") return "unanswered";
      if (page.kind === "refused") {
        deps.log.error({ event: "square.members_subscriptions_refused", gymId: ready.row.gymId, status: page.status, code: page.code }, "Square refused to show its subscriptions");
        return "refused";
      }
      for (const s of page.value.subscriptions) {
        if (s.customerId !== null && s.status !== null && members.SQUARE_SUBSCRIPTION_CHARGES.includes(s.status)) charged.add(s.customerId);
      }
      cursor = page.value.cursor;
    } while (cursor !== null);
  }
  return charged;
}

async function stop(deps: PaymentsDeps, run: members.RunRow, failure: members.RunFailure, code: string): Promise<Step> {
  deps.log.error({ event: "square.members_stopped", gymId: run.gymId, failure, code }, "Square refused Members in Square");
  await members.failRun(deps.sql, { gymId: run.gymId, environment: run.environment, runId: run.runId, failure });
  return "stopped";
}

// ── Adding ────────────────────────────────────────────────────────────────────

type Made = "done" | "refused" | "unanswered" | "busy";

/** The record's customer made at Square with its name, email and phone and the record's id as its reference,
 *  once: by the key on the record's row (`claimCustomer`), the one a card being saved asks with too. Square
 *  refusing that key for another body (a card save's, which sends less) is a customer being made by that save:
 *  found by its reference, or looked at again later. */
async function makeCustomer(deps: PaymentsDeps, ready: Ready, gymId: string, person: { entryId: string; fullName: string; email: string | null; phone: string | null }): Promise<Made> {
  const key = { gymId, entryId: person.entryId, environment: ready.square.environment, accountId: ready.row.accountId };
  const claimed = await cards.claimCustomer(deps.sql, key, randomUUID());
  if ("customerId" in claimed) return "done";
  const { givenName, familyName } = cardNameParts(person.fullName);
  const result = await ready.square.api.createCustomer(ready.token, {
    idempotencyKey: claimed.makingKey,
    givenName: givenName === "" ? null : givenName,
    familyName: familyName === "" ? null : familyName,
    email: person.email,
    phone: person.phone,
    referenceId: person.entryId,
  });
  let customerId: string;
  if (result.kind === "ok") {
    customerId = result.value.id;
  } else if (result.kind === "unavailable") {
    // The key stays on the row: asked again with it, Square gives back what it may have made.
    return "unanswered";
  } else if (result.code === "IDEMPOTENCY_KEY_REUSED") {
    const found = await ready.square.api.searchCustomers(ready.token, { referenceId: person.entryId });
    const made = found.kind === "ok" ? found.value.customers.filter((c) => c.reference_id === person.entryId).sort((a, b) => (a.id < b.id ? -1 : 1))[0] : undefined;
    if (made === undefined) return "busy";
    customerId = made.id;
  } else {
    deps.log.warn({ event: "square.member_customer_refused", gymId, status: result.status, code: result.code }, "Square refused a member's customer");
    await cards.abandonCustomer(deps.sql, key, claimed.makingKey);
    return "refused";
  }
  if (await cards.finishCustomer(deps.sql, key, claimed.makingKey, customerId)) return "done";
  // Another save wrote it first with the same key, or let the row go meanwhile: written as customerFor does.
  const now = await cards.claimCustomer(deps.sql, key, randomUUID());
  if ("customerId" in now) return "done";
  await cards.finishCustomer(deps.sql, key, now.makingKey, customerId);
  return "done";
}

/** One person of a plan, linked or added. */
async function applyOne(
  deps: PaymentsDeps,
  ready: Ready,
  gymId: string,
  p: { entryId: string; decision: "ours" | "link" | "add"; customerId: string | null; fullName: string; email: string | null; phone: string | null },
): Promise<Made | "changed"> {
  if (p.decision === "add") return await makeCustomer(deps, ready, gymId, p);
  const customerId = p.customerId;
  if (customerId === null) return "changed";
  const outcome = await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    return await members.linkCustomer(tx, {
      gymId,
      entryId: p.entryId,
      environment: ready.square.environment,
      accountId: ready.row.accountId,
      customerId,
      joined: p.decision === "link",
      now: deps.now(),
    });
  });
  return outcome === "taken" ? "changed" : "done";
}

/** The press's people while the budget lasts; adding is done when nobody is left. */
async function addSome(deps: PaymentsDeps, ready: Ready, run: members.RunRow, budget: Budget): Promise<Step> {
  const at = { gymId: run.gymId, environment: run.environment, runId: run.runId };
  let after: string | null = null;
  while (budget.left > 0) {
    const batch = await members.toApply(deps.sql, { ...at, limit: Math.min(budget.left, SQUARE_MEMBERS_WORK.addsAtOnce), after });
    if (batch.length === 0) break;
    after = batch[batch.length - 1]?.entryId ?? after;
    budget.left -= batch.length;
    const outcomes = await Promise.all(
      batch.map(async (p) => {
        // Changed since the box showed them, or no longer current: left for the next look.
        const made = p.unchanged ? await applyOne(deps, ready, run.gymId, p) : "changed";
        if (made === "done" || made === "changed" || made === "refused") await members.setOutcome(deps.sql, { ...at, entryId: p.entryId, outcome: made, now: deps.now() });
        return made;
      }),
    );
    if (outcomes.includes("unanswered")) {
      await members.setUnanswered(deps.sql, { ...at, now: deps.now() });
      return "unanswered";
    }
  }
  // Somebody left: the next minute goes on (a card being saved for them meanwhile is looked at again then).
  if ((await members.toApply(deps.sql, { ...at, limit: 1, after: null })).length > 0) return "more";
  return (await members.finishAdding(deps.sql, { ...at, now: deps.now() })) ? "done" : "stopped";
}

// ── New members, by themselves ────────────────────────────────────────────────

/** The customers Square has with this email or phone, as the rule reads them. */
async function customersWith(ready: Ready, country: ReturnType<typeof readCountry>, person: { email: string | null; phone: string | null }): Promise<PlanCustomer[] | null> {
  const found = new Map<string, PlanCustomer>();
  const asks: ({ email: string } | { phone: string })[] = [];
  const email = squareEmail(person.email);
  if (email !== null) asks.push({ email });
  if (person.phone !== null) asks.push({ phone: person.phone });
  for (const by of asks) {
    const page = await ready.square.api.searchCustomers(ready.token, by);
    if (page.kind !== "ok") return null;
    for (const c of page.value.customers) {
      found.set(c.id, {
        id: c.id,
        givenName: c.given_name ?? null,
        familyName: c.family_name ?? null,
        email: c.email_address ?? null,
        phone: squarePhone(c.phone_number, country),
        referenceId: c.reference_id ?? null,
      });
    }
  }
  return [...found.values()];
}

/** A few current records not in Square looked up, each linked, added, or left out as the check would; the
 *  list counted as looked at once nobody is due. */
async function lookSome(deps: PaymentsDeps, ready: Ready, run: members.RunRow, budget: Budget): Promise<{ step: Step; looked: number; added: number; linked: number }> {
  const environment = run.environment;
  const now = deps.now();
  const gym = await repo.readGym(deps.sql, run.gymId);
  if (gym === null) return { step: "stopped", looked: 0, added: 0, linked: 0 };
  const country = readCountry(gym.country);
  const version = await members.listVersionOf(deps.sql, run.gymId);
  const lookedBefore = new Date(now.getTime() - SQUARE_MEMBERS_WORK.lookAgainMs);
  const limit = Math.min(SQUARE_MEMBERS_WORK.looksByWorker, budget.left);
  const due = await members.recordsDue(deps.sql, { gymId: run.gymId, environment, accountId: run.accountId, lookedBefore, limit });
  const tally = { looked: 0, added: 0, linked: 0 };
  let busy = false;
  let stopped = false;
  for (const person of due) {
    if (budget.left <= 0) {
      stopped = true;
      break;
    }
    budget.left -= (person.email === null ? 0 : 1) + (person.phone === null ? 0 : 1);
    const found = await customersWith(ready, country, person);
    if (found === null) {
      await members.setUnanswered(deps.sql, { gymId: run.gymId, environment, runId: run.runId, now: deps.now() });
      return { step: "unanswered", ...tally };
    }
    const emails = [...new Set([person.email, ...found.map((c) => c.email)].flatMap((e) => (squareEmail(e) === null ? [] : [squareEmail(e) ?? ""])))];
    const phones = [...new Set([person.phone, ...found.map((c) => c.phone)].flatMap((p) => (p === null ? [] : [p])))];
    const [sharing, taken, known] = await Promise.all([
      members.recordsSharing(deps.sql, { gymId: run.gymId, environment, accountId: run.accountId, emails, phones }),
      members.takenCustomers(deps.sql, run.gymId, environment, run.accountId),
      members.contactsOf(deps.sql, run.gymId),
    ]);
    const people = [person, ...sharing.filter((s) => s.entryId !== person.entryId)];
    const plan = squareMembersPlan(
      people.map((p): PlanMember => ({ entryId: p.entryId, fullName: p.fullName, email: p.email, phone: p.phone })),
      found,
      { taken, recordIds: known.recordIds },
    );
    const mine = plan.get(person.entryId) ?? { kind: "add" as const };
    let outcome: members.Outcome | null = null;
    if (mine.kind === "ours" || mine.kind === "link" || mine.kind === "add") {
      if (mine.kind === "add") budget.left -= 1;
      const made = await applyOne(deps, ready, run.gymId, {
        entryId: person.entryId,
        decision: mine.kind,
        customerId: mine.kind === "add" ? null : mine.customerId,
        fullName: person.fullName,
        email: person.email,
        phone: person.phone,
      });
      if (made === "unanswered") {
        await members.setUnanswered(deps.sql, { gymId: run.gymId, environment, runId: run.runId, now: deps.now() });
        return { step: "unanswered", ...tally };
      }
      if (made === "busy") {
        // A card being saved for them this moment makes their customer: looked at again in a minute.
        busy = true;
        continue;
      }
      outcome = made;
      if (made === "done") {
        if (mine.kind === "add") tally.added += 1;
        else tally.linked += 1;
      }
    }
    await members.writeLook(deps.sql, { gymId: run.gymId, environment, runId: run.runId, entryId: person.entryId, plan: mine, digest: person.digest, outcome, now: deps.now() });
    tally.looked += 1;
  }
  if (!stopped && due.length < limit) {
    const next = busy ? 60_000 : SQUARE_MEMBERS_WORK.lookAgainMs;
    await members.caughtUp(deps.sql, { gymId: run.gymId, environment, runId: run.runId, version, lookDueAt: new Date(now.getTime() + next) });
    return { step: "done", ...tally };
  }
  return { step: "more", ...tally };
}

// ── The worker's minute ───────────────────────────────────────────────────────

/** Each gym's check or adding nobody holds, and each gym's new members once members were added: a few pages
 *  or people a gym, then the lease let go. `gymIds`: only these gyms, for a test; production passes null. */
export async function processSquareMembers(deps: PaymentsDeps, square: SquareSettings, gymIds: readonly string[] | null = null): Promise<SquareMembersRun> {
  const tally: SquareMembersRun = { pages: 0, added: 0, linked: 0, looked: 0, unanswered: 0 };
  const budget: Budget = { left: SQUARE_MEMBERS_WORK.callsByWorker };
  const now = deps.now();
  const runs = await members.claimDueRuns(deps.sql, {
    environment: square.environment,
    now,
    leaseUntil: new Date(now.getTime() + SQUARE_MEMBERS_WORK.leaseMs),
    gymIds,
    limit: SQUARE_MEMBERS_WORK.gymsPerRun,
  });
  for (const run of runs) {
    try {
      // The minute's calls are spent: this gym's lease is let go, and it is taken on the next minute.
      if (budget.left <= 0) continue;
      const ready = await readyFor(deps, run.gymId);
      if (ready === null || ready.row.accountId !== run.accountId || !readsSubscriptions(ready.row)) continue;
      let step: Step = "stopped";
      // Whether an open box has something new to read: a check or adding moved on, or somebody was looked at.
      let news = true;
      if (run.state === "checking") {
        const before = budget.left;
        step = await checkSome(deps, ready, run, budget);
        tally.pages += before - budget.left;
      } else if (run.state === "adding") {
        step = await addSome(deps, ready, run, budget);
      } else if (run.automatic) {
        const look = await lookSome(deps, ready, run, budget);
        step = look.step;
        news = look.looked > 0;
        tally.looked += look.looked;
        tally.added += look.added;
        tally.linked += look.linked;
      }
      if (step === "unanswered") tally.unanswered += 1;
      if (news) tell(deps, run.gymId);
    } finally {
      await members.releaseRun(deps.sql, run);
    }
  }
  return tally;
}
