// The admin page (ROADMAP Stage 2 item 14a-i). What a person gets is read through the plan check's
// own module (`entitlementsOfMany`), never worked out a second time here.
import type { Sql } from "postgres";
import {
  ADMIN_DAY_PEOPLE_PAGE,
  ADMIN_DAYS_PAGE,
  type AdminDayResponse,
  type AdminPeopleQuery,
  type AdminPeopleResponse,
  type AdminPerson,
  type AdminPersonDaysResponse,
  type AdminSetLimitsRequest,
  type AdminSetLimitsResponse,
} from "@app/shared";
import type { RedisLike } from "../../redis.js";
import { bustEntitlements, entitlementsOfMany } from "../entitlements/service.js";
import * as repo from "./repo.js";

export interface AdminDeps {
  sql: Sql;
  redis: RedisLike;
}

export const PAGE_SIZE = 50;

function cursorOf(row: repo.PersonRow): string {
  return `${row.created_us}_${row.id}`;
}

function parseCursor(after: string | undefined): { us: string; id: string } | null {
  if (after === undefined) return null;
  const cut = after.indexOf("_");
  return { us: after.slice(0, cut), id: after.slice(cut + 1) };
}

export async function listPeople(deps: AdminDeps, query: AdminPeopleQuery): Promise<AdminPeopleResponse> {
  const rows = await repo.listPeople(deps.sql, {
    search: query.search ?? null,
    after: parseCursor(query.after),
    limit: PAGE_SIZE + 1,
  });
  const page = rows.slice(0, PAGE_SIZE);
  const plans = await entitlementsOfMany(deps.sql, page.map((row) => row.id));
  const people = page.map((row): AdminPerson => {
    const entitlements = plans.get(row.id);
    if (entitlements === undefined) throw new Error("entitlementsOfMany answers for every person asked");
    return {
      id: row.id,
      name: row.display_name,
      email: row.email,
      signedUpAt: row.created_at.toISOString(),
      lastSeenAt: row.last_active_at === null ? null : row.last_active_at.toISOString(),
      ownPlan: row.own_interval,
      gyms: row.gyms,
      mealScans: { ...entitlements.meal_scan, yours: row.meal_scans_a_day !== null },
      routePlans: { ...entitlements.route_gen, yours: row.route_plans_a_day !== null },
    };
  });
  const last = page[page.length - 1];
  return { people, next: rows.length > PAGE_SIZE && last !== undefined ? cursorOf(last) : null };
}

/** Sets the number, then has every changed person's plan check read afresh at once, and again a
 *  second later: a plan check that read the old number just before the save could otherwise put it
 *  back in the 60-second memory after the first clearing. */
export const SECOND_CLEARING_MS = 1000;
export async function setLimits(deps: AdminDeps, actorUserId: string, input: AdminSetLimitsRequest): Promise<AdminSetLimitsResponse> {
  const result = await repo.setLimits(deps.sql, actorUserId, input);
  const clear = async (): Promise<void> => {
    await Promise.all(result.changed.map((id) => bustEntitlements(deps.redis, id)));
  };
  await clear();
  if (result.changed.length > 0) setTimeout(() => void clear(), SECOND_CLEARING_MS).unref();
  return { changed: result.changed.length, unchanged: result.unchanged, notFound: result.notFound };
}

/** A sum of micro-dollars read as text, as a whole number the page can show. */
function micro(text: string): number {
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("a cost outside a safe whole number");
  return n;
}

/** One person's days, ADMIN_DAYS_PAGE at a time (ROADMAP Stage 2 item 14a-ii); null when they are
 *  not a person using the app. */
export async function personDays(
  deps: AdminDeps,
  input: { userId: string; zone: string; before: string | null; now: Date },
): Promise<AdminPersonDaysResponse | null> {
  const rows = await repo.personDays(deps.sql, { ...input, count: ADMIN_DAYS_PAGE });
  const first = rows[0];
  if (first === undefined) return null;
  const days = rows.flatMap((r) =>
    r.day === null ? [] : [{ day: r.day, minutes: r.minutes, mealScans: r.meal, routePlans: r.route, costMicro: micro(r.cost) }],
  );
  const earliest = days[days.length - 1];
  return {
    person: { id: first.id, name: first.display_name, email: first.email },
    zone: first.zone,
    zoneFromPhone: first.from_phone,
    today: first.today,
    days,
    next: earliest !== undefined && earliest.day > first.first_shown ? earliest.day : null,
  };
}

/** Everyone who used the app on one day, with the day's totals (14a-ii). */
export async function dayPeople(deps: AdminDeps, input: { day: string; zone: string; from: number }): Promise<AdminDayResponse> {
  const list = await repo.dayList(deps.sql, { ...input, limit: ADMIN_DAY_PEOPLE_PAGE });
  const people = list.page.map((r) => ({
    id: r.id,
    name: r.display_name,
    email: r.email,
    minutes: r.minutes,
    mealScans: r.meal,
    routePlans: r.route,
    costMicro: micro(r.cost),
  }));
  const shown = input.from + people.length;
  return {
    day: input.day,
    totals: {
      people: list.totals.people,
      minutes: list.totals.minutes,
      mealScans: list.totals.meal,
      routePlans: list.totals.route,
      costMicro: micro(list.totals.cost),
    },
    people,
    next: shown < list.totals.people ? shown : null,
  };
}
