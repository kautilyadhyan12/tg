// Orgs service — the org lifecycle this slice covers: create one, join one by
// code, list mine, read the roster. Authorization decisions live here (R3.3
// step 3); the repo enforces tenancy in every WHERE and the routes stay thin.
import type { Sql } from "postgres";
import {
  GYM_POSTAL_ADDRESS_MAX_CHARS,
  JOIN_CODE_LENGTH,
  ORG_TYPES_PHRASE,
  currencyForCountry,
  normaliseJoinCode,
  orgWords,
} from "@app/shared";
import { bustEntitlements } from "../entitlements/service.js";
import { onAttendanceMarked } from "../gamification/service.js";
import { getUserSyncContext } from "../users/service.js";
import type { RedisLike } from "../../redis.js";
import { codeFromBytes, slugCandidate, slugifyName } from "./codes.js";
import { cleanGymText } from "./invites/gymText.js";
import * as repo from "./repo.js";
import {
  ORG_PRIVILEGES,
  OWNER_ONLY_PRIVILEGES,
  ROLE_PRIVILEGES,
  closeGymDayResponseSchema,
  gymAttendanceDayResponseSchema,
  gymAttendanceHistoryResponseSchema,
  markGymAttendanceResponseSchema,
  confirmApplicationResponseSchema,
  createOrgResponseSchema,
  gymHoursResponseSchema,
  removeGymClosureResponseSchema,
  setGymHoursResponseSchema,
  joinOrgResponseSchema,
  myOrgApplicationsResponseSchema,
  myOrgsResponseSchema,
  nudgeApplicationResponseSchema,
  orgApplicationPageSchema,
  orgCodeMutationResponseSchema,
  orgCodesResponseSchema,
  orgMemberPageSchema,
  orgOverviewResponseSchema,
  orgPlansResponseSchema,
  orgStaffMutationResponseSchema,
  orgStaffResponseSchema,
  rejectApplicationResponseSchema,
  removeMemberResponseSchema,
  removeOrgCodeResponseSchema,
  removeOrgStaffResponseSchema,
  rotateOrgCodeResponseSchema,
  sendGymCheerResponseSchema,
  sendGymNudgeResponseSchema,
  startOrgTrialResponseSchema,
  updateOrgResponseSchema,
} from "./schemas.js";
import type {
  AddOrgStaffRequest,
  AttendanceDayQuery,
  OrgType,
  AttendanceHistoryQuery,
  CloseGymDayRequest,
  CloseGymDayResponse,
  GymAttendanceDayResponse,
  GymAttendanceHistoryResponse,
  GymAttendanceVisit,
  MarkGymAttendanceResponse,
  OrgOverviewResponse,
  SendGymCheerRequest,
  SendGymCheerResponse,
  SendGymNudgeRequest,
  SendGymNudgeResponse,
  ConfirmApplicationResponse,
  CreateOrgCodeRequest,
  CreateOrgRequest,
  CreateOrgResponse,
  GymHours,
  GymHoursResponse,
  GymWeekSchedule,
  JoinOrgRequest,
  JoinOrgResponse,
  RemoveGymClosureResponse,
  SetGymHoursRequest,
  SetGymHoursResponse,
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
  /** REQUIRED, and the one caller that needs it is the attendance hook.
   *
   *  A streak that fails to recompute must not lose the attendance (the row IS
   *  the record), so that failure is caught and WARNED rather than thrown — and
   *  R8.5 forbids the empty catch that would otherwise be the alternative.
   *
   *  ~~It is optional because every other function in this module has never
   *  needed a logger and adding a required field would rewrite every test's deps
   *  object to buy nothing.~~ **STRUCK — the premise was measured and false, and
   *  the optionality reintroduced the very thing the catch exists to avoid.**
   *  `deps.log?.warn(...)` on an absent logger is R8.5's empty catch reached
   *  through an optional chain: the failure is swallowed with no record at all.
   *  There is exactly ONE construction site in the whole repo
   *  (`routes.ts`, which already passes `app.log`), so "every test's deps
   *  object" was zero objects. Required costs nothing and removes the silent
   *  path. */
  log: { warn: (obj: Record<string, unknown>, msg: string) => void };
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
    clockFormat: org.clockFormat,
    manualAttendanceEnabled: org.manualAttendanceEnabled,
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
 *  `normaliseJoinCode`, and for the same reason: normalise once, at the boundary. */
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
    `Could not create the ${orgWords(req.orgType).it} just now. Please try again.`,
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
 *  dressed up as semantic.
 *
 *  **The noun follows the org type (roadmap 2b) and A GYM'S SENTENCE IS
 *  UNCHANGED TO THE BYTE**, which is what keeps the golden string above doing
 *  its job: the fixture it guards is a gym, so re-wording this still arrives
 *  red. */
export function currencyLockedMessage(orgType: OrgType): string {
  const it = orgWords(orgType).it;
  return (
    `The currency your ${it} is billed in can't change while your ${it} has a subscription, ` +
    "and that country uses a different one. Contact us and we'll move it for you."
  );
}

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
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "org.manage");

  const patch: repo.OrgPatch = {};
  // `in`, not `!== undefined`: `city: null` is a real instruction ("clear it")
  // and must reach the writer, while an absent `city` must leave it alone. The
  // two are the same value in JS and different intentions on a PATCH.
  if ("name" in req && req.name !== undefined) patch.name = req.name;
  if ("city" in req) patch.city = req.city ?? null;
  if ("timezone" in req && req.timezone !== undefined) patch.timezone = req.timezone;
  // NOT bound by the currency lock below: a clock is a display choice with no
  // money and no day boundary behind it, so it is the one field on this route
  // a PAYING gym may always change.
  if ("clockFormat" in req && req.clockFormat !== undefined) patch.clockFormat = req.clockFormat;
  // The owner's attendance switch (:26469 §1.4), and not bound by the currency
  // lock for `clockFormat`'s reason: no money, no day boundary.
  //
  // **THIS LINE IS THE ONE THE FIRST DRAFT FORGOT.** The field was in the
  // request schema, in `OrgPatch` and in the UPDATE's column list — so it
  // typechecked, linted and answered 200 — and every switch-off was silently
  // dropped here, between a contract that accepted it and a writer that could
  // have stored it. Caught by the switch's own test, which drove the SCREEN's
  // journey (patch, then try to mark) rather than the field.
  if ("manualAttendanceEnabled" in req && req.manualAttendanceEnabled !== undefined) {
    patch.manualAttendanceEnabled = req.manualAttendanceEnabled;
  }
  if ("country" in req && req.country !== undefined) {
    patch.country = normaliseCountry(req.country);
    patch.currencyDisplay = resolveCurrency(req.country);
  }
  // Stored as every invitation prints it (Part 3 §9.12): lines joined, links and `@`
  // taken out. Empty after that clears it.
  if ("postalAddress" in req && req.postalAddress !== undefined) {
    const tidied = req.postalAddress === null ? "" : cleanGymText(req.postalAddress, Number.MAX_SAFE_INTEGER);
    if (Array.from(tidied).length > GYM_POSTAL_ADDRESS_MAX_CHARS) {
      throw new OrgsError(
        400,
        "postal_address_too_long",
        `That address is too long. Keep it to ${String(GYM_POSTAL_ADDRESS_MAX_CHARS)} characters.`,
      );
    }
    patch.postalAddress = tidied === "" ? null : tidied;
  }

  const outcome = await repo.updateOrg(deps.sql, { gymId, patch, actorUserId: userId });

  switch (outcome.kind) {
    // BOTH arms answer 200 with the row, and `unchanged` is not an error: the
    // caller asked for a state and the state holds. Which call produced it is
    // the audit log's business (:12227 L-3), and the audit log is exactly where
    // a no-op is deliberately absent.
    case "updated":
    case "unchanged":
      return updateOrgResponseSchema.parse({ org: toOrgSummary(outcome.org), postalAddress: outcome.postalAddress });
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
      throw new OrgsError(409, "currency_locked", currencyLockedMessage(org.orgType));
    case "not_found":
      // Unreachable in practice — `requirePrivilege` has already read the org
      // and 404'd a stranger — but a gym archived or deleted between that read
      // and this write must not surface as a 500. The module's standing 404.
      throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
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
      // IS THIS GYM'S CONSOLE READ-ONLY — Part 3 §4.2, and Kd's ruling of
      // 2026-08-29 that it stops EVERY member of staff rather than only whoever
      // can pay. It is the answer `requireWritablePrivilege` reaches, sent ahead
      // of the press so a screen can grey a control out instead of drawing one
      // whose every tap is a 409.
      //
      // **STAFF, NOT `billing.manage` — and the contrast with the line directly
      // above is the whole of Kd's ruling.** `ownerTrialUsed` feeds the prompt,
      // which stops only whoever can pay (:22921 §1), so it is narrowed to that
      // tick. This one is told to a TRAINER too: their buttons stop working, and
      // a control that fails with no sentence beside it is the silence :12660
      // ruled on. Same boundary as `subscription` and `seatsUsed`, because like
      // them it is a fact about THIS GYM and not about a person (:23128's Low-8,
      // which is the comparison that was got wrong once already).
      //
      // Null for a non-staff caller, and the shared schema defaults it to null
      // for an api too old to send it. **Null is "we could not ask" and never
      // "locked"** — C97's rule, and the reason this is a field of its own rather
      // than `subscription === null` read at the client.
      consoleReadOnly: r.staffRole === null ? null : r.consoleReadOnly,
      // A fact about the gym for its staff (the Settings box and the Invite screen).
      postalAddress: r.staffRole === null ? null : r.postalAddress,
      // THE NEWEST CHEER THIS GYM SENT **THIS CALLER** — and it is the one field
      // on this response that is NOT withheld from a plain member.
      //
      // **THE FOUR FIELDS ABOVE ARE FACTS ABOUT THE GYM; THIS IS A MESSAGE
      // ADDRESSED TO THE READER.** §2.4's boundary keeps a gym's business from
      // its members, and applying it here would hide the feature from the only
      // person it exists for — the mirror-image mistake to the one :23128's
      // Low-8 corrected on `ownerTrialUsed`. The row is already scoped to this
      // user by the lateral's own `c.user_id` predicate, so there is nothing
      // here that belongs to anybody else.
      //
      // No staff gate, and no sender either: the member learns their gym cheered
      // them, never which member of staff pressed it.
      latestCheer:
        r.latestCheer === null
          ? null
          : { preset: r.latestCheer.preset, sentAt: r.latestCheer.sentAt.toISOString() },
      // SAME REASONING, SAME NON-GATE — a message addressed to the reader, not a
      // fact about the gym. It is on the wire beside the cheer and **only one of
      // the two may reach the screen** (Kd's own question, :36694 §3): the
      // client picks the newer, and drawing both is the way the member's half
      // gets built wrong.
      latestNudge:
        r.latestNudge === null
          ? null
          : { preset: r.latestNudge.preset, sentAt: r.latestNudge.sentAt.toISOString() },
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

/** `orgCanConfirm` is a REQUIRED second argument rather than an optional one
 *  defaulting to null, and that is the guard: this function has two callers —
 *  the join door and the waiting list — and the first version of this card gave
 *  the field to only one of them, leaving `/org/join` promising a tap the server
 *  refuses. A required parameter makes a third caller impossible to write
 *  without answering the question. `null` stays reserved for an api too old to
 *  send the field at all (:23711's C97 rule), which no path here can produce. */
function toApplication(app: repo.ApplicationRow, orgCanConfirm: boolean): OrgApplication {
  return {
    id: app.id,
    status: app.status,
    appliedAt: app.appliedAt.toISOString(),
    expiresAt: app.expiresAt.toISOString(),
    decidedAt: app.decidedAt === null ? null : app.decidedAt.toISOString(),
    nudgedAt: app.nudgedAt === null ? null : app.nudgedAt.toISOString(),
    orgCanConfirm,
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
    code: normaliseJoinCode(req.code),
    consent: req.consent ?? false,
  });

  switch (outcome.kind) {
    case "pending":
    case "already_pending":
      return joinOrgResponseSchema.parse({
        outcome: outcome.kind,
        org: toOrgSummary(outcome.org),
        application: toApplication(outcome.application, outcome.orgCanConfirm),
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
    // THE REFUSALS NAME THE PLACE IN ITS OWN WORD (roadmap 2b, Part 3 §2.2).
    // These sentences are the SERVER'S and the client prints them verbatim
    // (`JoinGymPanel` records that about itself), so this is the only place they
    // can be made to follow the org type.
    //
    // `no_such_code` is the one that cannot: no code means no org, so it names
    // all three types rather than guessing at one.
    case "no_such_code":
      throw new OrgsError(
        404,
        "code_not_found",
        `That code doesn't match any ${ORG_TYPES_PHRASE}.`,
      );
    case "org_archived":
      throw new OrgsError(
        409,
        "org_archived",
        `That ${orgWords(outcome.orgType).itToMembers} is no longer active.`,
      );
    case "code_unusable": {
      const it = orgWords(outcome.orgType).itToMembers;
      const message =
        outcome.reason === "paused"
          ? `That code has been paused. Ask the ${it} for a current one.`
          : outcome.reason === "expired"
            ? `That code has expired. Ask the ${it} for a current one.`
            : `That code has been used the maximum number of times. Ask the ${it} for a new one.`;
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
      ...toApplication(r.application, r.orgCanConfirm),
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
          ? // NO NOUN, because this arm cannot read one: `nudgeApplication`
            // answers about the APPLICATION and never loads the org, and a
            // person nudging a request that has already been accepted is owed
            // the fact rather than our vocabulary for the place.
            "That request was already accepted — you're in."
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
/** Exported for `memberList/service.ts`, which is the same console behind the
 *  same two gates and must not grow a fourth copy of either: four readers of
 *  one authorisation rule is four answers to "may this person see the gym's
 *  members", and the one a screen believes would not be the one the server
 *  enforces. */
export async function requirePrivilege(
  deps: Pick<OrgsDeps, "sql">,
  gymId: string,
  userId: string,
  privilege: OrgPrivilege,
): Promise<{ org: repo.OrgRow; role: OrgRole }> {
  const [org, authority] = await Promise.all([
    repo.getOrgById(deps.sql, gymId),
    repo.getStaffAuthority(deps.sql, gymId, userId),
  ]);
  if (org === null || authority === null) {
    throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
  }
  if (!privilegesFor(authority.role, authority.privileges).includes(privilege)) {
    // The message says ROLE because that is what a person understands, and it
    // stays true of a ticked-down manager: what their account is allowed to do
    // here does not cover this.
    throw new OrgsError(403, "forbidden", "Your role doesn't allow that.");
  }
  return { org, role: authority.role };
}

/** THE 404 EVERY ORG-SCOPED ROUTE ANSWERS — and the one sentence here that
 *  CANNOT name a type, which is why it names none.
 *
 *  It is thrown when the org does not exist AND when the caller has no standing
 *  in it, deliberately indistinguishable (that is the whole tenancy answer). In
 *  the first case there is no `org_type` to read, and in the second, telling a
 *  stranger "that STUDIO was not found" would answer a question they were
 *  refused. "Organisation" is the word `ConsoleHome` already puts above the list
 *  of everything somebody runs, so it is not a new one to learn. */
const ORG_NOT_FOUND_MESSAGE = "Organisation not found.";

/** THE SENTENCE A REFUSED WRITE CARRIES, and it is written once because twelve
 *  routes say it.
 *
 *  **It is complete without a button**, which is `billingView.js`'s rule 1
 *  applied to a server message: there is nowhere to send anybody yet (Paddle is
 *  unbuilt, the admin "mark this gym as paid" tool is unbuilt, the contact
 *  channel is owed), so a sentence promising a next step would be a promise with
 *  no code behind it (:5807).
 *
 *  **It is TRUE FOR EVERY STAFF ROLE, which is what Kd's ruling required of it.**
 *  A trainer reading it cannot subscribe, so it does not tell them to; it says
 *  what is wrong and what has to change. "Ask your gym's owner" was the other
 *  wording and is not used: the person reading it may BE the owner.
 *
 *  **It names the ORGANISATION IN ITS OWN WORD** (roadmap 2b): a studio's owner
 *  reads "This studio needs a plan". The web draws the same sentence on the
 *  screens themselves (`billingView.js`'s `readOnlyNote`), from the same table,
 *  so the banner and the refusal cannot disagree. */
function notOnPlanMessage(orgType: OrgType): string {
  return `This ${orgWords(orgType).it} needs a plan before anything here can be changed.`;
}

/** WHAT A CLOSED GYM'S STAFF ARE TOLD — Part 3 §4.2's archived state, which
 *  `archiveSweep.ts` finally writes (Kd's four months, 2026-08-31).
 *
 *  **It is `startGymTrial`'s existing sentence, hoisted rather than re-worded**,
 *  so the two doors that refuse a closed gym to its own STAFF say one thing.
 *  **`applyByCode` keeps *"That … is no longer active"* on purpose**: a
 *  different audience — somebody who is not staff of this gym and is owed the
 *  effect rather than our vocabulary (:25092 §1(d)'s boundary).
 *
 *  **`confirmApplication`'s copy of that sentence is NOT the applicant's, and
 *  the comment here said it was until T3 round 1 (2026-08-31).**
 *  `confirmOrgApplication` runs behind THIS gate holding `members.confirm`, so
 *  its caller is the front desk of this gym, not somebody at the door — half of
 *  the "different audience" justification did not hold for half of the pair it
 *  named. The branch itself is unaffected and is not reachable anyway: the plan
 *  check below answers before the repo is asked. It stays because the repo's
 *  outcome union is shared with `reject` and a door that can return a state has
 *  to say what it means; what was wrong was the reason written above it.
 *
 *  Complete without a button, like every other refusal on this console: a closed
 *  gym is re-opened by an operator (`tools/gym-restore.ts`) or by paying, and
 *  neither is a link this app can offer yet (:5807). */
function archivedMessage(orgType: OrgType): string {
  return `This ${orgWords(orgType).it} is archived.`;
}

/** AUTHORISE A WRITE — the privilege check above, plus Part 3 §4.2's read-only
 *  console.
 *
 *  **KD RULING 2026-08-29: a gym with no live plan is read-only for EVERY member
 *  of staff, not only for whoever can pay.** Put to him with the alternative in
 *  one line each. The reason the alternative was recommended against is the one
 *  to keep: `billing.manage` is a TICK, so a gate that stopped only its holders
 *  would be no gate at all — an owner appoints a manager without it and the
 *  lapsed gym carries on issuing join codes and admitting members through that
 *  login. It would have been a screen-deep rule wearing a server's clothes.
 *
 *  **THE ORDER OF THE TWO CHECKS IS DELIBERATE AND IS AN INFORMATION BOUNDARY.**
 *  Privilege first, so a stranger still gets `requirePrivilege`'s 404 and learns
 *  nothing about whether the gym exists, let alone whether it is paying; a
 *  staffer without the tick still gets its 403. Only somebody who would otherwise
 *  have been allowed reaches the 409 — which is the only caller the sentence is
 *  true and useful for. Reversed, this route would tell any signed-in stranger
 *  with a uuid which gyms have lapsed.
 *
 *  **THE READS ARE DELIBERATELY NOT GATED**, because §4.2 says read-ONLY: the
 *  roster, the codes, the staff list, the waiting queue and the price list all
 *  keep answering. Nothing is hidden from a gym because it stopped paying — what
 *  stops is changing things. **And the PAY PATH is not gated either**
 *  (`startOrgTrial`, `listOrgPlans`): gating the way out of the state on being
 *  out of the state is the brick wall :22215 §4 exists to remove.
 *
 *  **IT IS A CHECK-THEN-ACT AND TAKES NO LOCK, WHICH IS A DECISION.** A trial
 *  could start or expire between this read and the write it guards. :19560 puts
 *  the currency lock inside the transaction under `lockOrgRow` because that one
 *  guards MONEY and a write landing on the wrong side moves a paying gym's
 *  currency; this guards neither money nor anybody else's data, and both
 *  orderings are states the gym legitimately passes through seconds apart — a
 *  write admitted as a trial expires is one the owner could have made a second
 *  earlier. Widening it to a lock would serialise every console write in a gym
 *  for a guarantee nobody can observe. */
export async function requireWritablePrivilege(
  deps: Pick<OrgsDeps, "sql">,
  gymId: string,
  userId: string,
  privilege: OrgPrivilege,
): Promise<{ org: repo.OrgRow; role: OrgRole }> {
  const authorised = await requirePrivilege(deps, gymId, userId, privilege);
  if (!(await repo.gymHasLivePlan(deps.sql, gymId))) {
    throw new OrgsError(409, "gym_not_on_plan", notOnPlanMessage(authorised.org.orgType));
  }
  // **A CLOSED GYM CANNOT BE CHANGED EVEN IF A PLAN SAYS OTHERWISE** — Kd's
  // ruling of 2026-08-31 that a lapsed gym is archived after four months, and
  // the state `archiveSweep.ts` writes.
  //
  // **IT IS SECOND, AND THE ORDER IS THE ONLY REASON THIS IS INVISIBLE TODAY.**
  // Every gym the sweep can close has no live plan, so the check above answers
  // first and staff of a closed gym keep reading the sentence their own screen
  // is already showing them (`READ_ONLY_NOTE`, drawn from this module's
  // `notOnPlanMessage`). Reversed, one refusal would have two different
  // sentences depending on which door produced it — the drift `billingView.js`
  // warns about, bought for nothing.
  //
  // **SO IT IS UNREACHABLE TODAY AND IS WRITTEN ANYWAY, deliberately.** The
  // combination it refuses — archived AND on a live plan — is one no current
  // writer can produce, and it is exactly what :19016's first admin slice
  // produces the day it ships: *"i will have the power of removing them or
  // pausing their use if i find them to be fraud"* writes `archived` to a gym
  // that may still be paying. Without this line that gym would keep a fully
  // working console, because every other gate in this module asks about the
  // PLAN and not about the gym. The `past_due` banner sets the precedent for
  // writing the unreachable state now: the alternative on the day it becomes
  // reachable is silence, and Kd ruled on silence at :12660.
  //
  // The 409 code and sentence are `startGymTrial`'s own, not a third variant —
  // one state, one word for it.
  if (authorised.org.status !== "active") {
    throw new OrgsError(409, "org_archived", archivedMessage(authorised.org.orgType));
  }
  return authorised;
}

/** START THE GYM'S OWN FREE TRIAL.
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
  const { org } = await requirePrivilege(deps, gymId, userId, "billing.manage");

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
        `You've already used your free trial. It's one per person, not one per ${orgWords(org.orgType).it}.`,
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
      throw new OrgsError(409, "org_archived", archivedMessage(org.orgType));
    case "not_found":
      // Unreachable in practice — `requirePrivilege` has already read the org and
      // 404'd a stranger — but a gym archived or deleted between that read and
      // this write must not surface as a 500. The module's standing 404.
      throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
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
  // already grants them; a personal trainer's assistant gets the one client
  // list, because a trainer has no groups to scope to and never will; studios
  // and clinics wait for the scoping card.
  if (role === "trainer" && org.orgType !== "gym" && org.orgType !== "personal_trainer") {
    throw new OrgsError(
      403,
      "trainer_scope_unavailable",
      // This arm fires only where the role is NOT called Trainer — a studio's
      // Coach, a clinic's Clinician — so the role word follows the type.
      `${orgWords(org.orgType).coachCap} access to this list isn't available yet.`,
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
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "codes.manage");
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
        `This ${orgWords(org.orgType).it} already has ${String(outcome.cap)} codes, which is the most it can hold. Remove one from the list before making another.`,
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
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "codes.manage");

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
    code: normaliseJoinCode(code),
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
      throw new OrgsError(404, "code_not_found", `That code isn't one of this ${orgWords(org.orgType).it}'s.`);
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
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "codes.manage");

  const outcome = await mintCode(deps, (newCode) =>
    repo.rotateCode(deps.sql, {
      gymId,
      code: normaliseJoinCode(code),
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
      throw new OrgsError(404, "code_not_found", `That code isn't one of this ${orgWords(org.orgType).it}'s.`);
    case "too_many":
      throw new OrgsError(
        409,
        "too_many_codes",
        `This ${orgWords(org.orgType).it} already has ${String(outcome.cap)} codes, which is the most it can hold. Remove one from the list before replacing this one.`,
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
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "codes.manage");

  const outcome = await repo.removeCode(deps.sql, {
    gymId,
    code: normaliseJoinCode(code),
    actorUserId: userId,
  });

  switch (outcome.kind) {
    case "removed":
      return removeOrgCodeResponseSchema.parse({ status: "removed" });
    case "not_found":
      throw new OrgsError(404, "code_not_found", `That code isn't one of this ${orgWords(org.orgType).it}'s.`);
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
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.confirm");

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
      throw new OrgsError(
        409,
        "org_archived",
        `That ${orgWords(org.orgType).it} is no longer active.`,
      );
    case "seat_cap":
      // The application is deliberately still waiting — the owner adds a seat
      // and taps again. Naming the number here IS right, unlike at the join
      // door: this reader is the gym, and it is their own cap.
      throw new OrgsError(
        409,
        "seat_cap_reached",
        `Your plan covers ${String(outcome.cap)} ${orgWords(org.orgType).people} and they are all taken. Add a seat, then confirm again — this person is still waiting.`,
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
  await requireWritablePrivilege(deps, gymId, userId, "members.confirm");

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
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "members.remove");

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
      throw new OrgsError(404, "member_not_found", `That person isn't a ${orgWords(org.orgType).person} of this ${orgWords(org.orgType).it}.`);
    case "is_staff":
      throw new OrgsError(
        409,
        "member_is_staff",
        `${outcome.role === "owner" ? "The owner" : "A staff member"} can't be removed from the ${orgWords(org.orgType).person} list. Staff membership is managed with staff.`,
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
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "staff.manage");

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
        `Nobody in this ${orgWords(org.orgType).it} has that email address. They need to join first — send them your join code.`,
      );
    case "already_staff":
      throw new OrgsError(
        409,
        "already_staff",
        outcome.staff.role === "owner"
          ? `That person owns this ${orgWords(org.orgType).it}.`
          : `${outcome.staff.displayName} is already ${outcome.staff.role === "manager" ? "a manager" : `a ${orgWords(org.orgType).coach}`} here. Change their role instead of adding them again.`,
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
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "staff.manage");

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
      throw new OrgsError(404, "not_staff", `That person doesn't run this ${orgWords(org.orgType).it}.`);
    case "is_owner":
      throw new OrgsError(
        409,
        "owner_role_locked",
        `The ${orgWords(org.orgType).it}'s owner keeps the owner role. Handing a ${orgWords(org.orgType).it} over to somebody else isn't something the app can do yet.`,
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
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "staff.manage");

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
      throw new OrgsError(
        404,
        "not_staff",
        `That person doesn't run this ${orgWords(org.orgType).it}.`,
      );
    case "owner_only_privilege":
      throw new OrgsError(
        409,
        "owner_only_privilege",
        `Managing staff stays with the ${orgWords(org.orgType).it}'s owner. You can give this person any of the other permissions.`,
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
        `A ${orgWords(org.orgType).it}'s last owner has to keep both staff management and billing, so somebody there can always hand out the keys and pay.`,
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
  const { org } = await requireWritablePrivilege(deps, gymId, userId, "staff.manage");

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
      throw new OrgsError(404, "not_staff", `That person doesn't run this ${orgWords(org.orgType).it}.`);
    case "last_owner":
      throw new OrgsError(
        409,
        "last_owner",
        `A ${orgWords(org.orgType).it} can't be left with nobody in charge, so its last owner can't be removed.`,
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

// ---------------------------------------------------------------------------
// OPENING HOURS — Kd ruling 2026-08-31 (:26624), addenda :26684 and :26736.
// ---------------------------------------------------------------------------

/** WHO MAY READ A GYM'S HOURS: its staff, or a live member of it.
 *
 *  **It is deliberately wider than `requirePrivilege` and deliberately not
 *  public.** Kd ruled that MEMBERS SEE THE HOURS (:26684 §2, *"yes can see"*),
 *  and the member's gym card is served by this same route — one reader for both
 *  screens, so the console and the card cannot disagree about what a gym said.
 *  A stranger still gets the module's standing 404: a gym's timetable is not
 *  secret, but a route that answers for any uuid is a gym-enumeration oracle,
 *  which is the same reason `requirePrivilege` 404s rather than 403s.
 *
 *  **The two conditions are ORed rather than merged**, because they are genuinely
 *  different questions: `getStaffAuthority` answers "what may this person do
 *  here" and admits an invited manager who never joined (:14401's ghost rule);
 *  `isLiveMember` answers "is this person in this gym today". Requiring both
 *  would lock a manager out of a screen they administer. */
async function requireGymAudience(deps: OrgsDeps, gymId: string, userId: string): Promise<void> {
  const [org, authority, member] = await Promise.all([
    repo.getOrgById(deps.sql, gymId),
    repo.getStaffAuthority(deps.sql, gymId, userId),
    repo.isLiveMember(deps.sql, gymId, userId),
  ]);
  if (org === null || (authority === null && !member)) {
    throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
  }
}

/** A REAL DATE, not merely a well-shaped one.
 *
 *  `closeGymDayRequestSchema` and `closureParamsSchema` check `YYYY-MM-DD`, and
 *  **`2026-02-31` passes that and is not a day.** Postgres would refuse the cast
 *  and the caller would get a 500 they cannot act on, so the round trip through
 *  `Date` is the cheap oracle: JS rolls an impossible date forward (31 Feb →
 *  3 Mar), so a value that does not print back identically was never a date.
 *
 *  Deliberately NOT a locale or timezone question — the string is interpreted at
 *  UTC purely to normalise it, and the DAY it names is the gym's own (trap #8).
 *  Nothing here decides what "today" is.
 *
 *  **YEAR ZERO IS THE HOLE T3 ROUND 1 FOUND (Low-1), and it is this function's
 *  own failure mode rather than an edge case somewhere else.** `0000-01-01`
 *  matches the pattern AND round-trips through `Date` identically — JS has a year
 *  0, the Gregorian calendar does not, and Postgres refuses the cast with
 *  `date/time field value out of range`. So the one input class this guard exists
 *  to convert into a 400 was answering 500. Verified both ways before the fix:
 *  `0000-01-01` errors in Postgres, `0001-01-01` is accepted. The bound is
 *  therefore on the YEAR and not on the string. */
function requireCalendarDate(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new OrgsError(400, "invalid_date", "That date doesn't exist.");
  }
  // `getUTCFullYear()` and not a substring: the round-trip above has already
  // proven the string is what `Date` parsed, so the parsed value is the honest
  // thing to bound — and a substring comparison would need its own opinion about
  // leading zeros.
  if (parsed.getUTCFullYear() < 1) {
    throw new OrgsError(400, "invalid_date", "That date doesn't exist.");
  }
  return day;
}

/** Minutes from midnight as a 24-hour clock face, for the ONE place a human
 *  reads them: the sentence that names two sessions which clash. Deliberately
 *  not `toLocale*` — R5.1's ban is the engine's, but the reason travels: a
 *  server-side locale would make an error message depend on where the process
 *  runs. 1440 renders as `24:00`, which is what it means (midnight at the END of
 *  the day) and is how timetables have always written it. */
function clockFace(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

/** ISO weekday (1 = Monday … 7 = Sunday) to the word a refusal message uses.
 *  Indexed off a validated 1–7 — `gymWeekdaySchema` has already run — and the
 *  fallback exists only because `noUncheckedIndexedAccess` is on (R2.1) and a
 *  refusal must never crash on the way to being sent. */
function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] ?? `day ${String(weekday)}`;
}

/** FLATTEN THE WEEK INTO ROWS, REFUSING ANYTHING A GYM COULD NOT HAVE MEANT.
 *
 *  Two rules, and both exist because the attendance card must be able to ask
 *  "which session did this stamp fall in" and get exactly one answer:
 *
 *  **(1) ONE ENTRY PER WEEKDAY.** Two `{weekday: 3}` entries in one body would
 *  be silently concatenated by any reader that just iterates — and the overlap
 *  check below would then run per-entry and pass on a pair that overlaps ACROSS
 *  them. Refused rather than merged: a client sending Wednesday twice has a bug
 *  its user cannot see.
 *
 *  **(2) NO OVERLAP WITHIN A DAY. TOUCHING IS LEGAL.** 10:00–12:00 beside
 *  12:00–14:00 is a gym with a break in its numbering, not an error; 10:00–12:00
 *  beside 11:00–13:00 is a timetable with no single answer. The comparison is
 *  `next.opens < current.closes` — strict, so equality (touching) passes — and
 *  it is the boundary this card names as easy to get backwards, which is why a
 *  test drives both sides of it.
 *
 *  **The message names the two sessions that clash**, because "invalid week" is
 *  a refusal an owner cannot act on; they need to know which two rows to look
 *  at. It carries no other input back (R3.10). */
function flattenWeek(week: GymWeekSchedule): repo.GymSessionRow[] {
  const rows: repo.GymSessionRow[] = [];
  const seen = new Set<number>();

  for (const day of week) {
    if (seen.has(day.weekday)) {
      throw new OrgsError(
        400,
        "duplicate_weekday",
        `${weekdayName(day.weekday)} is listed twice. Send each day once, with all of its sessions.`,
      );
    }
    seen.add(day.weekday);

    // Sorted here rather than trusting the client's order: the overlap check is
    // a neighbour comparison and is only correct on sorted input, and a screen
    // that lets an owner add a 6am session after a 2pm one is a screen we want
    // to keep working.
    const sessions = [...day.sessions].sort((a, b) => a.opensMinute - b.opensMinute);
    for (let i = 1; i < sessions.length; i += 1) {
      const previous = sessions[i - 1];
      const current = sessions[i];
      if (previous === undefined || current === undefined) continue;
      if (current.opensMinute < previous.closesMinute) {
        throw new OrgsError(
          400,
          "overlapping_sessions",
          `${weekdayName(day.weekday)} has two sessions that overlap: ` +
            `${clockFace(previous.opensMinute)}–${clockFace(previous.closesMinute)} and ` +
            `${clockFace(current.opensMinute)}–${clockFace(current.closesMinute)}.`,
        );
      }
    }

    for (const session of sessions) {
      rows.push({
        weekday: day.weekday,
        opensMinute: session.opensMinute,
        closesMinute: session.closesMinute,
      });
    }
  }
  return rows;
}

/** The repo's flat rows back into the per-weekday shape the contract carries.
 *  Only weekdays that HAVE sessions appear — an absent weekday and an empty list
 *  mean the same thing, and emitting seven entries every time would put five
 *  empty objects on every member's gym card. */
function toWeekSchedule(sessions: readonly repo.GymSessionRow[]): GymHours["week"] {
  const byWeekday = new Map<number, { opensMinute: number; closesMinute: number }[]>();
  for (const s of sessions) {
    const list = byWeekday.get(s.weekday) ?? [];
    list.push({ opensMinute: s.opensMinute, closesMinute: s.closesMinute });
    byWeekday.set(s.weekday, list);
  }
  return [...byWeekday.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekday, list]) => ({ weekday, sessions: list }));
}

/** ONE PLACE TURNS A ROW INTO THE ANSWER, and it is what makes the `unset`
 *  guarantee checkable rather than a comment.
 *
 *  **`week` IS EMPTY UNLESS THE MODE IS `scheduled`.** ~~A gym on `open_24h` has
 *  no rows anyway (the writer deletes them)~~ — **STRUCK 2026-09-03: Kd reversed
 *  that, and the rows now survive on purpose** (`:31508`), which makes the rest
 *  of this paragraph MORE load-bearing rather than less. `unset` has none by
 *  construction — but a reader that trusted the rows alone would be one stray
 *  row away from telling members a 24-hour gym closes at six, and stray rows are
 *  no longer hypothetical. The mode decides, every time, which is :26736's rule
 *  made mechanical.
 *
 *  T3 round 1's L-1: this block survived the commit that reversed it, stacked
 *  above the newer one where only the second binds. Struck in place on
 *  :20587's rule rather than deleted, because the sentence is the reason the
 *  guarantee exists. */
/** THE TWO WEEKS ANSWER TWO DIFFERENT QUESTIONS, and this function is the only
 *  place either is built.
 *
 *  **`week` — WHAT THIS GYM IS TELLING PEOPLE. The MODE decides it, never the
 *  rows**, and that is the invariant `orgs.hours.test.ts`'s *"the MODE decides
 *  what the week contains"* was written to protect: a reader trusting the rows
 *  would draw a 24-hour gym a Monday-to-Sunday timetable nobody is being
 *  offered, and an `unset` gym a week it has never claimed (:26736).
 *
 *  **`savedWeek` — WHAT THE OWNER WOULD COME BACK TO.** The rows as they stand,
 *  whatever the mode. It exists because Kd ruled on 2026-09-03 that switching to
 *  24 hours must stop destroying a gym's timetable, and it has exactly ONE
 *  caller: the console's own form. **Nothing member-facing may draw it** —
 *  `GymHoursNote` branches on the mode and reads `week`, which is why keeping
 *  the rows changes nothing a member sees. */
function toGymHours(row: repo.GymHoursRow): GymHours {
  return {
    mode: row.mode,
    timezone: row.timezone,
    clockFormat: row.clockFormat,
    week: row.mode === "scheduled" ? toWeekSchedule(row.sessions) : [],
    savedWeek: toWeekSchedule(row.sessions),
    closures: row.closures.map((c) => ({ day: c.day, note: c.note })),
  };
}

/** WHEN IS THIS GYM OPEN — the console's Settings panel and the member's gym
 *  card, one reader.
 *
 *  **NOT gated on the gym having a live plan.** §4.2's read-only console is
 *  read-ONLY: a lapsed gym keeps answering every read, and hiding a gym's
 *  opening times from its own members because it stopped paying would tell them
 *  something false about the gym rather than about the bill (:23711's rule, the
 *  same reason the roster and the code list stay open). */
export async function getOrgHours(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
): Promise<GymHoursResponse> {
  await requireGymAudience(deps, gymId, userId);
  const row = await repo.getGymHours(deps.sql, gymId);
  if (row === null) throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
  return gymHoursResponseSchema.parse({ hours: toGymHours(row) });
}

/** SET THE WHOLE WEEK, or declare the gym open 24 hours.
 *
 *  `org.manage` through `requireWritablePrivilege`, so a gym with no live plan
 *  and an archived gym are refused by the gates that already exist (:23711,
 *  :26220) — **no new refusal vocabulary is invented for this card.** */
export async function setOrgHours(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  req: SetGymHoursRequest,
): Promise<SetGymHoursResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "org.manage");

  const sessions = req.mode === "scheduled" ? flattenWeek(req.week) : [];
  const outcome = await repo.setGymHours(deps.sql, {
    gymId,
    mode: req.mode,
    sessions,
    actorUserId: userId,
  });

  switch (outcome.kind) {
    case "set":
      return setGymHoursResponseSchema.parse({ hours: toGymHours(outcome.hours) });
    case "not_found":
      // Unreachable in practice — the gate above already read the org — but a
      // gym deleted between that read and this write must not surface as a 500.
      throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
    default:
      return assertNever(outcome);
  }
}

