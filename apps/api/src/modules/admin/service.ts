// The admin page (ROADMAP Stage 2 item 14a-i). What a person gets is read through the plan check's
// own module (`entitlementsOfMany`), never worked out a second time here.
import type { Sql } from "postgres";
import type { AdminPeopleQuery, AdminPeopleResponse, AdminPerson, AdminSetLimitsRequest, AdminSetLimitsResponse } from "@app/shared";
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
