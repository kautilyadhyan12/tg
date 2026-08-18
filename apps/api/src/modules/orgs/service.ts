// Orgs service — the org lifecycle this slice covers: create one, join one by
// code, list mine, read the roster. Authorization decisions live here (R3.3
// step 3); the repo enforces tenancy in every WHERE and the routes stay thin.
import type { Sql } from "postgres";
import { currencyForCountry } from "@app/shared";
import { bustEntitlements } from "../entitlements/service.js";
import type { RedisLike } from "../../redis.js";
import { codeFromBytes, normaliseCode, slugCandidate, slugifyName } from "./codes.js";
import * as repo from "./repo.js";
import {
  createOrgResponseSchema,
  joinOrgResponseSchema,
  myOrgsResponseSchema,
  orgCodesResponseSchema,
  orgMemberPageSchema,
} from "./schemas.js";
import type {
  CreateOrgRequest,
  CreateOrgResponse,
  JoinOrgRequest,
  JoinOrgResponse,
  MyOrgsResponse,
  OrgCodesResponse,
  OrgMemberListQuery,
  OrgMemberPage,
  OrgRole,
  OrgSummary,
} from "./schemas.js";

/** Typed failure for the central error mapper (R8.1); messages are authored
 *  for clients and name no internals. */
export class OrgsError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "OrgsError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface OrgsDeps {
  sql: Sql;
  redis: RedisLike;
  /** Injected so the collision-retry path is reachable in a test without
   *  waiting for a 1-in-a-billion coincidence. Production passes
   *  `crypto.randomBytes`. */
  randomBytes: (n: number) => Uint8Array;
}

/** Part 3 §4.0 step 4 names the first code "Front Desk". */
const FIRST_CODE_LABEL = "Front Desk";

/** Slug and code are both minted from randomness, so a collision is a lost
 *  race rather than an error: try again with fresh values. Five is far beyond
 *  what the numbers need (32^6 codes) and bounds the loop so a genuinely broken
 *  constraint surfaces as a 503 instead of spinning. */
const CREATE_ATTEMPTS = 5;

function toOrgSummary(org: repo.OrgRow): OrgSummary {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    city: org.city,
    orgType: org.orgType,
    timezone: org.timezone,
    locale: org.locale,
    currencyDisplay: org.currencyDisplay,
    status: org.status,
  };
}

export async function createOrg(
  deps: OrgsDeps,
  ownerUserId: string,
  req: CreateOrgRequest,
): Promise<CreateOrgResponse> {
  // Kd ruling 2026-08-18: currency follows the gym's country, decided HERE and
  // never accepted from the client. An unsupported country is refused outright
  // — the alternative is a fallback currency, which means a gym in a country we
  // have no prices for is quoted in somebody else's money.
  const currencyDisplay = currencyForCountry(req.country);
  if (currencyDisplay === null) {
    throw new OrgsError(
      400,
      "country_unsupported",
      "We're not open in that country yet. Right now we support the United States, India, Canada, the UK and countries using the euro.",
    );
  }

  const base = slugifyName(req.name);

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    // Attempt 0 keeps the readable slug; later attempts add a short token so a
    // second "Iron House" still gets a URL of its own rather than an error the
    // owner cannot act on.
    const suffix = attempt === 0 ? null : codeFromBytes(deps.randomBytes(4), 4);
    try {
      const created = await repo.createOrgAttempt(deps.sql, {
        ownerUserId,
        slug: slugCandidate(base, suffix),
        name: req.name,
        city: req.city ?? null,
        orgType: req.orgType,
        timezone: req.timezone,
        locale: req.locale,
        currencyDisplay,
        code: codeFromBytes(deps.randomBytes(6)),
        codeLabel: FIRST_CODE_LABEL,
      });
      // The owner is member #1 (Part 3 §4.0 step 6), which is a membership
      // change like any other — §4.1's cache would otherwise answer from a
      // snapshot taken before the org existed.
      await bustEntitlements(deps.redis, ownerUserId);
      // Parsed on the way OUT, like the catalog reader next door. It is not
      // ceremony: it is what would have caught a response missing
      // `currencyDisplay` after the schema gained the field (T3 round 1 L-4).
      return createOrgResponseSchema.parse({
        org: toOrgSummary(created.org),
        joinCode: created.code,
      });
    } catch (err) {
      if (err instanceof repo.OrgNameTakenError) continue;
      throw err;
    }
  }
  throw new OrgsError(
    503,
    "org_create_unavailable",
    "Could not create the gym just now. Please try again.",
  );
}

