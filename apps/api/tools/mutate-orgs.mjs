/**
 * Mutation audit — the org slice: create, join by code, roster.
 * Run from the repo root with DATABASE_URL set:
 *   `node apps/api/tools/mutate-orgs.mjs`
 *
 * WHY THESE GUARANTEES AND NOT OTHERS (:5857 rule 4a — the audit is scoped by
 * severity, and slow database mutants are spent only on Critical/High). This
 * card DOES change server behaviour, so database mutants are in scope, and
 * every row below sits in one of 4a's four columns:
 *   · OWNERSHIP — can another person see this roster (O4, O5, O10)
 *   · MONEY     — can the last seat be sold twice, or sold to the wrong count
 *                 (O1, O2, O3)
 *   · SAVES/SYNCS — is a membership created once, is a code's use counted once,
 *                 is the owner's own seat written, is the whole roster reachable
 *                 (O7, O8, O12, O14)
 *   · WHAT A USER SEES AND COULD BE FALSE — a code typed off a poster that is
 *                 refused, a member upgraded but still shown free limits, a
 *                 clinic joined without consent, an audit trail that lost an
 *                 event (O6, O9, O11, O13)
 *
 * O27–O35 are THE WAITING ROOM (Kd ruling 2026-08-19, DECISIONS :11072), and
 * they sit in the same four columns: the ruling itself inverted so typing a
 * code admits somebody (O27) · the seat cap and the code's uses, which now
 * move at CONFIRM rather than at the door (O28, O30, O35) · one gym's staff
 * deciding another gym's application, and a stranger reading the queue (O29,
 * O33) · a refusal that can be undone, and a deleted account still waiting
 * (O31, O32) · Kd's own owner-and-manager line (O34).
 *
 * Deliberately NOT mutated, per the same rule: wording of the refusal
 * messages, comments, the ported plan seed, and the slug's cosmetics.
 *
 * The class fixes are inherited, not relearned (:4855, :5199, :5748, :6277,
 * :9509): anchors that match nothing ABORT · a target outside TARGETS ABORTS ·
 * a run with no test tally ABORTS · an unmutated CONTROL must report GREEN
 * through this same path before any verdict is believed · restores are
 * sha256-verified after EVERY mutant · a RUNNER fault is not a RED and is
 * raised AFTER the restore · substrings are replaced through a utf8
 * read/write, never `sed -i` (CRLF, :4267).
 *
 * NO MUTANT IS EXPECTED ALIVE.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SUITE = 'test/orgs.routes.test.ts';

const TARGETS = {
  repo: { file: resolve(ROOT, 'apps/api/src/modules/orgs/repo.ts') },
  service: { file: resolve(ROOT, 'apps/api/src/modules/orgs/service.ts') },
  codes: { file: resolve(ROOT, 'apps/api/src/modules/orgs/codes.ts') },
  // The country→currency map is a CONTRACT, shared with the console's country
  // picker, so it lives in @app/shared and is mutated there. The api suite
  // imports the workspace source directly, so no build step sits in between.
  shared: { file: resolve(ROOT, 'packages/shared/src/orgs.ts') },
  // The DPDP Day-0 flow closes a leaving member's gym rows, and since the
  // waiting-room card it cancels their pending applications in the same
  // transaction. It lives in the USERS repo — R7.1 forbids the deletion
  // cascade calling into the orgs repo — so the guarantee is mutated where the
  // statement actually is. A target outside this map ABORTS the run (:5199),
  // which is exactly how a mutant pointed at the wrong file gets caught.
  users: { file: resolve(ROOT, 'apps/api/src/modules/users/repo.ts') },
};

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

const MUTANTS = [
  {
    id: 'O1',
    target: 'repo',
    why: 'MONEY: the org row is no longer locked, so two people scanning the same poster at the same instant both read the pre-insert seat count and both get the last seat',
    expect: 'sells the last seat exactly once',
    from: '      FROM gyms WHERE id = ${input.gymId} FOR UPDATE`;',
    to: '      FROM gyms WHERE id = ${input.gymId}`;',
  },
  {
    id: 'O2',
    target: 'repo',
    why: 'MONEY: the cap comparison goes off by one, so a full gym sells one seat more than the plan pays for',
    expect: 'enforces the plan',
    from: '      if (used >= cap) return { kind: "seat_cap", cap };',
    to: '      if (used > cap) return { kind: "seat_cap", cap };',
  },
  {
    id: 'O3',
    target: 'repo',
    why: "MONEY: the owner's complimentary seat starts consuming a paid one, so every gym is one seat short of what it bought",
    expect: 'enforces the plan',
    from: "        WHERE gym_id = ${input.org.id} AND removed_at IS NULL AND complimentary = false`;",
    to: '        WHERE gym_id = ${input.org.id} AND removed_at IS NULL`;',
  },
  {
    id: 'O4',
    target: 'service',
    why: 'OWNERSHIP: a caller who is not staff no longer gets the same answer as a stranger, which confirms the gym exists to anyone holding a uuid',
    expect: 'serves the roster to staff and hides it',
    from: '  if (org === null || role === null) {',
    to: '  if (org === null) {',
  },
  {
    id: 'O5',
    target: 'repo',
    why: "OWNERSHIP, the worst case on this card: the roster query stops being scoped to one gym, so a gym owner reads every other gym's members",
    expect: 'serves the roster to staff and hides it',
    from: '    WHERE m.gym_id = ${input.gymId}\n      AND m.removed_at IS NULL',
    to: '    WHERE (m.gym_id = ${input.gymId} OR true)\n      AND m.removed_at IS NULL',
  },
  {
    id: 'O6',
    target: 'service',
    why: "FALSE ON SCREEN: an existing member re-typing the code stops shaking loose a stale cache, so somebody whose gym started paying keeps seeing the free plan's limits for up to a minute",
    // RE-AIMED: this anchor is the APPLY path's already_member arm, and its old
    // filter named the test that now exercises the CONFIRM path instead — so it
    // came back ALIVE, correctly reporting that neither arm was covered by it.
    // O36 is the confirm arm; this row keeps the apply arm and points at the
    // test written for it.
    expect: 'busts a stale cache',
    from: '      await bustEntitlements(deps.redis, userId);',
    to: '      await Promise.resolve();',
  },
  {
    id: 'O7',
    target: 'repo',
    why: 'SAVES: the idempotent conflict handling goes, so a confirm for somebody who already holds a seat raises 23505, aborts the transaction and shows a server error instead of §4.2\'s idempotent success',
    // RE-POINTED, and this row is the one to read twice: it was **RED in the
    // first full sweep of this card and ALIVE in the second, with its anchor,
    // its mutation and the named test all UNCHANGED between them.** The named
    // test never reaches this line — a second Confirm is answered
    // `already_confirmed` from the application's own status before `claimSeat`
    // is called — so the earlier RED cannot have been caused by the guarantee.
    // The remaining explanation is a leftover live membership in the SHARED
    // test database making the FIRST insert conflict: :10182's C/H-3 exactly,
    // one card later, in a MUTANT rather than in a test. **A verdict nobody can
    // name a cause for is not evidence**, so it now points at the test that
    // genuinely drives the conflict — the one built to reach this branch.
    expect: 'ALREADY holds a seat',
    from: '    ON CONFLICT (gym_id, user_id) WHERE removed_at IS NULL DO NOTHING\n    RETURNING id, joined_at`;',
    to: '    RETURNING id, joined_at`;',
  },
  {
    id: 'O8',
    target: 'repo',
    why: "SAVES: a repeat join burns another of the code's uses, so a max_uses code retires early and the gym's poster stops working",
    // RE-POINTED TWICE, and the second time is the lesson: the double-CONFIRM
    // race never reaches `claimSeat`'s already-member branch at all — the loser
    // reads an application that is already `confirmed` and returns before it.
    // Only the test built to construct that state exercises this line.
    expect: 'ALREADY holds a seat',
    from: '    const existing = held ?? (await liveMembership(tx, input.org.id, input.userId));',
    to: '    await tx`UPDATE gym_codes SET uses = uses + 1 WHERE id = ${input.codeId}`;\n    const existing = held ?? (await liveMembership(tx, input.org.id, input.userId));',
  },
  {
    id: 'O9',
    target: 'repo',
    why: 'PRIVACY: a clinic membership is created without the consent record Part 3 §2.4 makes it depend on',
    expect: 'legacy clinic row still demands consent',
    from: '    if (org.orgType === "clinic" && !input.consent) return { kind: "consent_required" };',
    to: '    if (false && org.orgType === "clinic" && !input.consent) return { kind: "consent_required" };',
  },
  {
    id: 'O10',
    target: 'service',
    why: 'OWNERSHIP: the clinic/studio trainer hold-back goes, so a trainer reads every caseload in a clinic with no scoping built yet',
    expect: 'holds a studio trainer back',
    from: '  if (role === "trainer" && org.orgType !== "gym") {',
    to: '  if (role === "trainer" && org.orgType === "zzz_never") {',
  },
  {
    id: 'O11',
    target: 'codes',
    why: 'FALSE ON SCREEN: codes stop being normalised, so a code typed off a poster in lower case is answered "that code does not match any gym"',
    expect: 'typing a code APPLIES',
    from: '  return raw.trim().toUpperCase().replace(/[\\s-]/g, "");',
    to: '  return raw;',
  },
  {
    id: 'O12',
    target: 'repo',
    why: "SAVES: the owner's own membership is never written, so the owner cannot demo the app on their own phone and the roster is missing member #1",
    expect: 'creates the org, its first code',
    from: '      if (includeRows[0]?.owner_included_as_member === true) {',
    to: '      if (includeRows[0]?.owner_included_as_member === false) {',
  },
  {
    id: 'O13',
    target: 'repo',
    why: 'AUDIT: the org-created event is written under a different name, so the trail Part 3 §3.3 requires cannot answer who created this gym',
    expect: 'creates the org, its first code',
    from: '        action: "org.created",',
    to: '        action: "org.created.renamed",',
  },
  {
    id: 'O14',
    target: 'repo',
    why: 'SAVES: the roster page stops over-reading by one, so nextCursor is always null and a gym with more than one page shows only its first',
    expect: 'walks the roster by cursor',
    // ANCHORED ON THE ORDER BY TOO, and that is the finding rather than a
    // tidy-up: `LIMIT ${input.limit + 1}` now appears TWICE in this file (the
    // roster and the confirm queue), a string replace takes the FIRST match,
    // and the first match is the queue. So this mutant silently began driving
    // a surface its own name disowns — :11757 L2's shape, where index
    // selection made a case report on the wrong thing. It came back ALIVE,
    // which is the honest reading: neither query was covered by it.
    from: '    ORDER BY m.joined_at DESC, m.id DESC\n    LIMIT ${input.limit + 1}`;',
    to: '    ORDER BY m.joined_at DESC, m.id DESC\n    LIMIT ${input.limit}`;',
  },
  {
    id: 'O15',
    target: 'service',
    why: "MONEY / FALSE ON SCREEN: the currency stops following the gym's country and reverts to a default, so a US gym is set up in rupees — the exact thing Kd's 2026-08-18 ruling removed",
    expect: 'sets the currency from the gym',
    from: '  const currencyDisplay = currencyForCountry(req.country);',
    to: '  const currencyDisplay = "INR";',
  },
  {
    id: 'O16',
    target: 'shared',
    why: 'MONEY: an unsupported country gets a FALLBACK currency instead of an honest refusal, so a gym in Sydney is quoted in US dollars',
    expect: 'sets the currency from the gym',
    from: '  return parsed.success ? COUNTRY_CURRENCY[parsed.data] : null;',
    to: '  return parsed.success ? COUNTRY_CURRENCY[parsed.data] : "USD";',
  },
  // ---- T3 round 1 fixes. Each of these restores the defect the review found,
  // which is rule 3's requirement: a Critical/High fix ships with a test that
  // fails without it, and this is where that claim is MEASURED.
  {
    id: 'O17',
    target: 'repo',
    why: 'T3 C/H-1 RESTORED: the seat check runs for somebody who already holds a seat, so a full gym answers "no free places" to a member standing in it',
    // RE-POINTED for O8's reason: since the door became an application door the
    // seat-cap test's "rejoin while full" case is answered at APPLY and never
    // reaches this branch, so the guard it was written to protect had drifted
    // out from under it.
    expect: 'ALREADY holds a seat',
    from: '  if (held === null) {',
    to: '  if (true) {',
  },
  {
    id: 'O18',
    target: 'repo',
    why: "T3 C/H-2 RESTORED: the owner's silent membership is stamped with a consent record nobody collected",
    expect: 'creates the org, its first code',
    from: '          VALUES (${org.id}, ${input.ownerUserId}, ${codeRow.id}, NULL, true)`;',
    to: '          VALUES (${org.id}, ${input.ownerUserId}, ${codeRow.id}, now(), true)`;',
  },
  {
    id: 'O19',
    target: 'shared',
    why: "KD RULING RESTORED-AWAY: clinics can be created again, against his 2026-08-18 ruling that the product is gyms and fitness centres only",
    expect: 'refuses to create a clinic',
    from: 'export const createOrgTypeSchema = z.enum(["gym", "studio"]);',
    to: 'export const createOrgTypeSchema = z.enum(["gym", "studio", "clinic"]);',
  },
  {
    id: 'O20',
    target: 'shared',
    why: 'T3 L-3 RESTORED: any string is accepted as a time zone, so an org-day boundary is written from a name nothing can interpret later',
    expect: 'rejects a malformed or over-specified create body',
    from: '    timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, {\n      message: "not a known IANA time zone",\n    }),',
    to: '    timezone: z.string().trim().min(1).max(64),',
  },

  // ── The console card's read endpoint, GET /v1/orgs/:gymId/codes ──────────
  // A join code IS the key to a gym's roster: anybody holding one can join and
  // become a member. So every row here is OWNERSHIP or "on screen AND false",
  // which is what buys them a database mutant under :5857 rule 4a.
  {
    id: 'O21',
    target: 'repo',
    why: "OWNERSHIP: the code list loses its gym scoping, so one gym's console shows — and invites people with — another gym's join codes",
    expect: "join codes to staff",
    // RE-ANCHORED after the T3 L-1 fix added `LIMIT` to this query. The old
    // anchor ended at the closing backtick, so inserting a line before it made
    // this mutant match NOTHING — and the honest reading of a no-op mutation is
    // "this guarantee has no test", which would have sent the next chat hunting
    // a hole in the gym scoping that was never there. The whole-table anchor
    // check caught it before a byte was written (:5199's class fix, :8610's
    // fix-drifts-a-mutant-span shape).
    from: '    WHERE gym_id = ${gymId}\n    ORDER BY created_at ASC, code ASC\n    LIMIT ${ORG_CODES_LIMIT}`;',
    to: '    ORDER BY created_at ASC, code ASC\n    LIMIT ${ORG_CODES_LIMIT}`;',
  },
  {
    id: 'O22',
    target: 'service',
    why: 'OWNERSHIP: the staff check disappears, so a stranger holding the gym uuid — or a plain member — reads the code that lets anyone in',
    expect: "join codes to staff",
    from: '): Promise<OrgCodesResponse> {\n  await requirePrivilege(deps, gymId, userId, "codes.invite");\n  const rows = await repo.listCodes(deps.sql, gymId);',
    to: '): Promise<OrgCodesResponse> {\n  const rows = await repo.listCodes(deps.sql, gymId);',
  },
  {
    id: 'O23',
    target: 'repo',
    why: 'ON SCREEN AND FALSE: a paused code reads back as live, so the console tells an owner to share a code the join path will refuse',
    expect: "reports a code's live state honestly",
    from: '    paused: r.paused,',
    to: '    paused: false,',
  },
  {
    id: 'O24',
    target: 'service',
    why: '§2.2 MATRIX: a trainer loses Invite, which the matrix grants all three roles — the roster hold-back is about the member list, not the poster code',
    expect: 'gives a studio TRAINER the join codes',
    from: '): Promise<OrgCodesResponse> {\n  await requirePrivilege(deps, gymId, userId, "codes.invite");',
    to: '): Promise<OrgCodesResponse> {\n  await requirePrivilege(deps, gymId, userId, "members.confirm");',
  },

  // ── T3 round 1's API-side fixes, each restored so its regression test is
  //    MEASURED red rather than asserted to be (:5348 rule 3) ─────────────
  {
    id: 'O25',
    target: 'codes',
    suite: 'test/orgs.unit.test.ts',
    why: "L-2 RESTORED: a gym named \"New\" slugs to `new`, which the console's router already spends on the create form — its owner clicks their gym in the list and lands on a blank wizard, with no way in and no later repair, because the slug is minted once",
    expect: "never mints a slug the console's own router has already spent",
    from: '  return RESERVED_SLUGS.has(base) ? `${base}-gym` : base;',
    to: '  return base;',
  },
  {
    id: 'O26',
    target: 'repo',
    why: 'L-1 RESTORED: the codes list loses its bound, the one list in this module that had none while every sibling is capped',
    expect: 'bounds the codes list',
    from: '    ORDER BY created_at ASC, code ASC\n    LIMIT ${ORG_CODES_LIMIT}`;',
    to: '    ORDER BY created_at ASC, code ASC`;',
  },


  // ── THE WAITING ROOM (Kd ruling 2026-08-19, DECISIONS :11072) ────────────
  // Every row below is Critical/High under :5857 rule 4a — ownership, money,
  // or something a user would see that would be false. The ruling's whole
  // content is "a pending person consumes nothing and receives nothing", so
  // these attack exactly that.
  {
    id: 'O27',
    target: 'repo',
    why: 'THE RULING ITSELF, INVERTED: typing a code goes back to creating a MEMBERSHIP, so a stranger holding a leaked code is inside the gym before anybody has looked at them',
    expect: 'typing a code APPLIES',
    from: '    return { kind: "pending", org, application: toApplicationRow(newRow) };',
    to: '    await tx`INSERT INTO gym_members (gym_id, user_id, code_id, complimentary) VALUES (${org.id}, ${input.userId}, ${code.id}, false)`;\n    return { kind: "pending", org, application: toApplicationRow(newRow) };',
  },
  {
    id: 'O28',
    target: 'repo',
    why: 'MONEY: the seat cap stops being consulted at confirm, so a gym on a one-seat plan can be filled with any number of paying members',
    expect: 'enforces the plan',
    from: '    const cap = await seatCapFor(tx, input.org.id);',
    to: '    const cap = null;\n    void seatCapFor;',
  },
  {
    id: 'O29',
    target: 'repo',
    why: "OWNERSHIP, the worst case on this card: an application stops being scoped to its gym, so one gym's staff can confirm a person into ANOTHER gym holding nothing but a uuid",
    expect: 'decide another gym',
    from: '      WHERE id = ${input.applicationId} AND gym_id = ${input.gymId}\n      FOR UPDATE`;\n    const app = appRows[0];',
    to: '      WHERE id = ${input.applicationId}\n      FOR UPDATE`;\n    const app = appRows[0];',
  },
  {
    id: 'O30',
    target: 'repo',
    why: 'SAVES: a full gym DESTROYS the application instead of leaving it waiting, so the owner buys a seat and the person they were about to admit has vanished',
    expect: 'enforces the plan',
    from: '    if (claim.kind === "seat_cap") return { kind: "seat_cap", cap: claim.cap };',
    to: "    if (claim.kind === \"seat_cap\") {\n      await tx`UPDATE gym_join_applications SET status = 'rejected' WHERE id = ${app.id}`;\n      return { kind: \"seat_cap\", cap: claim.cap };\n    }",
  },
  {
    id: 'O31',
    target: 'repo',
    why: 'SAVES: a REJECTED application can still be confirmed afterwards, so "not this person" is undone by a second tap and the gym cannot actually refuse anybody',
    expect: 'not this person',
    from: '    if (status !== "pending") return { kind: "not_pending", status };\n\n    const orgRows = await tx<RawOrg[]>`',
    to: '    const orgRows = await tx<RawOrg[]>`',
  },
  {
    id: 'O32',
    target: 'users',
    why: "PRIVACY: a deleted account keeps waiting in the gym's queue, so their name is shown to a gym for a fortnight and one tap makes them a member of a gym they left the product to escape",
    expect: 'deleted account',
    from: "      UPDATE gym_join_applications\n      SET status = 'cancelled', decided_at = now()\n      WHERE user_id = ${userId} AND status = 'pending'`;",
    to: "      UPDATE gym_join_applications\n      SET decided_at = now()\n      WHERE user_id = ${userId} AND status = 'pending'`;",
  },
  {
    id: 'O33',
    target: 'service',
    why: 'OWNERSHIP: the privilege check on the confirm queue disappears, so a stranger holding the gym uuid reads the names of everyone waiting to join it',
    expect: 'confirm queue to staff',
    from: '  await requirePrivilege(deps, gymId, userId, "members.confirm");\n\n  // The queue\'s cursor is the application\'s OWN id',
    to: '  // The queue\'s cursor is the application\'s OWN id',
  },
  {
    id: 'O34',
    target: 'service',
    why: "KD'S RULING 2026-08-19: a trainer gains the power to confirm, which he reserved to owner and manager until an owner ticks it on for one named person",
    expect: 'holds a TRAINER back from confirming',
    from: '  trainer: ["members.read", "codes.invite"],',
    to: '  trainer: ["members.read", "codes.invite", "members.confirm"],',
  },
  {
    id: 'O35',
    target: 'repo',
    why: 'MONEY: applying burns one of the code\'s uses, so a stranger with a leaked code can exhaust a max_uses code and shut a real gym\'s poster down without ever getting in',
    expect: 'typing a code APPLIES',
    from: '    await insertAudit(tx, {\n      actorUserId: input.userId,\n      gymId: org.id,\n      action: "org.join_applied",',
    to: '    await tx`UPDATE gym_codes SET uses = uses + 1 WHERE id = ${code.id}`;\n    await insertAudit(tx, {\n      actorUserId: input.userId,\n      gymId: org.id,\n      action: "org.join_applied",',
  },

  // ── ADDED BY THIS CARD'S OWN AUDIT, after four mutants survived ─────────
  // Each of these three closes a guarantee that had a mutant aimed at the
  // wrong place, or no mutant at all. They are listed here rather than folded
  // into the rows above so the reason they exist stays legible.
  {
    id: 'O36',
    target: 'service',
    why: "FALSE ON SCREEN: the CONFIRM path stops busting the entitlement cache, so somebody just admitted to a gym that pays for Pro keeps seeing the free plan's limits for up to a minute — O6 was still aimed at the apply path and could not see this",
    expect: 'upgrades entitlements immediately',
    from: '      await bustEntitlements(deps.redis, outcome.applicantUserId);',
    to: '      await Promise.resolve();',
  },
  {
    id: 'O37',
    target: 'repo',
    why: "SAVES: the confirm queue stops over-reading by one, so nextCursor is always null and a gym with more than a page of people waiting only ever sees the first — the surface O14's anchor had silently drifted onto",
    expect: 'walks the confirm queue by cursor',
    from: '    ORDER BY a.applied_at ASC, a.id ASC\n    LIMIT ${input.limit + 1}`;',
    to: '    ORDER BY a.applied_at ASC, a.id ASC\n    LIMIT ${input.limit}`;',
  },
  {
    id: 'O38',
    target: 'repo',
    why: 'FALSE ON SCREEN: the queue count is taken from the PAGE instead of the whole queue, so a console with 90 people waiting prints "3 people waiting" — :10402\'s exact-or-a-bound rule, inverted',
    expect: 'walks the confirm queue by cursor',
    from: '    pendingCount: countRows[0]?.n ?? 0,',
    to: '    pendingCount: page.length,',
  },

  // ── T3 ROUND 1's Low fixes, each pinned (rule 3's discipline applied to
  // Lows: no Critical/High was found, so nothing OWED a failing-first test —
  // these exist so the fixes cannot be undone silently) ───────────────────
  {
    id: 'O39',
    target: 'repo',
    why: 'T3 L-2 RESTORED: a stale cursor blanks the confirm queue while the count still reports the true total — a console showing "3 people waiting" over an empty list',
    expect: 'walks the confirm queue by cursor',
    from: '        OR NOT EXISTS (\n          SELECT 1 FROM gym_join_applications c\n          WHERE c.id = ${cursorId}::uuid AND c.gym_id = ${input.gymId}\n        )\n',
    to: '',
  },
  {
    id: 'O40',
    target: 'service',
    why: 'T3 L-3 RESTORED: a second tap on "not this person" 409s where the first succeeded, while confirm stays idempotent — the asymmetry nobody designed',
    expect: 'not this person',
    from: '      if (outcome.status === "rejected") {\n        return rejectApplicationResponseSchema.parse({ status: "rejected" });\n      }\n',
    to: '',
  },
  {
    id: 'O41',
    target: 'users',
    why: 'T3 L-4 RESTORED: the DPDP cascade goes back to taking gym_members before the applications, putting a third writer on the opposite lock order to confirm',
    expect: 'deleted account',
    from: "    await tx`\n      UPDATE gym_join_applications\n      SET status = 'cancelled', decided_at = now()\n      WHERE user_id = ${userId} AND status = 'pending'`;",
    to: "    await tx`SELECT 1`;",
  },
];

/** ANCHORS ARE CONVERTED TO THE FILE'S OWN LINE ENDINGS, and the file is never
 *  normalised (:4267's class fix, as recorded at :10866).
 *
 *  Measured 2026-08-19: `modules/users/repo.ts` is CRLF while every orgs file
 *  is LF, so O32 — the DPDP guarantee — matched nothing and would have aborted
 *  a sweep it should have passed. That is the FIFTH occurrence of this class in
 *  this repo and the first in an api harness; porting the fix rather than
 *  re-learning it is the point of :5348 rule 5.
 *
 *  Converting the ANCHOR rather than the FILE is deliberate: normalising the
 *  file rewrites every line ending in it, so the mutated tree would differ from
 *  the original everywhere instead of only at the mutation — and a mutant is
 *  only evidence about the one line it changed. */
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const withEolOf = (snippet, text) =>
  snippet.replace(/\r\n/g, '\n').replace(/\n/g, eolOf(text));

