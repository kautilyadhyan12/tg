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
  ORG_PRIVILEGES,
  OWNER_ONLY_PRIVILEGES,
  ROLE_PRIVILEGES,
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
  orgPlansResponseSchema,
  orgStaffMutationResponseSchema,
  orgStaffResponseSchema,
  rejectApplicationResponseSchema,
  removeMemberResponseSchema,
  removeOrgCodeResponseSchema,
  removeOrgStaffResponseSchema,
  rotateOrgCodeResponseSchema,
  startOrgTrialResponseSchema,
  updateOrgResponseSchema,
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
  OrgPlansResponse,
  OrgPrivilege,
  OrgRole,
  OrgStaff,
  OrgStaffMutationResponse,
  OrgStaffResponse,
  OrgSubscription,
  OrgSummary,
  RejectApplicationResponse,
  RemoveMemberResponse,
  RemoveOrgCodeResponse,
  RemoveOrgStaffResponse,
  RotateOrgCodeResponse,
  StartOrgTrialResponse,
  UpdateOrgCodeRequest,
  UpdateOrgRequest,
  UpdateOrgResponse,
  UpdateOrgStaffPrivilegesRequest,
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
    country: org.country,
    orgType: org.orgType,
    timezone: org.timezone,
    locale: org.locale,
    currencyDisplay: org.currencyDisplay,
    status: org.status,
  };
}

/** Kd ruling 2026-08-18: the currency follows the gym's country, is decided
 *  HERE, and is never accepted from the client. An unsupported country is
 *  refused outright — the alternative is a fallback currency, which means a gym
 *  in a country we have no prices for is quoted in somebody else's money.
 *
 *  **One function for both doors.** Create and edit must give the identical
 *  answer and the identical refusal: a country the wizard accepts and the
 *  settings screen rejects (or the reverse) is two definitions of where we
 *  operate, and the one that drifts is whichever is edited less. The sentence is
 *  written once for the same reason. */
/** One spelling of a country in the database, so `country === 'US'` is a
 *  question with one answer. `currencyForCountry` already normalises before it
 *  looks the country up, so without this the row could store `us` while the
 *  currency was derived from `US` — and the column's own CHECK (two capitals)
 *  would then refuse the write with a 500 rather than a sentence. Same shape as
 *  `normaliseCode`, and for the same reason: normalise once, at the boundary. */
function normaliseCountry(country: string): string {
  return country.trim().toUpperCase();
}

function resolveCurrency(country: string): string {
  const currencyDisplay = currencyForCountry(country);
  if (currencyDisplay === null) {
    throw new OrgsError(
      400,
      "country_unsupported",
      "We're not open in that country yet. Right now we support the United States, India, Canada, the UK and countries using the euro.",
    );
  }
  return currencyDisplay;
}