/** "WE ARE CLOSED TODAY" for one date, with an optional reason.
 *
 *  **An omitted `note` and an explicit null both mean "no reason given", and
 *  that is not a lost distinction.** Re-closing a day is how a note is edited
 *  (the UNIQUE makes the write an upsert), so a body with no note must be able
 *  to CLEAR one — a screen whose reason box the owner emptied sends exactly
 *  that. An empty string is normalised to null by the same rule, so the card
 *  never renders a dash after a dangling dash. */
export async function closeOrgDay(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  req: CloseGymDayRequest,
): Promise<CloseGymDayResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "org.manage");

  const trimmed = req.note ?? null;
  const outcome = await repo.closeGymDay(deps.sql, {
    gymId,
    day: requireCalendarDate(req.day),
    note: trimmed === null || trimmed.length === 0 ? null : trimmed,
    actorUserId: userId,
  });

  switch (outcome.kind) {
    case "closed":
      return closeGymDayResponseSchema.parse({ hours: toGymHours(outcome.hours) });
    case "not_found":
      throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
    default:
      return assertNever(outcome);
  }
}

/** UN-CLOSE A DAY, restoring the weekly pattern. Answering `removed` for a day
 *  that was never closed is deliberate — the word names the STATE, not this
 *  request (`removeOrgMember`'s convention, same reason). */