export async function listMyOrgs(deps: OrgsDeps, userId: string): Promise<MyOrgsResponse> {
  const rows = await repo.listOrgsForUser(deps.sql, userId);
  return myOrgsResponseSchema.parse({
    orgs: rows.map((r) => ({
      ...toOrgSummary(r),
      staffRole: r.staffRole,
      isMember: r.isMember,
      joinedAt: r.joinedAt === null ? null : r.joinedAt.toISOString(),
    })),
  });
}

export async function joinOrg(
  deps: OrgsDeps,
  userId: string,
  req: JoinOrgRequest,
): Promise<JoinOrgResponse> {
  const outcome = await repo.joinByCode(deps.sql, {
    userId,
    // Normalised here, once, so the repo only ever looks up the stored form.
    // Doing it at the call site instead is how one caller ends up comparing
    // "aihg-24kq7b" against a stored "24KQ7B" and getting "no such gym".
    code: normaliseCode(req.code),
    consent: req.consent ?? false,
  });

  switch (outcome.kind) {
    case "joined":
    case "already_member": {
      // §4.1's bust seam. A member whose gym grants Pro must not spend up to
      // 60 seconds seeing the free plan's limits — and on the "already"
      // branch too, because a stale cache is exactly what a second attempt is
      // often trying to shake loose.
      await bustEntitlements(deps.redis, userId);
      return joinOrgResponseSchema.parse({
        org: toOrgSummary(outcome.org),
        membership: {
          id: outcome.membership.id,
          joinedAt: outcome.membership.joinedAt.toISOString(),
          groupLabel: outcome.membership.groupLabel,
        },
        alreadyMember: outcome.kind === "already_member",
      });
    }
    case "no_such_code":
      throw new OrgsError(404, "code_not_found", "That code doesn't match any gym.");
    case "org_archived":
      throw new OrgsError(409, "org_archived", "That gym is no longer active.");
    case "code_unusable": {
      const message =
        outcome.reason === "paused"
          ? "That code has been paused. Ask the gym for a current one."
          : outcome.reason === "expired"
            ? "That code has expired. Ask the gym for a current one."
            : "That code has been used the maximum number of times. Ask the gym for a new one.";
      throw new OrgsError(409, `code_${outcome.reason}`, message);
    }
    case "consent_required":
      throw new OrgsError(
        400,
        "consent_required",
        "Joining this clinic needs your agreement to share your activity with them.",
      );
    case "seat_cap":
      // Deliberately does NOT name the number: the seat cap is the gym's
      // commercial business, not the joiner's.
      throw new OrgsError(
        409,
        "seat_cap_reached",
        "This gym has no free places right now. Ask them to add one.",
      );
    default:
      return assertNever(outcome);
  }
}

/** Part 3 §2.2's matrix, enforced server-side (R3.3 — UI hiding is never the
 *  enforcement).
 *
 *  A caller who is not staff of this org gets 404, not 403, and the
 *  distinction is deliberate: 403 confirms the org exists, which lets anyone
 *  with a uuid enumerate gyms. Insufficient ROLE inside an org they do belong
 *  to is a genuine 403 — they already know it exists. */
