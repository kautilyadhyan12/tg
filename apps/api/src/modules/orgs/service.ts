// Orgs service — the org lifecycle this slice covers: create one, join one by
// code, list mine, read the roster. Authorization decisions live here (R3.3
// step 3); the repo enforces tenancy in every WHERE and the routes stay thin.
import type { Sql } from "postgres";
import { JOIN_CODE_LENGTH, currencyForCountry } from "@app/shared";
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
  nudgeApplicationResponseSchema,
  orgApplicationPageSchema,
  orgCodeMutationResponseSchema,
  orgCodesResponseSchema,
  orgMemberPageSchema,
  orgStaffMutationResponseSchema,
  orgStaffResponseSchema,
  rejectApplicationResponseSchema,
  removeMemberResponseSchema,
  removeOrgCodeResponseSchema,
  removeOrgStaffResponseSchema,
  rotateOrgCodeResponseSchema,
} from "./schemas.js";
import type {
  AddOrgStaffRequest,
  ConfirmApplicationResponse,
  CreateOrgCodeRequest,
  CreateOrgRequest,
  CreateOrgResponse,
  JoinOrgRequest,
  JoinOrgResponse,
  MyOrgApplicationsResponse,
  MyOrgsResponse,
  NudgeApplicationResponse,
  OrgApplication,
  OrgApplicationListQuery,
  OrgApplicationPage,
  OrgCode,
  OrgCodeMutationResponse,
  OrgCodesResponse,
  OrgMemberListQuery,
  OrgMemberPage,
  OrgRole,
  OrgStaff,
  OrgStaffMutationResponse,
  OrgStaffResponse,
  OrgSummary,
  RejectApplicationResponse,
  RemoveMemberResponse,
  RemoveOrgCodeResponse,
  RemoveOrgStaffResponse,
  RotateOrgCodeResponse,
  UpdateOrgCodeRequest,
  UpdateOrgStaffRequest,
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
  // Two reads, one response, ONE SNAPSHOT — T3 round 2 L2-4. They answer
  // different questions (what I belong to now; what recently ended) and neither
  // can be derived from the other, which is why the dashboard was silent about
  // a removal before Kd ruled on it. Run as two independent statements they
  // could straddle a commit: a removal landing between them produces a response
  // where the gym is in NEITHER list — the exact silence the ruling exists to
  // end — or in BOTH, drawn as "You're a member" over a membership that has
  // just ended. One transaction makes the pair consistent by construction
  // rather than self-healing on the next reload.
  //
  // Sequential inside the transaction on purpose: one connection cannot run two
  // statements at once, so `Promise.all` here would only queue them.
  const { rows, former } = await deps.sql.begin(async (tx) => ({
    rows: await repo.listOrgsForUser(tx, userId),
    former: await repo.listFormerOrgsForUser(tx, userId),
  }));
  return myOrgsResponseSchema.parse({
    orgs: rows.map((r) => ({
      ...toOrgSummary(r),
      staffRole: r.staffRole,
      isMember: r.isMember,
      joinedAt: r.joinedAt === null ? null : r.joinedAt.toISOString(),
    })),
    formerOrgs: former.map((f) => ({
      ...toOrgSummary(f.org),
      removedAt: f.removedAt.toISOString(),
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
    nudgedAt: app.nudgedAt === null ? null : app.nudgedAt.toISOString(),
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

/** "REMIND THEM" — :11385's third mechanic, the only one the waiting person
 *  sets off themselves, and the one that stops the door being a place you shout
 *  into.
 *
 *  **No org authorization, for the same reason `listMyApplications` has none:**
 *  this is the caller's own row, scoped by `user_id` in the repo's WHERE. It
 *  asks nothing about a gym, so it does not go through `requirePrivilege` —
 *  the applicant is not staff of the gym they are trying to get into.
 *
 *  **No entitlement bust either.** Reminding a gym grants nobody anything;
 *  that is the point of the whole waiting room (:11072). */
export async function nudgeMyApplication(
  deps: OrgsDeps,
  userId: string,
  applicationId: string,
): Promise<NudgeApplicationResponse> {
  const outcome = await repo.nudgeApplication(deps.sql, { applicationId, userId });

  switch (outcome.kind) {
    case "sent":
    case "too_soon":
      // ONE SHAPE FOR BOTH, and the arm name is the only difference. The
      // screen's sentence — "we've let them know, you can do this again
      // tomorrow" — is true either way, and giving the client the times means
      // it never computes a date of its own (:1110's habit: the server sends,
      // the client renders).
      return nudgeApplicationResponseSchema.parse({
        status: outcome.kind === "sent" ? "sent" : "already_sent",
        nudgedAt: outcome.nudgedAt.toISOString(),
        nextNudgeAt: outcome.nextNudgeAt.toISOString(),
      });
    case "not_found":
      // The module's standing 404: somebody else's application must not be
      // distinguishable from one that never existed.
      throw new OrgsError(404, "application_not_found", "That request is no longer waiting.");
    case "not_pending":
      throw new OrgsError(
        409,
        `application_${outcome.status}`,
        outcome.status === "confirmed"
          ? "You're already a member of this gym."
          : "That request has already been dealt with. You can ask again whenever you like.",
      );
    default:
      return assertNever(outcome);
  }
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
export const ORG_PRIVILEGES = [
  "members.read",
  "codes.invite",
  "codes.manage",
  "members.confirm",
  "members.remove",
  "staff.manage",
] as const;
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
 *  narrow).
 *
 *  `members.remove` is §2.2's "Remove / restore member" row LITERALLY — owner
 *  and manager, never trainer (the matrix hides Remove from a trainer by name,
 *  §4.3). It sits beside `members.confirm` because they are the same power in
 *  two directions, and Kd's ruling of 2026-08-19 is that the second direction
 *  has to exist at all: confirming somebody was a one-way door until it did.
 *
 *  `codes.manage` is §2.2's "Create / rotate / expire codes" row LITERALLY —
 *  owner and manager, never trainer — and it is DELIBERATELY NOT the same tick
 *  as `codes.invite`, which the same matrix grants to all three. The two rows
 *  are one line apart in §2.2 and mean opposite things: a trainer handing a
 *  member the poster is inviting; a trainer switching the gym's door off is not
 *  something the matrix ever granted. Merging them would silently widen a
 *  trainer's power under cover of a read they already had.
 *
 *  `staff.manage` is §2.2's "Staff management" row LITERALLY — the ONE row in
 *  that matrix granted to the owner and to nobody else, and the line every
 *  product in this market draws in the same place (:11429's industry check:
 *  money and staff belong to the owner alone). **It gates the READ as well as
 *  the writes, which is narrower than §2.2 strictly requires** — the matrix has
 *  no "view staff" row at all, so the choice was between owner-only and
 *  inventing a grant. Narrow is the reversible direction: widening it later is
 *  one tick under :11429 rule 3, whereas a manager who has been reading the
 *  staff list for a month cannot be un-shown it. */
const ROLE_PRIVILEGES: Readonly<Record<OrgRole, readonly OrgPrivilege[]>> = {
  owner: [
    "members.read",
    "codes.invite",
    "codes.manage",
    "members.confirm",
    "members.remove",
    "staff.manage",
  ],
  manager: ["members.read", "codes.invite", "codes.manage", "members.confirm", "members.remove"],
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
      takesSeat: m.takesSeat,
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
  return orgCodesResponseSchema.parse({ codes: rows.map(toOrgCode) });
}

function toOrgCode(row: repo.CodeRow): OrgCode {
  return {
    code: row.code,
    label: row.label,
    paused: row.paused,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    maxUses: row.maxUses,
    joined: row.joined,
  };
}

/** An expiry in the PAST is refused rather than stored.
 *
 *  Storing it would "work" — the join path compares `expires_at` to now and
 *  would refuse everybody — but the owner who mistyped a year would be handed a
 *  code that has never once been usable, under a screen that just told them it
 *  was created. Pause is the control that means OFF NOW, and it is one tap away.
 *
 *  Compared against the SERVER's clock, deliberately: the client's is a value a
 *  caller controls, and an expiry is what decides whether a stranger with a
 *  leaked code still gets in. */
function assertFutureExpiry(expiresAt: string | null): Date | null {
  if (expiresAt === null) return null;
  const at = new Date(expiresAt);
  if (at.getTime() <= Date.now()) {
    throw new OrgsError(
      400,
      "expiry_in_past",
      "That end date has already passed. Pick a later one, or pause the code to switch it off now.",
    );
  }
  return at;
}

/** Mint a code the database will accept, retrying a collision.
 *
 *  Codes are globally unique (`gym_codes_code_unique`, `0001_init`), so a clash
 *  with ANY gym's code is possible — vanishingly rare across 32^6 ≈ 1.07 billion
 *  values, and handled rather than trusted. `createOrgAttempt`'s own retry is
 *  the precedent; five attempts turns a genuinely broken constraint into a 503
 *  instead of a spin. */
async function mintCode<T>(deps: OrgsDeps, attempt: (code: string) => Promise<T>): Promise<T> {
  for (let i = 0; i < CREATE_ATTEMPTS; i++) {
    try {
      return await attempt(codeFromBytes(deps.randomBytes(JOIN_CODE_LENGTH)));
    } catch (err) {
      // The SAME typed error `createOrg` retries on, thrown by the same repo for
      // the same constraint. Anything else is a real failure and travels on
      // untouched — a bare `catch { continue }` here would swallow a broken
      // database into a 503 five attempts later.
      if (err instanceof repo.OrgNameTakenError) continue;
      throw err;
    }
  }
  throw new OrgsError(
    503,
    "code_create_unavailable",
    "Could not make a new code just now. Please try again.",
  );
}

/** WHO MAY CHANGE A CODE — and it is NOT who may share one.
 *
 *  §2.2 has two separate rows and this card keeps them separate: "Invite (share
 *  code / print poster)" is granted to owner, manager AND trainer, which is what
 *  `codes.invite` guards on the READ. "Create / rotate / expire codes" is owner
 *  and manager only — a trainer may hand somebody the poster and may not switch
 *  the gym's door off.
 *
 *  Added to `ORG_PRIVILEGES` rather than checked as a role name, per :11429: no
 *  route in this module asks "is this person a manager", so the staff card can
 *  later widen this to one trainer with a tick instead of a migration of
 *  call sites. */
export async function createOrgCode(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  req: CreateOrgCodeRequest,
): Promise<OrgCodeMutationResponse> {
  await requirePrivilege(deps, gymId, userId, "codes.manage");
  const expiresAt = assertFutureExpiry(req.expiresAt);

  const outcome = await mintCode(deps, (code) =>
    repo.createCode(deps.sql, {
      gymId,
      code,
      // KD RULING 2026-08-21: no name box. The COLUMN keeps its default rather
      // than being dropped (no-removal: narrowed at the door), so every code
      // this route mints is labelled like the gym's first one and nothing reads
      // the label as meaningful until Kd asks for names back.
      label: FIRST_CODE_LABEL,
      expiresAt,
      maxUses: req.maxUses,
      actorUserId: userId,
    }),
  );

  switch (outcome.kind) {
    case "created":
      return orgCodeMutationResponseSchema.parse({ code: toOrgCode(outcome.code) });
    case "too_many":
      throw new OrgsError(
        409,
        "too_many_codes",
        `This gym already has ${String(outcome.cap)} codes, which is the most it can hold. Remove one from the list before making another.`,
      );
    default:
      return assertNever(outcome);
  }
}

export async function updateOrgCode(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  code: string,
  req: UpdateOrgCodeRequest,
): Promise<OrgCodeMutationResponse> {
  await requirePrivilege(deps, gymId, userId, "codes.manage");

  // Only an expiry the caller actually SENT is checked. `expiresAt: null`
  // ("never expires") is a legitimate change and must not be run past the
  // future test, and an absent key must not be either — a PATCH that validates
  // a field it was not given is a PATCH that refuses a pause because of a date
  // somebody set last year.
  const patch: repo.CodePatch = {};
  if (req.paused !== undefined) patch.paused = req.paused;
  if (req.expiresAt !== undefined) patch.expiresAt = assertFutureExpiry(req.expiresAt);
  if (req.maxUses !== undefined) patch.maxUses = req.maxUses;

  const outcome = await repo.updateCode(deps.sql, {
    gymId,
    // Normalised for the same reason the join door normalises: an owner
    // pasting "k7qm-2x" out of a message must reach the row stored as "K7QM2X".
    code: normaliseCode(code),
    patch,
    actorUserId: userId,
  });

  switch (outcome.kind) {
    case "updated":
      return orgCodeMutationResponseSchema.parse({ code: toOrgCode(outcome.code) });
    case "not_found":
      // The module's standing 404: another gym's code must not be
      // distinguishable from one that never existed. Codes are globally unique,
      // so a 403 here would confirm a stranger's code exists.
      throw new OrgsError(404, "code_not_found", "That code isn't one of this gym's.");
    case "max_uses_below_uses":
      throw new OrgsError(
        409,
        "max_uses_below_uses",
        `${String(outcome.joined)} ${outcome.joined === 1 ? "person is" : "people are"} in through this code, so the limit can't be lower than that. Pause the code to stop new people joining.`,
      );
    default:
      return assertNever(outcome);
  }
}

/** ROTATE — new code on, old code off, in ONE transaction (Part 3 §7). */
export async function rotateOrgCode(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  code: string,
): Promise<RotateOrgCodeResponse> {
  await requirePrivilege(deps, gymId, userId, "codes.manage");

  const outcome = await mintCode(deps, (newCode) =>
    repo.rotateCode(deps.sql, {
      gymId,
      code: normaliseCode(code),
      newCode,
      actorUserId: userId,
    }),
  );

  switch (outcome.kind) {
    case "rotated":
      return rotateOrgCodeResponseSchema.parse({
        code: toOrgCode(outcome.code),
        replaced: toOrgCode(outcome.replaced),
      });
    case "not_found":
      throw new OrgsError(404, "code_not_found", "That code isn't one of this gym's.");
    case "too_many":
      throw new OrgsError(
        409,
        "too_many_codes",
        `This gym already has ${String(outcome.cap)} codes, which is the most it can hold. Remove one from the list before replacing this one.`,
      );
    default:
      return assertNever(outcome);
  }
}

/** TIDY A FINISHED CODE OFF THE LIST — Kd, 2026-08-21.
 *
 *  `codes.manage`, the same tick as create/pause/replace: §2.2's row is "Create /
 *  rotate / expire codes" and taking a dead one off the screen is the last step
 *  of expiring one, not a new power. A trainer reads the list and cannot touch it.
 *
 *  The REFUSAL an owner can actually hit is a code that still works. It is a 409
 *  with a sentence naming the fix, rather than the screen hiding the button:
 *  hiding is never the enforcement (R3.3), and a stale list is exactly how a
 *  console offers a control the server will refuse. */
export async function removeOrgCode(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  code: string,
): Promise<RemoveOrgCodeResponse> {
  await requirePrivilege(deps, gymId, userId, "codes.manage");

  const outcome = await repo.removeCode(deps.sql, {
    gymId,
    code: normaliseCode(code),
    actorUserId: userId,
  });

  switch (outcome.kind) {
    case "removed":
      return removeOrgCodeResponseSchema.parse({ status: "removed" });
    case "not_found":
      throw new OrgsError(404, "code_not_found", "That code isn't one of this gym's.");
    case "still_usable":
      throw new OrgsError(
        409,
        "code_still_usable",
        "This code still works, so it can't be taken off the list. Switch it off first — then remove it.",
      );
    default:
      return assertNever(outcome);
  }
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
      gymNotifiedAt: a.gymNotifiedAt === null ? null : a.gymNotifiedAt.toISOString(),
      nudgedAt: a.nudgedAt === null ? null : a.nudgedAt.toISOString(),
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

/** REMOVING A MEMBER — Part 3 §4.3, and the reason Confirm is no longer a
 *  one-way door (Kd ruling 2026-08-19).
 *
 *  **THE ENTITLEMENT BUST IS THE PART THAT MATTERS and it is Kd's own rule:**
 *  *"if a gym removes a user that user losses the parks and need to take
 *  personal subscriptions"*. The §4.1 resolver already counts a membership only
 *  while `removed_at` is null, so the DATABASE says free the instant the row
 *  closes — but the resolved answer is CACHED, and without this bust the person
 *  would keep the gym's paid limits for the rest of the cache's life (R6.5
 *  gives that flip 60 seconds; here it is immediate). Their own consumer
 *  subscription, if they have one, is a separate candidate and is untouched.
 *
 *  It is busted on `already_removed` too, deliberately: a second tap costs one
 *  Redis delete and closes the case where the first tap's bust was the thing
 *  that failed. */
export async function removeOrgMember(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  targetUserId: string,
): Promise<RemoveMemberResponse> {
  await requirePrivilege(deps, gymId, userId, "members.remove");

  const outcome = await repo.removeMember(deps.sql, {
    gymId,
    userId: targetUserId,
    actorUserId: userId,
  });

  switch (outcome.kind) {
    case "removed":
    case "already_removed":
      await bustEntitlements(deps.redis, targetUserId);
      return removeMemberResponseSchema.parse({ status: "removed" });
    case "never_member":
      // Same 404 reasoning as everywhere else in this module: a person who was
      // never in THIS gym is indistinguishable from a user id that does not
      // exist, so holding a uuid tells the caller nothing.
      throw new OrgsError(404, "member_not_found", "That person isn't a member of this gym.");
    case "is_staff":
      throw new OrgsError(
        409,
        "member_is_staff",
        `${outcome.role === "owner" ? "The owner" : "A staff member"} can't be removed from the member list. Staff membership is managed with staff.`,
      );
    default:
      return assertNever(outcome);
  }
}

// ---------------------------------------------------------------------------
// STAFF — Part 3 §4.7, approved by Kd 2026-08-21. Before this card a gym had
// exactly ONE person who could do anything: the account that created it. The
// join door was built around "the front desk confirms" and no gym could have a
// front desk.
// ---------------------------------------------------------------------------

/** `isYou` is computed HERE against the caller, never inferred by the screen
 *  (:10726's Low-3 — the last thing this console derived instead of comparing
 *  was true only by coincidence). */
function toOrgStaff(row: repo.StaffRow, viewerUserId: string): OrgStaff {
  return {
    userId: row.userId,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    since: row.since.toISOString(),
    isYou: row.userId === viewerUserId,
  };
}

export async function listOrgStaff(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
): Promise<OrgStaffResponse> {
  await requirePrivilege(deps, gymId, userId, "staff.manage");
  const rows = await repo.listStaff(deps.sql, gymId);
  // Parsed on the way out like every other list in this module: this response
  // carries an email, so a field that reached the row without reaching the
  // schema is dropped here rather than served.
  return orgStaffResponseSchema.parse({ staff: rows.map((r) => toOrgStaff(r, userId)) });
}

/** APPOINT SOMEBODY. See `addOrgStaffRequestSchema` for why the email must
 *  belong to a member of this gym; the short version is that inviting a
 *  stranger needs an email nothing in this product can send, and a global
 *  lookup would be an account-existence oracle. */
export async function addOrgStaff(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  input: AddOrgStaffRequest,
): Promise<OrgStaffMutationResponse> {
  await requirePrivilege(deps, gymId, userId, "staff.manage");

  const outcome = await repo.addStaff(deps.sql, {
    gymId,
    email: input.email,
    role: input.role,
    actorUserId: userId,
  });

  switch (outcome.kind) {
    case "added":
      return orgStaffMutationResponseSchema.parse({ staff: toOrgStaff(outcome.staff, userId) });
    case "not_a_member":
      // 404 and NOT "no account with that email", which would be the oracle the
      // gym-scoped lookup exists to avoid. The message names the fix, because
      // the owner's next question is always the same one.
      throw new OrgsError(
        404,
        "not_a_member",
        "Nobody in this gym has that email address. They need to join the gym first — send them your join code.",
      );
    case "already_staff":
      throw new OrgsError(
        409,
        "already_staff",
        outcome.staff.role === "owner"
          ? "That person owns this gym."
          : `${outcome.staff.displayName} is already ${outcome.staff.role === "manager" ? "a manager" : "a trainer"} here. Change their role instead of adding them again.`,
      );
    default:
      return assertNever(outcome);
  }
}

export async function updateOrgStaffRole(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  targetUserId: string,
  input: UpdateOrgStaffRequest,
): Promise<OrgStaffMutationResponse> {
  await requirePrivilege(deps, gymId, userId, "staff.manage");

  const outcome = await repo.updateStaffRole(deps.sql, {
    gymId,
    userId: targetUserId,
    role: input.role,
    actorUserId: userId,
  });

  switch (outcome.kind) {
    // Both are a 200 carrying the row. The caller asked for a state and the
    // state holds; which of the two calls produced it is the audit log's
    // business, not the screen's (:12227 L-3's asymmetry, avoided rather than
    // repeated).
    case "updated":
    case "unchanged":
      return orgStaffMutationResponseSchema.parse({ staff: toOrgStaff(outcome.staff, userId) });
    case "not_staff":
      throw new OrgsError(404, "not_staff", "That person doesn't run this gym.");
    case "is_owner":
      throw new OrgsError(
        409,
        "owner_role_locked",
        "The gym's owner keeps the owner role. Handing a gym over to somebody else isn't something the app can do yet.",
      );
    default:
      return assertNever(outcome);
  }
}

/** TAKE THE KEYS BACK. They stay a MEMBER — Kd was given that distinction
 *  before approving the card, and it is the honest one: this ends what somebody
 *  can DO in the console, `removeOrgMember` ends whether they are in the gym at
 *  all, and only the second costs them the gym's perks.
 *
 *  **No entitlement bust, and that is verified rather than assumed:** the §4.1
 *  candidate query joins `gym_members` on `removed_at IS NULL` and never reads
 *  `complimentary` or `gym_staff`, so nothing this route changes can alter what
 *  the person is entitled to. `removeOrgMember` is where the bust belongs and it
 *  is already there. */
export async function removeOrgStaff(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  targetUserId: string,
): Promise<RemoveOrgStaffResponse> {
  await requirePrivilege(deps, gymId, userId, "staff.manage");

  const outcome = await repo.removeStaff(deps.sql, {
    gymId,
    userId: targetUserId,
    actorUserId: userId,
  });

  switch (outcome.kind) {
    case "removed":
      return removeOrgStaffResponseSchema.parse({ status: "removed" });
    case "not_staff":
      throw new OrgsError(404, "not_staff", "That person doesn't run this gym.");
    case "last_owner":
      throw new OrgsError(
        409,
        "last_owner",
        "A gym can't be left with nobody in charge, so its last owner can't be removed.",
      );
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