export async function createOrg(
  deps: OrgsDeps,
  ownerUserId: string,
  req: CreateOrgRequest,
): Promise<CreateOrgResponse> {
  const currencyDisplay = resolveCurrency(req.country);

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
        // STORED from 2026-08-26 on. It used to reach this function, become a
        // currency and evaporate, so a gym could be edited into a country it
        // could never be shown — the gap migration `0014` closes.
        country: normaliseCountry(req.country),
        orgType: req.orgType,
        timezone: req.timezone,
        locale: req.locale,
        currencyDisplay,
        code: codeFromBytes(deps.randomBytes(6)),
        codeLabel: FIRST_CODE_LABEL,
        // §4.0 step 1's owner row starts with the owner role's whole set. Same
        // source as an appointment's, so "what does an owner start with" has
        // one answer in one place.
        ownerPrivileges: defaultPrivilegesFor("owner"),
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

/** THE SENTENCE A GYM OWNER READS WHEN THE CURRENCY LOCK REFUSES THEM.
 *
 *  **EXPORTED SO A TEST CAN PIN IT EXACTLY — round-3 Low-2, and the reviewer
 *  proved the previous guard was worth less than its comment claimed.** That
 *  comment said the assertion "bans the CLAIM"; it banned one substring
 *  (`/country is fixed/i`), and he planted *"…can't change because your gym's
 *  country is locked…"* — telling one of the 59 gyms that have NO country that
 *  its country is locked, C/H-2's exact falsehood — **and the suite went
 *  GREEN**.
 *
 *  A lexical ban cannot express "makes no false claim about this gym"; the
 *  honest instrument is a GOLDEN STRING. Asserting equality does not force
 *  vaguer wording the way banning a substring does (:14840's lesson, which is
 *  what the weaker version was reaching for) — it forces a DELIBERATE change:
 *  reword this and the test goes red, and a human has to look at the new
 *  sentence and decide whether it is true of a gym with no country. That is the
 *  only check that actually applies here, and it is stated as such rather than
 *  dressed up as semantic. */
export const CURRENCY_LOCKED_MESSAGE =
  "The currency your gym is billed in can't change while your gym has a subscription, " +
  "and that country uses a different one. Contact us and we'll move it for you.";

/** A GYM CAN FINALLY FIX ITS OWN DETAILS (Kd approved `org.manage` 2026-08-26).
 *
 *  Before this the row was insert-only after `createOrgAttempt`: a typo in the
 *  name was on every screen for ever, and a gym set up in the wrong zone had its
 *  day boundaries wrong for ever, because `gyms.timezone` is the only thing the
 *  rollup worker consults when it decides where that gym's day ends (trap #8).
 *
 *  **The currency is DERIVED and moves only with the country** (R3.1, :10010).
 *  It is not on the request schema at all, so a caller who sends one gets a 400
 *  from `.strict()` rather than a silent strip — an owner who tried to choose
 *  their own money learns that we decide it.
 *
 *  **The country is checked BEFORE the transaction opens**, so an unsupported
 *  one costs no lock and, more importantly, leaves the row exactly as it was:
 *  a refusal that had already written the name would be a half-applied save
 *  nobody asked for.
 *
 *  Not audited as a membership change and no entitlement bust: nothing the §4.1
 *  candidate query reads lives on this row (it joins `gym_members` through the
 *  gym's live subscription), so nobody's entitlements move when a gym is
 *  renamed. Verified rather than assumed, the way `removeOrgStaff` states it. */
export async function updateOrg(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  req: UpdateOrgRequest,
): Promise<UpdateOrgResponse> {
  await requirePrivilege(deps, gymId, userId, "org.manage");

  const patch: repo.OrgPatch = {};
  // `in`, not `!== undefined`: `city: null` is a real instruction ("clear it")
  // and must reach the writer, while an absent `city` must leave it alone. The
  // two are the same value in JS and different intentions on a PATCH.
  if ("name" in req && req.name !== undefined) patch.name = req.name;
  if ("city" in req) patch.city = req.city ?? null;
  if ("timezone" in req && req.timezone !== undefined) patch.timezone = req.timezone;
  if ("country" in req && req.country !== undefined) {
    patch.country = normaliseCountry(req.country);
    patch.currencyDisplay = resolveCurrency(req.country);
  }

  const outcome = await repo.updateOrg(deps.sql, { gymId, patch, actorUserId: userId });

  switch (outcome.kind) {
    // BOTH arms answer 200 with the row, and `unchanged` is not an error: the
    // caller asked for a state and the state holds. Which call produced it is
    // the audit log's business (:12227 L-3), and the audit log is exactly where
    // a no-op is deliberately absent.
    case "updated":
    case "unchanged":
      return updateOrgResponseSchema.parse({ org: toOrgSummary(outcome.org) });
    case "currency_locked":
      // KD RULING 2026-08-26. The sentence names the reason and the way out,
      // because a refusal an owner cannot act on is a dead end — and the way out
      // is a real one: Kd approves every gym by hand at this scale (:11072), and
      // moving a paying customer between price books is what both Stripe and
      // Paddle also make a support action rather than a self-serve toggle.
      //
      // **IT NAMES THE CURRENCY, NOT THE COUNTRY — T3 round 1 C/H-2.** The old
      // wording said "your gym's country is fixed", which is FALSE to any of the
      // 59 pre-`0014` gyms that have no country at all (:5807 — on screen AND
      // wrong). What is actually frozen is the money, and the refusal now only
      // fires when the money would genuinely move.
      //
      // **"WHILE YOUR GYM HAS A SUBSCRIPTION", NOT "ON A PAID PLAN" — T3 round
      // 2 Low-1.** The guard fires on `status <> 'trialing'`, and :19560
      // deliberately includes `canceled` and `expired` ("over-locking is the
      // safe direction") — so two of the states it knowingly covers are NOT a
      // paid plan, and the old sentence told those gyms they were on one. The
      // round that wrote it said its purpose was to make the refusal TRUE and
      // left this half carrying the pre-fix wording.
      throw new OrgsError(409, "currency_locked", CURRENCY_LOCKED_MESSAGE);
    case "not_found":
      // Unreachable in practice — `requirePrivilege` has already read the org
      // and 404'd a stranger — but a gym archived or deleted between that read
      // and this write must not surface as a 500. The module's standing 404.
      throw new OrgsError(404, "org_not_found", "Gym not found.");
    default:
      return assertNever(outcome);
  }
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
    orgs: rows.map((r) => {
      // COMPUTED ONCE PER ROW because two fields below now need it, and calling
      // `privilegesFor` twice would be two chances for them to disagree about
      // what one staff row means.
      const privileges = r.staffRole === null ? [] : [...privilegesFor(r.staffRole, r.privileges)];
      return {
      ...toOrgSummary(r),
      staffRole: r.staffRole,
      // WHAT THIS CALLER MAY DO HERE, so the console can stop deciding on the
      // role NAME (T3 round 1 C/H-1). Run through the SAME `privilegesFor` that
      // `requirePrivilege` uses, so the answer a screen draws and the answer the
      // door enforces come out of one function — a second interpretation of a
      // null row is a second definition of what a trainer may do.
      //
      // A caller who staffs nothing gets `[]`, not the absent field: absent means
      // "this api is too old to say" and the client falls back to the role's
      // defaults, which for a non-staff member would be nonsense.
      privileges,
      // WHAT THE GYM IS ON, AND HOW FULL IT IS — §4.2's banner and §4.3's seat
      // meter, which had no read to come from until this card. Both are STAFF
      // FACTS and this is the one line that decides that.
      //
      // A plain member reads this same response — it is where "You're a member
      // of Iron House" comes from — and when a gym's trial runs out is the
      // gym's business, not its members' (§2.4's boundary applied in the other
      // direction to the roster's). Null rather than absent, so a non-staff
      // caller, a gym on no plan and an api too old to answer all arrive at the
      // client as the same "we know of no plan", which is the only state the
      // console may honestly draw nothing for.
      subscription:
        r.staffRole === null || r.subscription === null
          ? null
          : toOrgSubscription(r.subscription),
      seatsUsed: r.staffRole === null ? null : r.seatsUsed,
      // WHETHER THIS GYM'S OWNER HAS ALREADY SPENT THEIR ONE FREE TRIAL — the
      // fact that decides which face the unskippable prompt shows (:22697).
      //
      // **`billing.manage`, NOT `staffRole !== null` — NARROWED BY T3 ROUND 1's
      // Low-8, and the reasoning is the part to keep.** It first shipped on the
      // same line as `subscription` and `seatsUsed`, which looked consistent and
      // was the wrong comparison: **those are facts about THIS GYM, and this is a
      // fact about a PERSON.** It spans gyms the reader has no relationship with,
      // so a trainer at gym B would learn that their employer had trialled
      // somewhere else entirely. One bit about their own employer — genuinely not
      // a breach, which is why the reviewer graded it Low — but there is no
      // reason to send it, and :22921 §1 rules that the prompt this feeds stops
      // ONLY somebody holding `billing.manage`. Least privilege: the field and
      // the screen that consumes it now have the same gate, which is also the
      // gate on `/plans` beside it.
      //
      // NULL HERE MEANS "WE DID NOT ASK", AND THE PROMPT MUST TREAT IT THAT WAY.
      // For every other field on this response an unknown state costs a screen a
      // sentence; for this one it decides whether a person is sealed out of
      // their own console, so the honest failure is to draw NOTHING rather than
      // to guess an arm. The client requires a definite boolean before it blocks.
      ownerTrialUsed: privileges.includes("billing.manage") ? r.ownerTrialUsed : null,
      isMember: r.isMember,
      joinedAt: r.joinedAt === null ? null : r.joinedAt.toISOString(),
      };
    }),
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
 *  **THE TICKS NOW HAVE STORAGE (2026-08-22), and this comment's own prophecy
 *  is what landed: `privilegesFor` reads the stored set and NO CALLER
 *  CHANGED.** `gym_staff.privileges` holds the EFFECTIVE set as a snapshot
 *  (migration `0013`), an owner edits it through `updateOrgStaffPrivileges`,
 *  and the role's template below is only what a NEW appointment starts from.
 *
 *  **The vocabulary moved to `@app/shared` in the same card** and is re-exported
 *  here so this file still reads as the seam: the staff list serves these
 *  strings and the ticks route accepts them, so it is contract now (R7.2) and a
 *  second copy would be a second vocabulary. */
export { ORG_PRIVILEGES };
export type { OrgPrivilege };

/** Part 3 §2.2's matrix, as the DEFAULT ticks each role starts with — **now in
 *  `@app/shared`, where its own doc comment explains every row.**
 *
 *  It moved there with the Staff SCREEN card (2026-08-23) for the reason the
 *  vocabulary moved with the server one (R7.2): `orgStaffSchema.privileges` is
 *  optional, so a screen meeting a row without it must draw the ROLE's template,
 *  and a table the web derives separately is a second answer to "what may a
 *  trainer do". Re-exported through `./schemas.js` so this file still reads as
 *  the seam. **Nothing about the values or this module's use of them changed.** */

/** WHAT THIS PERSON MAY DO, and the argument order is the whole ruling: the
 *  STORED ticks win, and the role's template is only what somebody starts with.
 *
 *  **`stored === null` is the DEPLOY WINDOW, not the model** (R4.4
 *  expand-then-contract). Migration `0013` filled every row that predates the
 *  column, and every writer since fills it, so the only rows that can be null
 *  are ones written by OLD code between the migration landing and this code
 *  deploying. They read as their role's defaults — exactly what they could do
 *  before — rather than as "no privileges", which would lock a gym's owner out
 *  of their own console for the length of a deploy.
 *
 *  It is deliberately NOT a permanent fallback: `OWED.md` carries the contract
 *  to NOT NULL, and while this branch exists a change to `ROLE_PRIVILEGES` could
 *  reach a null row — which is the silent widening Kd ruled against on
 *  2026-08-22, bounded here to a deploy window rather than left open for ever. */
function privilegesFor(role: OrgRole, stored: readonly string[] | null): readonly OrgPrivilege[] {
  // Canonical, not the template's own order: a null row and a stored row must
  // be indistinguishable to every reader, and a set that arrives in a different
  // order depending on which branch produced it is a difference a screen and an
  // audit row can both see.
  if (stored === null) return defaultPrivilegesFor(role);
  // The DATABASE's own CHECK restricts this column to the vocabulary, but a
  // value read back is external input all the same (R2.3): anything the enum
  // does not recognise is dropped rather than trusted or thrown over.
  return stored.filter((p): p is OrgPrivilege => ORG_PRIVILEGE_SET.has(p));
}

/** A Set rather than `(ORG_PRIVILEGES as readonly string[]).includes(...)` —
 *  T3 Low-2, R2.2: that cast was one of five in `apps/api/src` and sat outside
 *  an adapter file. It runs on every authorisation decision, so O(1) is the
 *  incidental half; the point is that the rule needs no cast to express. */
const ORG_PRIVILEGE_SET: ReadonlySet<string> = new Set(ORG_PRIVILEGES);

/** The ticks a BRAND-NEW appointment starts with, and the ONLY place the role
 *  templates are read for a write. Sorted and de-duplicated so the column, the
 *  audit rows and the screen all show one canonical order. */
export function defaultPrivilegesFor(role: OrgRole): OrgPrivilege[] {
  return canonicalPrivileges(ROLE_PRIVILEGES[role]);
}

/** One order, everywhere: sorted, no repeats. A set stored two different ways
 *  reads as two different sets in an audit log, and "did anything change" is
 *  then a question about ordering rather than about access. */
function canonicalPrivileges(privileges: readonly OrgPrivilege[]): OrgPrivilege[] {
  return [...new Set(privileges)].sort();
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
  const [org, authority] = await Promise.all([
    repo.getOrgById(deps.sql, gymId),
    repo.getStaffAuthority(deps.sql, gymId, userId),
  ]);
  if (org === null || authority === null) {
    throw new OrgsError(404, "org_not_found", "Gym not found.");
  }
  if (!privilegesFor(authority.role, authority.privileges).includes(privilege)) {
    // The message says ROLE because that is what a person understands, and it
    // stays true of a ticked-down manager: what their account is allowed to do
    // here does not cover this.
    throw new OrgsError(403, "forbidden", "Your role doesn't allow that.");
  }
  return { org, role: authority.role };
}

/** START THE GYM'S OWN 30-DAY TRIAL.
 *
 *  **KD RULING 2026-08-27, reversing :11072 ruling 1: a gym starts its own trial,
 *  with no approval step.** *"a gym can start on own without my approval but i
 *  will have the power of removing them or pausing their use if i find them to be
 *  fraud"*. The gate that ruling replaced was aimed at two abuses and the
 *  measurement moved BOTH of them before he decided:
 *
 *  **Friend-pooling is no longer worth doing** and Kd's own 5-vs-20 ruling is
 *  what killed it (:17366 §2). A gym's member gets 5 meal scans a day; a paid
 *  individual gets 20 and everything else is identical (`gymMemberEntitlements`
 *  is `proEntitlements` with ONE key changed). So five people splitting band 1
 *  buy a WORSE product than the individual plan, each.
 *
 *  **Trial-chaining is what survived, and it is closed in the repo rather than
 *  here** — one trial per owner ever, Part 5 §12's own rule. That is the piece
 *  doing the work the approval gate used to do.
 *
 *  **What is NOT closed by any of this, and must not be read as closed: an API
 *  spend ceiling.** v1 §9.3 promises an alert and a soft-degrade past 3× the
 *  gym's fee and calls bankruptcy-by-API-bill "mathematically impossible"; it is
 *  not built (the counter has one writer, the switched-off coach, and no reader).
 *  Kd was shown that measurement when he made this ruling and it has its own
 *  `OWED.md` line with a deadline — before the app is on the internet.
 *
 *  **`billing.manage`, not `role === "owner"`.** :11429's seam says no route
 *  checks a role NAME and warns that a new one doing so re-opens it; :15534's
 *  C/H-1 is what that costs. §2.2's Billing row is owner-only, which is why the
 *  privilege DEFAULTS to the owner alone — but it is a tick, so an owner whose
 *  office manager handles invoices can hand it over. */
export async function startOrgTrial(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
): Promise<StartOrgTrialResponse> {
  await requirePrivilege(deps, gymId, userId, "billing.manage");

  const outcome = await repo.startGymTrial(deps.sql, { gymId, actorUserId: userId });

  switch (outcome.kind) {
    case "started":
      /** THE CALLER'S OWN CACHED ANSWER IS BUSTED; EVERYBODY ELSE'S EXPIRES.
       *
       *  The caller is the person looking at a screen when this returns, and a
       *  stale 60-second answer there would show the gym still on the free tier
       *  immediately after they upgraded it (:5807 on the screen that just acted).
       *
       *  **The caller is USUALLY the owner but need not be** — corrected at T3
       *  round 1 (Low-8), where the earlier version of this note asserted "the
       *  owner is member #1 of their own gym, so they are the one person looking
       *  at a screen". `billing.manage` is a TICK, so an owner can hand it to a
       *  manager, and this module's own test drives exactly that. When a manager
       *  taps the button it is the MANAGER's cached answer that is cleared and the
       *  owner who waits out the TTL. The 60-second guarantee below holds either
       *  way; only the sentence was wrong.
       *
       *  **The other members are covered by the cache's own TTL and that is the
       *  guarantee, not an oversight.** R6.5 asks that every bust trigger flip
       *  within 60s; `getEntitlements` caches for exactly 60s, so it does. A
       *  fan-out deleting one key per member would be a second mechanism for the
       *  same promise, and on a 300-seat trial it is 300 deletes to save at most
       *  a minute for people who are not looking. */
      await bustEntitlements(deps.redis, userId);
      return startOrgTrialResponseSchema.parse({
        outcome: "started",
        subscription: toOrgSubscription(outcome.subscription),
      });
    case "already_subscribed":
      // No bust: nothing changed, so there is nothing stale to clear.
      return startOrgTrialResponseSchema.parse({
        outcome: "already_subscribed",
        subscription: toOrgSubscription(outcome.subscription),
      });
    case "trial_already_used":
      // Names the rule and the ONE fact that makes it feel fair rather than
      // arbitrary — it is per person, not per gym, so "make another gym" is
      // visibly not the answer. No contact channel is named because there is
      // none yet, and :19656's Low-3 is the precedent for not inventing one.
      throw new OrgsError(
        409,
        "trial_already_used",
        "You've already used your free trial. It's one per person, not one per gym.",
      );
    case "no_plan":
      // TRUE AND SPECIFIC, because the alternative is a person concluding the
      // app is broken.
      //
      // **NO NEWLY CREATED GYM CAN REACH THIS, AND A GYM CREATED BEFORE
      // 2026-08-28 STILL CAN — the distinction matters and an earlier version of
      // this comment collapsed it** (T3 round 1, Low-2). Until that day the arm
      // fired for Canada, the UK and the twenty euro-area countries:
      // `COUNTRY_CURRENCY` gave them CAD/GBP/EUR while the seeded book held USD
      // and INR, so a real gym could be created and then refused its own trial.
      // Kd settled it by ruling all three onto US dollars (:22215 §3.5) — the fix
      // was the MAP, never three price books he has never priced.
      //
      // **BUT THE MAP IS CONSULTED AT CREATION, NOT AT READ.**
      // `gyms.currency_display` is written once and recomputed only when the
      // country CHANGES, so a gym that was created in Canada before the ruling
      // still carries CAD and still lands here. Measured: zero such gyms on the
      // shared branch, so nothing real is stranded; the local database has one,
      // created by this card's own smoke before the api was restarted.
      //
      // Retained as the guard it always was — :10010's standing rule that a
      // currency we do not sell in is REFUSED rather than quietly served
      // somebody else's money. It now covers two populations rather than one:
      // any country added to the supported list without prices, and any gym
      // still carrying a currency the book has since stopped listing.
      throw new OrgsError(
        409,
        "no_plan_for_currency",
        "We're not open for business in your country yet, so there's no plan to start.",
      );
    case "org_archived":
      throw new OrgsError(409, "org_archived", "This gym is archived.");
    case "not_found":
      // Unreachable in practice — `requirePrivilege` has already read the org and
      // 404'd a stranger — but a gym archived or deleted between that read and
      // this write must not surface as a 500. The module's standing 404.
      throw new OrgsError(404, "org_not_found", "Gym not found.");
    default:
      return assertNever(outcome);
  }
}

function toOrgSubscription(row: repo.GymSubscriptionRow): OrgSubscription {
  return {
    status: row.status,
    trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
    seatCap: row.seatCap,
  };
}

/** MINOR UNITS → THE SENTENCE A PERSON READS. `3500` and `USD` become `$35`.
 *
 *  **THE SERVER FORMATS MONEY SO THAT NO CLIENT HAS TO** (R10.4). The shared
 *  schema sends this string and deliberately never sends the integer beside it,
 *  so there is nothing on a screen to divide.
 *
 *  **NOT ONE FLOAT IN HERE, AND THAT IS THE POINT RATHER THAN FUSSINESS.** The
 *  obvious version is `format(priceMinor / 100)`, which breaks R6.1's "floats
 *  never touch money" and, worse, hardcodes a divisor that is simply WRONG for
 *  currencies we have said we will reach later — the yen has no minor unit at
 *  all and the dinar has three. So the decimal is built by moving the point with
 *  STRING operations, and how far to move it is asked of Intl rather than
 *  assumed (verified on this Node: USD 2, INR 2, JPY 0, KWD 3).
 *
 *  **THE TRAILING-ZERO BRANCH IS A REAL DEFECT AVOIDED, NOT A FLOURISH.** With a
 *  fixed `maximumFractionDigits: 2` this returns `$1,234.5` for 123450 —
 *  measured, not feared. Whole amounts print with no decimals (`$35`, which is
 *  how Kd's book is written) and anything else prints the currency's full
 *  digits (`$34.99`). Whether the amount is whole is decided by looking at the
 *  digits, so that answer carries no float either.
 *
 *  **THE WHOLE PART GOES THROUGH Intl AS A `bigint`, AND THAT IS THE LINE THAT
 *  KEEPS R6.1.** The natural spelling is `format(priceMinor / 100)` and the
 *  next-most-natural is `format("35.00")` — Intl accepts a decimal STRING at
 *  runtime (verified) but only from ES2023, and this repo's `lib` is ES2022, so
 *  the typed alternatives were a float or an `as` cast. Both are banned here
 *  (R6.1, R2.2) and neither is worth a repo-wide `lib` bump for one call, so the
 *  integer is handed over as a `bigint` — exact, typed since ES2022 — and the
 *  minor digits are appended as text.
 *
 *  **THAT APPEND IS WHY THE LOCALE IS PINNED TO `en-US` AND MUST STAY PINNED.**
 *  In en-US the symbol leads (`$1,234` + `.50`); in a locale where it trails,
 *  appending would produce `1 234 €,50`. The pin is already deliberate — this
 *  product has no i18n and `plans.name_key` has no translation table to resolve
 *  against — and this function is now a second reason it cannot quietly become
 *  the caller's locale.
 *
 *  Measured on this Node across every shape that matters: `$35` · `$129` ·
 *  `$1,234.50` · `$34.99` · `₹1,500` · `₹8,500` · `¥1,234` (no minor unit) ·
 *  `KWD 1,234.567` (three of them). */
function formatPriceMinor(priceMinor: number, currency: string): string {
  const digits = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits;
  if (digits === undefined) {
    // Cannot happen for `style: "currency"`, and it is thrown rather than
    // defaulted to 2 on purpose: a guessed divisor is how the yen prints a
    // hundredth of its real price. R1.3 — fail loudly, never fake it.
    throw new Error(`Intl reported no minor-unit digits for currency ${currency}`);
  }
  const negative = priceMinor < 0;
  const raw = String(Math.abs(priceMinor)).padStart(digits + 1, "0");
  const whole = digits === 0 ? raw : raw.slice(0, raw.length - digits);
  const frac = digits === 0 ? "" : raw.slice(raw.length - digits);
  const isWhole = !/[1-9]/.test(frac);
  const head = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(BigInt(negative ? `-${whole}` : whole));
  return isWhole ? head : `${head}.${frac}`;
}

/** THE GYM'S PRICE LIST — what the unskippable subscribe prompt draws when the
 *  owner's one free trial is spent (Kd ruling 2026-08-28, :22697: *"they will be
 *  showed subscription option that they can take and say that they alreday ahd a
 *  free trial"*).
 *
 *  **`billing.manage`, NOT `role === "owner"`** — :11429's seam, the same
 *  privilege `startOrgTrial` above asks for, and for the same reason: only
 *  whoever may put the gym on a plan is shown what a plan costs. It also matches
 *  Kd's ruling of today that the prompt stops only the person who can pay, so a
 *  trainer never meets a price list they cannot act on.
 *
 *  **THE CURRENCY IS THE GYM'S, READ FROM THE GYM, AND IS NEVER A PARAMETER.**
 *  R3.1: a client-sent currency is at best a display hint and at worst a gym
 *  quoted in the wrong money. `requirePrivilege` has already fetched the org, so
 *  this costs no second read.
 *
 *  **NO RATE LIMIT OF ITS OWN, unlike the trial door beside it.** That one is
 *  limited because every call takes `lockOrgRow` and writes; this is a read of
 *  five seeded rows behind authentication and a privilege check, under the
 *  global floor. Recorded because the neighbour having one invites the question. */
export async function listOrgPlans(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
): Promise<OrgPlansResponse> {
  const { org } = await requirePrivilege(deps, gymId, userId, "billing.manage");
  const rows = await repo.listOrgPlansForCurrency(deps.sql, org.currencyDisplay);
  return orgPlansResponseSchema.parse({
    plans: rows.map((p) => ({
      code: p.code,
      priceLabel: formatPriceMinor(p.priceMinor, p.currency),
      currency: p.currency,
      interval: p.interval,
      seatCap: p.seatCap,
    })),
  });
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
    // THE EFFECTIVE SET, run through the same function `requirePrivilege` asks,
    // so the screen cannot draw a tick the server would refuse or hide one it
    // honours (:11429 rule 4 — the UI hides, the SERVER enforces, and the two
    // disagreeing is the defect that rule names in advance).
    privileges: [...privilegesFor(row.role, row.privileges)],
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
    // The role picks the STARTING ticks and the row carries them from its first
    // moment (:11429). The policy is computed here and the repo only stores it,
    // so there is one place that knows what a trainer starts with.
    privileges: defaultPrivilegesFor(input.role),
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
    // CHANGING THE ROLE RESETS THE TICKS to the new role's defaults, and this is
    // the load-bearing half of the decision rather than a convenience: without
    // it, demoting a manager to trainer would leave every manager tick standing,
    // so the one control an owner reaches for to REDUCE somebody's access would
    // reduce nothing. A demotion has to actually demote.
    //
    // THE COST IS BIGGER THAN "EDITS ARE LOST" AND T3 Low-6 CORRECTED IT: the
    // ticks BECOME the new role's template, which for a hand-NARROWED person can
    // be MORE than they had — ticked down to nothing and then set to trainer,
    // they get `members.read` and `codes.invite` back. Not a silent widening
    // (an owner tapped it), but the Staff screen's warning must say **"their
    // permissions become the defaults for the new role"** and NOT "your changes
    // will be lost", which describes only the narrowing half.
    privileges: defaultPrivilegesFor(input.role),
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

/** THE TICKS THE LAST OWNER CANNOT BE STRIPPED OF (:11429 rule 2).
 *
 *  §4.7 blocks removing the last owner; **ticking away the same rights reaches
 *  the identical lockout by another door**, and the spec's rule does not cover
 *  it because per-staff ticks did not exist when it was written. Without this a
 *  gym locks itself out of its own console with one tap and only we can let it
 *  back in.
 *
 *  **It is a LIST rather than one name because :11429 names TWO — staff
 *  management and BILLING — and billing has no tick yet**, there being no
 *  billing surface in the product. The day one is added to `ORG_PRIVILEGES` it
 *  belongs here in the same commit; `OWED.md` carries that line so it is not
 *  remembered by luck. */
/** **`billing.manage` JOINS `staff.manage` HERE AND THAT CLOSES AN `OWED.md`
 *  LINE.** :11429 rule 2 has always named TWO lockout doors — *"ticking away the
 *  last owner's billing/staff-management is the same lockout by another door"* —
 *  and this guard has only ever covered one of them, because billing had no tick
 *  to cover. The trial card gives it one.
 *
 *  **THE ASYMMETRY-WITH-`org.manage` ARGUMENT THAT USED TO SIT HERE WAS
 *  SELF-REFUTING, and T3 round 2 (Low-2) is what caught it.** It read: an owner
 *  ticked down from `org.manage` still holds `staff.manage` and can tick it
 *  straight back, whereas *"a gym whose last owner cannot reach billing cannot
 *  PAY, and no control inside the gym repairs that"*. **The second half is false
 *  by the first half's own reasoning.** `billing.manage` is NOT in
 *  `OWNER_ONLY_PRIVILEGES` (that list is `["staff.manage"]` alone) and
 *  `updateOrgStaffPrivileges` does not exclude self-targeting — so a last owner
 *  ticked out of billing still holds `staff.manage`, **which this very guard
 *  guarantees they keep**, and can tick billing back onto their own row. It is
 *  recoverable, exactly like `org.manage`.
 *
 *  **The guard stays, on the reason that actually holds: over-locking is the safe
 *  direction, and :11429 rule 2 names BOTH doors, so both doors should ask the
 *  same question.** Refusing costs an owner one save they can make differently;
 *  allowing it costs a window in which the gym cannot pay until somebody notices
 *  and repairs it by hand. **This is defence in depth, not the only thing between
 *  the gym and an unpayable invoice** — which is what the old sentence claimed,
 *  and which nothing in the code supported. */
const LAST_OWNER_REQUIRED_PRIVILEGES: readonly OrgPrivilege[] = ["staff.manage", "billing.manage"];

/** PRIVILEGES ONLY AN OWNER'S ROW MAY CARRY — §2.2's owner-alone rows, and the
 *  enforcement of :11429 rule 1 ("only an OWNER may change anybody's ticks; this
 *  ruling does not widen it"). **The list itself is now in `@app/shared`** and
 *  moved there with the Staff screen (2026-08-23), because a screen that does
 *  not know it draws a box whose every save is refused; the ENFORCEMENT did not
 *  move and is still `setStaffPrivileges`'s 409.
 *
 *  **T3 C/H-1: without this the ticks route was owner-only by ACCIDENT.** Its
 *  gate is the `staff.manage` tick, which was the owner's alone only because
 *  nothing could grant it — and granting ticks is exactly what that card built.
 *  One owner action then handed a manager the power to change anybody's
 *  privileges, the owner's included; the reviewer ran the chain and the owner
 *  ended up 403'd on their own roster.
 *
 *  **The consequence is real and is Kd's ruling rather than a limitation to
 *  work around: staff management cannot be delegated at all.** An owner cannot
 *  make somebody else able to hire, fire or change permissions. Widening that
 *  is a Kd decision with its own card, and it is the reversible direction —
 *  refusing today costs a feature nobody has asked for, while allowing it costs
 *  an escalation nobody can see. */

/** CHANGE WHAT ONE PERSON MAY DO. Owner-only — `staff.manage` is §2.2's
 *  owner-alone row and :11429 rule 1 says this ruling does not widen it.
 *
 *  The WHOLE set arrives, never a diff (see the request schema), and the last
 *  writer wins on a set a human looked at. */
export async function updateOrgStaffPrivileges(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  targetUserId: string,
  input: UpdateOrgStaffPrivilegesRequest,
): Promise<OrgStaffMutationResponse> {
  await requirePrivilege(deps, gymId, userId, "staff.manage");

  const outcome = await repo.setStaffPrivileges(deps.sql, {
    gymId,
    userId: targetUserId,
    privileges: canonicalPrivileges(input.privileges),
    lastOwnerRequires: LAST_OWNER_REQUIRED_PRIVILEGES,
    ownerOnly: OWNER_ONLY_PRIVILEGES,
    actorUserId: userId,
  });

  switch (outcome.kind) {
    // Both carry the row, for `updateOrgStaffRole`'s reason: the caller asked
    // for a state and the state holds. Which call produced it is the audit
    // log's business (:12227 L-3).
    case "updated":
    case "unchanged":
      return orgStaffMutationResponseSchema.parse({ staff: toOrgStaff(outcome.staff, userId) });
    case "not_staff":
      throw new OrgsError(404, "not_staff", "That person doesn't run this gym.");
    case "owner_only_privilege":
      throw new OrgsError(
        409,
        "owner_only_privilege",
        "Managing staff stays with the gym's owner. You can give this person any of the other permissions.",
      );
    case "last_owner_locked":
      // NAMES BOTH ABILITIES, because the guard covers both and this message
      // named one (T3 round 1, Low-3). `LAST_OWNER_REQUIRED_PRIVILEGES` is
      // staff.manage AND billing.manage, and this module's own test drives the
      // billing case — where the old wording told an owner they were being
      // refused over staff management they had in fact kept.
      //
      // NO CAUSAL CLAUSE (T3 round 2, Low-2). Round 1's replacement ended
      // "...otherwise nobody could hand those out again, and nobody could pay",
      // and the second half was FALSE: `billing.manage` is not in
      // OWNER_ONLY_PRIVILEGES and this route does not exclude self-targeting, so
      // a last owner keeping `staff.manage` — which this same guard guarantees
      // they keep — could tick billing straight back onto their own row. A
      // refusal states the rule; it does not need to argue for it, and an
      // argument is the part that goes stale.
      throw new OrgsError(
        409,
        "last_owner_locked",
        "A gym's last owner has to keep both staff management and billing, so somebody in the gym can always hand out the keys and pay.",
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
    // The same list the ticks door uses: "can somebody else still run this gym"
    // is one question, and answering it differently at the two doors is what
    // T3 round 2 found (Low-1).
    lastOwnerRequires: LAST_OWNER_REQUIRED_PRIVILEGES,
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