export async function removeOrgClosure(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  day: string,
): Promise<RemoveGymClosureResponse> {
  await requireWritablePrivilege(deps, gymId, userId, "org.manage");

  const outcome = await repo.removeGymClosure(deps.sql, {
    gymId,
    day: requireCalendarDate(day),
    actorUserId: userId,
  });

  switch (outcome.kind) {
    case "removed":
      return removeGymClosureResponseSchema.parse({
        status: "removed",
        hours: toGymHours(outcome.hours),
      });
    case "not_found":
      throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
    default:
      return assertNever(outcome);
  }
}

/* ─────────────────────────── ATTENDANCE ───────────────────────────
 *
 *  Kd 2026-08-31 (:26469) and 2026-09-01 (:27900, :27992, :28055, :28107).
 */

function toAttendanceVisit(row: repo.GymAttendanceVisitRow): GymAttendanceVisit {
  return {
    day: row.day,
    markedAt: row.markedAt.toISOString(),
    method: row.method,
    hoursStatus: row.hoursStatus,
    session:
      row.sessionOpensMinute !== null && row.sessionClosesMinute !== null
        ? { opensMinute: row.sessionOpensMinute, closesMinute: row.sessionClosesMinute }
        : null,
  };
}

/** THE SENTENCE A MEMBER SEES WHEN THEIR GYM HAS SWITCHED MANUAL MARKING OFF.
 *
 *  **It names the phone app because that is the true reason and the true next
 *  step** (:26586: the scan path is phone-app work). A bare "not allowed" would
 *  leave a member believing attendance is broken, and the owner who switched it
 *  off did so expecting scanning to replace it. */