const abort = (msg) => {
  console.error(`\nABORT — ${msg}`);
  process.exit(2);
};

if (!process.env.DATABASE_URL) {
  abort('DATABASE_URL is not set. The suite would SKIP and every mutant would report ALIVE for the wrong reason.');
}

/** `MUTATE_ONLY=O6,O14` runs a SUBSET — the web harness has had this since
 *  :4855 F6 and this one did not, which is why every fix round here cost a
 *  full 35-mutant sweep against a database in another country.
 *
 *  **An unknown label is FATAL, never a silent empty run** (:4855's own
 *  requirement): a typo would otherwise "pass" by mutating nothing at all,
 *  which is the fourth-time-lucky shape this repo keeps recording. A subset
 *  run is NOT a full sweep and says so in its own summary, so a partial figure
 *  cannot be quoted as a complete one. */
const onlyRaw = process.env.MUTATE_ONLY;
const only = onlyRaw === undefined || onlyRaw.trim() === ''
  ? null
  : new Set(onlyRaw.split(',').map((s) => s.trim()).filter((s) => s !== ''));
if (only !== null) {
  const known = new Set(MUTANTS.map((m) => m.id));
  const unknown = [...only].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    abort(`MUTATE_ONLY names ${unknown.join(', ')}, which are not in the table. Nothing has been run.`);
  }
}
const SELECTED = only === null ? MUTANTS : MUTANTS.filter((m) => only.has(m.id));

