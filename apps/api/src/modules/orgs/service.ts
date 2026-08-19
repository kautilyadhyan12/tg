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
  confirmApplicationResponseSchema,
  createOrgResponseSchema,
  joinOrgResponseSchema,
  myOrgApplicationsResponseSchema,
  myOrgsResponseSchema,
  orgApplicationPageSchema,
  orgCodesResponseSchema,
  orgMemberPageSchema,
  rejectApplicationResponseSchema,
} from "./schemas.js";
import type {
  ConfirmApplicationResponse,
  CreateOrgRequest,
  CreateOrgResponse,
  JoinOrgRequest,
  JoinOrgResponse,
  MyOrgApplicationsResponse,
  MyOrgsResponse,
  OrgApplication,
  OrgApplicationListQuery,
  OrgApplicationPage,
  OrgCodesResponse,
  OrgMemberListQuery,
  OrgMemberPage,
  OrgRole,
  OrgSummary,
  RejectApplicationResponse,
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

function toApplication(app: repo.ApplicationRow): OrgApplication {
  return {
    id: app.id,
    status: app.status,
    appliedAt: app.appliedAt.toISOString(),
    expiresAt: app.expiresAt.toISOString(),
    decidedAt: app.decidedAt === null ? null : app.decidedAt.toISOString(),
  };
}

/** KD RULING :11072 — typing a code APPLIES. Nothing is granted here.
 *
 *  **`bustEntitlements` is deliberately NOT called on the pending arms.** A
 *  pending person's entitlements have not changed — that is the ruling's whole
 *  content — so busting the cache would be a no-op that reads, to the next
 *  person maintaining this, as though something was granted. It stays on the
 *  `already_member` arm (a stale free-plan answer is what a second attempt is
 *  often trying to shake loose) and moves to CONFIRM, where a membership is
 *  genuinely created. */
export async function applyToOrg(
  deps: OrgsDeps,
  userId: string,
  req: JoinOrgRequest,
): Promise<JoinOrgResponse> {
  const outcome = await repo.applyByCode(deps.sql, {
    userId,
    // Normalised here, once, so the repo only ever looks up the stored form.
    // Doing it at the call site instead is how one caller ends up comparing
    // "aihg-24kq7b" against a stored "24KQ7B" and getting "no such gym".
    code: normaliseCode(req.code),
    consent: req.consent ?? false,
  });

  switch (outcome.kind) {
    case "pending":
    case "already_pending":
      return joinOrgResponseSchema.parse({
        outcome: outcome.kind,
        org: toOrgSummary(outcome.org),
        application: toApplication(outcome.application),
      });
    case "already_member": {
      await bustEntitlements(deps.redis, userId);
      return joinOrgResponseSchema.parse({
        outcome: "already_member",
        org: toOrgSummary(outcome.org),
        membership: {
          id: outcome.membership.id,
          joinedAt: outcome.membership.joinedAt.toISOString(),
          groupLabel: outcome.membership.groupLabel,
        },
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
    default:
      return assertNever(outcome);
  }
}

/** The applicant's own waiting list — read by the card that sits on TOP of the
 *  whole free app (:11132 clarification 1). No org authorization: these are
 *  the caller's own rows, scoped by `user_id` in the repo's WHERE. */
export async function listMyApplications(
  deps: OrgsDeps,
  userId: string,
): Promise<MyOrgApplicationsResponse> {
  const rows = await repo.listApplicationsForUser(deps.sql, userId);
  return myOrgApplicationsResponseSchema.parse({
    applications: rows.map((r) => ({
      ...toApplication(r.application),
      org: toOrgSummary(r.org),
    })),
  });
}

/** THE PERMISSION SEAM (Kd ruling 2026-08-19, :11429).
 *
 *  **Routes ask "does this person hold privilege X", NEVER "is this person a
 *  manager".** Kd ruled that the three roles stay AND per-staff privilege
 *  ticks go on top — "AND", not "OR" — with the ROLE picking the starting
 *  ticks and the TICKS being what the server enforces. His words on the
 *  widening half, 2026-08-19: *"ok only owner and manager but if owner gives
 *  permission others can also add"*.
 *
 *  The measured reason this seam exists NOW rather than at the staff card: the
 *  whole permission surface was one function and two call sites, so the
 *  conversion is cheap today and a dozen-route migration later — and a new
 *  route checking a role NAME re-opens it. This card adds FOUR routes and THREE
 *  of them go through here — the applicant's own list does not, because it is
 *  scoped by `user_id` and asks nothing about a gym.
 *
 *  **WHAT IS NOT BUILT YET, said plainly: the per-staff TICKS have no
 *  storage.** `gym_staff` holds gym/user/role and nothing else, so today the
 *  effective set is the ROLE'S DEFAULT and an owner cannot yet widen one
 *  person's. That is the staff-management card (its own `OWED.md` line), and
 *  when it lands it replaces the body of `privilegesFor` with a read of the
 *  stored SNAPSHOT — no caller changes. */
export const ORG_PRIVILEGES = ["members.read", "codes.invite", "members.confirm"] as const;
export type OrgPrivilege = (typeof ORG_PRIVILEGES)[number];

/** Part 3 §2.2's matrix, as the DEFAULT ticks each role starts with.
 *
 *  `members.read` and `codes.invite` reproduce §2.2's own rows exactly — the
 *  matrix grants "Members list + detail" and "Invite (share code / print
 *  poster)" to all three roles, and the studio/clinic trainer hold-back on the
 *  ROSTER is a separate rule applied at its own call site (§2.3's group
 *  scoping, still unbuildable).
 *
 *  `members.confirm` is an ADDITION — §2.2 predates the application door — and
 *  it is aligned with the matrix's "Remove / restore member" row (owner and
 *  manager, not trainer) because confirming and removing are the same power
 *  pointed in opposite directions: both decide who is inside the gym. Kd was
 *  given that cost before approving: a gym whose front desk is a TRAINER
 *  cannot confirm until the tick storage lands, and widening it then is one
 *  tick rather than a redesign (:11429 rule 3 — ticks may widen, not only
 *  narrow). */
const ROLE_PRIVILEGES: Readonly<Record<OrgRole, readonly OrgPrivilege[]>> = {
  owner: ["members.read", "codes.invite", "members.confirm"],
  manager: ["members.read", "codes.invite", "members.confirm"],
  trainer: ["members.read", "codes.invite"],
};

function privilegesFor(role: OrgRole): readonly OrgPrivilege[] {
  return ROLE_PRIVILEGES[role];
}

/** Part 3 §2.2's matrix, enforced server-side (R3.3 — UI hiding is never the
 *  enforcement).
 *
 *  A caller who is not staff of this org gets 404, not 403, and the
 *  distinction is deliberate: 403 confirms the org exists, which lets anyone
 *  with a uuid enumerate gyms. Insufficient PRIVILEGE inside an org they do
 *  belong to is a genuine 403 — they already know it exists. */
async function requirePrivilege(
  deps: OrgsDeps,
  gymId: string,
  userId: string,
  privilege: OrgPrivilege,
): Promise<{ org: repo.OrgRow; role: OrgRole }> {
  const [org, role] = await Promise.all([
    repo.getOrgById(deps.sql, gymId),
    repo.getStaffRole(deps.sql, gymId, userId),
  ]);
  if (org === null || role === null) {
    throw new OrgsError(404, "org_not_found", "Gym not found.");
  }
  if (!privilegesFor(role).includes(privilege)) {
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
  const { org, role } = await requirePrivilege(deps, gymId, userId, "members.read");

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
  await requirePrivilege(deps, gymId, userId, "codes.invite");
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

/** The console's confirm queue — Part 3 §2.4's boundary applies here exactly
 *  as it does to the roster, and the shape is no wider. */
export async function listOrgApplications(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  query: OrgApplicationListQuery,
): Promise<OrgApplicationPage> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");

  // The queue's cursor is the application's OWN id, not the roster's
  // `<instant>|<uuid>` pair — see `repo.listApplications` for why the pair
  // shape repeats a row on every page boundary. Malformed → first page, never
  // a 500 from a hand-edited cursor (the roster's convention, kept).
  const page = await repo.listApplications(deps.sql, {
    gymId,
    limit: query.limit,
    cursor: parseUuidCursor(query.cursor),
  });
  // Parsed on the way out like its siblings: this response is a §2.4 surface,
  // so a field added to the row without being added to the schema is dropped
  // here rather than served to a gym.
  return orgApplicationPageSchema.parse({
    items: page.items.map((a) => ({
      id: a.id,
      userId: a.userId,
      displayName: a.displayName,
      appliedAt: a.appliedAt.toISOString(),
      expiresAt: a.expiresAt.toISOString(),
      groupLabel: a.groupLabel,
    })),
    nextCursor: page.nextCursor,
    pendingCount: page.pendingCount,
  });
}

/** THE TAP THAT MAKES SOMEBODY A MEMBER.
 *
 *  The entitlement cache is busted for the APPLICANT, not the caller — the
 *  person whose plan just changed is the one who was confirmed, and busting
 *  the front-desk staffer's cache instead would leave the new member on the
 *  free plan's limits for up to 60 seconds on the one screen they are most
 *  likely to open next. */
export async function confirmOrgApplication(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  applicationId: string,
): Promise<ConfirmApplicationResponse> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");

  const outcome = await repo.confirmApplication(deps.sql, {
    gymId,
    applicationId,
    actorUserId: userId,
  });

  switch (outcome.kind) {
    case "confirmed": {
      await bustEntitlements(deps.redis, outcome.applicantUserId);
      return confirmApplicationResponseSchema.parse({
        status: "confirmed",
        membership: {
          id: outcome.membership.id,
          joinedAt: outcome.membership.joinedAt.toISOString(),
          groupLabel: outcome.membership.groupLabel,
        },
      });
    }
    case "already_confirmed":
      // A second tap is a person pressing a button twice. Idempotent success,
      // not an error — and no membership is echoed back, because this branch
      // did not create one and reporting a row it did not write is how a
      // screen ends up claiming something it cannot see.
      return confirmApplicationResponseSchema.parse({ status: "already_confirmed" });
    case "not_found":
      // Same reasoning as the roster's 404: an application belonging to
      // another gym must not be distinguishable from one that never existed.
      throw new OrgsError(404, "application_not_found", "That request is no longer waiting.");
    case "not_pending":
      throw new OrgsError(
        409,
        `application_${outcome.status}`,
        outcome.status === "cancelled"
          ? "That person withdrew their request."
          : "That request has already been dealt with.",
      );
    case "org_archived":
      throw new OrgsError(409, "org_archived", "That gym is no longer active.");
    case "seat_cap":
      // The application is deliberately still waiting — the owner adds a seat
      // and taps again. Naming the number here IS right, unlike at the join
      // door: this reader is the gym, and it is their own cap.
      throw new OrgsError(
        409,
        "seat_cap_reached",
        `Your plan covers ${String(outcome.cap)} members and they are all taken. Add a seat, then confirm again — this person is still waiting.`,
      );
    case "rejected":
      // Not reachable from confirm; the union is shared with reject.
      throw new OrgsError(409, "application_rejected", "That request has already been dealt with.");
    default:
      return assertNever(outcome);
  }
}

export async function rejectOrgApplication(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  applicationId: string,
): Promise<RejectApplicationResponse> {
  await requirePrivilege(deps, gymId, userId, "members.confirm");

  const outcome = await repo.rejectApplication(deps.sql, {
    gymId,
    applicationId,
    actorUserId: userId,
  });

  switch (outcome.kind) {
    case "rejected":
      return rejectApplicationResponseSchema.parse({ status: "rejected" });
    case "not_found":
      throw new OrgsError(404, "application_not_found", "That request is no longer waiting.");
    case "not_pending":
      // T3 L-3: a SECOND tap on "not this person" now answers the same as the
      // first, because confirm's own justification applies word for word — it
      // is a person pressing a button twice, and two front-desk staff working
      // one queue is the case this card cites everywhere else. The asymmetry
      // was not designed; confirm got `already_confirmed` and reject was left
      // to 409. Every OTHER terminal state keeps the 409: `confirmed` must not
      // be silently reversible, and `cancelled`/`expired` are facts about the
      // applicant that the front desk should be told rather than shown a
      // success for something they did not do.
      if (outcome.status === "rejected") {
        return rejectApplicationResponseSchema.parse({ status: "rejected" });
      }
      throw new OrgsError(
        409,
        `application_${outcome.status}`,
        "That request has already been dealt with.",
      );
    case "confirmed":
    case "already_confirmed":
    case "org_archived":
    case "seat_cap":
      // Not reachable from reject; the union is shared with confirm.
      throw new OrgsError(409, "application_conflict", "That request has already been dealt with.");
    default:
      return assertNever(outcome);
  }
}

/** A bare uuid — the confirm queue's cursor. Anything else is the first page,
 *  never a 500 from a hand-edited value. */
function parseUuidCursor(cursor: string | undefined): string | null {
  if (cursor === undefined) return null;
  return UUID_RE.test(cursor) ? cursor : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `<joinedAt ISO>|<uuid>`. Malformed → null (first page), never a 500 from a
 *  hand-edited cursor — the workouts reader's convention, kept identical. */
function parseCursor(cursor: string | undefined): { joinedAt: string; id: string } | null {
  if (cursor === undefined) return null;
  const sep = cursor.indexOf("|");
  if (sep === -1) return null;
  const joinedAt = new Date(cursor.slice(0, sep));
  const id = cursor.slice(sep + 1);
  if (Number.isNaN(joinedAt.getTime()) || !UUID_RE.test(id)) return null;
  return { joinedAt: joinedAt.toISOString(), id };
}

function assertNever(x: never): never {
  throw new Error(`unhandled join outcome: ${JSON.stringify(x)}`);
}