function manualAttendanceOffMessage(orgType: OrgType): string {
  return `This ${orgWords(orgType).itToMembers} doesn't take attendance from the web. Scanning arrives with the phone app.`;
}

/** `06:00` on the gym's own clock — 24-hour, always, and NOT the gym's
 *  `clockFormat`.
 *
 *  **This is a SERVER string and the server has no business rendering a gym's
 *  chosen clock**: every 12-hour label in this product comes from `clockLabel`
 *  in the web bundle, and a second spelling of one minute is the defect that
 *  file's own header names. A refusal message is the one place a time must
 *  travel as text rather than as minutes, so it uses the unambiguous form. */
function clock24(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** WHAT A MEMBER IS TOLD WHEN THEY TAP "I'm here" AND THE GYM IS SHUT.
 *
 *  Kd's ruling of 2026-09-03. **It never scolds and it always says what to do
 *  next** — the sentence a person reads at a locked door should be the opening
 *  times, not a refusal on its own, and a gym whose pattern has no sessions
 *  today gets a different sentence from one that is simply between them.
 *
 *  **THE NOUN FOLLOWS THE ORG TYPE and a gym's three sentences are unchanged to
 *  the byte** (roadmap 2b). A personal trainer's client reads "Your trainer is
 *  closed today", which is how anybody speaks of a business run by one person
 *  ("the dentist is closed today") — the alternative was a fourth sentence for
 *  one type, and two spellings of one refusal is what this file's neighbours
 *  keep warning about. */
function gymClosedMessage(
  outcome: {
    hoursStatus: "outside_hours" | "closed_day";
    todayHours: { opensMinute: number; closesMinute: number }[];
  },
  orgType: OrgType,
): string {
  const it = orgWords(orgType).itToMembers;
  if (outcome.hoursStatus === "closed_day") {
    return `Your ${it} is closed today, so attendance isn't open.`;
  }
  if (outcome.todayHours.length === 0) {
    return `Your ${it} isn't open today, so attendance isn't open.`;
  }
  const windows = outcome.todayHours
    .map((h) => `${clock24(h.opensMinute)}–${clock24(h.closesMinute)}`)
    .join(", ");
  return `Your ${it} is open ${windows} today — attendance opens then.`;
}

/** A PAGE MARKER WE CANNOT READ IS A 400, NEVER A SILENT "START AGAIN".
 *
 *  Both attendance reads take a cursor and both must fail the same way: serving
 *  page one for an unreadable marker is how a client loops for ever, re-fetching
 *  the same rows and believing it is advancing. One function so the two cannot
 *  drift into two different answers. */
function requireAttendanceCursor(
  raw: string | undefined,
): { markedAt: Date; id: string } | undefined {
  if (raw === undefined) return undefined;
  const parsed = repo.parseAttendanceCursor(raw);
  if (parsed === null) throw new OrgsError(400, "bad_cursor", "That page marker isn't valid.");
  return parsed;
}

/** MARK YOURSELF PRESENT.
 *
 *  **THE GATE IS THE GYM EXISTING PLUS A LIVE MEMBERSHIP — NOT
 *  `requireGymAudience`, AND DELIBERATELY NOT `requireWritablePrivilege`.**
 *  ~~`requireGymAudience`~~ is named nowhere in this function and naming it here
 *  understated the gate: that helper admits non-member STAFF, which the
 *  paragraph three below says must not happen. The code has always been the
 *  stricter of the two; the sentence was the loose one. That helper is built for
 *  CONSOLE writes by
 *  STAFF and refuses a gym with no live plan — which would refuse **a lapsed
 *  gym's own members**, contradicting Kd's answer at the plan gate (:27992) and
 *  :22215's arm A, where a lapsed gym's members fall back to the free app rather
 *  than being locked out. The gym still exists, the member still walked in, and
 *  refusing would tell them something false about their own gym (:5807).
 *
 *  **AN ARCHIVED GYM IS DIFFERENT AND DOES REFUSE.** Nothing new happens at a
 *  closed gym — :25771 stops anybody joining one — so a new attendance row there
 *  would be a fact about a gym the product has finished with.
 *
 *  **STAFF AUTHORITY IS NOT A SUBSTITUTE FOR MEMBERSHIP HERE**, which is the one
 *  place this differs from every other read in this module. A manager who never
 *  joined the gym has authority over it and is not a member of it; letting
 *  authority stand in for membership would put staff into a gym's own attendance
 *  numbers without anybody deciding that (:14401's ghost rule pointed the other
 *  way — it is about authority OUTLIVING membership, never replacing it).
 *
 *  **NOTHING ON THIS PATH ASKS WHETHER THE MEMBER HAS PAID THE GYM** — Kd,
 *  2026-09-01: *"if a memebr is not part of the gym or have not paid then gym
 *  memebr can remove them thas gym responsibility"*. One condition, a live
 *  membership row, and `members.remove` is the gym's remedy for anybody else. */
export async function markOrgAttendance(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
): Promise<MarkGymAttendanceResponse> {
  const [org, member] = await Promise.all([
    repo.getOrgById(deps.sql, gymId),
    repo.isLiveMember(deps.sql, gymId, userId),
  ]);
  if (org === null || !member) {
    throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
  }
  if (org.status === "archived") {
    // THE MEMBER'S WORD, not the staff's: this is the one archived refusal a
    // member reaches, and a personal trainer's client joined a trainer, not a
    // business. The same `itToMembers` the join door and the switched-off
    // message on this path already use.
    throw new OrgsError(
      409,
      "org_archived",
      `This ${orgWords(org.orgType).itToMembers} is no longer active.`,
    );
  }

  const outcome = await repo.markGymAttendance(deps.sql, {
    gymId,
    userId,
    // TODAY ALWAYS THE MEMBER THEMSELVES — Kd answered "only the member, for
    // now" (:27900). The column is separate so a front-desk button later ADDS a
    // value rather than rewriting history, and this is the line that would
    // change, alone.
    markedByUserId: userId,
    // `qr` is unreachable until the phone app ships (:26586); it exists in the
    // vocabulary so the gym can tell the two apart from day one (:26469 §4).
    method: "manual",
  });

  switch (outcome.kind) {
    case "marked":
      // KD RULED GOING TO THE GYM KEEPS A STREAK ALIVE (:27900 §3). The hook is
      // a SERVICE INTERFACE (R7.1), the same seam `workouts` and `nutrition`
      // use; nothing here reaches into gamification's repo.
      //
      // **ONLY FOR A NEW ROW.** A repeated tap in the same slot is idempotent at
      // the database and changes no day, so re-running would be work with no
      // possible effect — and `recomputeXp` takes a per-user advisory lock a
      // member hammering a button must not be able to queue behind.
      //
      // **AND IT CANNOT LOSE THE ATTENDANCE.** The row is already committed; a
      // streak is recomputed from committed history on the next read anyway, so
      // a failure here degrades with a warn rather than turning a recorded visit
      // into a 500 (`awardMealBadges`' precedent, same shape, same reason).
      //
      // **THE READ IS INSIDE THE GUARD, NOT BESIDE IT.** `getUserSyncContext`
      // is a database read on the same failure-prone path, and awaiting it
      // OUTSIDE the catch made a blip there a 500 on a POST whose attendance row
      // is already committed — telling the member their tap failed while they
      // are marked in, which is the exact outcome the paragraph above forbids
      // (:5807). Everything between the commit and the response degrades or
      // nothing does.
      if (!outcome.alreadyMarked) {
        await getUserSyncContext(deps.sql, userId)
          .then((ctx) => onAttendanceMarked({ sql: deps.sql }, userId, ctx.timezone))
          .catch((err: unknown) => {
            deps.log.warn(
              {
                event: "gamification.attendance_streak_failed",
                userId,
                gymId,
                errName: err instanceof Error ? err.name : typeof err,
              },
              "attendance streak recompute failed",
            );
          });
      }
      return markGymAttendanceResponseSchema.parse({
        status: "created",
        alreadyMarked: outcome.alreadyMarked,
        visit: toAttendanceVisit(outcome.visit),
        timezone: outcome.timezone,
        clockFormat: outcome.clockFormat,
      });
    case "manual_disabled":
      throw new OrgsError(409, "manual_attendance_off", manualAttendanceOffMessage(org.orgType));
    case "closed":
      throw new OrgsError(409, "gym_closed_now", gymClosedMessage(outcome, org.orgType));
    case "not_found":
      // Unreachable in practice — the gate above read the org — but a gym
      // deleted between that read and this write must not surface as a 500.
      throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
    default:
      return assertNever(outcome);
  }
}

/** WHO CAME — the console's Attendance section (Kd :28107, its own place in the
 *  rail rather than a corner of Settings).
 *
 *  `attendance.read`, which every role holds by default and an owner may untick
 *  per person (:28107). **NOT `requireWritablePrivilege`**: this is a READ, and
 *  §4.2's read-only console keeps answering every read for a gym with no live
 *  plan (:23711) — a gym that stopped paying still needs to know who is in the
 *  building. */
export async function getOrgAttendanceDay(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  // THE SCHEMA'S OWN TYPE, NEVER A HAND-WRITTEN COPY OF IT. The copy that used
  // to be here named `statuses` while the schema emitted `status`, and the
  // filter silently did nothing for a whole card (see `attendanceDayQuerySchema`).
  query: AttendanceDayQuery,
): Promise<GymAttendanceDayResponse> {
  await requirePrivilege(deps, gymId, userId, "attendance.read");

  const cursor = requireAttendanceCursor(query.cursor);

  const row = await repo.getGymAttendanceDay(deps.sql, {
    gymId,
    day: query.day === undefined ? undefined : requireCalendarDate(query.day),
    statuses: query.statuses,
    cursor: cursor === undefined ? undefined : { markedAt: cursor.markedAt, userId: cursor.id },
  });
  if (row === null) throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);

  return gymAttendanceDayResponseSchema.parse({
    attendance: {
      day: row.day,
      timezone: row.timezone,
      clockFormat: row.clockFormat,
      totals: row.totals,
      summary: row.summary.map((s) => ({
        hoursStatus: s.hoursStatus,
        session:
          s.opensMinute !== null && s.closesMinute !== null
            ? { opensMinute: s.opensMinute, closesMinute: s.closesMinute }
            : null,
        visits: s.visits,
        people: s.people,
      })),
      people: row.people.map((p) => ({
        userId: p.userId,
        displayName: p.displayName,
        // Kd's 2026-09-03 ruling — a knowing deviation from Part 3 §2.4, with
        // the join screen's disclosure changed in the same commit. See the
        // field's own note in `packages/shared/src/orgs.ts`.
        email: p.email,
        visits: p.visits.map(toAttendanceVisit),
      })),
      nextCursor: row.nextCursor,
    },
  });
}