// Checked for the WHOLE table before a byte is written (:5199). Runs over
// MUTANTS, not SELECTED: a subset run still proves the whole table is sane.
for (const m of MUTANTS) {
  if (!Object.hasOwn(TARGETS, m.target)) {
    abort(`${m.id}: names target '${m.target}', which is not in TARGETS. Nothing has been written yet.`);
  }
}

const originals = new Map(
  Object.entries(TARGETS).map(([k, t]) => [k, { sha: sha(t.file), text: readFileSync(t.file, 'utf8') }]),
);

// Every anchor is proven to match BEFORE the first run, so a drifted anchor
// costs seconds rather than being discovered twenty minutes in.
for (const m of MUTANTS) {
  const original = originals.get(m.target);
  if (!original.text.includes(withEolOf(m.from, original.text))) {
    abort(`${m.id}: its anchor matched nothing in ${m.target}. A no-op mutation reports as a missing test. Re-anchor it against the current file.`);
  }
}

const STRIP_ANSI = new RegExp(String.fromCharCode(27) + String.raw`\[[0-9;]*m`, 'g');
const tallied = (out) => {
  const clean = out.replace(STRIP_ANSI, '');
  return /Tests\s+(?:\d+ failed \| )?\d+ (?:passed|failed)/.test(clean) && !/No test files found/.test(clean);
};