async function requireStaff(
  deps: OrgsDeps,
  gymId: string,
  userId: string,
  allowed: readonly OrgRole[],
): Promise<{ org: repo.OrgRow; role: OrgRole }> {
  const [org, role] = await Promise.all([
    repo.getOrgById(deps.sql, gymId),
    repo.getStaffRole(deps.sql, gymId, userId),
  ]);
  if (org === null || role === null) {
    throw new OrgsError(404, "org_not_found", "Gym not found.");
  }
  if (!allowed.includes(role)) {
    throw new OrgsError(403, "forbidden", "Your role doesn't allow that.");
  }
  return { org, role };
}

export async function listOrgMembers(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  query: OrgMemberListQuery,
): Promise<OrgMemberPage> {
  const { org, role } = await requireStaff(deps, gymId, userId, ["owner", "manager", "trainer"]);

  // §2.2 gives trainers the member list "assigned/group only (gym: all)", and
  // §2.3 makes group scoping CORE for studios and clinics. Nothing assigns a
  // trainer to a group yet — `gym_staff` has no group column — so an unscoped
  // list is the only thing buildable, and handing a clinic trainer every
  // caseload is the wrong direction to guess in. Gyms get the "all" the matrix
  // already grants them; studios and clinics wait for the scoping card.
  if (role === "trainer" && org.orgType !== "gym") {
    throw new OrgsError(
      403,
      "trainer_scope_unavailable",
      "Trainer access to this list isn't available yet.",
    );
  }

  const page = await repo.listMembers(deps.sql, {
    gymId,
    limit: query.limit,
    cursor: parseCursor(query.cursor),
  });
  // Parsed on the way out, and this one carries the most weight: the roster
  // shape IS Part 3 §2.4's visibility boundary, so a field added to the row
  // without being added to the schema is dropped here rather than served.
  return orgMemberPageSchema.parse({
    items: page.items.map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      joinedAt: m.joinedAt.toISOString(),
      groupLabel: m.groupLabel,
      complimentary: m.complimentary,
    })),
    nextCursor:
      page.nextCursor === null
        ? null
        : `${page.nextCursor.joinedAt.toISOString()}|${page.nextCursor.id}`,
  });
}

/** Part 3 §3.3's `GET /codes`, read half.
 *
 *  ALL THREE ROLES, and that is not an oversight: §2.2's matrix grants "Invite
 *  (share code / print poster)" to owner, manager AND trainer alike. The
 *  studio/clinic trainer hold-back a few lines up belongs to the MEMBER LIST —
 *  §2.2 scopes a trainer's roster to their own group and nothing assigns groups
 *  yet — and has nothing to say about handing somebody a poster code. A trainer
 *  who may not read the roster may still invite. */
export async function listOrgCodes(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
): Promise<OrgCodesResponse> {
  await requireStaff(deps, gymId, userId, ["owner", "manager", "trainer"]);
  const rows = await repo.listCodes(deps.sql, gymId);
  // Parsed on the way out like its siblings: the console decides live-vs-dead
  // from these fields, so a row that silently lost `paused` would become a
  // screen telling an owner to share a code the join path refuses.
  return orgCodesResponseSchema.parse({
    codes: rows.map((c) => ({
      code: c.code,
      label: c.label,
      paused: c.paused,
      expiresAt: c.expiresAt === null ? null : c.expiresAt.toISOString(),
      maxUses: c.maxUses,
      uses: c.uses,
    })),
  });
}

/** `<joinedAt ISO>|<uuid>`. Malformed → null (first page), never a 500 from a
 *  hand-edited cursor — the workouts reader's convention, kept identical. */
function parseCursor(cursor: string | undefined): { joinedAt: string; id: string } | null {
  if (cursor === undefined) return null;
  const sep = cursor.indexOf("|");
  if (sep === -1) return null;
  const joinedAt = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (Number.isNaN(joinedAt.getTime()) || !uuidRe.test(id)) return null;
  return { joinedAt: joinedAt.toISOString(), id };
}

function assertNever(x: never): never {
  throw new Error(`unhandled join outcome: ${JSON.stringify(x)}`);
}