/** ONE PERSON'S OWN ATTENDANCE.
 *
 *  **TWO CALLERS, ONE FUNCTION, AND THE AUTHORISATION IS WHAT DIFFERS.** A
 *  member reading THEMSELVES needs only to be a live member (Kd, :27900 — they
 *  see their own history); staff reading SOMEBODY ELSE need `attendance.read`
 *  (:28055's `?userId=` filter). Splitting these into two routes would be two
 *  places to get an IDOR wrong (R3.2), so the fork is here, in one `if`, and
 *  everything after it is identical.
 *
 *  **THE SELF CASE IS CHECKED FIRST AND SEPARATELY**, so a member who is not
 *  staff never reaches the privilege check and never sees a 403 about their own
 *  attendance.
 *
 *  **`from`/`to` NARROW THE ANSWER AND CANNOT WIDEN IT.** They are gym days, not
 *  instants, and the fork above runs before them — a window is a filter over the
 *  rows this caller was already entitled to for this subject, never a way to
 *  reach a row they were not. `attendanceHistoryQuerySchema` carries the whole
 *  reasoning, including why the unit is not `/v1/workouts`'. */
export async function getOrgAttendanceHistory(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
  // The schema's own type, for `getOrgAttendanceDay`'s reason — the guard is
  // worth nothing if it covers one of the two readers.
  query: AttendanceHistoryQuery,
): Promise<GymAttendanceHistoryResponse> {
  const subjectId = query.userId ?? userId;
  if (subjectId === userId) {
    const [org, member] = await Promise.all([
      repo.getOrgById(deps.sql, gymId),
      repo.isLiveMember(deps.sql, gymId, userId),
    ]);
    if (org === null || !member) {
      throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);
    }
  } else {
    await requirePrivilege(deps, gymId, userId, "attendance.read");
  }

  const row = await repo.getGymAttendanceHistory(deps.sql, {
    gymId,
    userId: subjectId,
    // THE CALENDAR CHECK IS HERE AND THE SHAPE CHECK IS IN THE SCHEMA, which is
    // the split `getOrgAttendanceDay` above already makes for `day`: the pattern
    // admits `2026-02-31`, which is not a date, and Postgres refusing the
    // `::date` cast would be a 500 the caller cannot act on. Each bound is
    // checked ALONE because the schema's ordering refine only runs when BOTH are
    // present (:4483's F3 — a one-bound request reaching the database layer and
    // 500ing there while the two-bound request was politely refused).
    from: query.from === undefined ? undefined : requireCalendarDate(query.from),
    to: query.to === undefined ? undefined : requireCalendarDate(query.to),
    cursor: requireAttendanceCursor(query.cursor),
  });
  if (row === null) throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);

  return gymAttendanceHistoryResponseSchema.parse({
    attendance: {
      timezone: row.timezone,
      clockFormat: row.clockFormat,
      visits: row.visits.map(toAttendanceVisit),
      nextCursor: row.nextCursor,
    },
  });
}