const run = (nameFilter, suite = SUITE) => {
  let out = '';
  try {
    out = execSync(
      `corepack pnpm --filter api exec vitest run ${suite} -t ${JSON.stringify(nameFilter)}`,
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
    return { out, failed: false, fault: null };
  } catch (e) {
    if (typeof e.status === 'number' && e.status !== 0) {
      return { out: `${e.stdout || ''}${e.stderr || ''}`, failed: true, fault: null };
    }
    return { out: '', failed: false, fault: `${e.code || ''} ${e.message}` };
  }
};

// THE CONTROL (:9509): an UNMUTATED run of every filter this sweep will use,
// through the same command, must report GREEN and must produce a tally. A
// filter that matches no test would otherwise make its mutant look ALIVE, and
// a suite that cannot start would make every mutant look RED.
console.log('control (unmutated) — every filter must be GREEN and must tally ...');
// Deduped as OBJECTS, not by joining a string and splitting it: every filter
// here contains spaces, so a split would run the control on the first WORD of
// each -- a broader filter than the mutants use, i.e. the control quietly
// checking something else. (Caught in the web harness before it ever ran.)
const controlPairs = [];
const seenControl = new Set();
for (const m of SELECTED) {
  const suite = m.suite ?? SUITE;
  const key = `${suite} :: ${m.expect}`;
  if (seenControl.has(key)) continue;
  seenControl.add(key);
  controlPairs.push({ suite, filter: m.expect });
}
for (const { suite, filter } of controlPairs) {
  const { out, failed, fault } = run(filter, suite);
  if (fault !== null) abort(`control for ${JSON.stringify(filter)}: the RUNNER failed — ${fault}`);
  if (!tallied(out)) abort(`control for ${JSON.stringify(filter)}: no test tally. That filter matches no test, so its mutants would prove nothing.`);
  if (failed) abort(`control for ${JSON.stringify(filter)}: RED before any mutation. Every verdict below would be meaningless.`);
  console.log(`  control GREEN  ${filter}`);
}
console.log('control complete\n');

const results = [];
for (const m of SELECTED) {
  const target = TARGETS[m.target];
  const original = originals.get(m.target);
  const mutated = original.text.replace(
    withEolOf(m.from, original.text),
    withEolOf(m.to, original.text),
  );
  if (mutated === original.text) {
    abort(`${m.id}: its anchor matched nothing at apply time. Re-anchor it against the current file.`);
  }
  writeFileSync(target.file, mutated);

  const { out, failed, fault } = run(m.expect, m.suite ?? SUITE);

  // Restore FIRST, always (:5199).
  writeFileSync(target.file, original.text);
  if (fault !== null) {
    if (sha(target.file) !== original.sha) abort(`${m.id}: the runner failed AND the restore did not reproduce the original bytes — fix the tree by hand.`);
    abort(`${m.id}: the RUNNER itself failed, which is NOT a test result — ${fault}`);
  }
  if (sha(target.file) !== original.sha) {
    abort(`${m.id}: the restore did NOT reproduce the original bytes. The working tree is dirty — fix it before running anything else.`);
  }
  if (!tallied(out)) abort(`${m.id}: the run produced no test tally, so it proves nothing.`);

  const verdict = failed ? 'RED' : 'ALIVE';
  results.push({ ...m, verdict, ok: verdict === 'RED' });
  console.log(`${m.id.padEnd(4)} ${verdict.padEnd(5)} ${verdict === 'RED' ? 'as expected' : 'UNEXPECTED'}  ${m.why}`);
}

const bad = results.filter((r) => !r.ok);
console.log('\n--- summary ---');
// A SUBSET RUN SAYS SO, IN THE LINE A LATER CHAT WILL COPY INTO A COMMIT
// MESSAGE. Otherwise "12 mutants · 12 RED" reads as a complete sweep, which is
// this repo's most-recorded failure shape wearing a new hat.
if (only !== null) {
  console.log(
    `SUBSET RUN (MUTATE_ONLY=${[...only].join(',')}) — ${String(results.length)} of ` +
    `${String(MUTANTS.length)} mutants. THIS IS NOT A FULL SWEEP; do not quote it as one.`,
  );
}
console.log(
  `${results.length} mutants · ${results.filter((r) => r.verdict === 'RED').length} RED · ` +
  `${results.filter((r) => r.verdict === 'ALIVE').length} ALIVE (0 expected) · 0 never ran`,
);
console.log('restore verified byte-exact (sha256) after every mutant');
if (bad.length) {
  console.error(`\n${bad.length} mutant(s) survived: ${bad.map((b) => b.id).join(', ')}`);
  process.exit(1);
}
console.log('every mutant matched its expectation');