/** THE GYM'S NUMBERS — Part 3 §4.1's Overview, and Kd's :29961 ruling 1 (the
 *  tiles count VISITS).
 *
 *  **GATED ON `attendance.read`, NOT ON `members.read`.** These figures ARE the
 *  attendance figures, so an owner who unticks a trainer's attendance box and
 *  then watches that trainer read the day's visit totals off the Overview has a
 *  tick box that does not do what it says — :13803's precedent, restated at
 *  :21157 and again when the privilege was minted (:28107 §2).
 *
 *  **NOT behind `requireWritablePrivilege`**, deliberately: that helper refuses a
 *  gym with no live plan, and Part 3 §4.2's read-only console still DRAWS in full
 *  (:23711 — *"it seals nobody out"*). A lapsed gym's owner is being asked to
 *  pay; showing them a blank screen where their numbers were is the argument
 *  against paying.
 *
 *  **THE ONLY ARITHMETIC ON THIS PATH IS THE PERCENTAGE, AND IT IS DONE HERE
 *  RATHER THAN ON THE SCREEN** (R3.1; :27992 §3). A client that divided
 *  `visitors` by `members` itself would be one rounding rule away from
 *  disagreeing with every other surface that ever prints adoption. */
export async function getOrgOverview(
  deps: OrgsDeps,
  userId: string,
  gymId: string,
): Promise<OrgOverviewResponse> {
  await requirePrivilege(deps, gymId, userId, "attendance.read");

  const row = await repo.getOrgOverview(deps.sql, { gymId });
  if (row === null) throw new OrgsError(404, "org_not_found", ORG_NOT_FOUND_MESSAGE);

  /** THE REGULARS RIDE ON THIS READ RATHER THAN TAKING ONE OF THEIR OWN.
   *
   *  `Overview.jsx` already issues four reads in one `Promise.allSettled` and
   *  :30399's own trigger warns before adding a fourth; a fifth would be a fifth
   *  outcome to reconcile on the screen whose error handling is already the
   *  subtlest thing on it. This question is attendance-derived and this route is
   *  already gated on `attendance.read`, so it belongs in this answer.
   *
   *  **A SECOND `null` HERE WOULD BE UNREACHABLE AND IS STILL NOT ASSUMED AWAY**
   *  — both reads resolve the same gym id microseconds apart, so this can only
   *  be null if the gym vanished between them. It reads as an empty list rather
   *  than a 404, because the numbers above are already computed and throwing
   *  them away over a race nobody can produce would turn a whole screen off. */
  const regulars = (await repo.getGymRegulars(deps.sql, { gymId })) ?? [];

  /** THE SLIPPING-AWAY LIST RIDES HERE FOR THE REGULARS' REASON, ONE STEP ON.
   *
   *  `Overview.jsx` issues FIVE reads in one `Promise.allSettled` — measured
   *  2026-09-07, and the docblock above still says four because `getAttendanceDay`
   *  landed at :30733 without either comment being re-read. **The argument is
   *  unaffected and gets stronger**: a sixth outcome to reconcile on the screen
   *  whose error handling is the subtlest thing on it. This question is
   *  attendance-derived and this route is already gated on `attendance.read`.
   *
   *  **THE `null` FALLBACK IS THE SAME UNREACHABLE RACE**, handled the same way:
   *  an empty list with `hasHistory: true` rather than a 404, because the numbers
   *  above are already computed and discarding a whole screen over a gym that
   *  vanished between two reads helps nobody. **`hasHistory: true` and not
   *  `false` is the safe direction** — it draws "nobody is slipping" for a gym
   *  that cannot exist, where `false` would draw a "still collecting" sentence
   *  naming a date this branch has no way to know. */
  const slipping = (await repo.getGymSlippingAway(deps.sql, { gymId })) ?? {
    rows: [],
    hasHistory: true,
    since: null,
  };

  /** **NULL AND NOT ZERO WHEN THERE ARE NO MEMBERS.** A gym nobody has joined
   *  has no adoption to state, and "0%" would tell an owner on their first day
   *  that their members are ignoring them. :8267's class — the difference
   *  between "no answer" and "the answer is none" — and it is also the divide
   *  this line exists to not perform. */
  const adoptionPct =
    row.members === 0 ? null : Math.round((row.monthVisitors * 100) / row.members);

  return orgOverviewResponseSchema.parse({
    overview: {
      timezone: row.timezone,
      today: row.today,
      tiles: {
        today: { visits: row.todayVisits, visitors: row.todayVisitors },
        week: {
          visits: row.weekVisits,
          visitors: row.weekVisitors,
          prevVisits: row.prevWeekVisits,
          prevVisitors: row.prevWeekVisitors,
        },
        month: { visitors: row.monthVisitors, members: row.members, adoptionPct },
      },
      weeks: row.weeks,
      onARoll: regulars.map((r) => ({
        userId: r.userId,
        displayName: r.displayName,
        weeksRunning: r.weeksRunning,
        daysRunning: r.daysRunning,
        visits: r.visits,
        cheerableAt: r.cheerableAt === null ? null : r.cheerableAt.toISOString(),
      })),
      slippingAway: slipping.rows.map((r) => ({
        userId: r.userId,
        displayName: r.displayName,
        lastVisitDay: r.lastVisitDay,
        visits: r.visits,
        nudgeableAt: r.nudgeableAt === null ? null : r.nudgeableAt.toISOString(),
      })),
      slippingAwayHasHistory: slipping.hasHistory,
      slippingAwaySince: slipping.since,
    },
  });
}

/** A GYM CHEERS ONE OF ITS MEMBERS ON — Kd's :29961 ruling 4, and the SIXTEENTH
 *  write door in this module.
 *
 *  **IT IS BEHIND `requireWritablePrivilege`, WHICH IS A DECISION AND NOT A
 *  DEFAULT.** :22215 is Kd's ruling that a gym without a live plan gets nothing,
 *  and :23711 built it as twelve doors that now number sixteen — so a lapsed gym
 *  and an archived gym are refused here by gates that already existed, with no
 *  new refusal vocabulary invented (:26812's phrasing). A cheer is a gym acting
 *  on its members; a gym that has stopped paying stops acting.
 *
 *  **THE GATE IS `members.read` AND NOT A TENTH PRIVILEGE — a call made for Kd,
 *  with its cost, at the gate (the habit :27992 §1 and :28055 §1 both earned).**
 *  Part 3 §2.2 grants *Send "we miss you" nudge* to all three roles, which is
 *  exactly the set that already holds `members.read`, so this needs no new
 *  vocabulary to match the spec. **What it costs: an owner cannot stop one
 *  staffer cheering without also taking away their roster.** Nobody has asked
 *  to, and minting `members.cheer` is a migration in this repo rather than a
 *  list edit (:28107's standing rule) — DDL CHECK, backfill, role templates, a
 *  tick box and two "newest" fixtures. Reversible in one line if he wants it.
 *
 *  **THE PRIVILEGE IS CHECKED BEFORE THE MEMBERSHIP, and the order is an
 *  information boundary** (:23711 §2): a stranger keeps `requirePrivilege`'s 404
 *  and learns nothing about who belongs to this gym. Reversed, anybody holding
 *  two uuids could probe a gym's roster. */
export async function sendOrgCheer(
  deps: OrgsDeps,
  actorUserId: string,
  gymId: string,
  targetUserId: string,
  input: SendGymCheerRequest,
): Promise<SendGymCheerResponse> {
  const { org } = await requireWritablePrivilege(deps, gymId, actorUserId, "members.read");

  const outcome = await repo.sendGymCheer(deps.sql, {
    gymId,
    userId: targetUserId,
    sentByUserId: actorUserId,
    preset: input.preset,
  });

  switch (outcome.kind) {
    case "not_found":
      // ONE SENTENCE FOR "no such person" AND "not your member" (R3.2). The
      // caller is authorised for THIS gym, so the only thing this hides is
      // whether a uuid they already hold belongs to somebody else's roster.
      throw new OrgsError(404, "member_not_found", `That person isn't a ${orgWords(org.orgType).person} of this ${orgWords(org.orgType).it}.`);
    case "too_soon":
      // **THE INSTANT IS DELIBERATELY NOT ON THE ERROR, and the reason is scope
      // rather than taste.** `OrgsError` carries a status, a code and a
      // sentence, and sixteen doors share it; widening it for one rare path is
      // R1.1's drive-by. The screen does not need it either: `cheerableAt`
      // already rides on the overview payload, so a refused send is answered by
      // re-reading the list the button lives in — which is what a stale page
      // needs anyway.
      //
      // **THIS IS ONLY REACHABLE FROM A STALE OR RACING SCREEN**, because the
      // button is drawn dead whenever `cheerableAt` is set. It is the server
      // keeping the last word, not the ordinary path (:24141 §3a).
      //
      // **THE SENTENCE SAYS WHAT HAPPENED, NOT WHO DID IT.** The cap is per
      // GYM — the query filters on `gym_id` and `user_id` and nothing else — so
      // "You've already cheered" is FALSE for the second staffer on the desk,
      // who is told they did something a colleague did.
      //
      // **"today" IS THE GYM'S DAY, and it is now literally true** (Kd's
      // :35762, one per member per gym-day). Under the old rolling seven this
      // sentence had to name a span — "in the last 7 days" — and an earlier
      // draft saying "this week" was wrong because a rolling window is not a
      // calendar one. **The rule moved to the calendar, so the plainest word is
      // also the accurate one**, which is the rare direction for this kind of
      // change.
      throw new OrgsError(
        409,
        "cheer_already_sent",
        `This ${orgWords(org.orgType).person} has already been cheered today.`,
      );
    case "sent":
      return sendGymCheerResponseSchema.parse({
        cheer: { preset: outcome.preset, sentAt: outcome.sentAt.toISOString() },
      });
    default:
      return assertNever(outcome);
  }
}

/** A GYM ASKS SOMEBODY TO COME BACK — Part 3 §4.1's one-tap nudge, and the
 *  SEVENTEENTH write door in this module.
 *
 *  **IT IS BEHIND `requireWritablePrivilege`, WHICH IS A DECISION AND NOT A
 *  DEFAULT.** :22215 is Kd's ruling that a gym without a live plan gets nothing,
 *  and :23711 built it as twelve doors that now number seventeen — so a lapsed
 *  gym and an archived gym are refused here by gates that already existed, with
 *  no new refusal vocabulary invented (:26812's phrasing). A nudge is a gym
 *  acting on its members; a gym that has stopped paying stops acting.
 *
 *  **THE GATE IS `members.read` AND NOT A TENTH PRIVILEGE — the same call
 *  `sendOrgCheer` made, and here it is not even a chat's call**: Part 3 §2.2
 *  grants *Send "we miss you" nudge* to all three roles by name, which is exactly
 *  the set holding `members.read`. **What it costs: an owner cannot stop one
 *  staffer nudging without also taking away their roster.** Minting
 *  `members.nudge` is a migration in this repo rather than a list edit
 *  (:28107) — DDL CHECK, backfill, role templates, a tick box and two "newest"
 *  fixtures. Reversible in one line if Kd wants it.
 *
 *  **THE PRIVILEGE IS CHECKED BEFORE THE MEMBERSHIP, and the order is an
 *  information boundary** (:23711 §2): a stranger keeps `requirePrivilege`'s 404
 *  and learns nothing about who belongs to this gym. Reversed, anybody holding
 *  two uuids could probe a gym's roster. */
export async function sendOrgNudge(
  deps: OrgsDeps,
  actorUserId: string,
  gymId: string,
  targetUserId: string,
  input: SendGymNudgeRequest,
): Promise<SendGymNudgeResponse> {
  const { org } = await requireWritablePrivilege(deps, gymId, actorUserId, "members.read");

  const outcome = await repo.sendGymNudge(deps.sql, {
    gymId,
    userId: targetUserId,
    sentByUserId: actorUserId,
    preset: input.preset,
  });

  switch (outcome.kind) {
    case "not_found":
      // ONE SENTENCE FOR "no such person" AND "not your member" (R3.2), and the
      // same words `sendOrgCheer` uses — deliberately, because two doors that
      // refuse the same condition differently tell an attacker which door they
      // are at.
      throw new OrgsError(404, "member_not_found", `That person isn't a ${orgWords(org.orgType).person} of this ${orgWords(org.orgType).it}.`);
    case "too_soon":
      // **THE INSTANT IS DELIBERATELY NOT ON THE ERROR**, for `sendOrgCheer`'s
      // recorded reason: `OrgsError` carries a status, a code and a sentence,
      // seventeen doors share it, and widening it for one rare path is R1.1's
      // drive-by (:34443 L-3 struck exactly that from the cheer). `nudgeableAt`
      // rides on the overview payload, so a refused send is answered by
      // re-reading the list the button lives in — which a stale page needs
      // anyway.
      //
      // **THIS IS ONLY REACHABLE FROM A STALE OR RACING SCREEN**, because the
      // button is drawn dead whenever `nudgeableAt` is set (:24141 §3a).
      //
      // **THE SENTENCE SAYS WHAT HAPPENED, NOT WHO DID IT.** The cap is per
      // GYM — the query filters on `gym_id` and `user_id` and nothing else — so
      // "You've already nudged" would be FALSE for the second staffer on the
      // desk, who would be told they did something a colleague did.
      //
      // **AND IT NAMES A SPAN RATHER THAN A DAY, WHICH IS THE OPPOSITE OF THE
      // CHEER'S SENTENCE AND IS CORRECT FOR THE OPPOSITE REASON.** The cheer's
      // cap became a CALENDAR gym-day (:35762), so "today" is literally true
      // there. This cap is Part 3 §4.1's ROLLING seven days, so there is no
      // "this week" to name — a message sent last Friday frees up next Friday,
      // not on Monday. Saying "this week" here would be the error :35762's own
      // trigger warns about, read in the other direction.
      throw new OrgsError(
        409,
        "nudge_already_sent",
        `This ${orgWords(org.orgType).person} has already been sent a message in the last 7 days.`,
      );
    case "sent":
      return sendGymNudgeResponseSchema.parse({
        nudge: { preset: outcome.preset, sentAt: outcome.sentAt.toISOString() },
      });
    default:
      return assertNever(outcome);
  }
}
