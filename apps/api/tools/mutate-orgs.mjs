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
  // THE WAITING ROOM'S CLOCK (:11385, step 3). Its own file and its own suite
  // — `test/orgs.sweep.test.ts` — because the guarantees are about TIME and
  // every one of them needs the injected clock the routes suite never touches.
  // Rows aimed here carry `suite: SWEEP_SUITE`.
  sweep: { file: resolve(ROOT, 'apps/api/src/modules/orgs/sweep.ts') },
  // TRIALS ACTUALLY END (Kd ruling :22215 step 1). Its own file and its own
  // suite for the same reason the clock has one: every guarantee here is about
  // TIME and needs the injected clock the routes suite never touches. It also
  // sits in rule 4a's MONEY column without argument — until this file existed a
  // gym's members kept gym-tier entitlements free for ever, and what these rows
  // break is the thing that stops that. Rows aimed here carry
  // `suite: TRIAL_SWEEP_SUITE`.
  trialSweep: { file: resolve(ROOT, 'apps/api/src/modules/orgs/trialSweep.ts') },
  // A GYM WITH NO PLAN IS CLOSED FOUR MONTHS LATER (Kd ruling 2026-08-31,
  // replacing Part 3 §4.2's fourteen days). Its own file and its own suite for
  // the reason both sweeps above have one: every guarantee here is about TIME
  // and needs the injected clock the routes suite never touches. It sits in rule
  // 4a's expensive columns without argument — the worst thing in its blast
  // radius is closing a gym that is PAYING, and closing a gym is the most
  // damaging single thing any row in `gyms` can say. Rows aimed here carry
  // `suite: ARCHIVE_SWEEP_SUITE`.
  archiveSweep: { file: resolve(ROOT, 'apps/api/src/modules/orgs/archiveSweep.ts') },
  // THE PRICE BOOK. It is not in `modules/orgs`, but it is where a gym's price
  // AND its member limit actually come from — `seatCapFor` reads
  // `plans.seat_cap` through the gym's live subscription, so the same number
  // this file writes is the one the seat door enforces. That puts it squarely
  // in :5857 rule 4a's MONEY and "numbers a user sees" columns, which is what
  // buys these rows a slow database mutant. Its guarantees live in the
  // migration suite, so every row aimed here carries `suite: SEED_SUITE`.
  seed: { file: resolve(ROOT, 'apps/api/src/db/seed.ts') },
};

/** The clock's guarantees live in their own suite. Every row that names the
 *  `sweep` target must also name this, or it runs the routes suite, finds
 *  nothing to break, and reports a RED that has nothing to do with the mutation
 *  — the "red for the wrong reason" shape recorded at :4718 F2. */
const SWEEP_SUITE = 'test/orgs.sweep.test.ts';

/** The trial expiry's guarantees live in their own suite, for the same reason
 *  and with the same failure mode: a `trialSweep` row that forgot this would run
 *  the routes suite, which never moves a clock, and report a RED that has
 *  nothing to do with the mutation (:4718 F2). */
const TRIAL_SWEEP_SUITE = 'test/orgs.trialSweep.test.ts';

/** The archive sweep's guarantees live in their own suite, for the same reason
 *  and with the same failure mode as the two above: a row that forgot this would
 *  run the routes suite, which never moves a clock four months, and report a RED
 *  that has nothing to do with the mutation (:4718 F2). The one archive row that
 *  does NOT name it is O174, which is aimed at the console write gate in
 *  `service.ts` and is therefore genuinely the routes suite's. */
const ARCHIVE_SWEEP_SUITE = 'test/orgs.archiveSweep.test.ts';

/** The price list and the trial-arm selector have their own suite, for the same
 *  reason and with the same failure mode as the two above: a row that forgot
 *  this would run the routes suite, which asserts no price and reads no
 *  `ownerTrialUsed`, and report a RED that has nothing to do with the mutation
 *  (:4718 F2). */
const PLANS_SUITE = 'test/orgs.plans.test.ts';

/** The price book's guarantees live in the migration suite, for the same reason
 *  the clock's live in the sweep suite: that is the only file that seeds and
 *  then READS BACK. A `seed` row that forgot this would run the routes suite,
 *  which never asserts a price, and report a RED that means nothing (:4718 F2). */
const SEED_SUITE = 'test/db.migration.test.ts';

/** OPENING HOURS (Kd 2026-08-31). Its own suite because its guarantees need
 *  fixtures the routes suite has none of — a gym at UTC+14 whose "today" is a
 *  different date from the server's, and repo calls made DIRECTLY, since the
 *  service always hands the repo the gym id it just authorised and a mismatched
 *  pair is unreachable from any route. Rows aimed at it carry
 *  `suite: HOURS_SUITE`. */
const HOURS_SUITE = 'test/orgs.hours.test.ts';
/** Written ONCE and referenced everywhere, because it is used in two different
 *  KINDS of place: as the `expect` filter on seven mutants, and as the filter
 *  the post-sweep database repair runs. Renaming the test would break the seven
 *  loudly (the control aborts on a filter that matches nothing) and could break
 *  the repair SILENTLY in the same edit — the repair's failure mode is an abort
 *  saying "no test tally", which reads as a broken harness rather than as a
 *  stale string. T3 round-1 Low. */
const SEED_FILTER = 'matches the ruled price book';

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
    // BOTH HALVES MOVED, and the second half is the interesting one (:11846 —
    // an anchor says what breaks, a FILTER says what should notice).
    // RE-ANCHORED 2026-08-22: the C/H-1 fix added the staff exclusion to this
    // count and aliased the table, so the old one-line anchor matched nothing —
    // caught by the whole-table pre-check ABORTING rather than by care
    // (:5199/:8610's class, :10726's guard).
    // RE-FILTERED the same day, and only because it SURVIVED: with the staff
    // exclusion in place the owner — the product's only complimentary member —
    // is excluded twice over, so deleting this clause changed nothing the old
    // test could see. The guarantee is unchanged and still §4.2's own wording;
    // what it needed was a case where the two exclusions do not overlap.
    expect: 'COMPLIMENTARY member who is not staff',
    from: "          AND m.complimentary = false\n",
    to: '\n',
  },
  {
    id: 'O4',
    target: 'service',
    why: 'OWNERSHIP: a caller who is not staff no longer gets the same answer as a stranger, which confirms the gym exists to anyone holding a uuid',
    expect: 'serves the roster to staff and hides it',
    // RE-ANCHORED 2026-08-22 by the ticks card: `requirePrivilege` now reads a
    // whole AUTHORITY (role + stored ticks) in one query, so the null check
    // renamed. The GUARANTEE is untouched — a caller who is not staff of this
    // gym must get the stranger's 404 — and the whole-table pre-check is what
    // caught the drift, before a byte ran (:5199's class, sixth time on this
    // branch that a fix of mine moved an anchor).
    from: '  if (org === null || authority === null) {',
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
    // RE-ANCHORED 2026-08-27, and NOT allow-listed: the trial card added a
    // SECOND `await bustEntitlements(deps.redis, userId);` at six-space indent,
    // so the one-line anchor started matching twice and the whole-table
    // pre-check ABORTED before a byte was written (:15260 L-2's guard, working).
    // Widened to include the `already_member` case label above it, which is
    // unique to the apply path — a mutant is a claim about ONE call site
    // (:15770), so re-aiming it at whichever line came first would have been the
    // wrong fix. The trial site gets its OWN row, O133.
    expect: 'busts a stale cache',
    from: '    case "already_member": {\n      await bustEntitlements(deps.redis, userId);',
    to: '    case "already_member": {\n      await Promise.resolve();',
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
    // RE-ANCHORED 2026-08-26 and its REACH WIDENED. The gym-details card lifted
    // this line out of `createOrg` into a shared `resolveCurrency`, so the
    // whole-table pre-check aborted before a byte was written — the guard
    // paying for itself again. The guarantee did not move, but ONE line now
    // carries it for BOTH doors (create and edit), which is :13803's shape.
    //
    // The function signature is part of the anchor deliberately: O117 mutates
    // the very next line of the same function, and two anchors that overlap on
    // one line is how a mutant hits the right site only BY POSITION (:14493).
    from: 'function resolveCurrency(country: string): string {\n  const currencyDisplay = currencyForCountry(country);',
    to: 'function resolveCurrency(country: string): string {\n  const currencyDisplay = "INR";',
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
    why: 'T3 L-3 RESTORED: any string is accepted as a time zone at CREATE, so an org-day boundary is written from a name nothing can interpret later',
    expect: 'rejects a malformed or over-specified create body',
    // RE-ANCHORED 2026-08-26, on the `locale` line that follows it in the CREATE
    // schema alone. The gym-details card gave the EDIT schema the identical
    // three lines, so this anchor started matching TWICE and the uniqueness
    // pre-check (:15259 L-2) aborted the sweep before a byte was written — the
    // second time that guard has paid for itself on this card.
    from: '    timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, {\n      message: "not a known IANA time zone",\n    }),\n    locale: z',
    to: '    timezone: z.string().trim().min(1).max(64),\n    locale: z',
  },
  {
    // O20'S SIBLING, and it exists because a mutant is a claim about ONE CALL
    // SITE (:15770, :14840's own finding about its guard's filter). The edit
    // door repeats the create door's timezone proof, so re-aiming O20 at the
    // new copy would have left whichever one it stopped naming unguarded — and
    // "a control that LOOKS covered because a mutant was written for its
    // sibling" is :14174 L-1 verbatim.
    // RE-ANCHORED 2026-09-01 by the clock ruling, which added `clockFormat` to
    // this schema between the timezone field and `.partial()`, so the anchor's
    // trailing two lines no longer followed it. **THE PRE-CHECK ABORTED THE
    // WHOLE SWEEP BEFORE A BYTE WAS WRITTEN** — :5199's class doing its job, and
    // the reason it exists. Shortened to the timezone field ALONE, which is what
    // this row is actually about: the two trailing lines only ever made it
    // fragile to anything appended nearby (:15770 — name the statement, not its
    // neighbourhood). **THE SHORTENED VERSION THEN MATCHED TWICE** — the CREATE
    // schema carries the identical timezone field — so it now reaches one line
    // into the `clockFormat` comment that only the UPDATE schema has. That is
    // the honest minimum: this row is about the EDIT door, and an anchor that
    // cannot tell the two doors apart would mutate whichever came first.
    //
    // **AND THEN T3 ROUND 1 ON THE WEB HALF FOUND WHAT THAT COST: the anchor had
    // become hostage to a COMMENT.** It reached into the prose of the field
    // BELOW it (`Sent on its own by the …`), which is about the clock switch and
    // has nothing to do with time zones — so rewording a sentence about one
    // subject would abort a sweep about another. The abort is the safe failure,
    // but a tripwire in the wrong room is still in the wrong room.
    // **It now stops at the comment's OPENING MARKER.** What disambiguates the
    // two doors is structural and no longer verbal: the EDIT door's timezone is
    // followed by a documented field, the CREATE door's by `locale: z` — which
    // is the same shape O20 above uses, and what O20 has always relied on. The
    // prose inside that comment can now be rewritten freely. What would still
    // move it is deleting that comment or reordering the fields, and both are
    // changes that SHOULD send somebody back to this anchor.
    id: 'O122',
    target: 'shared',
    why: 'ANY STRING IS ACCEPTED AS A TIME ZONE ON THE EDIT DOOR, so a gym that corrects its details writes a day boundary nothing can interpret — the permanent, invisible corruption trap #8 names, arriving through the route built to FIX a wrong zone',
    expect: 'refuses a time zone that is not a real one',
    from: '    timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, {\n      message: "not a known IANA time zone",\n    }),\n    /**',
    to: '    timezone: z.string().trim().min(1).max(64),\n    /**',
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
    // RE-ANCHORED AGAIN 2026-08-21: the count of people in through a code turned
    // this query into an aliased one (`FROM gym_codes c`), so both the table
    // alias and the new `removed_at` clause moved the span. Same class of drift,
    // caught by the same whole-table check before a byte was written.
    from: '    WHERE c.gym_id = ${gymId} AND c.removed_at IS NULL\n    ORDER BY c.created_at ASC, c.code ASC',
    to: '    WHERE c.removed_at IS NULL\n    ORDER BY c.created_at ASC, c.code ASC',
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
    // RE-ANCHORED 2026-08-21 by the code-management card, and the whole-table
    // pre-check ABORTED the sweep rather than reporting a false ALIVE — which
    // is the guard working (:11846's class, caught for the sixth time).
    //
    // **ITS REACH WIDENED AND THAT IS SAID RATHER THAN GLOSSED.** It used to
    // mutate `listCodes`'s own inline mapper, so it was evidence about the READ
    // alone. `listCodes` and the three new writers now share `toCodeRow`, so
    // this one line carries the guarantee for all four — a broader mutant, and
    // a truer one, because there is no longer a second spelling of it that
    // could drift.
    why: 'ON SCREEN AND FALSE: a paused code reads back as live, so the console tells an owner to share a code the join path will refuse',
    expect: "reports a code's live state honestly",
    from: '    paused: raw.paused,',
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
    // RE-ANCHORED 2026-08-21 with O21, for the same reason: the count subquery
    // aliased this query's table, so `created_at` became `c.created_at`.
    from: '    ORDER BY c.created_at ASC, c.code ASC\n    LIMIT ${ORG_CODES_LIMIT}`;',
    to: '    ORDER BY c.created_at ASC, c.code ASC`;',
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
    // **RE-AIMED 2026-08-30, by this card's own diff** — the held-request card
    // gave both waiting arms an `orgCanConfirm`, so the one-line return became a
    // multi-line object and this anchor stopped matching. :23128's standing rule
    // yet again: a fix moves anchors nothing in its diff mentions. Same call
    // site, same insertion point, and the mutant still says exactly what it said.
    expect: 'typing a code APPLIES',
    from: '    return {\n      kind: "pending",',
    to: '    await tx`INSERT INTO gym_members (gym_id, user_id, code_id, complimentary) VALUES (${org.id}, ${input.userId}, ${code.id}, false)`;\n    return {\n      kind: "pending",',
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
    // RE-ANCHORED 2026-08-23 (target only; the mutation is byte-identical).
    // `ROLE_PRIVILEGES` moved to `@app/shared` with the Staff SCREEN card, for
    // the reason the country→currency map above is there: the console has to
    // draw the role's template when a row arrives without a stored set, and a
    // table the web derives separately is a second answer to "what may a
    // trainer do". Re-measured RED after the move — a re-aimed mutant is an
    // unproven one (:8610).
    target: 'shared',
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

  // ── REMOVING A MEMBER (Kd ruling 2026-08-19, Part 3 §4.3) ───────────────
  //
  // Every row here is Critical/High under 4a, which is what buys them a
  // database mutant each: one is OWNERSHIP (another gym's staff ending your
  // membership), one is DATA LOSS (history deleted rather than closed), one is
  // MONEY-adjacent (the gym's paid perks outliving the membership), and two are
  // the irreversible-tap the whole feature exists to make reversible.
  {
    id: 'O42',
    target: 'repo',
    why: "OWNERSHIP: the removal stops being scoped to the gym, so one gym's owner removing their own member closes that person's membership of EVERY other gym too — invisible to both of them",
    expect: 'leaves their membership of another gym alone',
    from: "      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId} AND removed_at IS NULL\n      RETURNING id",
    to: "      WHERE user_id = ${input.userId} AND removed_at IS NULL\n      RETURNING id",
  },
  {
    id: 'O43',
    target: 'repo',
    why: "DATA LOSS: the membership row is DELETED instead of closed, so the gym's own record of who trained there in that period is silently rewritten — and §2.1's membership interval, which every org-side reader is scoped by, loses its end date",
    expect: 'the row is CLOSED not deleted',
    from: "      UPDATE gym_members SET removed_at = now()",
    to: "      DELETE FROM gym_members",
  },
  {
    id: 'O44',
    target: 'service',
    why: "KD'S OWN RULE INVERTED: the entitlement cache is not busted on removal, so a removed member keeps the gym's paid limits until the cache ages out — the database says free and the app does not",
    expect: 'PERKS AWAY IMMEDIATELY',
    from: "    case \"removed\":\n    case \"already_removed\":\n      await bustEntitlements(deps.redis, targetUserId);",
    to: "    case \"removed\":\n    case \"already_removed\":",
  },
  {
    id: 'O45',
    target: 'repo',
    why: "IRREVERSIBLE TAP: the staff guard goes, so one press beside their own name closes the OWNER'S own §4.0-step-6 seat — with no restore built and no staff screen to undo it from",
    expect: 'refuses to remove STAFF',
    from: "    if (staff !== undefined) return { kind: \"is_staff\", role: toOrgRole(staff.role) };",
    to: "    if (staff !== undefined && false) return { kind: \"is_staff\", role: toOrgRole(staff.role) };",
  },
  {
    id: 'O46',
    // RE-ANCHORED 2026-08-23 with O34 and for the same reason — see there.
    target: 'shared',
    why: "§2.2's remove/restore row widened to trainers, so anybody on staff can end a membership — the same power as confirm, which Kd explicitly held at owner and manager",
    expect: 'a trainer gets 403, another gym',
    from: '  trainer: ["members.read", "codes.invite"],',
    to: '  trainer: ["members.read", "codes.invite", "members.remove"],',
  },
  {
    id: 'O47',
    target: 'repo',
    why: 'A REMOVED PERSON CANNOT COME BACK: a closed membership still reads as a live one, so re-applying answers "you are already a member" and the front desk can never put a mis-tap right — the removal becomes a permanent ban',
    expect: 'can apply again and be confirmed back in',
    from: "    WHERE m.gym_id = ${gymId} AND m.user_id = ${userId} AND m.removed_at IS NULL`;",
    to: "    WHERE m.gym_id = ${gymId} AND m.user_id = ${userId}`;",
  },

  // ── O48–O55: THE WAITING ROOM'S CLOCK (:11385, step 3) ───────────────────
  //
  // Every row sits in 4a's columns. **DATA LOSS is the dominant one here and it
  // is new to this module**: this is the first code in the product that ENDS
  // somebody's join request without a person deciding to, so the guarantees
  // worth a slow database mutant are the ones that stop it ending the wrong
  // request, or ending one nobody was warned about. The nudge rows are
  // OWNERSHIP (whose application can you touch) and A NUMBER A USER SEES
  // (how often the front desk is told somebody asked again).
  {
    id: 'O48',
    target: 'sweep',
    suite: SWEEP_SUITE,
    why: "DATA LOSS + KD'S ORDERING RULE: the expiry stops asking whether the gym was ever flagged, so an application nobody was warned about is deleted — the exact 'we quietly threw your members away' outcome :11385 exists to forbid",
    // **RE-AIMED TWICE. The first re-anchor pointed at `IS NOT NULL` ALONE and
    // came back ALIVE — correctly.** Round 2's Low-1 left the notice comparison
    // as the only surviving condition, and `gym_notified_at <= now - notice` is
    // NULL for an unflagged row, which filters it out by itself. So deleting the
    // IS NOT NULL guard is a NO-OP, and a no-op that reports ALIVE says nothing
    // about coverage (:12878's own lesson — ask whether the guarantee is
    // OBSERVABLE before assuming a test is missing).
    // Aimed at BOTH conditions now, which is what actually carries "the gym must
    // have been told at least once": with the pair gone, an unflagged row past
    // its deadline is deleted having been warned about by nobody.
    from: "        AND gym_notified_at IS NOT NULL\n        AND gym_notified_at <= ${now}::timestamptz - (${EXPIRY_NOTICE_DAYS} * INTERVAL '1 day')",
    to: '        AND true',
    expect: 'does NOT expire an unchased application',
  },
  {
    id: 'O49',
    target: 'sweep',
    suite: SWEEP_SUITE,
    why: 'DATA LOSS: the notice test collapses to "flagged at all", so a worker that was down for the fortnight flags every request and deletes it in the same run — the gym told and given zero seconds to act',
    from: "        AND gym_notified_at <= ${now}::timestamptz - (${EXPIRY_NOTICE_DAYS} * INTERVAL '1 day')",
    to: "        AND gym_notified_at >= ${now}::timestamptz - (${EXPIRY_NOTICE_DAYS} * INTERVAL '1 day')",
    expect: 'does NOT expire in the same run that first chases the gym',
  },
  {
    id: 'O50',
    target: 'sweep',
    suite: SWEEP_SUITE,
    why: 'DATA LOSS: the deadline comparison flips, so requests are deleted BEFORE their fourteen days rather than after — a real member who applied yesterday loses their place',
    from: '        AND expires_at <= ${now}\n        AND gym_notified_at IS NOT NULL',
    to: '        AND expires_at > ${now}\n        AND gym_notified_at IS NOT NULL',
    expect: 'expires a chased application past its deadline',
  },
  {
    id: 'O51',
    target: 'sweep',
    suite: SWEEP_SUITE,
    why: "DATA LOSS: the expiry stops filtering on 'pending', so a CONFIRMED membership's application row is overwritten as expired — the audit trail says a member who is standing in the gym was thrown out by a machine",
    from: '      SET status = \'expired\'\n      WHERE status = \'pending\'',
    to: '      SET status = \'expired\'\n      WHERE status IS NOT NULL',
    // **THIS FILTER MATCHES BOTH `leaves a REJECTED…` AND `leaves a
    // CONFIRMED…`, deliberately.** O51 SURVIVED its first run against a single
    // test that rejected a FRESH application: a never-chased row is excluded by
    // `gym_notified_at IS NOT NULL` whatever its status, so the guarantee was
    // carried by a different guard and this filter proved nothing. Both tests
    // now chase the gym FIRST, which strips that shelter, and naming both means
    // the mutant is caught by the decided state that matters most (a confirmed
    // member) AND by the one a gym meets far more often (a refusal).
    // :11846's standing lesson — a mutant has two halves, the anchor and the
    // filter, and a fix must move both.
    expect: 'application alone',
  },
  {
    id: 'O52',
    target: 'sweep',
    suite: SWEEP_SUITE,
    why: "THE GYM IS NEVER TOLD: the first chase never fires, so nothing is ever flagged for the front desk and — because the expiry depends on that flag — nothing ever expires either. The whole feature silently does nothing.",
    from: '      AND gym_notified_at IS NULL\n      AND applied_at <=',
    to: '      AND gym_notified_at IS NULL\n      AND false AND applied_at <=',
    expect: 'does not chase the gym before the ratified two days',
  },
  {
    id: 'O53',
    target: 'sweep',
    suite: SWEEP_SUITE,
    why: "A NUMBER NOBODY MEASURED: the weekly repeat fires on any flagged row, so a gym is re-flagged every single night — and the mark that means 'needs a decision' stops distinguishing a request that has sat for a week from one flagged this morning",
    from: '      AND gym_notified_at <= ${now}::timestamptz - (${GYM_REMINDER_REPEAT_DAYS} * INTERVAL \'1 day\')',
    to: '      AND gym_notified_at IS NOT NULL',
    expect: 'chases again a week later and not sooner',
  },
  {
    id: 'O54',
    target: 'repo',
    suite: SWEEP_SUITE,
    why: "OWNERSHIP: the nudge stops scoping by the caller, so anybody holding an application uuid can nudge on somebody else's behalf — and the front desk is shown 'they asked again' about a person who did not",
    from: '      WHERE id = ${input.applicationId} AND user_id = ${input.userId}\n      FOR UPDATE`;',
    to: '      WHERE id = ${input.applicationId}\n      FOR UPDATE`;',
    expect: "does not let a stranger nudge somebody else's application",
  },
  {
    id: 'O55',
    target: 'repo',
    suite: SWEEP_SUITE,
    why: "KD'S RATIFIED ONCE-A-DAY LIMIT: the interval check goes, so every tap sends a reminder and a stranger with a leaked code can fill an owner's queue with 'they asked again' — the pestering :11385 named the rate limit to prevent",
    from: "        AND (member_nudged_at IS NULL\n             OR member_nudged_at <= now() - (${NUDGE_INTERVAL_HOURS} * INTERVAL '1 hour'))",
    to: '        AND true',
    expect: 'refuses a second nudge the same day',
  },

  // ── O56–O57: THE TWO T3 ROUND 1 CRITICAL/HIGH FIXES ──────────────────────
  //
  // Rule 3 says a Critical/High fix ships with a test that fails without it.
  // These are that requirement made permanent: the fix cannot be quietly undone
  // by a later edit without a mutant going red. Both sit in 4a's DATA LOSS
  // column, which is where this whole subsystem lives.
  {
    id: 'O56',
    target: 'sweep',
    suite: SWEEP_SUITE,
    // **RE-AIMED IN ROUND 2, because round 1's fix left the arm this pointed at
    // as DEAD CODE (Low-1).** The guarantee never lived there: it lives in the
    // notice subtraction. Mutating that away is the true regression — the guard
    // goes back to "was the gym warned at all", which is the yes/no C/H-1 was
    // about, and a flag raised a minute before the deadline licences deletion on
    // the very next run.
    why: "C/H-1 REGRESSION: the notice subtraction goes, so the guard asks only WHETHER the gym was warned instead of HOW LONG AGO — measured at 31 minutes' notice against a promise of two days",
    // **RE-AIMED AGAIN 2026-08-30, and by the card's own diff.** The hold ruling
    // (:24141 §1) added `AND ${gymOnPlan}` between this condition and
    // `RETURNING`, so the two-line anchor stopped matching and the whole-table
    // pre-check aborted — :23128's standing rule earning itself once more: a fix
    // moves anchors nothing in its diff mentions.
    //
    // Now ONE LINE, which is the durable shape (:24141 re-anchored S15/C81/C82
    // the same way, and :17676's CRLF hazard is the other argument against
    // two-line anchors). It moves only when the notice condition itself moves.
    // Unique because the repeat chase's own `gym_notified_at <=` line carries
    // `GYM_REMINDER_REPEAT_DAYS` rather than `EXPIRY_NOTICE_DAYS`.
    from: "        AND gym_notified_at <= ${now}::timestamptz - (${EXPIRY_NOTICE_DAYS} * INTERVAL '1 day')",
    to: '        AND gym_notified_at <= ${now}',
    expect: "gives the ratified TWO DAYS' notice",
  },
  {
    id: 'O57',
    target: 'sweep',
    suite: SWEEP_SUITE,
    // **WHAT THIS MUTANT REPRESENTS, said precisely rather than implied.** The
    // original defect was the audit living in a SEPARATE `begin` after the
    // UPDATE had already committed. That is a structural change, not a substring
    // swap — and a mutation that does not COMPILE goes red for the wrong reason,
    // which certifies the wrong assertion (:4718 F2). Dropping the `await`
    // reproduces the property the test actually distinguishes: **the expiry no
    // longer depends on the audit succeeding**, so the rows commit as `expired`
    // with the audit lost. Same observable failure, same test catches it.
    why: "C/H-2 REGRESSION: the expiry stops depending on its audit write succeeding, so a failed audit leaves rows expired that the retry can never match ('status = pending' is gone) and no audit row is ever written — the trail unrecoverable",
    from: '      await writeAudit(tx, {',
    to: '      void writeAudit(tx, {',
    expect: 'a failed audit write takes the expiry down with it',
  },

  // ── O58–O63: CODE MANAGEMENT (create / pause / limit / expire / rotate) ──
  //
  // SCOPED BY :5857 RULE 4a, and the scoping is the point: these six sit in the
  // OWNERSHIP and DATA-LOSS columns, which is where a slow database-backed
  // mutant is worth its three minutes. The card's other guarantees — the copy
  // in a refusal, the audit meta's wording — are Low and are deliberately NOT
  // mutated here.
  {
    id: 'O58',
    target: 'repo',
    why: "OWNERSHIP: the PATCH stops scoping by gym, so any gym's manager can pause ANOTHER gym's poster by typing its six characters — codes are globally unique, so the lookup succeeds and the IDOR hides behind a column that happens to be unique",
    from: '      WHERE gym_id = ${input.gymId} AND code = ${input.code}\n      FOR UPDATE`;',
    to: '      WHERE code = ${input.code}\n      FOR UPDATE`;',
    expect: 'scopes every write to the OWNING gym',
  },
  {
    id: 'O59',
    target: 'service',
    why: "PRIVILEGE: code management drops to the INVITE tick, which §2.2 grants all three roles — so a trainer, who may hand out a poster, can switch the gym's door off instead",
    from: '  await requireWritablePrivilege(deps, gymId, userId, "codes.manage");\n  const expiresAt = assertFutureExpiry(req.expiresAt);',
    to: '  await requireWritablePrivilege(deps, gymId, userId, "codes.invite");\n  const expiresAt = assertFutureExpiry(req.expiresAt);',
    expect: 'refuses a TRAINER',
  },
  {
    id: 'O60',
    target: 'repo',
    why: 'DATA LOSS: rotate stops retiring the old code, so a leaked poster stays live for ever while the screen reports it replaced — the half-done rotate the single transaction exists to make impossible',
    // RE-ANCHORED 2026-08-21: the retired row now carries the count of people in
    // through it, which aliased the UPDATE's table (`gym_codes AS c`).
    from: '      const retiredRows = await tx<RawCode[]>`\n        UPDATE gym_codes AS c SET paused = true',
    to: '      const retiredRows = await tx<RawCode[]>`\n        UPDATE gym_codes AS c SET paused = paused',
    expect: 'the old one stops',
  },
  {
    id: 'O61',
    target: 'repo',
    why: "DATA LOSS: rotate copies the old code's expiry forward, so the replacement a gym is told to hand out can already be dead on arrival",
    from: '        INSERT INTO gym_codes (gym_id, code, label)\n        VALUES (${input.gymId}, ${input.newCode}, ${before.label})',
    to: '        INSERT INTO gym_codes (gym_id, code, label, expires_at)\n        VALUES (${input.gymId}, ${input.newCode}, ${before.label}, ${before.expires_at})',
    expect: 'BOTH land together',
  },
  {
    id: 'O62',
    target: 'repo',
    why: 'A NUMBER A USER SEES (:5807): the join limit may be set below the number who already joined, so an owner who types 1 to "let one more in" instantly reads Fully used over a code they just widened',
    from: '    if (nextMaxUses !== null && nextMaxUses < before.joined) {',
    to: '    if (false) {',
    expect: 'refuses a limit BELOW the number who already joined',
  },
  {
    id: 'O63',
    target: 'service',
    why: 'A NUMBER A USER SEES: a past end date is stored instead of refused, so the code the screen has just confirmed as created can never be joined with by anybody',
    from: '  if (at.getTime() <= Date.now()) {',
    to: '  if (false) {',
    expect: 'refuses an end date in the past',
  },

  // ── O64–O70: WHAT THE COUNT MEANS, AND TIDYING A CODE AWAY ───────────────
  //
  // Kd's smoke of 2026-08-21 read "2 people have joined with it" off a code ONE
  // person had ever used, and the same counter gated the code's limit. Every row
  // below is 4a's "a number a user sees and is FALSE" or its OWNERSHIP column;
  // the wording of the new refusals is Low and is not mutated.
  //
  // THE SUBQUERY APPEARS SIX TIMES BY DESIGN (see `toCodeRow`), so each anchor
  // below carries the lines AFTER it that make it unique — `String.replace` with
  // a string takes the FIRST match, and an anchor that is merely present would
  // mutate a site this row is not about.
  {
    id: 'O64',
    target: 'repo',
    why: 'A NUMBER A USER SEES (:5807): the console counts members who have LEFT, so a code one person joined and left reads "1 person is in through it" — the exact sentence Kd was shown, restored',
    from: '             WHERE m.code_id = c.id AND m.removed_at IS NULL AND m.complimentary = false)\n             AS joined\n    FROM gym_codes c\n    WHERE c.gym_id = ${gymId}',
    to: '             WHERE m.code_id = c.id AND m.complimentary = false)\n             AS joined\n    FROM gym_codes c\n    WHERE c.gym_id = ${gymId}',
    expect: 'counts PEOPLE who are in',
  },
  {
    id: 'O65',
    target: 'repo',
    why: "A NUMBER A USER SEES: the owner's own complimentary seat is counted as a join, so every gym is told one more person came through its code than ever did — and Kd's reason for asking was that an owner is never counted against their own gym",
    from: '             WHERE m.code_id = c.id AND m.removed_at IS NULL AND m.complimentary = false)\n             AS joined\n    FROM gym_codes c',
    to: '             WHERE m.code_id = c.id AND m.removed_at IS NULL)\n             AS joined\n    FROM gym_codes c',
    expect: 'counts PEOPLE who are in',
  },
  {
    id: 'O66',
    target: 'repo',
    why: "DATA LOSS / A FALSE REFUSAL: the DOOR counts members who have left, so a code limited to twenty is dead for ever once twenty people have passed through it — a gym's poster shut by people who are no longer members",
    from: '               WHERE m.code_id = c.id AND m.removed_at IS NULL AND m.complimentary = false)\n               AS joined\n      FROM gym_codes c WHERE c.id = ${found.id}',
    to: '               WHERE m.code_id = c.id AND m.complimentary = false)\n               AS joined\n      FROM gym_codes c WHERE c.id = ${found.id}',
    expect: "frees a place in a code's limit when a member leaves",
  },
  {
    id: 'O67',
    target: 'repo',
    why: "OWNERSHIP: removal stops scoping by gym, so any gym's manager can take ANOTHER gym's poster off that gym's screen by typing its six characters — the same IDOR as O58, wearing a third method",
    from: '      SELECT code, paused, expires_at, removed_at\n      FROM gym_codes\n      WHERE gym_id = ${input.gymId} AND code = ${input.code}',
    to: '      SELECT code, paused, expires_at, removed_at\n      FROM gym_codes\n      WHERE code = ${input.code}',
    expect: 'scopes every write to the OWNING gym',
  },
  {
    id: 'O68',
    target: 'repo',
    why: 'A FALSE SCREEN: a code that still WORKS may be tidied away, so a gym removes a poster from the only list that watches it while the door it opens stays open — the pairing the removal rule exists to guarantee',
    from: '    if (!before.paused && !expired) return { kind: "still_usable" };',
    to: '    if (false) return { kind: "still_usable" };',
    expect: 'takes a switched-off code off the list',
  },
  {
    id: 'O69',
    target: 'repo',
    why: 'A FALSE SCREEN: removal stops pausing the row, so an EXPIRED code taken off the list could be woken by a later change nobody can see — "not on the list" and "cannot let anyone in" part company',
    from: '      UPDATE gym_codes SET removed_at = now(), paused = true',
    to: '      UPDATE gym_codes SET removed_at = now(), paused = paused',
    // SURVIVED ITS FIRST SWEEP, and the hole was in the TEST: every removal test
    // took away a code that was ALREADY paused, so nothing could notice removal
    // ceasing to pause. Re-pointed at the EXPIRED-code test, which is the only
    // path where a code is removed while `paused` is still false, and that test
    // now reads the row back.
    expect: 'removes an EXPIRED code',
  },
  {
    id: 'O71',
    target: 'repo',
    why: "DATA LOSS / A CODE THE CONSOLE CANNOT SEE: the cap stops being serialised on the gym row, so under READ COMMITTED two staff creating at once both read 99 and both insert — the gym holds 101 codes and the 101st is invisible to `listCodes`' LIMIT while the join door honours it (T3 L-3)",
    from: '      await lockOrgRow(tx, input.gymId);\n      const counted = await tx<{ n: number }[]>`',
    to: '      const counted = await tx<{ n: number }[]>`',
    expect: 'two staff create at once',
  },
  {
    id: 'O70',
    target: 'service',
    why: "PRIVILEGE: tidying a code away drops to the INVITE tick, which §2.2 grants all three roles — so a trainer can make a gym's codes disappear from the owner's screen",
    from: '  await requireWritablePrivilege(deps, gymId, userId, "codes.manage");\n\n  const outcome = await repo.removeCode(deps.sql, {',
    to: '  await requireWritablePrivilege(deps, gymId, userId, "codes.invite");\n\n  const outcome = await repo.removeCode(deps.sql, {',
    expect: 'refuses a TRAINER',
  },

  // O72–O81 — STAFF (Part 3 §4.7, Kd 2026-08-21). Scoped by :5857 rule 4a, and
  // every row is in one of its four columns:
  //   · OWNERSHIP — one gym's staff list reachable from another gym, and the
  //     account-existence oracle the gym-scoped email lookup exists to close
  //     (O72, O74, O79)
  //   · DATA LOSS — a gym left with NOBODY in charge, and a remove that takes
  //     the whole staff list with it (O77, O78)
  //   · MONEY — Kd's "yes staff seats free" in both directions (O75, O80)
  //   · WHAT A USER SEES AND COULD BE FALSE — a silent demotion, an owner
  //     demoted, an audit trail claiming something that never happened
  //     (O73, O76, O81)
  //
  // NOT MUTATED, per the same rule: the refusal wording, the list's ORDER, and
  // `since`'s formatting. Also NOT mutated and said rather than skipped
  // silently: `removeStaff`'s `lockOrgRow` has NO OBSERVABLE SUBJECT here — the
  // race needs two concurrent owner removals and this gym can only ever have
  // one owner, so a mutant would report ALIVE for a reason that is about the
  // fixture, not the guard (:13552's recursion row, same call made the same
  // way). It becomes observable on the day a second owner can exist, which is
  // the card that owes it.
  {
    id: 'O72',
    target: 'repo',
    why: "OWNERSHIP: the staff list stops being scoped to one gym, so any owner reads every gym's staff — names and EMAIL ADDRESSES — off a uuid",
    // RE-ANCHORED 2026-08-22: T3 round 2's Low-2 fix inserted the eligibility
    // test between this WHERE and the ORDER BY the old anchor spanned. Caught by
    // the whole-table pre-check ABORTING — the FOURTH time on this card, and
    // each time it was my own fix that moved the anchor (:5199/:8610's class).
    // The new anchor uses the line `getStaffRole` does NOT have, so it cannot
    // drift onto the sibling copy of the same SQL.
    from: "    WHERE s.gym_id = ${gymId}\n      AND u.status = 'active'",
    to: "    WHERE ${gymId} IS NOT NULL\n      AND u.status = 'active'",
    expect: 'lists the owner as staff',
  },
  {
    id: 'O73',
    target: 'repo',
    why: 'A SILENT DEMOTION: a second appointment OVERWRITES the role, so a stale screen still offering "add as trainer" quietly strips a manager of every right they had',
    from: '      ON CONFLICT (gym_id, user_id) DO NOTHING\n      RETURNING user_id`;',
    to: '      ON CONFLICT (gym_id, user_id) DO UPDATE SET role = EXCLUDED.role\n      RETURNING user_id`;',
    expect: 'a second appointment REPORTS the existing role',
  },
  {
    id: 'O74',
    target: 'repo',
    why: 'THE ACCOUNT-EXISTENCE ORACLE: the email lookup stops being scoped to this gym\'s roster, so "added" vs "nobody here has that email" answers *does this address have an account* for anything an owner cares to type',
    from: '      WHERE m.gym_id = ${input.gymId}\n        AND m.removed_at IS NULL\n        AND u.email = ${input.email}',
    to: '      WHERE ${input.gymId} IS NOT NULL\n        AND m.removed_at IS NULL\n        AND u.email = ${input.email}',
    expect: 'refuses an email that is not a member HERE',
  },
  // O75 AND O80 WERE RE-AIMED BY T3 ROUND 1'S C/H-1 FIX. Both used to anchor on
  // `setSeatComplimentary`, which no longer exists: Kd's "staff seats free" is
  // enforced in the seat CAP rather than by flagging a member `complimentary`.
  // The guarantees they name are unchanged; where they live moved (:11846's
  // "a mutant has two halves and a fix must move both" — anchor AND filter).
  {
    id: 'O75',
    target: 'repo',
    why: 'MONEY, against Kd\'s ruling ("yes staff seats free"): the seat cap stops excluding staff, so a gym at its cap cannot admit anybody after appointing a trainer — it is paying a seat per member of its own team',
    from: '          AND NOT EXISTS (\n            SELECT 1 FROM gym_staff s\n            WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)`;',
    to: '          `;',
    expect: 'SEAT CAP',
  },
  {
    id: 'O76',
    target: 'repo',
    why: "LOCKOUT BY ANOTHER DOOR (:11429 rule 2): the owner's role becomes changeable, so a mis-tap demotes the only person who can appoint staff and nobody inside the gym can undo it",
    from: '    if (previous === "owner") return { kind: "is_owner" };',
    to: '    if (previous === "nobody") return { kind: "is_owner" };',
    expect: "refuses to change the OWNER's role",
  },
  {
    id: 'O77',
    target: 'repo',
    why: 'A GYM WITH NOBODY IN CHARGE: the last-owner guard stops firing, so the only owner can remove themselves and no one left inside can appoint anybody — appointing staff is owner-only, so the gym is unrecoverable without us',
    // RE-ANCHORED by T3 round 2's Low-1 fix: the row count became a count of
    // owners who still HOLD the keys, so the comparison moved from `<= 1` to
    // `=== 0`. Guarantee unchanged — this guard must fire.
    from: '      if ((otherOwners[0]?.n ?? 0) === 0) return { kind: "last_owner" };',
    to: '      if ((otherOwners[0]?.n ?? 0) < 0) return { kind: "last_owner" };',
    expect: 'nobody in charge',
  },
  {
    id: 'O78',
    target: 'repo',
    why: "DATA LOSS: the DELETE loses its user half, so taking one trainer's keys deletes the gym's ENTIRE staff list — owner included — behind a 200",
    from: '      DELETE FROM gym_staff\n      WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}\n      RETURNING user_id`;',
    to: '      DELETE FROM gym_staff\n      WHERE gym_id = ${input.gymId} AND ${input.userId} IS NOT NULL\n      RETURNING user_id`;',
    expect: 'leaves them a MEMBER',
  },
  {
    id: 'O79',
    target: 'service',
    why: "OWNERSHIP: staff management drops to the members tick, which §2.2 grants all three roles — so a TRAINER can appoint themselves manager, or take the owner's keys",
    from: '  await requireWritablePrivilege(deps, gymId, userId, "staff.manage");\n\n  const outcome = await repo.addStaff(deps.sql, {',
    to: '  await requireWritablePrivilege(deps, gymId, userId, "members.read");\n\n  const outcome = await repo.addStaff(deps.sql, {',
    // STALE FILTER, FOUND 2026-08-29 WHILE RE-AIMING THIS ROW and fixed because
    // the re-aim is unmeasurable without it. It named "four staff routes"; the
    // test has said FIVE since the privileges route was added beside the other
    // four, so this control ABORTED every run that included O79 — and because
    // every api sweep is a stated SUBSET, no run has included it since. The
    // mutant has therefore been inert, not passing: :21580's three anchorless
    // console mutants, arriving through the FILTER half rather than the anchor
    // half (:11846's pair, and it is the filter half this repo keeps recording
    // last). Measured RED after the fix.
    expect: 'refused all five staff routes',
  },
  {
    id: 'O80',
    target: 'repo',
    why: 'T3 ROUND 1 C/H-1, PINNED AS A CLASS: the appointment goes back to flagging the member `complimentary`, so the console prints "Nobody has joined yet" over a gym with two members and a code limited to one person quietly admits another',
    from: '    // NOTHING IS WRITTEN TO `gym_members` HERE.',
    to: '    await tx`UPDATE gym_members SET complimentary = true WHERE gym_id = ${input.gymId} AND user_id = ${candidate.user_id} AND removed_at IS NULL`;\n    // NOTHING IS WRITTEN TO `gym_members` HERE.',
    expect: 'changes NO number',
  },
  {
    id: 'O82',
    target: 'repo',
    why: "T3 ROUND 1 C/H-2: appointing drops the org lock, so it interleaves with remove-from-members and commits a staff row over a closed membership — an ex-member holding `members.read` on the whole roster",
    from: '  return await sql.begin(async (tx) => {\n    await lockOrgRow(tx, input.gymId);\n\n    const candidates = await tx<{ user_id: string }[]>`',
    to: '  return await sql.begin(async (tx) => {\n    const candidates = await tx<{ user_id: string }[]>`',
    expect: 'RACE',
  },
  {
    id: 'O83',
    target: 'repo',
    why: 'T3 ROUND 1 C/H-2, the OTHER half: remove-from-members drops the org lock. Either side alone re-opens the race, so both need their own mutant — one guard proving the other is the shape :14174 L-1 recorded',
    from: '    await lockOrgRow(tx, input.gymId);\n\n    const staffRows = await tx<{ role: string }[]>`\n      SELECT role FROM gym_staff WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}`;',
    to: '    const staffRows = await tx<{ role: string }[]>`\n      SELECT role FROM gym_staff WHERE gym_id = ${input.gymId} AND user_id = ${input.userId}`;',
    expect: 'RACE',
  },
  {
    id: 'O84',
    target: 'repo',
    why: "T3 ROUND 1 C/H-3: a staff row stops being checked against the membership it belongs to, so somebody who deleted their account and restored it walks back in holding the keys to a gym they are no longer in",
    from: '        OR NOT EXISTS (\n          SELECT 1 FROM gym_members m\n          WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id\n        )\n      )`;',
    to: '        OR true\n      )`;',
    expect: 'GHOST',
  },
  // O85 AND O86 RE-ANCHORED 2026-08-22 (T3 round 2's Low-2 fix). `listStaff`
  // now spells the SAME eligibility test as `getStaffRole` — deliberately, so
  // the two readers cannot disagree — which means their old one-line anchors
  // appear TWICE in the file. `String.replace` takes the FIRST, so they still
  // happened to hit `getStaffRole`; "happened to" is :11846's O14 exactly (a
  // mutant named for the roster reporting on the queue). Both now carry
  // `getStaffRole`'s own parameter line, which `listStaff` does not have.
  {
    id: 'O85',
    target: 'repo',
    why: "LOCKOUT: the owner's exemption goes, so a gym whose owner is not a member of it — `gyms.owner_included_as_member`, which the create path already honours — locks its own owner out with a 404 and nobody inside can let them back in",
    from: '      AND s.user_id = ${userId}\n      AND u.status = \'active\'\n      AND (\n        g.owner_user_id = s.user_id',
    to: '      AND s.user_id = ${userId}\n      AND u.status = \'active\'\n      AND (\n        false',
    expect: 'GHOST',
  },
  {
    id: 'O86',
    target: 'repo',
    why: 'A DELETED ACCOUNT KEEPS ITS KEYS: the account-status check goes, so the window between a DPDP delete and its restore leaves a tombstoned user still authorised over a live gym',
    from: "      AND s.user_id = ${userId}\n      AND u.status = 'active'",
    to: '      AND s.user_id = ${userId}\n      AND true',
    expect: 'GHOST',
  },

  // O88–O91 — T3 ROUND 2. Round 1's three fixes added three `gym_id` predicates
  // and NOT ONE had a test: deleting any of them left all 88 green. The code was
  // correct; nothing would have noticed it going wrong, which is rule 3's whole
  // subject. O91 guards the OTHER reader of `gym_staff` against drifting from
  // the first — round 1 taught one and forgot the other.
  {
    id: 'O88',
    target: 'repo',
    why: "MONEY, ACROSS TENANTS: the seat exclusion stops asking WHICH gym somebody is staff of, so being a trainer anywhere frees your seat everywhere and a gym silently under-counts the seats it sold",
    // RE-ANCHORED by T3 L-2 on the badge card (:15093). This anchor matched
    // ONCE until that card added the roster's copy of the same subquery, whose
    // 14-space indent CONTAINS this 12-space line — so it began matching twice
    // and landed on `claimSeat` only because `String.replace` takes the first
    // occurrence and this one comes first in the file. :14493's recorded
    // double-match hazard, arriving through a new line rather than a moved one.
    // The trailing backtick-semicolon is what `claimSeat`'s copy has and the
    // roster's (`)) AS takes_seat`) does not.
    from: '            WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)`;',
    to: '            WHERE s.user_id = m.user_id)`;',
    expect: 'does not free your seat at another',
  },
  {
    id: 'O89',
    target: 'repo',
    why: "OWNERSHIP, ACROSS TENANTS: the live-member arm stops asking WHICH gym, so an ex-member of gym A keeps gym A's roster on the strength of a membership at gym B — C/H-3's hole reopened sideways",
    from: '        OR EXISTS (\n          SELECT 1 FROM gym_members m\n          WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id AND m.removed_at IS NULL\n        )\n        OR NOT EXISTS (',
    to: '        OR EXISTS (\n          SELECT 1 FROM gym_members m\n          WHERE m.user_id = s.user_id AND m.removed_at IS NULL\n        )\n        OR NOT EXISTS (',
    expect: 'never decided by membership at another',
  },
  {
    id: 'O90',
    target: 'repo',
    why: "AN ALLOW BECOMES A DENY: the never-a-member arm stops asking WHICH gym, so §4.7's invited manager is locked out of the gym that invited them the moment they hold a membership at any OTHER gym",
    from: '        OR NOT EXISTS (\n          SELECT 1 FROM gym_members m\n          WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id\n        )\n      )`;',
    to: '        OR NOT EXISTS (\n          SELECT 1 FROM gym_members m\n          WHERE m.user_id = s.user_id\n        )\n      )`;',
    expect: 'never decided by membership at another',
  },
  {
    id: 'O91',
    target: 'repo',
    why: 'TWO READERS THAT DISAGREE: the staff LIST drops the eligibility test, so it shows a deleted account still holding "manager" while that person\'s actual authority is null — the screen states a fact the server denies (round 1 taught `getStaffRole` and left this reader behind)',
    from: "      AND u.status = 'active'\n      AND (\n        g.owner_user_id = s.user_id\n        OR EXISTS (\n          SELECT 1 FROM gym_members m\n          WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id AND m.removed_at IS NULL\n        )\n        OR NOT EXISTS (\n          SELECT 1 FROM gym_members m\n          WHERE m.gym_id = s.gym_id AND m.user_id = s.user_id\n        )\n      )\n    ORDER BY",
    to: '    ORDER BY',
    expect: 'agree about every row',
  },
  {
    id: 'O87',
    target: 'repo',
    why: "THE REVIEWER'S OWN MUTANT (T3 round 1, rule 4): the last-owner guard counts STAFF instead of OWNERS, so a gym holding one owner and one trainer lets the owner remove themselves. It stayed GREEN against the original test, whose gym had a single staff row and could not tell the two counts apart",
    // RE-ANCHORED 2026-08-22 by the ticks card, and the ambiguity guard is what
    // caught it: `setStaffPrivileges` counts owners with the SAME SQL text —
    // deliberately, because it is the same rule pointed at the other door — so
    // this one-line anchor went from one match to two and would have mutated
    // whichever came first. The second line is what makes it unique
    // (`last_owner` here, `last_owner_locked` there). This is precisely the
    // hazard :14493 named and :15259 built the guard for; it fired on its first
    // real occasion.
    // RE-ANCHORED AGAIN by T3 round 2's Low-1 fix, which gave this door the
    // ticks door's holder-aware count. The GUARANTEE is unchanged — count
    // OWNERS, not staff — and `otherOwners` is what keeps the anchor unique
    // against the sibling query in `setStaffPrivileges`.
    from:
      '      const otherOwners = await tx<{ n: number }[]>`\n' +
      '        SELECT count(*)::int AS n FROM gym_staff\n' +
      '        WHERE gym_id = ${input.gymId}\n' +
      "          AND role = 'owner'\n",
    to:
      '      const otherOwners = await tx<{ n: number }[]>`\n' +
      '        SELECT count(*)::int AS n FROM gym_staff\n' +
      '        WHERE gym_id = ${input.gymId}\n',
    expect: 'nobody in charge',
  },
  {
    id: 'O81',
    target: 'repo',
    why: 'AN AUDIT TRAIL THAT LIES: a no-op tap writes a role change that never happened, so the history says the owner demoted somebody on a day they touched nothing',
    // The no-op branch is made unreachable, so a repeat tap falls through to the
    // UPDATE and writes a second audit row. Mutating the RETURNED KIND instead
    // would be a no-op — the service maps `updated` and `unchanged` to the same
    // 200 — and a no-op mutation reports ALIVE, whose honest reading is "this
    // guarantee has no test" (:10726).
    from: '    if (previous === input.role) {',
    to: '    if (previous === "impossible-role") {',
    expect: 'records BOTH ends in the audit row',
  },
  // THE ROSTER'S ANSWER AND THE SEAT COUNT ARE ONE RULE WRITTEN TWICE (:14953).
  // A shared `sql` fragment is R3.8's forbidden shape, so `listMembers` spells
  // out `claimSeat`'s two conditions again — exactly as `listStaff` spells out
  // `getStaffRole`'s eligibility test (:14493 Low-2). These two rows are what
  // stop the copies drifting: one per condition, each aimed at the ROSTER's
  // copy, both caught by the test that drives the badge and the cap together.
  // The door's own copy already has its guards (O3 and the seat-cap rows).
  {
    id: 'O92',
    target: 'repo',
    why: "A NUMBER ON SCREEN AND FALSE: the roster stops treating a complimentary seat as free, so the owner's own §4.0-step-6 place is drawn on their console as one they are paying for — the screen and the seat cap disagreeing about who costs money, which is the defect Kd found",
    from: '           (m.complimentary = false\n            AND NOT EXISTS (',
    to: '           (true\n            AND NOT EXISTS (',
    expect: 'the badge and the seat count answer the same question',
  },
  {
    id: 'O93',
    target: 'repo',
    why: "KD'S FINDING ITSELF, restored: the roster stops asking whether this member holds the keys, so a trainer sits on the console looking exactly like somebody occupying a paid place while the cap has not charged for them since :14401. This is the mutant that would be ALIVE if the card had never been built",
    from: '            AND NOT EXISTS (\n              SELECT 1 FROM gym_staff s\n              WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)) AS takes_seat',
    to: '            ) AS takes_seat',
    expect: 'the badge and the seat count answer the same question',
  },
  {
    // T3 L-1's finding, and it is the FOURTH `gym_id` predicate on this table to
    // ship without an observer. :14401 round 2 wrote O88–O90 because "round 1's
    // three fixes added three `gym_id` predicates and NOT ONE had a test"; the
    // badge card added a fourth and repeated it. Measured before this row
    // existed: deleting the scope left all 92 tests green.
    id: 'O94',
    target: 'repo',
    why: "MONEY AND FALSE ON SCREEN, ACROSS TENANTS: the ROSTER's staff exclusion stops asking WHICH gym, so a paying member of gym B who happens to hold keys at gym A is badged Complimentary on gym B's roster and loses their Remove button — gym B told its own paying member costs it nothing. O88 is this same deletion at the DOOR; this is the screen's copy",
    from: '              WHERE s.gym_id = m.gym_id AND s.user_id = m.user_id)) AS takes_seat',
    to: '              WHERE s.user_id = m.user_id)) AS takes_seat',
    expect: 'does not free your seat at another',
  },
  // ---------------------------------------------------------------------
  // PER-STAFF PRIVILEGE TICKS (Kd ruling :11429, amended :14745, snapshot
  // question settled by him 2026-08-22). Every row here is 4a's OWNERSHIP
  // column — "can this person do a thing they should not" — which is the one
  // the rule says always earns a database mutant.
  // ---------------------------------------------------------------------
  {
    id: 'O95',
    target: 'service',
    why: "THE WHOLE FEATURE, INERT: the seam stops reading the ticks stored on the row and decides on the role's template instead. Every tick an owner sets is then decoration — the greyed-control-over-a-live-route defect :11429 rule 4 names in advance — and a gym whose front desk is a trainer still cannot let anybody in",
    from: 'if (!privilegesFor(authority.role, authority.privileges).includes(privilege)) {',
    to: 'if (!privilegesFor(authority.role, null).includes(privilege)) {',
    expect: 'an owner can give one trainer the power to let people in',
  },
  {
    id: 'O96',
    target: 'repo',
    why: "LOCKOUT, and nobody inside the gym could repair it: the last-owner guard stops firing, so an owner can tick away their own staff management — the same lockout §4.7 blocks at the REMOVE door, reached through the one this ruling opened (:11429 rule 2). Handing `staff.manage` back requires `staff.manage`",
    // RE-ANCHORED by T3's Low-1 fix, which replaced the owner-ROW count with a
    // count of owners still HOLDING each required privilege.
    from: '      if ((others[0]?.n ?? 0) === 0) return { kind: "last_owner_locked" };',
    to: '      if ((others[0]?.n ?? 0) < 0) return { kind: "last_owner_locked" };',
    expect: 'the last owner cannot be ticked out of managing staff',
  },
  {
    id: 'O102',
    target: 'repo',
    why: "T3 C/H-1 RESTORED — PRIVILEGE ESCALATION: a non-owner can be handed `staff.manage`, which gates the ticks route itself, so one owner action gives a manager the power to change ANYBODY's ticks including the owner's. The reviewer ran the whole chain: granted, the manager stripped the owner, and the owner got 403 on their own roster. This is :11429 rule 1 deleted, and rule 3's licence to widen rests on rule 1 holding",
    from: '    if (role !== "owner" && input.ownerOnly.some((p) => input.privileges.includes(p))) {\n      return { kind: "owner_only_privilege" };\n    }',
    to: '    if (false) {\n      return { kind: "owner_only_privilege" };\n    }',
    expect: "the owner's own power to manage staff cannot be given away",
  },
  {
    id: 'O103',
    target: 'repo',
    why: "T3 Low-1 RESTORED: the last-owner guard stops asking whether the OTHER owners still HOLD the power and counts rows again, so with two owners each can strip the other — both left unable to manage staff, and nobody inside the gym able to repair it. Stripping a privilege removes no row, which is why `removeStaff`'s identically-shaped count is correct and this one was not",
    // The second line is what makes this unique: the two doors now hold the
    // SAME four-line query, deliberately (R3.8 forbids sharing the fragment),
    // and only the outcome name differs. T3 round 2's Low-1 is what created the
    // twin — the ambiguity guard would have aborted on a one-line anchor.
    from:
      '          AND (privileges IS NULL OR privileges @> ${[...input.lastOwnerRequires]})`;\n' +
      '      if ((others[0]?.n ?? 0) === 0) return { kind: "last_owner_locked" };',
    to:
      '          `;\n' +
      '      if ((others[0]?.n ?? 0) === 0) return { kind: "last_owner_locked" };',
    expect: 'a second owner counts only while they still HOLD the power',
  },
  {
    id: 'O104',
    target: 'repo',
    why: "T3 ROUND 2's Low-1 RESTORED, AT THE OTHER DOOR: `removeStaff` stops asking whether the remaining owners still HOLD the keys and counts owner ROWS again — so a gym with two owner rows, only one of whom can manage staff, lets that one be removed and keeps an owner who cannot appoint anybody. THE THIRD TIME THIS GUARD HAS BEEN COPIED AND GOT THE SAME THING WRONG (:14401's O87 here, round 1's Low-1 at the ticks door, this)",
    from:
      '          AND (privileges IS NULL OR privileges @> ${[...input.lastOwnerRequires]})`;\n' +
      '      if ((otherOwners[0]?.n ?? 0) === 0) return { kind: "last_owner" };',
    to:
      '          `;\n' +
      '      if ((otherOwners[0]?.n ?? 0) === 0) return { kind: "last_owner" };',
    expect: 'both doors refuse to leave a gym with an owner who cannot run it',
  },
  {
    id: 'O97',
    target: 'repo',
    why: "A DEMOTION THAT DEMOTES NOBODY: changing somebody to trainer stops resetting their ticks, so every manager power they were given stays live under a role that says trainer — the one control an owner reaches for to REDUCE access reduces nothing, and the screen says otherwise",
    from: '      UPDATE gym_staff SET role = ${input.role}, privileges = ${[...input.privileges]}',
    to: '      UPDATE gym_staff SET role = ${input.role}',
    expect: 'RESETS their ticks to that role',
  },
  {
    id: 'O98',
    target: 'repo',
    why: "THE OWNER'S OWN ROW SHIPS EMPTY: creating a gym stops writing the owner's ticks, so their authority rests for ever on the deploy-window fallback — which means a later edit to the role template silently changes what every gym owner can do, the exact silent widening Kd ruled against on 2026-08-22",
    from: "        VALUES (${org.id}, ${input.ownerUserId}, 'owner', ${[...input.ownerPrivileges]})",
    to: "        VALUES (${org.id}, ${input.ownerUserId}, 'owner', ${null})",
    expect: 'gives a new appointment the ticks its role starts with',
  },
  {
    id: 'O99',
    target: 'repo',
    why: "THE SAME HOLE AT THE OTHER WRITER: an appointment stores no ticks, so a new manager's row has no effective set of its own and inherits whatever the template says later. Two writers of `gym_staff`, and a card that fixes one and forgets the other is how this defect ships — it did, and this suite caught it",
    from: '      VALUES (${input.gymId}, ${candidate.user_id}, ${input.role}, ${[...input.privileges]})',
    to: '      VALUES (${input.gymId}, ${candidate.user_id}, ${input.role}, ${null})',
    expect: 'gives a new appointment the ticks its role starts with',
  },
  {
    id: 'O100',
    target: 'service',
    // WORDING CORRECTED after T3: this row's `why` used to claim it guarded the
    // escalation door, and it was GREEN while that door stood open — the gate it
    // deletes was owner-only by accident, not by enforcement. It guards the
    // ROUTE's gate; **O102 is the escalation itself.** A mutant can only kill a
    // guard that EXISTS, which is the lesson :14745 recorded when Kd's browser
    // found what no mutant could.
    why: "THE ROUTE'S GATE: changing somebody's ticks stops needing `staff.manage` and accepts `members.read`, which every trainer holds — so any staff member reaches the route at all. Necessary and NOT sufficient on its own: what stops a granted manager escalating is O102's refusal, not this gate",
    from: '  await requireWritablePrivilege(deps, gymId, userId, "staff.manage");\n\n  const outcome = await repo.setStaffPrivileges(deps.sql, {',
    to: '  await requireWritablePrivilege(deps, gymId, userId, "members.read");\n\n  const outcome = await repo.setStaffPrivileges(deps.sql, {',
    expect: 'refused all five staff routes with 403',
  },
  {
    id: 'O101',
    target: 'service',
    why: "ON SCREEN AND FALSE (:5807): the staff list stops serving the EFFECTIVE set and serves the role's template, so an owner reads back boxes they never ticked and misses ones they did — the screen and the server disagreeing about what a colleague may do, which is the pair rule 4 exists to keep in step",
    from: '    privileges: [...privilegesFor(row.role, row.privileges)],',
    to: '    privileges: [...privilegesFor(row.role, null)],',
    expect: 'an owner can give one trainer the power to let people in',
  },
  {
    // T3 ROUND 1 C/H-1, THE SERVER HALF. Its sibling O101 is the SAME mistake at
    // the staff LIST, and writing this row is the point :15770 made about
    // siblings: a mutant is a claim about ONE call site, and the /orgs/mine
    // reader had none, which is how the console came to have no source for the
    // caller's own set in the first place.
    id: 'O105',
    target: 'service',
    why: "THE ROUND-1 CRITICAL AT ITS ROOT: `/v1/orgs/mine` serves the ROLE's template instead of the caller's stored set, so a trainer an owner ticked `codes.manage` onto reads back the plain trainer defaults — the console then gates its controls on a set the server does not enforce, and the tick reaches no button anywhere. The screen and the door answering differently about the SAME person",
    // RE-ANCHORED 2026-08-28, TARGET AND MUTATION UNCHANGED. The fix round for
    // T3 Low-8 hoisted this expression into a `const privileges = …` above the
    // object literal, because `ownerTrialUsed` now needs the same answer and
    // computing it twice is two chances to disagree. The old anchor was the
    // OBJECT PROPERTY line, which no longer contains the call.
    //
    // **Aimed at the SAME call site, never at whichever line looked closest
    // (:15770), and the whole-table pre-check is what caught it** — it ABORTED
    // the fix round's sweep rather than letting this row quietly match nothing,
    // which is the failure :21580 recorded when three console mutants rotted
    // through two commits unnoticed.
    from: '      const privileges = r.staffRole === null ? [] : [...privilegesFor(r.staffRole, r.privileges)];',
    to: '      const privileges = r.staffRole === null ? [] : [...privilegesFor(r.staffRole, null)];',
    expect: 'tells a caller what they may DO here, not just what they are called',
  },

  // ---------------------------------------------------------------------
  // THE PRICE BOOK (:17366 §1 + :17902 §1a/§1b). Every row below is MONEY or a
  // NUMBER A USER SEES, which is what :5857 rule 4a spends database mutants on.
  //
  // Why they exist at all: the seeded book was stale through TWO rulings and
  // nothing noticed, because the only test over it asserted prices and never
  // caps, trial days or allowances — and asserted nothing about a currency book
  // being ABSENT. Each row below is one of the things that silence hid.
  // ---------------------------------------------------------------------
  {
    id: 'O106',
    target: 'seed',
    suite: SEED_SUITE,
    why: "MONEY: a gym band is repriced. This is the class of drift that actually happened — the seed carried the pre-:17366 book while two entries recorded a ratified one, so the app would have charged a number nobody ruled",
    from: '  { band: 2, seatCap: 500, usd: 5000, inr: 250000 }, //  301–500   $50 / ₹2,500',
    to: '  { band: 2, seatCap: 500, usd: 4000, inr: 250000 }, //  301–500   $50 / ₹2,500',
    expect: SEED_FILTER,
  },
  {
    id: 'O107',
    target: 'seed',
    suite: SEED_SUITE,
    why: "MONEY AND A DOOR: `seat_cap` IS the band boundary, and `seatCapFor` reads it to decide who gets in — so a wrong cap both misprices the gym and turns real members away (or lets a 500-member gym sit on the cheapest band forever). The old book's caps were 25/100/150/400 and NO test ever looked at one",
    from: '  { band: 4, seatCap: 1500, usd: 9900, inr: 650000 }, // 1001–1500 $99 / ₹6,500',
    to: '  { band: 4, seatCap: 1400, usd: 9900, inr: 650000 }, // 1001–1500 $99 / ₹6,500',
    expect: SEED_FILTER,
  },
  {
    id: 'O108',
    target: 'seed',
    suite: SEED_SUITE,
    why: "MONEY, IN THE MOST EXPENSIVE DIRECTION: the USD gym book disappears entirely and only the INR one is seeded. That is not hypothetical — it is EXACTLY the state this card found (zero USD org rows since the US became the primary market), and a price book can be wrong by being ABSENT rather than wrong, which is why the assertion compares the SET of active org codes and not a price row by row",
    from: '    currency: "USD",\n    interval: "month",\n    seatCap,',
    to: '    currency: "INR",\n    interval: "month",\n    seatCap,',
    expect: SEED_FILTER,
  },
  {
    id: 'O109',
    target: 'seed',
    suite: SEED_SUITE,
    why: "ON SCREEN AND FALSE (:5807): the gym trial reverts to the spec's 7 days, which Kd superseded with 30 at :16548. A gym told it has a month and cut off after a week is the app breaking a promise it made in writing",
    from: 'const ORG_TRIAL_DAYS = 30;',
    to: 'const ORG_TRIAL_DAYS = 7;',
    expect: SEED_FILTER,
  },
  {
    id: 'O110',
    target: 'seed',
    suite: SEED_SUITE,
    why: "MONEY: a gym's members get the paid consumer's 20 scans a day instead of 5, which :17366 §2 MEASURED as putting three of five bands underwater — the gym pays $35 and the scans cost $48.50. The one number that separates the two blocks",
    from: '  meal_scan: { window: "day", limit: 5 },\n} as const;',
    to: '  meal_scan: { window: "day", limit: 20 },\n} as const;',
    expect: SEED_FILTER,
  },
  {
    id: 'O111',
    target: 'seed',
    suite: SEED_SUITE,
    why: "THE RETIREMENT IS A CLAIM AND NEEDS AN OBSERVER: the pre-ruling book stops being switched off, so six plans carrying caps of 25/100/150/400 and prices no ruled book has matched since 2026-08-24 sit ACTIVE alongside the real ones, ready for a plan picker to offer",
    from: '  await db\n    .update(plans)\n    .set({ active: false })',
    to: '  await db\n    .update(plans)\n    .set({ active: true })',
    expect: SEED_FILTER,
  },
  {
    // O110'S SIBLING, AND THE REASON IT EXISTS IS ROUND 2's Low-2. O110 mutates
    // this same line and is caught by the SEED suite, which reads the plans
    // table. This one is caught through the RESOLVER — the path a real member's
    // app takes — because round 1 claimed five repointed tests now observed the
    // 5 and round 2 measured that they did not: every assertion in them is
    // identical in both entitlement blocks. :15770's lesson, one card later —
    // **a mutant is a claim about ONE call site**, and "the seed writes 5" and
    // "a member is GRANTED 5" are two different claims.
    id: 'O113',
    target: 'seed',
    suite: 'test/entitlements.routes.test.ts',
    why: "MONEY, THROUGH THE PATH A REAL MEMBER TAKES: a gym's member is granted the paid consumer's 20 scans a day instead of 5. O110 catches this at the plans TABLE; this catches it at `/v1/entitlements/me`, which is what the app actually reads",
    from: '  meal_scan: { window: "day", limit: 5 },\n} as const;',
    to: '  meal_scan: { window: "day", limit: 20 },\n} as const;',
    expect: "gym membership grants member_entitlements, source 'gym_membership'",
  },
  {
    id: 'O112',
    target: 'seed',
    suite: SEED_SUITE,
    why: "MONEY: the individual's monthly price reverts toward the pre-:17366 figure. Kd raised it from $6.99 to $10 and the seed had never carried either — it still held $3.99 from the original spec book",
    from: '    priceMinor: 1000, // $10/mo',
    to: '    priceMinor: 699, // $10/mo',
    expect: SEED_FILTER,
  },

  // ---------------------------------------------------------------------------
  // A GYM CAN FIX ITS OWN DETAILS (`PATCH /v1/orgs/:gymId`, Kd approved
  // `org.manage` 2026-08-26). Every row below names ONE call site, because a
  // mutant is a claim about a call site and not about a subject (:15770).
  // ---------------------------------------------------------------------------
  {
    id: 'O114',
    target: 'repo',
    /** THE ONLY MUTANT IN THIS TABLE THAT WRITES ROWS THE ACTING TEST DID NOT
     *  CREATE, and it does so BY DESIGN: removing the tenancy predicate is how
     *  the predicate is proven load-bearing, and the route then commits against
     *  every row in `gyms`.
     *
     *  Declared so the row guard can ATTRIBUTE that damage instead of treating
     *  it as an alarm (round-3 Low-5) — before this, a sweep containing O114 and
     *  a working guard were mutually exclusive: exit 4 on a healthy table, blind
     *  on a flattened one. **Adding this flag to a mutant is a claim that it
     *  mass-writes, and the sweep reports a declared mutant that moves nothing.**
     *  The reviewer's enumeration found no other mutant in the table that
     *  qualifies today: every sweep mutant keeps `AND ${inScope}`, and O42/O43,
     *  O47, O97/O98 stay row- or user-scoped. */
    writesRows: true,
    why: "TENANCY, R3.2: the gym id leaves the edit's WHERE, so ONE owner's save rewrites the name, city, country and billing currency of EVERY gym in the database. The cross-tenant case this repo has shipped untested four times on this very table (:15259 L-1)",
    from: '      WHERE id = ${input.gymId}\n      RETURNING id, slug, name, city, country, org_type, timezone, locale,',
    to: '      WHERE id IS NOT NULL\n      RETURNING id, slug, name, city, country, org_type, timezone, locale,',
    expect: 'refuses everybody who is not this gym',
  },
  {
    id: 'O115',
    target: 'service',
    why: "THE DOOR ITSELF: the privilege check comes off the edit route, so any trainer — and any member of any gym — can rename somebody else's gym and change the money it is billed in. `requirePrivilege` is what makes 404 and 403 mean what they mean here",
    from: '  await requireWritablePrivilege(deps, gymId, userId, "org.manage");\n\n  const patch: repo.OrgPatch = {};',
    to: '  const patch: repo.OrgPatch = {};',
    expect: 'refuses everybody who is not this gym',
  },
  {
    id: 'O116',
    target: 'service',
    why: "MONEY, R3.1: the currency stops following the country and is left on whatever the gym was created with, so a gym that moves from India to Germany is still billed in rupees under a screen saying it is in Germany — the same fabrication in the opposite direction to :10596's preselected United States",
    from: '    patch.currencyDisplay = resolveCurrency(req.country);',
    to: '    patch.country = normaliseCountry(req.country);',
    expect: 'changing the country moves the currency with it',
  },
  {
    id: 'O117',
    target: 'service',
    why: "AN UNSUPPORTED COUNTRY STOPS BEING REFUSED and is given a fallback currency instead — the exact defect Kd's ruling removes, where a gym in Sydney is quoted in somebody else's money. It is checked BEFORE the transaction so the refusal leaves the row alone; this makes the refusal disappear entirely",
    from: '  const currencyDisplay = currencyForCountry(country);\n  if (currencyDisplay === null) {',
    to: '  const currencyDisplay = currencyForCountry(country) ?? "USD";\n  if (currencyDisplay === null) {',
    expect: 'an unsupported country is refused and changes nothing',
  },
  {
    id: 'O118',
    target: 'repo',
    why: "THE AUDIT LOG STOPS TELLING THE TRUTH: a no-op save writes a row claiming somebody changed something, so a log nobody can read a real event out of. It is the half of this card that only a comparison against the CURRENT row can carry — a console sends back every field it drew",
    from: '    if (changed.length === 0) return { kind: "unchanged", org: before };',
    to: '    if (changed.length === 0 && false) return { kind: "unchanged", org: before };',
    expect: 'writes one audit entry per real change and none for a no-op',
  },
  {
    id: 'O119',
    target: 'repo',
    why: "AN ABSENT KEY STARTS CLEARING THE COLUMN IT NEVER NAMED: a screen editing the gym's name blanks the city it did not display. The `in` check is the whole difference between a PATCH and a PUT, and C26 guards this exact class one component away on the join-code pause switch",
    from: '        city = ${"city" in input.patch ? (input.patch.city ?? null) : before.city},',
    to: '        city = ${input.patch.city ?? null},',
    expect: 'an absent field is untouched and an explicit null clears the city',
  },
  {
    id: 'O120',
    target: 'service',
    why: "THE COUNTRY IS STORED IN WHATEVER CASE IT ARRIVED IN, so `country === 'US'` becomes a question with two answers and the column's own CHECK refuses a lower-case write as an unmapped 23514 — a 500 where a gym owner should see their country saved",
    from: '        country: normaliseCountry(req.country),',
    to: '        country: req.country,',
    // NOT the edit test, which is where this row was first aimed — that fixture
    // creates its gym with an already-upper-case `IN`, so the mutation changed
    // nothing observable and O120 came back ALIVE. The currency test is the one
    // with a LOWER-CASE country in its table (`ie`), and it now asserts the
    // stored country too. :11846's two halves: the anchor says what breaks, the
    // FILTER says what should notice, and this row had the filter wrong.
    expect: 'sets the currency from the gym',
  },
  {
    id: 'O123',
    target: 'repo',
    why: "MONEY, AND IT IS KD'S OWN RULING OF 2026-08-26: the lock comes off, so a PAYING gym can move its own country and with it the currency its invoices are raised in. Both providers refuse this — Stripe will not change a customer's currency after the first invoice and Paddle will not change a country on a live subscription at all",
    from: '    if (movesMoney) {\n      const billed = await tx<{ n: number }[]>`',
    to: '    if (false && movesMoney) {\n      const billed = await tx<{ n: number }[]>`',
    expect: 'freezes the country once the gym is on a paid plan',
  },
  {
    id: 'O124',
    target: 'repo',
    why: "THE OTHER DIRECTION, and it is the half Kd's refinement bought: the trial carve-out goes, so a gym on its card-less 30-day trial is frozen too — the typo locks at exactly the moment before it starts to cost, which is what made 'lock it from day one' the worse answer. A lock that fires too early is invisible to a test that only checks it fires",
    from: "          AND status <> 'trialing'`;",
    to: '          AND status IS NOT NULL`;',
    expect: 'freezes the country once the gym is on a paid plan',
  },
  {
    // T3 ROUND 1 C/H-1's PERMANENT GUARD (:5348 rule 5). The shipped code asked
    // "was the country MENTIONED", which refused a paying owner's whole save
    // because the settings form returned an untouched country with the name they
    // had actually changed. This restores that question.
    id: 'O125',
    target: 'repo',
    why: "A PAYING GYM CAN NO LONGER CHANGE ITS OWN NAME: the guard goes back to asking whether the country was MENTIONED rather than whether the MONEY would move, so every save from a settings form — which sends all four fields back — is refused, and the name, city and time zone Kd ruled editable are thrown away with it",
    from: '    const movesMoney =\n      "country" in input.patch &&',
    to: '    const movesMoney =\n      "country" in input.patch ||',
    expect: 'freezes the country once the gym is on a paid plan',
  },
  {
    // T3 ROUND 1 C/H-2's PERMANENT GUARD, and it is aimed at THE REVIEWER'S OWN
    // PROPOSED FIX — the one this round measured and rejected. It is the shape a
    // later chat is most likely to "simplify" back into the code, because it
    // reads as the obvious answer and closes C/H-1 on its own.
    id: 'O126',
    target: 'repo',
    why: "THE REJECTED ONE-LINER, RESTORED: the guard compares COUNTRIES instead of CURRENCIES, so one of the 59 pre-`0014` gyms — billed in rupees with no country recorded — can record `DE` and flip itself to euros. A paying gym's billing currency moves, which is the entire thing Kd's ruling stops. It closes C/H-1 and re-opens C/H-2, which is exactly why it is a trap",
    from: '      input.patch.currencyDisplay !== undefined &&\n      input.patch.currencyDisplay !== before.currencyDisplay;',
    to: '      input.patch.country !== undefined &&\n      input.patch.country !== (before.country ?? input.patch.country);',
    expect: 'already billed for',
  },
  {
    id: 'O121',
    target: 'shared',
    why: "THE NEW PRIVILEGE LEAVES THE OWNER'S TEMPLATE, so every gym created from now on has an owner who cannot edit their own gym — the ship-dead failure migration `0014`'s backfill exists to prevent, arriving through the OTHER door",
    // RE-ANCHORED 2026-08-27: the trial card added `billing.manage` after
    // `org.manage` in the owner's template, so this anchor matched NOTHING and
    // the whole-table pre-check ABORTED before a byte was written — a no-op
    // mutation would otherwise report ALIVE, whose honest reading is "this
    // guarantee has no test" (:10726's guard). Same guarantee, same target, and
    // the new privilege gets its own SIBLING at O134 rather than being folded in
    // here: a mutant is a claim about ONE line (:15770).
    from: '    "org.manage",\n    "billing.manage",\n  ],\n  manager:',
    to: '    "billing.manage",\n  ],\n  manager:',
    expect: "a brand-new owner's stored ticks include the new privilege",
  },
  {
    id: 'O127',
    target: 'repo',
    // THE MUTANT FOR THE `OWED.md` LINE THIS CARD EXISTS TO CLOSE. Its anchor is
    // a one-liner only because the source names the guarantee on that line —
    // `await lockOrgRow(tx, input.gymId);` appears five times in this file, and a
    // two-line anchor is the CRLF hazard :17676 counted 99 of.
    why: "MONEY: the subscription writer stops locking the gym row, so a trial committing between updateOrg's currency SELECT and its UPDATE is missed and a now-paying gym's billing currency moves — :19656 C/H-3, whose closing half was written onto this card as a requirement",
    expect: 'two simultaneous trial starts produce exactly one subscription',
    from: '    await lockOrgRow(tx, input.gymId); // subscription-writer lock, :19656 C/H-3\n',
    to: '\n',
  },
  {
    id: 'O128',
    target: 'repo',
    why: "ABUSE: the one-trial-per-owner gate disappears, so a fraudster makes a fresh gym every month for a fresh 30 days — the exact chain Kd's approval step used to close and this rule replaced (Part 5 §12)",
    expect: 'one free trial per owner, ever',
    // Deleted rather than inverted, matching the deletion idiom the rest of this
    // table uses: inverting it would also red the happy-path test, and a mutant
    // that reds everything says less about which guarantee it broke.
    from: '    if (used[0] !== undefined) return { kind: "trial_already_used" };\n',
    to: '\n',
  },
  {
    id: 'O129',
    target: 'repo',
    why: 'NUMBER A USER SEES: the trial resolves to the BIGGEST band instead of the smallest, so every gym trials at 2,100 members instead of the 300 Kd ruled (:19129) — and the screen shows them that number',
    expect: 'gets the 300-seat band',
    from: '      ORDER BY seat_cap ASC NULLS LAST, price_minor ASC',
    to: '      ORDER BY seat_cap DESC NULLS LAST, price_minor ASC',
  },
  {
    id: 'O130',
    target: 'repo',
    why: "NUMBER A USER SEES: a plan carrying no trial becomes eligible, so the trial lands on a row whose trial_days is 0 — a trial that ended the instant it began, carrying that plan's seat cap",
    expect: 'gets the 300-seat band',
    from: '        AND trial_days > 0\n',
    to: '\n',
  },
  {
    id: 'O131',
    target: 'repo',
    why: "OWNERSHIP: the live-subscription check stops naming the gym, so one gym reads ANOTHER gym's subscription and is told it is already subscribed — a gym silently denied its own trial because a stranger has one",
    expect: 'gets the 300-seat band',
    from: "      WHERE s.owner_type = 'gym' AND s.owner_id = ${input.gymId}\n        AND s.status IN ('trialing','active','past_due')`;",
    to: "      WHERE s.owner_type = 'gym'\n        AND s.status IN ('trialing','active','past_due')`;",
  },
  {
    id: 'O132',
    target: 'repo',
    why: "MONEY: the trial stops matching the gym's own currency, so a gym in a country we do not price is put on somebody else's money instead of being told we are not open — :10010's standing refusal of a fallback currency, which is how a Canadian gym gets quoted in rupees",
    expect: 'no price book is refused',
    from: '        AND currency = ${gym.currency_display}\n',
    to: '\n',
  },
  {
    id: 'O133',
    target: 'service',
    why: "FALSE ON SCREEN: starting the trial stops shaking loose the owner's own cached entitlements, so the person who just upgraded their gym is shown the free tier's limits for up to a minute on the screen they acted on",
    expect: 'members get the gym plan the moment the trial starts',
    from: '      await bustEntitlements(deps.redis, userId);\n      return startOrgTrialResponseSchema.parse({',
    to: '      await Promise.resolve();\n      return startOrgTrialResponseSchema.parse({',
  },
  {
    id: 'O134',
    target: 'shared',
    why: "SHIP-DEAD: the BILLING privilege leaves the owner's template, so every gym created from now on has an owner who is 403'd on their own trial button — O121's failure through the door this card opened, and the reason migration `0015` backfills the tick onto existing owners",
    expect: 'gets the 300-seat band',
    from: '    "org.manage",\n    "billing.manage",\n  ],\n  manager:',
    to: '    "org.manage",\n  ],\n  manager:',
  },
  // ── WHAT THE CONSOLE IS TOLD ABOUT THE PLAN (O135–O138) ───────────────────
  //
  // The web half put a banner and a seat meter on screen, and both are drawn
  // from two new fields on `/v1/orgs/mine`. Both sit squarely in 4a's "always
  // mutated" column: one is OWNERSHIP (who may learn a gym's billing state) and
  // the other is a NUMBER A USER SEES.
  {
    id: 'O135',
    target: 'service',
    why: "PRIVACY: the gym's plan stops being staff-only, so every ordinary MEMBER of a gym is told what it is on and when its trial runs out — a fact §2.4 keeps on the gym's side of the boundary, served to everybody who ever typed a join code",
    expect: 'tells a plain member NOTHING',
    from: '        r.staffRole === null || r.subscription === null\n          ? null\n          : toOrgSubscription(r.subscription),\n      seatsUsed: r.staffRole === null ? null : r.seatsUsed,',
    to: '        r.subscription === null ? null : toOrgSubscription(r.subscription),\n      seatsUsed: r.seatsUsed,',
  },
  {
    id: 'O136',
    target: 'repo',
    why: 'OWNERSHIP: the seat meter stops counting its own gym, so every gym on a plan is shown the number of paying members in the WHOLE DATABASE — a cross-tenant count on screen, and one that would read "full" at every gym at once',
    // ITS FIXTURE WAS ADDED AFTER THE FACT, AND UNTIL THEN THIS ROW WAS A LIE.
    //
    // The anchor and the filter were both right from the day it was written, and
    // it still proved nothing: the named test built ONE gym, so the correlated
    // count and a whole-table count returned the same number and the mutation
    // changed nothing observable. It reported RED on the dev machine ONLY
    // because 78 unrelated `gym_members` rows happened to be sitting there —
    // measured ALIVE on a throwaway database with nothing else in it.
    //
    // :18652's C/H-3 exactly (*a mutant whose verdict depends on which database
    // you point it at is worse than a missing one*), and :12343's standing
    // lesson from the other side: when a mutant SURVIVES, ask whether the
    // guarantee is observable before assuming the test is missing. Here it did
    // not survive, which is worse — the accident pointed the flattering way.
    //
    // Closed by giving the anchor test a SECOND GYM with its own live,
    // non-complimentary, non-staff member, built before any assertion, so every
    // `seatsUsed` reading in that test is now taken across a tenant boundary.
    expect: 'seat meter counts the same people',
    from: '             WHERE sm.gym_id = g.id\n               AND sm.removed_at IS NULL',
    to: '             WHERE sm.removed_at IS NULL',
  },
  {
    id: 'O137',
    target: 'repo',
    why: 'FALSE ON SCREEN: the meter stops excluding STAFF, so it counts places the seat cap does not charge for — the screen and the door disagreeing about who costs money, which is exactly the defect Kd found on the roster badge, and a gym reads "300 of 300, full" while the door is still admitting people',
    expect: 'seat meter counts the same people',
    from: '               AND NOT EXISTS (\n                 SELECT 1 FROM gym_staff ss\n                 WHERE ss.gym_id = sm.gym_id AND ss.user_id = sm.user_id)',
    to: '               AND true',
  },
  {
    id: 'O138',
    target: 'repo',
    why: "FALSE ON SCREEN: the meter counts COMPLIMENTARY places, so the owner's own §4.0-step-6 seat is billed to them — every brand-new gym opens its console reading \"1 place used\" before a single member has joined",
    expect: 'on no plan, and how full it is anyway',
    from: '               AND sm.complimentary = false\n',
    to: '\n',
  },

  // ── TRIALS ACTUALLY END (Kd ruling :22215 step 1) ──────────────────────────
  //
  // Every row below is in rule 4a's MONEY column, and O140 is the one that
  // re-creates the exact hole this card was built to close.
  //
  // Deliberately NOT mutated, per the same rule: the `owner_type = 'gym'`
  // filter. Nothing in the product inserts a `user` subscription, so the
  // mutation has NO OBSERVABLE SUBJECT and would come back ALIVE for a true
  // reason — :12343's shape, and adding it would put a permanently-alive row in
  // a table whose header says no mutant is expected alive. It earns a mutant on
  // the day consumer trials ship, which is what its `OWED.md` line is for.
  {
    id: 'O139',
    target: 'trialSweep',
    suite: TRIAL_SWEEP_SUITE,
    why: "MONEY: the job stops asking whether the subscription is a TRIAL, so it cancels gyms that are PAYING — every gym that converts from a trial keeps its old `trial_ends_at`, so the first run after conversion ends the plan they are being charged for. Dunning is P3.8's and this job must not be able to reach it",
    expect: 'a gym that pays is never touched',
    from: "        AND status = 'trialing'\n",
    to: '\n',
  },
  {
    id: 'O140',
    target: 'trialSweep',
    suite: TRIAL_SWEEP_SUITE,
    why: "MONEY, AND IT IS THIS CARD'S OWN HOLE PUT BACK: the trial 'ends' into a status that is still in the granting set, so `getCandidates` keeps handing every member of that gym its 5 meal scans a day for ever — the run reports a number, the audit row says it happened, and nothing actually changed for anybody",
    expect: 'members lose the gym grant',
    from: "      SET status = 'expired'",
    to: "      SET status = 'past_due'",
  },
  {
    id: 'O141',
    target: 'trialSweep',
    suite: TRIAL_SWEEP_SUITE,
    why: 'ON SCREEN AND FALSE: the comparison inverts, so a gym is cut off on day one of its thirty and a gym that is genuinely finished runs for ever — the promise Kd sells the trial on, broken in both directions at once',
    expect: 'still inside its thirty days',
    from: '        AND trial_ends_at <= ${now}',
    to: '        AND trial_ends_at > ${now}',
  },
  {
    id: 'O142',
    target: 'trialSweep',
    suite: TRIAL_SWEEP_SUITE,
    // **THIS MUTANT MAKES THE SUITE WRITE ROWS IT DOES NOT OWN.** Run locally it
    // ends every live gym trial in the database; the damage is one re-seed, and
    // it was declared here rather than discovered.
    //
    // **AND THE DETECTOR COULD NOT SEE IT UNTIL T3 ROUND 1 (L-5).** That guard
    // fingerprinted `gyms` alone (:19803 C/H-1) while this statement writes
    // `subscriptions`, so a sweep containing this row printed *"gym rows
    // verified — no unattributed changes"* over a mass expiry. Both tables are
    // fingerprinted now, and `writesRows` below is what tells the guard this
    // one's damage is EXPECTED — **checked in both directions, so declaring it
    // and moving nothing is reported too.**
    writesRows: true,
    why: "OWNERSHIP/MONEY: the scope predicate stops being a predicate, so any bounded run reaches EVERY gym in the table. In production the nightly job is unbounded anyway — what this breaks is the smoke instrument, where `tools/trial-sweep.ts --now` would end every gym's trial at once instead of the one being demonstrated",
    expect: 'ends only the gyms it was given',
    from: '        AND (${scope}::uuid[] IS NULL OR owner_id = ANY(${scope}::uuid[]))\n',
    to: '\n',
  },
  {
    id: 'O143',
    target: 'trialSweep',
    suite: TRIAL_SWEEP_SUITE,
    why: "SAVES: the audit row is never written, so the ONLY record of why a gym's console changed overnight does not exist. Part 3 §3.3 requires every mutating call to write one, and this is the mutation an owner is most likely to ring up about",
    expect: 'records who did it',
    from: '    for (const row of rows) {',
    to: '    for (const row of rows.slice(0, 0)) {',
  },
  {
    id: 'O144',
    target: 'trialSweep',
    suite: TRIAL_SWEEP_SUITE,
    why: "SAVES: the UPDATE moves back onto the pool and out of the transaction, so a failure between the expiry and its audit leaves the rows already expired with NO audit row ever written — the retry matches nothing (`status = 'trialing'` is gone) and the trail is unrecoverable. This is :13075's C/H-2 on `sweep.ts`, aimed at its twin before it can be shipped a second time",
    expect: 'rolls the expiry back',
    from: '    const rows = await tx<Row[]>`',
    to: '    const rows = await deps.sql<Row[]>`',
  },

  // ── THE PRICE LIST AND THE TRIAL-ARM SELECTOR (Kd :22215 §3.5, :22697) ──────
  //
  // Every row below sits in :5857 rule 4a's expensive columns without argument:
  // MONEY and NUMBERS A USER SEES (this is the first card that puts a price on a
  // screen at all) and OWNERSHIP (a route that answers about a named gym).
  //
  // They carry `suite: PLANS_SUITE` for the reason the sweep rows carry theirs
  // — a row that forgot it would run the routes suite, which asserts no price,
  // and report a RED that means nothing (:4718 F2).
  {
    id: 'O145',
    target: 'shared',
    suite: PLANS_SUITE,
    why: "MONEY, AND IT IS THE BRICK WALL PUT BACK: Canada returns to CAD, which the seeded book has no rows for, so a Canadian gym is created and then refused its own trial with 'We're not open for business in your country yet'. Kd ruled the dollar precisely because an unskippable prompt turns that into a gym stranded on a screen whose only button fails (:22215 §4)",
    expect: 'starts its trial on the dollar book',
    from: '  CA: "USD",',
    to: '  CA: "CAD",',
  },
  {
    id: 'O146',
    target: 'service',
    suite: PLANS_SUITE,
    why: "OWNERSHIP: the price list drops to a privilege every TRAINER holds, so anybody the gym has hired can read what the gym is quoted. It is the same seam :15534's C/H-1 was, and Kd's ruling of 2026-08-28 is that this prompt stops only the person who can actually pay",
    expect: 'a trainer is refused the price list',
    from: 'const { org } = await requirePrivilege(deps, gymId, userId, "billing.manage");',
    to: 'const { org } = await requirePrivilege(deps, gymId, userId, "members.read");',
  },
  {
    id: 'O147',
    target: 'repo',
    suite: PLANS_SUITE,
    why: "ON SCREEN AND FALSE: the ladder inverts, so the FIRST plan a gym owner reads is the 2,100-seat band at $129 rather than the $35 entry price. Nothing on the screen says the list is descending, so the honest reading of the top row — 'this is what it costs' — is wrong by a factor of nearly four",
    expect: 'cheapest band first',
    // RE-ANCHORED TWICE IN THE FIX ROUND, and both failures were the harness
    // refusing to let a bad anchor through silently.
    //
    // (1) Low-7 added `LIMIT ${ORG_PLANS_LIMIT}` on the next line, so the old
    //     anchor — which ended at the closing backtick — matched NOTHING.
    // (2) Dropping the backtick made it match TWICE: `startGymTrial` orders by
    //     the same rule with deeper indentation, and the four-space version is a
    //     SUBSTRING of the six-space one. That is the identical trap O148 hit,
    //     in the same file, in the same session.
    //
    // Remedy both times is :21157's, not a two-line anchor (:17676's CRLF
    // hazard): the line was made unique IN THE SOURCE with a trailing comment.
    from: '    ORDER BY seat_cap ASC NULLS LAST, price_minor ASC -- the ladder Kd priced',
    to: '    ORDER BY seat_cap DESC NULLS LAST, price_minor DESC -- the ladder Kd priced',
  },
  {
    id: 'O148',
    target: 'repo',
    suite: PLANS_SUITE,
    // The anchor carries its own trailing comment because `AND active = true`
    // also appears inside `startGymTrial` and one is a SUBSTRING of the other
    // (six spaces against eight). A two-line anchor is :17676's 99-strong CRLF
    // hazard, so the line was made unique IN THE SOURCE instead — :21157's
    // remedy, and never re-aimed at whichever line came first (:15770).
    why: "MONEY: retired bands come back into the list, so a buyer is quoted the PRE-:18488 price book beside the ruled one — the ₹999 micro tier and the 25-seat caps Kd re-priced. A person choosing a plan from that list is choosing a price we do not sell at",
    // **THE FILTER IS THE RUPEE TEST AND IT HAS TO BE — THIS ROW SURVIVED TWICE
    // BEFORE IT WAS RIGHT, ONCE FOR EACH HALF (:11846's two halves).**
    //
    // First run: it named the USD test, and the guarantee is INVISIBLE there —
    // every retired row in the book is INR, so deleting `active = true` changes
    // nothing a dollar gym can see. That was the TEST half, and the fix was an
    // assertion listing the five retired INR codes.
    //
    // Second run: it STILL survived, because the filter still named the USD
    // test while the new assertion lives in the rupee one. That is :21580's C91
    // verbatim — a mutant pointed at a test that never exercises its subject —
    // and it is the half this repo keeps recording last.
    expect: 'quotes an Indian gym in rupees',
    from: '      AND active = true -- a retired band must never be quoted to a buyer\n',
    to: '\n',
  },
  {
    id: 'O149',
    target: 'repo',
    suite: PLANS_SUITE,
    why: "MONEY: the currency filter goes, so every gym is shown every book at once — an Indian gym reads dollar prices next to its rupee ones with nothing saying which it would be charged in. This is :10010's no-fallback rule failing in the loudest possible direction",
    expect: 'quotes an Indian gym in rupees',
    from: '      AND currency = ${currency}\n',
    to: '\n',
  },
  {
    id: 'O150',
    target: 'repo',
    suite: PLANS_SUITE,
    why: "ON SCREEN AND FALSE, AND IT IS :22341 §7 PUT BACK: the evidence keys on the STATUS instead of the durable column, so the moment a trial expires the owner reads as never having trialled. That is exactly the state that printed 'Start your 30-day free trial' over a button which could only answer 409 — the defect this whole card exists to remove, and the reason the source says IT TESTS trial_ends_at AND NEVER A STATUS",
    expect: 'still reports the owner',
    from: "               AND ts.trial_ends_at IS NOT NULL",
    to: "               AND ts.status = 'trialing'",
  },
  {
    id: 'O151',
    target: 'service',
    suite: PLANS_SUITE,
    why: "MONEY, BY A FACTOR OF TEN: the decimal point moves one place, so the $35 band prints as $350 and the ₹1,500 one as ₹15,000. The formatter is the ONLY money field on the wire — the shared schema deliberately sends no minor-unit integer beside it — so there is nothing else on the screen for a reader to check it against",
    expect: 'at the ratified prices',
    from: '  const whole = digits === 0 ? raw : raw.slice(0, raw.length - digits);',
    to: '  const whole = digits === 0 ? raw : raw.slice(0, raw.length - digits + 1);',
  },
  {
    id: 'O152',
    target: 'service',
    suite: PLANS_SUITE,
    // ADDED IN THE FIX ROUND (T3 round 1, Low-8). The reviewer noted the
    // withholding line had no mutant while :5857 rule 4a puts OWNERSHIP in the
    // always-mutated column. The narrowing and its guard land together.
    why: "OWNERSHIP: the field widens back to every staff member, so a TRAINER at one gym is told whether their employer has spent a free trial — a fact about a PERSON that follows the owner across gyms the reader has no relationship with. Not a breach (one bit, about their own employer) but it has no consumer: :22921 §1 rules the prompt this feeds stops only somebody holding `billing.manage`",
    expect: 'a trainer is told nothing',
    from: 'privileges.includes("billing.manage") ? r.ownerTrialUsed : null',
    to: 'r.staffRole !== null ? r.ownerTrialUsed : null',
  },
  {
    id: 'O153',
    target: 'service',
    suite: PLANS_SUITE,
    // ADDED IN THE FIX ROUND (T3 round 1, Low-6): the fractional half of the
    // formatter had NO OBSERVER — a mutant forcing `isWhole` true stayed GREEN,
    // and O151 pins only the whole branch. The fixture that gives it a subject
    // and the mutant that watches it ship together.
    why: "MONEY: every price loses its minor units, so a $34.99 band prints as $34 — a gym is quoted a penny less than it will be charged, and the whole-number bands look identical either way, which is exactly why this went unwatched until a fractional fixture existed",
    expect: 'prints the minor units',
    from: '  const isWhole = !/[1-9]/.test(frac);',
    to: '  const isWhole = true;',
  },

  // ══ PART 3 §4.2's READ-ONLY CONSOLE — Kd's ruling 2026-08-29 ═══════════════
  //
  // Every row here sits in :5857 rule 4a's ALWAYS-MUTATED columns without
  // argument: this is what decides whether a gym that is not a customer can go
  // on issuing join codes, admitting members and changing its own record, and
  // three of the six run in the OPPOSITE direction — a gate that refuses too
  // much is not a safer gate, it is a console taken away from a paying gym.
  {
    id: 'O154',
    target: 'service',
    why: "THE WHOLE CARD, DELETED: the refusal never fires, so a gym whose trial ended keeps a fully working console — it issues join codes, confirms new members and edits its own details while granting those members nothing. That is the state Kd's ruling exists to remove, and the one the money hole was measured in (:22215 §2)",
    expect: 'refuses every console write',
    from: '    throw new OrgsError(409, "gym_not_on_plan", GYM_NOT_ON_PLAN_MESSAGE);',
    to: '    void GYM_NOT_ON_PLAN_MESSAGE;',
  },
  {
    id: 'O155',
    target: 'repo',
    why: "THE GATE'S READER WIDENED TO THE ENDED STATUSES, so an `expired` subscription counts as live and a lapsed gym writes freely. It is the same defect as O154 arriving through the reader rather than the gate — and it is the shape :12731 warns about from the other side, a status set quietly growing past §4.1's three",
    expect: 'refuses every console write',
    from: "        AND s.status IN ('trialing','active','past_due') -- read-only gate, §4.1's live set",
    to: "        AND s.status IN ('trialing','active','past_due','expired','canceled')",
  },
  {
    id: 'O156',
    target: 'repo',
    why: "ON SCREEN AND FALSE: the console is told it may change things while the server refuses every attempt. The screen then draws live buttons whose every press is a 409 — a person blocked from finishing something with no sentence saying why, which is :5807 1a on both of its halves",
    expect: 'read-only flag and the write refusal move together',
    from: '    consoleReadOnly: r.sub_status === null,',
    to: '    consoleReadOnly: false,',
  },
  {
    id: 'O157',
    target: 'service',
    why: "§2.4's BOUNDARY: a plain member of the gym is told whether its console is locked. When a gym stops paying is the gym's business and not its members' — the same rule that withholds `subscription` and `seatsUsed` one line up, and the boundary :23128's Low-8 got wrong once already in the other direction",
    expect: 'a plain member nothing at all',
    from: '      consoleReadOnly: r.staffRole === null ? null : r.consoleReadOnly,',
    to: '      consoleReadOnly: r.consoleReadOnly,',
  },
  {
    id: 'O158',
    target: 'service',
    why: "AN INFORMATION BOUNDARY REVERSED: the plan is checked BEFORE the privilege, so any signed-in stranger holding a uuid learns which gyms have stopped paying — a 409 where the module's standing answer is 404. `requirePrivilege`'s own comment says why that 404 exists (a 403 confirms the gym exists and lets anybody enumerate gyms); this turns the new refusal into exactly that leak",
    expect: 'a stranger still gets 404',
    from: '  const authorised = await requirePrivilege(deps, gymId, userId, privilege);',
    to: '  if (!(await repo.gymHasLivePlan(deps.sql, gymId))) throw new OrgsError(409, "gym_not_on_plan", GYM_NOT_ON_PLAN_MESSAGE);\n  const authorised = await requirePrivilege(deps, gymId, userId, privilege);',
  },
  {
    id: 'O159',
    target: 'service',
    why: "READ-ONLY BECOMES SHUT, which is the direction a guard is never tested in unless somebody writes it down (:7104's PG1). The roster is refused to a gym that has lapsed, so an owner cannot even SEE who is in their gym while being asked to pay for it — §4.2 says read-ONLY, and Kd's arm A keeps a lapsed gym's people and their data exactly where they are",
    expect: 'READS and the pay path keep working',
    from: '  const { org, role } = await requirePrivilege(deps, gymId, userId, "members.read");',
    to: '  const { org, role } = await requireWritablePrivilege(deps, gymId, userId, "members.read");',
  },
  {
    id: 'O160',
    target: 'service',
    why: "THE WAY OUT IS GATED ON BEING OUT: the trial door itself refuses a gym with no plan, so the one action left to a lapsed gym is the one it cannot take. That is :22215 §4's brick wall built by hand — the console says subscribe, and subscribing is refused because the gym has not subscribed",
    expect: 'READS and the pay path keep working',
    from: '  await requirePrivilege(deps, gymId, userId, "billing.manage");',
    to: '  await requireWritablePrivilege(deps, gymId, userId, "billing.manage");',
  },

  // ── THE HELD REQUEST (Kd 2026-08-29, :24141 §1) ──────────────────────────
  //
  // 4a's DATA-LOSS column without argument: what these rows break is the thing
  // that stops a person's request being deleted while nobody at the gym was
  // ALLOWED to act on it. This card changes SERVER behaviour, so database
  // mutants are in scope.
  //
  // **PAIRED IN BOTH DIRECTIONS.** O161/O162/O166/O167 run the lock LEAKING;
  // O163/O164/O165 run it firing too widely or reporting itself wrongly. A hold
  // that never releases is not a safer hold — it is an application that can
  // never resolve on a gym that is paying (:7104's PG1).
  {
    id: 'O161',
    target: 'sweep',
    suite: SWEEP_SUITE,
    why: "THE HOLD DELETED: the expiry stops asking whether the gym has a plan, so a lapsed gym's applications die on day 14 exactly as before — the person waited a fortnight for a yes that could not come, which is the defect Kd's ruling exists to remove",
    expect: 'HOLDS an overdue application while the gym has no live plan',
    from: '\n        AND ${gymOnPlan}',
    to: '',
  },
  {
    id: 'O162',
    target: 'sweep',
    suite: SWEEP_SUITE,
    why: "THE STATUS SET WIDENED TO THE ENDED ONES, so an `expired` subscription counts as live and the gym whose TRIAL just ran out — the commonest way to reach this state, and the one the ruling is about — goes on deleting requests. **This is O155's shape and it is why the headline test uses `expireGym` rather than `lapseGym`**: with no row at all `EXISTS` is false whatever statuses are listed, so a test that lapses by DELETING cannot see this mutation",
    expect: 'HOLDS an overdue application while the gym has no live plan',
    from: "      AND s.status IN ('trialing','active','past_due')",
    to: "      AND s.status IN ('trialing','active','past_due','expired')",
  },
  {
    id: 'O163',
    target: 'sweep',
    suite: SWEEP_SUITE,
    why: 'THE HOLD BECOMES INVISIBLE TO OPS: `heldNoPlan` always reports zero, so the one number that says "these requests are alive and waiting on a plan" reads as though nothing is being held at all. The rows are still safe; nobody can see that they are',
    expect: 'HOLDS an overdue application while the gym has no live plan',
    from: '    heldNoPlan: due - dueOnPlan,',
    to: '    heldNoPlan: 0,',
  },
  {
    id: 'O164',
    target: 'sweep',
    suite: SWEEP_SUITE,
    why: 'THE TWO REASONS COLLAPSE BACK INTO ONE: `heldForNotice` counts every due row again, so a lapsed gym\'s held requests are reported as "the chase step is not doing its job". That number exists to be acted on — a non-zero one means an operator goes hunting a broken worker that is working perfectly',
    expect: 'counts a due row as held for ONE reason at a time',
    from: '    heldForNotice: dueOnPlan - expiredRows.length,',
    to: '    heldForNotice: due - expiredRows.length,',
  },
  {
    id: 'O165',
    target: 'sweep',
    suite: SWEEP_SUITE,
    why: "THE CHASE GATED TOO, WHICH LOOKS TIDIER AND BUILDS A SECOND HIDDEN HOLD: a lapsed gym's applications are never flagged, and an unflagged row can never expire — so it survives the gym paying up, then sits pending for a further two days minimum, and for ever if it is never chased again. The hold belongs on the statement that DESTROYS something, and this is the row that says so",
    expect: 'keeps CHASING a lapsed gym',
    from: "      AND applied_at <= ${now}::timestamptz - (${GYM_REMINDER_FIRST_DAYS} * INTERVAL '1 day')",
    to: "      AND applied_at <= ${now}::timestamptz - (${GYM_REMINDER_FIRST_DAYS} * INTERVAL '1 day')\n      AND ${gymOnPlan}",
  },
  {
    id: 'O166',
    target: 'repo',
    why: "THE APPLICANT IS TOLD THE WRONG THING BY THE SAME WIDENING AS O162, one file over: a gym whose trial ended reads as able to confirm, so the waiting card goes on saying 'one tap at the front desk' about a tap that answers 409. The reader and the sweep's gate are separate copies of §4.1's three statuses and this is the row that stops them drifting apart",
    expect: 'tells the applicant whether their gym can act on the request',
    from: "               AND s.status IN ('trialing','active','past_due')",
    to: "               AND s.status IN ('trialing','active','past_due','expired')",
  },
  {
    id: 'O167',
    target: 'repo',
    why: "THE FIELD STOPS ASKING ANYTHING: `EXISTS(...) IS NOT NULL` is true for every gym, so every applicant is told their gym can confirm them. It is O166's defect without the subtlety — the whole answer, not one status — and it is the one a careless edit to this SELECT actually produces",
    expect: 'tells the applicant whether their gym can act on the request',
    from: '           ) AS org_can_confirm',
    to: '           ) IS NOT NULL AS org_can_confirm',
  },

  // ── THE FOUR-MONTH CLOSURE (Kd ruling 2026-08-31) ─────────────────────────
  //
  // 4a's expensive columns, and the argument is short: the worst outcome in this
  // card's blast radius is a PAYING gym closed, and the second worst is a gym
  // closed with no record of why. This card changes SERVER behaviour, so
  // database mutants are in scope.
  //
  // **PAIRED IN BOTH DIRECTIONS, because a job that closes nothing passes every
  // test that only checks something stayed open** (:7104's PG1). O168/O169/O171
  // run the closure firing too WIDELY or too EARLY; O170 runs it inverted;
  // O172/O176 run it undoing an operator's own hand.
  //
  // Deliberately NOT mutated, per the same rule: the refusal wording, and the
  // `g.status = 'active'` restatement — the file says in as many words that
  // `archived_at IS NULL` is the condition doing the work, so a mutation of the
  // restatement has NO OBSERVABLE SUBJECT and would come back ALIVE for a true
  // reason (:12343's shape, and the same call `trialSweep.ts` made about
  // `owner_type = 'gym'`).
  //
  // ALSO DELIBERATELY NOT MUTATED, added at T3 round 1 (2026-08-31): the UTC
  // round trip around the month arithmetic. Its subject is the DATABASE
  // SESSION'S TimeZone, which no test in this repo sets and vitest cannot vary
  // per suite, so reverting it would come back ALIVE against a UTC session and
  // the ALIVE would mean "the session is UTC here", not "nothing guards this".
  // A mutant that cannot be killed for a true reason is worse than no mutant
  // (:6277's shape) — the guard is the comment on the line plus this note.
  //
  // O177/O178/O181 were added by that same round: the first two run conditions
  // it FOUND MISSING, and the third runs the nightly job's own configuration
  // selecting nothing at all.
  {
    id: 'O168',
    target: 'archiveSweep',
    suite: ARCHIVE_SWEEP_SUITE,
    why: "MONEY, AND IT IS THE WORST THING THIS CARD COULD DO: the job stops asking whether the gym is on a plan, so a gym that trialled, converted and has been PAYING ever since is closed four months after its trial ended — its join code stops working and nobody can be confirmed into it, while the invoices keep coming. Every gym that converts from a trial carries that old `ended_at` for ever, so this is not an edge case, it is all of them",
    expect: 'a gym that is on a plan is never closed',
    from: '        AND NOT EXISTS (\n          SELECT 1 FROM subscriptions s\n          WHERE s.owner_type = \'gym\' AND s.owner_id = g.id\n            AND s.status IN (\'trialing\',\'active\',\'past_due\'))\n',
    to: '',
  },
  {
    id: 'O169',
    target: 'archiveSweep',
    suite: ARCHIVE_SWEEP_SUITE,
    why: "THE OLDEST ENDING INSTEAD OF THE NEWEST: a gym that trialled last year, paid for months and lapsed LAST WEEK is closed immediately, because the trial's date is the one being measured. It is the difference between `max` and `min` and it is invisible on any gym with only one ended row — which is every fixture except the one written for this",
    expect: 'not closed for a trial that ended a year ago',
    from: '          SELECT max(s2.ended_at) FROM subscriptions s2',
    to: '          SELECT min(s2.ended_at) FROM subscriptions s2',
  },
  {
    id: 'O170',
    target: 'archiveSweep',
    suite: ARCHIVE_SWEEP_SUITE,
    why: 'THE COMPARISON INVERTED: a gym is closed the DAY its plan ends and a gym that has been gone for a year is never closed — the promise broken in both directions at once, which is O141 on the trial sweep arriving at its sibling',
    expect: 'the window is four months, to the minute',
    // RE-AIMED AT T3 ROUND 1 (2026-08-31): the comparison gained the UTC round
    // trip, so the old anchor matched nothing. The pre-check would have aborted
    // the whole sweep rather than reporting a false verdict, which is :13336's
    // lesson working — but a re-aim is still a claim, and this one was proven by
    // watching the row go RED after the move, not by reading it.
    from: '        ) <= ((${now}::timestamptz',
    to: '        ) >= ((${now}::timestamptz',
  },
  {
    id: 'O171',
    target: 'archiveSweep',
    suite: ARCHIVE_SWEEP_SUITE,
    why: "KD'S NUMBER MOVED: four months becomes one, so a gym that stopped paying in April is closed in May. He ruled the four on 2026-08-31 against the spec's fourteen days, and :22215 §6 requires that it not be shortened or lengthened without asking — this is the row that makes an edit to it visible",
    expect: 'the window is four months, to the minute',
    from: 'export const ARCHIVE_AFTER_MONTHS = 4;',
    to: 'export const ARCHIVE_AFTER_MONTHS = 1;',
  },
  {
    id: 'O172',
    target: 'archiveSweep',
    suite: ARCHIVE_SWEEP_SUITE,
    why: "THE OPERATOR IS OVERRULED BY THE MACHINE: the sweep stops asking whether this gym has been closed before, so a gym re-opened by hand is closed again the very next night — the plan still ended five months ago. Today `tools/gym-restore.ts` is the ONLY way back from `archived` (nothing in the product can put a gym on a plan), so a restore that lasts one night is no way back at all",
    expect: 'not closed again the next night',
    // RE-AIMED AT T3 ROUND 1 (2026-08-31), same reason as O170: the condition
    // grew its second half, so the one-line anchor stopped matching. This row
    // still deletes the WHOLE condition; O177 below deletes only the new half.
    from: "        AND (\n          g.archived_at IS NULL\n          OR EXISTS (\n            SELECT 1 FROM subscriptions s4\n            WHERE s4.owner_type = 'gym' AND s4.owner_id = g.id\n              AND s4.ended_at > g.archived_at)\n        )\n",
    to: '',
  },
  {
    id: 'O177',
    target: 'archiveSweep',
    suite: ARCHIVE_SWEEP_SUITE,
    why: "A RESTORE BECOMES PERMANENT IMMUNITY: without the re-arming half, `archived_at IS NULL` stops meaning \"an operator has overruled this closure\" and starts meaning \"an operator overruled a closure once, so this gym is outside the policy for ever\". A gym re-opened by hand, later on a plan, later lapsed again and dead another four months is never closed — silently, and it is the state every gym reaches the day the payment card re-opens gyms automatically. This is the defect T3 round 1 found in the shipped statement, and this row is what stops it coming back",
    expect: 'closed again if its NEXT plan',
    from: "\n          OR EXISTS (\n            SELECT 1 FROM subscriptions s4\n            WHERE s4.owner_type = 'gym' AND s4.owner_id = g.id\n              AND s4.ended_at > g.archived_at)",
    to: '',
  },
  {
    id: 'O178',
    target: 'archiveSweep',
    suite: ARCHIVE_SWEEP_SUITE,
    why: "AN UNDATED ENDING IS COUNTED FROM THE WRONG DATE: max() skips NULLs, so a gym carrying an old stamped row plus a newer row nobody dated is measured from the OLD one and closed on the spot. It is O169's harm arriving through a NULL instead of through min(), and the only thing standing between the product and it — before T3 round 1 — was a sentence in a comment saying the writer always stamps",
    expect: 'newest ending was never dated',
    from: "        AND NOT EXISTS (\n          SELECT 1 FROM subscriptions s3\n          WHERE s3.owner_type = 'gym' AND s3.owner_id = g.id\n            AND s3.ended_at IS NULL\n            AND s3.status NOT IN ('trialing','active','past_due'))\n",
    to: '',
  },
  {
    id: 'O179',
    target: 'archiveSweep',
    suite: ARCHIVE_SWEEP_SUITE,
    why: "THE CLOSURE IS STAMPED WITH THE WALL CLOCK INSTEAD OF THE RUN'S: `archived_at` stops recording the instant the sweep decided and records whenever the statement happened to execute. It was ALIVE when T3 round 1 ran it — the suite asserted only that the column was not null — and it is not cosmetic now: the re-arm condition compares this column against `ended_at`, so a stamp from the wrong clock re-arms gyms nobody swept, and `tools/gym-restore.ts` answers an owner's \"when did my gym close?\" out of it",
    expect: 'is closed four months later',
    from: "SET status = 'archived', archived_at = ${now}",
    to: "SET status = 'archived', archived_at = now()",
  },
  {
    id: 'O173',
    target: 'archiveSweep',
    suite: ARCHIVE_SWEEP_SUITE,
    // DECLARED, AND THE GUARD WAS WIDENED IN THIS SAME COMMIT TO SEE IT: while
    // this row is live the suite closes every gym in the database that has ever
    // lapsed, and until 2026-08-31 the fingerprint did not watch `gyms.status`
    // at all — it would have printed "no unattributed changes" over exactly
    // that. :22782's L-5, on schedule.
    //
    // **MEASURED, AND THE HARNESS SAID SO ITSELF: this row moves rows it does
    // not own, and NOT rows that existed before the run** — so the first sweep
    // after it was written printed *"O173 declares writesRows and moved no
    // row"*. Both halves are true and the claim stays. The rows it can reach are
    // the ones carrying `ended_at`, and that column is three hours old: only
    // this suite and `orgs.trialSweep.test.ts` write it, both create their gyms
    // inside the run and delete them after, and four suites share one database —
    // so an unscoped run at a future clock closes the trial sweep's gyms
    // mid-assertion while the fingerprint, taken BEFORE either suite started,
    // has never heard of them. The declaration describes the blast radius
    // honestly; the detector reports only the pre-existing part of it, which is
    // its documented limit and not a disagreement.
    writesRows: true,
    why: "A TABLE-WIDE JOB LOSES ITS BOUNDS: the scope predicate goes, so a run aimed at one gym closes every lapsed gym in the database. It is also what makes this suite's own counts meaningless — four suites share one database, and a sweep at a future clock reaches all of them",
    expect: 'closes only the gyms it was given',
    from: '        AND (${scope}::uuid[] IS NULL OR g.id = ANY(${scope}::uuid[]))\n',
    to: '',
  },
  {
    id: 'O174',
    target: 'service',
    why: "A CLOSED GYM STAYS WRITABLE: the console's write gate stops asking whether the gym is closed and asks only about the plan, so the day :19016's admin panel suspends a fraudulent gym that is still paying, that gym carries on issuing join codes and admitting members through every one of its twelve write doors. Every other gate in this module asks about the PLAN and not about the GYM, which is why this line is the only thing standing there",
    expect: 'a CLOSED gym refuses a console write',
    from: '  if (authorised.org.status !== "active") {\n    throw new OrgsError(409, "org_archived", GYM_ARCHIVED_MESSAGE);\n  }\n',
    to: '',
  },
  {
    id: 'O175',
    target: 'archiveSweep',
    suite: ARCHIVE_SWEEP_SUITE,
    why: "SAVES: the UPDATE moves back onto the pool and out of the transaction, so a failure between the closure and its audit leaves gyms already closed with NO audit row ever written — and that row is the only thing that will ever explain to an owner why their gym shut, and the only record `tools/gym-restore.ts` is answering. :13075's C/H-2 aimed at a third sweep before it can be shipped a third time",
    expect: 'rolls the closure back',
    from: '    const rows = await tx<Row[]>`',
    to: '    const rows = await deps.sql<Row[]>`',
  },
  {
    id: 'O176',
    target: 'repo',
    suite: ARCHIVE_SWEEP_SUITE,
    why: "THE RESTORE ERASES ITS OWN MEMORY: re-opening a gym clears `archived_at` as well as the status, which looks tidier and makes the restore last exactly one night — the next run sees a gym with no live plan, a plan that ended five months ago and no record of having been closed, and closes it again. It is O172's defect reached from the other file, and it is why that column deliberately survives the restore",
    expect: 'not closed again the next night',
    from: "      UPDATE gyms SET status = 'active'",
    to: "      UPDATE gyms SET status = 'active', archived_at = NULL",
  },
  {
    id: 'O180',
    target: 'service',
    why: "THE TWO REFUSALS SWAP, AND STAFF OF A CLOSED GYM ARE TOLD SOMETHING THEIR OWN SCREEN CONTRADICTS: the archived check answers first, so every gym this sweep closes — no live plan AND archived — replies `org_archived` while its console goes on showing the read-only banner built from `GYM_NOT_ON_PLAN_MESSAGE`. The order is the load-bearing half of that guard and the whole reason the new refusal is invisible today; before T3 round 1 nothing observed it, because the only test in the suite that reached the guard used a gym that was archived AND paying, which answers the same either way",
    expect: 'cites the PLAN, not the closure',
    from: '  const authorised = await requirePrivilege(deps, gymId, userId, privilege);\n  if (!(await repo.gymHasLivePlan(deps.sql, gymId))) {',
    to: '  const authorised = await requirePrivilege(deps, gymId, userId, privilege);\n  if (authorised.org.status !== "active") {\n    throw new OrgsError(409, "org_archived", GYM_ARCHIVED_MESSAGE);\n  }\n  if (!(await repo.gymHasLivePlan(deps.sql, gymId))) {',
  },
  {
    id: 'O181',
    target: 'archiveSweep',
    suite: ARCHIVE_SWEEP_SUITE,
    why: "THE NIGHTLY JOB BECOMES A PERMANENT SILENT NO-OP: the IS NULL short-circuit goes, so an unscoped run compares every gym against `ANY(NULL)`, matches nothing and closes nothing — for ever, at 04:30, with a clean log line saying `archived: 0` every morning. Every OTHER test in the suite passes a scope and would stay green, which is exactly why the test this row is aimed at had to be written: `worker.ts` is the only caller that passes none",
    expect: 'with no scope at all, still selects',
    from: '        AND (${scope}::uuid[] IS NULL OR g.id = ANY(${scope}::uuid[]))',
    to: '        AND (g.id = ANY(${scope}::uuid[]))',
  },

  // -------------------------------------------------------------------------
  // OPENING HOURS (Kd 2026-08-31, :26624 + :26684 + :26736). Every row below is
  // in one of rule 4a's ALWAYS-MUTATED columns — ownership, a number or state a
  // user SEES and could see falsely, or data loss — and nothing here mutates
  // wording, layout or a comment.
  // -------------------------------------------------------------------------
  {
    id: 'O182',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "OWNERSHIP: the session read stops being scoped to one gym, so every gym's timetable is served to every other gym's members and staff. Invisible to every ROUTE test in the suite — the service hands the repo the id it just authorised, so a mismatched pair is unreachable from a route — which is why the tenancy block calls this function directly",
    expect: "never returns another gym's sessions",
    from: '    FROM gym_hours\n    WHERE gym_id = ${gymId}',
    to: '    FROM gym_hours\n    WHERE (gym_id = ${gymId} OR true)',
  },
  {
    id: 'O183',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "OWNERSHIP: the CLOSURE read loses its gym scope, so a member's gym card lists closures other gyms typed — including their notes, which are free text somebody wrote for their own members",
    expect: "never returns another gym's sessions",
    from: '    WHERE c.gym_id = ${gymId}\n      AND c.day >=',
    to: '    WHERE (c.gym_id = ${gymId} OR true)\n      AND c.day >=',
  },
  {
    id: 'O184',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "DATA LOSS, the worst case on this card: the whole-week replace stops deleting the old sessions, so every save MERGES into what was there. A gym correcting its hours ends up advertising both the old and the new ones, the overlap rule it was validated against no longer describes the rows, and no screen can show a gym what it has actually said",
    expect: 'replaces the week',
    from: '    await tx`DELETE FROM gym_hours WHERE gym_id = ${input.gymId}`;',
    to: '    await tx`DELETE FROM gym_hours WHERE gym_id = ${input.gymId} AND false`;',
  },
  {
    id: 'O185',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "OWNERSHIP + DATA LOSS: un-closing a day stops being scoped to one gym, so one owner tapping undo on their own holiday re-opens that same date for every gym in the product. The `day` clause survives, so it is a QUIET cross-tenant delete rather than a table wipe — the shape a stray tenancy predicate actually takes",
    expect: 'leaves the same day closed in another',
    // RE-ANCHORED IN THE T3 FIX ROUND, and the reason is the recorded one
    // (:15770): Low-6's fix added a `SELECT note FROM gym_closures` carrying the
    // IDENTICAL `WHERE gym_id = … AND day = …` line, so the one-line anchor
    // matched TWICE and the pre-check aborted. It is NOT re-aimed at whichever
    // line comes first — the DELETE is named, which is the statement this row is
    // about.
    from: '      DELETE FROM gym_closures\n      WHERE gym_id = ${input.gymId} AND day = ${input.day}::date',
    to: '      DELETE FROM gym_closures\n      WHERE day = ${input.day}::date',
  },
  {
    id: 'O186',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "IDEMPOTENCY (R3.5): the closure upsert loses its ON CONFLICT arm, so an owner double-tapping `Closed today` — or a retried request — hits the UNIQUE and gets a 500, and editing a closure's note becomes impossible because the only way to change one is to write it again",
    expect: 'EDITS the note without stacking a row',
    from: '      ON CONFLICT (gym_id, day) DO UPDATE\n        SET note = EXCLUDED.note, created_by_user_id = EXCLUDED.created_by_user_id`;',
    to: '`;',
  },
  {
    id: 'O187',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "A USER IS SHOWN SOMETHING FALSE (:5807), and it is trap #8 exactly: the closure list is filtered against the SERVER's date instead of the gym's own. A gym on the other side of the date line loses today's closure from its members' cards — or keeps yesterday's up — while every UTC gym looks perfect. THIS MUTANT SURVIVED ITS FIRST RUN against a single UTC+14 fixture, because Kiritimati and UTC share a calendar date for ten hours of every day and differ for fourteen; the fixture behind it is now a UTC+14 AND UTC-12 PAIR, 26 hours apart, whose dates can never both equal the server's",
    expect: "measured in the GYM's zone",
    from: '      AND c.day >= (now() AT TIME ZONE g.timezone)::date',
    to: '      AND c.day >= now()::date',
  },
  {
    id: 'O188',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "A USER IS SHOWN SOMETHING FALSE: the closure filter goes strict, so a gym that is closed TODAY drops off its own members' cards on the one day it matters — the day they would otherwise turn up at a locked door",
    expect: "measured in the GYM's zone",
    from: '      AND c.day >= (now() AT TIME ZONE g.timezone)::date',
    to: '      AND c.day > (now() AT TIME ZONE g.timezone)::date',
  },
  {
    id: 'O189',
    target: 'service',
    suite: HOURS_SUITE,
    why: ":26736's WHOLE SUBJECT, and the defect that would have hit EVERY gym in the database on the day this shipped: the reader trusts the ROWS instead of the MODE, so a gym that has never set hours — no rows, `unset` — renders identically to one that is genuinely closed, and its members are told `Closed` about a gym that has simply not answered. Kd caught the example that led to it before a line was built; this is what stops it coming back",
    // AIMED AT THE FORCED-STATE TEST, not at the `open_24h` one, and the
    // difference is the whole finding. The writer DELETES the rows whenever the
    // mode leaves `scheduled`, so on every path a route can reach, `week` is
    // empty whether the reader branches on the mode or not — this mutant
    // SURVIVES the obvious test. Only a gym holding rows its mode does not admit
    // can observe it, and no route can produce one, so the test forces the state
    // in SQL.
    expect: 'the MODE decides what the week contains',
    from: '    week: row.mode === "scheduled" ? toWeekSchedule(row.sessions) : [],',
    to: '    week: toWeekSchedule(row.sessions),',
  },
  {
    id: 'O190',
    target: 'service',
    suite: HOURS_SUITE,
    why: "OWNERSHIP: the hours read stops asking whether the caller belongs to this gym at all, so any signed-in stranger holding a uuid reads a gym's timetable — and, worse, learns the gym exists, which is the enumeration oracle the module's standing 404 exists to close",
    expect: 'a signed-in stranger gets 404',
    from: '  if (org === null || (authority === null && !member)) {',
    to: '  if (org === null) {',
  },
  {
    id: 'O191',
    target: 'service',
    suite: HOURS_SUITE,
    why: "A USER IS BLOCKED FROM FINISHING SOMETHING (:5807's second half): the overlap comparison goes from strict to inclusive, so two sessions that merely TOUCH — 10:00-12:00 then 12:00-14:00, an ordinary timetable with a break in its numbering — are refused as overlapping. This card names the touching boundary as risk 4, and it is the direction a reviewer is least likely to check because the refusal looks like the guard working",
    expect: 'ACCEPTS touching ones',
    from: '      if (current.opensMinute < previous.closesMinute) {',
    to: '      if (current.opensMinute <= previous.closesMinute) {',
  },
  {
    id: 'O192',
    target: 'service',
    suite: HOURS_SUITE,
    why: "A GYM ADVERTISES A TIMETABLE NOBODY CAN READ: the sessions stop being sorted before the neighbour comparison, so an overlap sent in any order but ascending walks straight through the check. A screen that lets an owner add a 6am session after a 2pm one — which is every screen anybody would build — turns the guard off entirely",
    // AIMED AT THE HAPPY PATH, and the re-aim is the finding. This first pointed
    // at a test called "catches an overlap even when the client sends the
    // sessions out of order" and SURVIVED it: a neighbour check on unsorted
    // input fires on ANY descending pair, so it rejects that input too and the
    // test stays green with the sort gone. What the sort protects is the
    // opposite case — a VALID week sent out of order must be ACCEPTED — and the
    // observer for that is the happy path, whose three sessions are deliberately
    // sent 16:00, 06:00, 14:00.
    expect: 'reads them back in order',
    from: '    const sessions = [...day.sessions].sort((a, b) => a.opensMinute - b.opensMinute);',
    to: '    const sessions = [...day.sessions];',
  },
  {
    id: 'O193',
    target: 'service',
    suite: HOURS_SUITE,
    why: "A 500 A CLIENT CANNOT ACT ON: the calendar check goes, so `2027-02-31` — well-shaped, and not a day — reaches Postgres, which refuses the cast. The route answers 500 to a request whose only fault is a typo, and the audit row it half-wrote is rolled back with no trace of why",
    expect: 'well-shaped and does not exist',
    from: '    day: requireCalendarDate(req.day),',
    to: '    day: req.day,',
  },

  // -------------------------------------------------------------------------
  // T3 ROUND 1's FIX ROUND. Every row below guards something the review found
  // UNGUARDED — four of its eight Lows were "a test whose name is wider than its
  // coverage", and a fix without a mutant is the same defect one round later.
  // -------------------------------------------------------------------------
  {
    id: 'O194',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "OWNERSHIP, AND IT HAD NO OBSERVER AT ALL UNTIL T3 ROUND 1 (Low-2): the live-membership predicate goes, so a person the gym REMOVED goes on reading that gym's timetable for ever. The reviewer mutated this exact line and the whole 32-test file stayed green — the code was right and nothing was watching it, which in rule 4a's ownership column is the one place that is never acceptable",
    expect: 'REMOVED from the gym stops being able to read',
    from: '      AND m.removed_at IS NULL\n      AND u.status =',
    to: '      AND (m.removed_at IS NULL OR true)\n      AND u.status =',
  },
  {
    id: 'O195',
    target: 'service',
    suite: HOURS_SUITE,
    why: "A 500 A CLIENT CANNOT ACT ON, through the hole the calendar guard did not cover (T3 round 1, Low-1): year zero matches `YYYY-MM-DD` and round-trips through `Date` identically — JS has a year 0, the Gregorian calendar does not — so `0000-01-01` reached Postgres, which answers `date/time field value out of range`. This is the bound that closed it, and `0001-01-01` must keep working",
    expect: 'refuses year zero',
    from: '  if (parsed.getUTCFullYear() < 1) {',
    to: '  if (parsed.getUTCFullYear() < 0) {',
  },
  {
    id: 'O196',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "AN UNBOUNDED MEMBER-FACING PAYLOAD (T3 round 1, Low-5): the far horizon goes, and since `day` reaches 9999-12-31 with no per-gym cap on the close route, a gym's own owner can grow every one of its members' responses without limit. The reader's comment claimed this bound existed while only the PAST was trimmed",
    expect: 'past the one-year horizon',
    from: '      AND c.day < ((now() AT TIME ZONE g.timezone)::date + ${CLOSURE_HORIZON_DAYS}::int)\n',
    to: '\n',
  },
  {
    id: 'O197',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "A LOG THAT RECORDS NON-EVENTS (T3 round 1, Low-6): the no-op guard goes and `closeGymDay` audits every call again, so an owner double-tapping `Closed today` leaves two rows claiming two changes for one state. `removeGymClosure` three functions below already refuses to do this and says why — the module stated the rule and this function broke it",
    expect: 'audits a closure once, not once per tap',
    from: '    if (existing === undefined || existing.note !== input.note) {',
    to: '    if (input.day !== "") {',
  },
  // ---------------------------------------------------------------------
  // THE GYM'S CHOSEN CLOCK (Kd at the screen, 2026-09-01). Both rows are in
  // rule 4a's "a number a user SEES" column: a gym shown a clock it did not
  // pick, or a member shown a different one from their own gym.
  // ---------------------------------------------------------------------
  {
    id: 'O198',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "A GYM'S CHOSEN CLOCK IS SILENTLY DROPPED ON EVERY SAVE: the UPDATE stops writing it, so an owner picks 4:00 PM, the screen says it worked, and the next page load is back on 16:00. It is :5807 through a save that reports success - and the column keeps its old value, so nothing in the database looks wrong",
    expect: "picks its own clock",
    from: "        clock_format = ${\n          \"clockFormat\" in input.patch\n            ? (input.patch.clockFormat ?? before.clockFormat)\n            : before.clockFormat\n        }",
    to: "        clock_format = ${before.clockFormat}",
  },
  {
    id: 'O199',
    target: 'repo',
    suite: HOURS_SUITE,
    why: "THE HOURS READ STOPS CARRYING THE GYM'S CLOCK, so every MEMBER's card falls back to 24-hour whatever their gym chose. The console is unaffected (it has the org row) which is exactly what makes this bite only the half nobody is looking at - one gym showing its owner 4:00 PM and its members 16:00 about the same Monday",
    expect: "a member of the gym reads",
    from: "    clockFormat: gymClockFormatSchema.parse(gym.clock_format),",
    to: "    clockFormat: '24h',",
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

/** SAY WHICH DATABASE, because this harness runs the whole suite ONCE PER
 *  MUTANT and the choice dominates the wall clock (DECISIONS :5857 rule 4a).
 *  **Measured 2026-08-21 on `orgs.sweep.test.ts`: 158.2 s against the Neon
 *  branch in `ap-southeast-1`, 10.8 s against a local docker Postgres — 14.7×
 *  per mutant**, and the clock card's audit had its control ABORT twice under
 *  Singapore contention (:13336), which is the harness correctly refusing to
 *  report a verdict it cannot back.
 *
 *  Host only, never the url: a connection string carries a password and this
 *  prints to a terminal that gets pasted into chats (R3.10, and the Neon
 *  password was burned exactly that way on 2026-07-26). */

/** IS THIS HOST THE LOCAL MACHINE? A named function rather than an inline
 *  regex, because the write-refusal below turns on it and it is the only real
 *  branching in that guard — round-2 Low-6.
 *
 *  **It errs toward REMOTE in every uncertain case**, which is the safe
 *  direction: the cost of a false "remote" is an unnecessary refusal with the
 *  fix printed beside it, and the cost of a false "local" is a price nobody
 *  ruled written into the database Kd's browser reads. Note `[::1]` keeps its
 *  brackets (that is how `URL.host` renders IPv6) and the trailing `(:|$)` is
 *  what stops `localhost.evil.com` passing. */
const isLocalHost = (host) => /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);

/** A SELF-CHECK THAT RUNS EVERY SWEEP, because the refusal it protects has no
 *  external test and deleting it turns nothing red — round-2 Low-6, the same
 *  finding as the handler-placement guard above.
 *
 *  There is no test harness for `tools/*.mjs`; building one is its own card.
 *  So the table lives here, costs microseconds, and fails loudly. **Both
 *  directions are represented on purpose** — a checker that only lists hosts it
 *  should accept is satisfied by a function that accepts everything (:7104's
 *  PG1: an assertion satisfied by a threshold loosened until it barely works). */
for (const [host, expected] of [
  ['localhost:5433', true],
  ['127.0.0.1:5433', true],
  ['[::1]:5433', true],
  ['localhost', true],
  ['ep-cool-name-123.ap-southeast-1.aws.neon.tech', false],
  ['localhost.evil.com:5433', false], // the prefix trap the `(:|$)` closes
  ['192.168.1.50:5433', false],       // a LAN box is somebody else's machine
  ['unparseable', false],             // an unreadable url must never read local
]) {
  if (isLocalHost(host) !== expected) {
    abort(`isLocalHost('${host}') should be ${String(expected)}. The remote-write refusal cannot be trusted. Nothing has been run.`);
  }
}

let DB_IS_LOCAL = false;
let DB_HOST = 'unparseable';
{
  let dbHost = 'unparseable';
  try {
    dbHost = new URL(process.env.DATABASE_URL).host;
  } catch {
    // An unreadable url is not fatal here — the suite will fail on its own and
    // say why. What must not happen is this line inventing a host.
  }
  const local = isLocalHost(dbHost);
  console.log(`Database: ${dbHost}${local ? '' : '  ← REMOTE. `pnpm --filter api test:local` is ~15x faster per mutant.'}`);
  DB_IS_LOCAL = local;
  DB_HOST = dbHost;
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

/** THIS HARNESS IS REFUSED AGAINST A DATABASE THAT IS NOT LOCAL — **EVERY
 *  target, not just `seed`.**
 *
 *  **T3 ROUND 2 Critical/High, and the premise this guard was built on had
 *  already gone false.** Its previous wording read *"until the `seed` target
 *  existed every mutant here only made the suite READ code"* and *"every other
 *  target is unaffected"*, so it fired only for `seed`. **Both sentences stopped
 *  being true the moment this repo grew a route that WRITES**, and O114 is the
 *  proof: it deletes the tenancy predicate from `updateOrg`'s UPDATE, so while
 *  that mutant is live the suite runs the real route and **rewrites the name,
 *  city, country, currency and timezone of EVERY ROW IN `gyms`.** The file is
 *  then restored byte-exact and the rows are not — a summary reading "restore
 *  verified byte-exact (sha256)" over a wrecked table, which is :5199/:4855 F1's
 *  shape and :18488's own finding recurring at the target its fix excluded.
 *
 *  **Measured by the reviewer: 59 canary rows stamped, O114 run, 59 → 0**, every
 *  row carrying one test's payload, exit 0. `insertAudit` records only the ONE
 *  gym the route was called for, so the rest are overwritten with no record
 *  anywhere of what they held. `apps/api/.env`'s `DATABASE_URL` is deliberately
 *  the Neon branch, because **Kd's own test gyms live there and his browser
 *  smokes read them** (:13659) — 108 gyms, verified intact 2026-08-26.
 *
 *  **SO THE ENUMERATION IS ABANDONED RATHER THAN EXTENDED.** Deciding per
 *  target which mutants can write is a judgement that was wrong once and gets
 *  harder every time the product grows a write route; the next one re-opens
 *  this silently. A blanket refusal cannot go stale. Precedent for refusing
 *  rather than warning: `tools/orgs-sweep.ts --now` (:13075). The escape hatch
 *  stays deliberate and deliberately awkward, and its name is no longer about
 *  prices, because the damage no longer is. */
if (!DB_IS_LOCAL) {
  if (process.env.MUTATE_ON_REMOTE_DB !== 'i-know-this-writes-to-the-database') {
    abort(
      `this harness makes the suite WRITE, and ${DB_HOST} is not local.\n` +
      `  That is very likely the Neon branch Kd's own gyms and browser smokes read.\n` +
      `  Nothing has been run.\n\n` +
      `  A repo-target mutant can rewrite EVERY ROW in \`gyms\` (O114 deletes the\n` +
      `  tenancy predicate on purpose — that is how it proves the predicate is real);\n` +
      `  O142 deletes the trial sweep's scope predicate, so it ENDS EVERY LIVE GYM\n` +
      `  TRIAL in the database, dropping every one of those gyms' members to the\n` +
      `  free tier; and a seed mutant writes prices nobody ruled. None of it is\n` +
      `  undone by the byte-exact FILE restore this harness reports.\n\n` +
      `  Use the local database instead:\n` +
      `    docker compose -f infra/docker-compose.dev.yml up -d postgres redis\n` +
      `    DATABASE_URL='postgres://aihg:aihg@localhost:5433/aihg' node apps/api/tools/mutate-orgs.mjs\n\n` +
      `  If you genuinely mean to write to ${DB_HOST}, set\n` +
      `    MUTATE_ON_REMOTE_DB=i-know-this-writes-to-the-database`,
    );
  }
  console.log(`WARNING: this sweep will WRITE to ${DB_HOST}, on your explicit opt-in.`);
}

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

/** ANCHORS MUST MATCH, AND MUST MATCH EXACTLY ONCE.
 *
 *  The first half is old (:5199): an anchor matching nothing is a no-op
 *  mutation, and a no-op mutation reports ALIVE, whose honest reading is "this
 *  guarantee has no test".
 *
 *  **The second half is new, added by T3 L-2 on the badge card (:15093), and it
 *  closes a hole this harness had NAMED and not fixed.** :14493 recorded it in
 *  as many words — *"a pre-check that asks 'does this match?' cannot ask 'does
 *  this match ONCE' — worth fixing in the harness"* — after O85/O86 matched in
 *  two places and hit the right one only BY POSITION. It bit again immediately:
 *  the badge card added the roster's copy of a `gym_staff` subquery whose
 *  14-space indent CONTAINS O88's 12-space anchor, so O88 silently went from one
 *  match to two while three documents recorded it as verified-unique.
 *  `String.replace` takes the first occurrence, so such a mutant still lands
 *  somewhere — just not provably where its `why` says it does.
 *
 *  **THE ALLOW-LIST IS PRE-EXISTING DEBT, NOT AN EXEMPTION.** These three were
 *  already ambiguous at `3950a5d`, before the badge card existed (census run
 *  2026-08-22: O17, O29, O89 — and O88, which that card broke and which is now
 *  re-anchored). Each still lands on its intended line by position. They are
 *  named here rather than tolerated silently, and they carry an `OWED.md` line;
 *  **the list may only ever shrink.** A row not on it that becomes ambiguous
 *  aborts the run, which is the point. */
const AMBIGUOUS_ALLOWED = new Set(['O17', 'O29', 'O89']);

for (const m of MUTANTS) {
  const original = originals.get(m.target);
  const anchor = withEolOf(m.from, original.text);
  const hits = original.text.split(anchor).length - 1;
  if (hits === 0) {
    abort(`${m.id}: its anchor matched nothing in ${m.target}. A no-op mutation reports as a missing test. Re-anchor it against the current file.`);
  }
  if (hits > 1 && !AMBIGUOUS_ALLOWED.has(m.id)) {
    abort(
      `${m.id}: its anchor matches ${String(hits)} times in ${m.target}, so the mutation lands on whichever comes FIRST rather than on the line its \`why\` describes. ` +
      `Re-anchor it on text unique to that function. Nothing has been written yet.`,
    );
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

/** SET THE INSTANT A MUTATED `seed.ts` REACHES THE DISK, not when the loop
 *  finishes. Everything about the repair below turns on this being true even
 *  when the run dies half way. */
let seedMutated = false;
let seedRepaired = false;

/** RESTORING THE FILE IS NOT RESTORING THE WORLD — permanent guard, :5348
 *  rule 5, added the day the `seed` target was.
 *
 *  Every other target in this harness is code the suite READS. `seed.ts` is
 *  code the suite RUNS, and running it WRITES to the shared database — so a
 *  mutated price is upserted into `plans` and stays there after the byte-exact
 *  file restore the summary line proudly reports. **Measured, not feared: the
 *  first run of O106–O112 left `pro_us_m` at 699 minor units** — the last
 *  mutant's value — in the database every other suite and Kd's own browser
 *  read. The harness would have printed "restore verified byte-exact" over it,
 *  which is this repo's most-recorded failure shape (:5199, :4855 F1, :5906):
 *  a report that is TRUE about the thing it checked and silent about the thing
 *  it did not.
 *
 *  The repair and the proof are the same act: the seed suite seeds and then
 *  reads the whole book back, so a GREEN run here means the database matches
 *  the restored source. A RED one means it does not, and that must be said
 *  loudly rather than left for the next suite to trip over.
 *
 *  **IT RUNS ON EVERY EXIT PATH, NOT ONLY THE HAPPY ONE — T3 round-1
 *  Critical/High, and the first version of this guard had exactly that hole.**
 *  Four `abort()`s inside the mutation loop fire AFTER a mutated seed has
 *  already been executed against the database, and every one of their messages
 *  talks about the working TREE. Neither is hypothetical: :13336 records the
 *  control aborting twice under database contention and :17218 a mutant killed
 *  at 600 s. Hooking `process.on('exit')` covers `abort()` (which is
 *  `process.exit`, so a `finally` would never run), an uncaught throw, and
 *  normal completion alike — `execSync` is synchronous, which is the only
 *  reason an exit handler can do real work here.
 *
 *  **THE REGISTRATION SITS ABOVE THE LOOP AND THAT PLACEMENT IS THE WHOLE
 *  FIX.** The first attempt at this guard defined the handler BELOW the loop,
 *  so an abort inside the loop exited before the handler existed and the repair
 *  never ran — measured by forcing a real in-loop abort, which left `pro_us_m`
 *  at 699 exactly as before the guard was written. A guard that is registered
 *  after the thing it guards is not a guard. Do not move this back down.
 *
 *  **CTRL-C AND `kill` ARE COVERED TOO — round-2 Low-5, and the finding was
 *  that this comment's own justification named a case it did not cover.** It
 *  cites :17218, and :17284 records that incident as a mutant that *"had to be
 *  killed, which left the mutated file on disk"* — a KILL, which fires no
 *  `exit` handler. Citing the one trigger you do not handle as the reason you
 *  are needed is the shape :5748 keeps recording. Fixed by handling it rather
 *  than by narrowing the citation: `SIGINT`/`SIGTERM` repair, then exit with
 *  the conventional 128+n.
 *
 *  **THE COST IS REAL AND IS ACCEPTED: Ctrl-C now takes as long as one suite
 *  run (~10 s local) before the process ends**, and it prints why, because a
 *  tool that appears to ignore Ctrl-C is worse than one that is slow.
 *
 *  **WHAT STILL CANNOT BE COVERED, stated rather than implied by silence:**
 *  `SIGKILL`, a power cut, and a SECOND Ctrl-C during the repair. Re-seed by
 *  hand if you force one of those:
 *  `DATABASE_URL=<url> corepack pnpm --filter api exec tsx src/db/seed.ts`. */
const repairSeedDatabase = () => {
  if (!seedMutated || seedRepaired) return true;
  seedRepaired = true;
  console.log('\nseed target was mutated — re-seeding the database and verifying it matches the restored source ...');
  const { out, failed, fault } = run(SEED_FILTER, SEED_SUITE);
  const wrong =
    fault !== null ? `the re-seed could not RUN — ${fault}`
    : !tallied(out) ? 'the re-seed produced no test tally, so nothing was verified'
    : failed ? 'THE DATABASE STILL DOES NOT MATCH THE SOURCE after re-seeding'
    : null;
  if (wrong !== null) {
    console.error(
      `\nDATABASE MAY STILL HOLD A MUTATED PRICE — ${wrong}.\n` +
      `  Re-seed it by hand before trusting ANY suite or browsing the app:\n` +
      `  DATABASE_URL=<your url> corepack pnpm --filter api exec tsx src/db/seed.ts\n`,
    );
    return false;
  }
  console.log('database re-seeded and verified against the restored source');
  return true;
};

/** THE GYM ROWS ARE PROVEN TO HAVE SURVIVED — T3 round 2 Critical/High's
 *  durable half, and Kd approved building it rather than only widening the
 *  refusal above.
 *
 *  **The refusal stops this reaching Kd's database. It does NOT stop a mutant
 *  wrecking the LOCAL one**, and the round measured exactly that: O114 removes
 *  the tenancy predicate on purpose — that is how it proves the predicate is
 *  real — so while it is live the suite rewrites every row in `gyms`. 59 canary
 *  rows went to 0 under a summary reading "restore verified byte-exact".
 *
 *  **A FILE RESTORE IS NOT A DATABASE RESTORE, and the summary said only the
 *  first.** This is the second instrument in this harness to learn that
 *  (:18488's seed repair was the first, and its fix deliberately excluded every
 *  other target). Rather than enumerate which mutants can write — the judgement
 *  that was already wrong once and gets harder with every new write route —
 *  this snapshots the rows and checks them.
 *
 *  **WHAT IT ACTUALLY COVERS, stated narrowly because the first version of this
 *  sentence claimed the CLASS and the code covers one table — round-3 Low-4.**
 *  It watches `gyms` (name, city, country, currency_display, timezone) **and,
 *  since 2026-08-28, `subscriptions` (status, plan_id, trial_ends_at)**. **A
 *  mutant that mass-writes `gym_members`, `gym_staff`, `gym_codes`,
 *  `gym_join_applications`, or `gyms.slug` / `.status` / `.owner_user_id` /
 *  `.removed_at` is still INVISIBLE to it.**
 *
 *  **THE PREDICTION IN THIS PARAGRAPH CAME TRUE AND THE PARAGRAPH WAS NOT
 *  UPDATED — that is T3 round 1 on the trial sweep, L-5.** It said *"the trigger
 *  to widen it is the next route that writes rows a caller does not own"* and
 *  then *"no such mutant exists today"*. `O142` became that mutant in the same
 *  commit that added it, nobody widened the guard, and a sweep containing it
 *  printed *"gym rows verified — no unattributed changes"* while the suite
 *  expired every live gym trial in the database. **A limit that names its own
 *  trigger still needs somebody to notice the trigger firing; the honest fix is
 *  to widen the guard in the commit that adds the writer, not to write a better
 *  sentence about it.**
 *
 *  **IT COMPARES ROWS THAT EXISTED BEFORE AND STILL EXIST AFTER.** Rows the
 *  suite CREATES are expected, rows its cleanup DELETES are expected; a
 *  pre-existing row whose columns moved is not, and is the only signature of
 *  the defect. That is why this cannot be a count or a whole-table checksum —
 *  both false-alarm on a suite that legitimately creates and drops gyms.
 *
 *  It reports rather than repairs, deliberately: this harness has no record of
 *  what the rows held (`insertAudit` logs only the ONE gym the route was called
 *  for), so a repair would be an invention. Naming the damage loudly is the
 *  honest act — and on a local database the fix is a re-seed.
 *
 *  **WHAT IT CANNOT DO, MEASURED ON THE RUN THAT PROVED IT WORKS: it catches the
 *  FIRST mass-write and cannot re-alarm on a table that is ALREADY uniform.**
 *  O114 rewrites every gym to the acting test's payload; run it twice and the
 *  second run writes the identical values, so nothing CHANGES and this reports
 *  "rows unchanged" — truthfully, and misleadingly if read as "O114 is safe".
 *  Measured 2026-08-26: O114 alone against a healthy table caught 59 rows; the
 *  same mutant inside a 15-mutant sweep, on a table already flattened by that
 *  first run, reported 63 unchanged. **The alarm does not repeat once the fire
 *  has burned everything.**
 *
 *  That is acceptable because it is not the primary defence — the blanket
 *  REFUSAL above is, and it is what keeps this away from Kd's database
 *  entirely. This catches the local case, once, which is when it matters. **If
 *  the local `gyms` table is uniform, this guard is blind until it is cleaned;**
 *  `OWED.md` carries that state and the cleanup. */
const gymFingerprint = () => {
  // **`subscriptions` JOINED THE WATCH ON 2026-08-28 (T3 round 1 on the trial
  // sweep, L-5), AND THE DOC ABOVE PREDICTED THE TRIGGER EXACTLY:** *"the next
  // route that writes rows a caller does not own … that is when the cheap thing
  // to do is add its table here."* `O142` deletes the trial sweep's scope
  // predicate, so while it is live the suite expires EVERY live gym trial in the
  // database — and this guard, watching `gyms` alone, printed *"gym rows
  // verified — no unattributed changes"* over exactly that. **True about what it
  // checked and silent about what was written**, which is :5199/:4855 F1's shape
  // and the same defect :19803 found here the first time.
  //
  // The two tables are fingerprinted in ONE query and one round trip, keyed by a
  // prefixed id so a collision between a gym id and a subscription id is
  // impossible and the report can name which table moved.
  // **`gyms.status`/`archived_at` AND `subscriptions.ended_at` JOINED THE WATCH
  // ON 2026-08-31, IN THE COMMIT THAT ADDED THEIR WRITER — which is the whole of
  // L-5's lesson from the trial sweep three days earlier.** That round found this
  // guard printing *"gym rows verified"* over a mutant rewriting `subscriptions`,
  // and recorded the remedy in as many words: *"widen the guard in the commit
  // that adds the writer, not … a better sentence about the limit."* The archive
  // sweep writes `gyms.status` and `gyms.archived_at`, and a fingerprint of
  // name/city/country/currency/timezone is blind to a gym being CLOSED — the most
  // damaging thing any row in this table can say. O173 deletes that sweep's scope
  // predicate on purpose, so it is the trigger firing again, on schedule.
  const sql =
    'SELECT \'gym:\' || id::text AS id, coalesce(name,\'\') || \'|\' || ' +
    'coalesce(city,\'\') || \'|\' || coalesce(country,\'\') || \'|\' || ' +
    'coalesce(currency_display,\'\') || \'|\' || coalesce(timezone,\'\') || \'|\' || ' +
    'coalesce(status,\'\') || \'|\' || coalesce(archived_at::text,\'\') AS f ' +
    'FROM gyms ' +
    'UNION ALL ' +
    // status and trial_ends_at are the two columns the trial sweep writes and
    // reads; ended_at is the one it stamps and the archive sweep reads; plan_id
    // is here because a future writer moving a gym between bands is the same
    // class of damage and costs nothing to watch.
    'SELECT \'sub:\' || id::text AS id, coalesce(status,\'\') || \'|\' || ' +
    'coalesce(plan_id::text,\'\') || \'|\' || ' +
    'coalesce(trial_ends_at::text,\'\') || \'|\' || ' +
    'coalesce(ended_at::text,\'\') AS f FROM subscriptions';
  // Plain `node` with cwd = apps/api, NOT `pnpm exec tsx`: measured 2026-08-26,
  // `pnpm --filter api exec tsx` reports "Command tsx not found" from the repo
  // root, and the first version of this probe therefore returned null on every
  // run — the guard announced itself OFF and the sweep passed. It failed in the
  // SAFE direction (it says so rather than passing quietly), and it was still a
  // guard that could not fire. `postgres` resolves from apps/api's own
  // node_modules, which is where the suite gets it too.
  try {
    const out = execSync(
      `node -e ${JSON.stringify(
        `const postgres=require('postgres');` +
        `const s=postgres(process.env.DATABASE_URL,{prepare:false,max:1});` +
        `s\`${sql}\`.then(r=>{console.log(JSON.stringify(r.map(x=>[x.id,x.f])));return s.end();})` +
        `.catch(e=>{console.error(e.message);process.exit(1);});`,
      )}`,
      {
        cwd: resolve(ROOT, 'apps/api'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const line = out.split('\n').reverse().find((l) => l.trim().startsWith('[['))
      ?? out.split('\n').reverse().find((l) => l.trim() === '[]');
    if (line === undefined) return null;
    return new Map(JSON.parse(line.trim()));
  } catch {
    return null;
  }
};

/** A BASELINE THAT COULD NOT BE TAKEN IS A FATAL, NOT A WARNING — round-3
 *  Low-1. The first version printed one line and let the sweep complete
 *  normally, and the summary said nothing about the check at all, so **a run
 *  with the guard OFF was byte-identical in its summary to a run where it
 *  passed.** That is exactly the mode that made v1 of this guard dead (:19799):
 *  the warning was printed and nobody acted on it.
 *
 *  Its two siblings in this file already fail closed — `repairSeedDatabase`
 *  exits 3 when it cannot verify, and the re-read below exits 4 — so the
 *  asymmetry was undocumented as well as wrong. The probe needs only `node` and
 *  `postgres` from `apps/api`, both of which must work for the suite to run at
 *  all, so a failure here means something is broken enough to stop for. */
const gymsBefore = gymFingerprint();
if (gymsBefore === null) {
  abort(
    'could not fingerprint `gyms`, so mass-write detection would be OFF for this run.\n' +
    '  A sweep whose damage-detector cannot run is one whose green summary means nothing\n' +
    '  (:19799 — v1 of this guard printed a warning here and passed).\n' +
    '  Nothing has been mutated. Check that the database is up and that `postgres`\n' +
    '  resolves from apps/api.',
  );
}
console.log(
  `fingerprinted ${String(gymsBefore.size)} gym + subscription rows for mass-write detection`,
);

/** IS THE TABLE ALREADY UNIFORM? Every row carrying one fingerprint is the
 *  signature of a mass-write that has ALREADY happened, and it is the state in
 *  which this guard is blind — a repeat write of the same values changes
 *  nothing. Round-3 Low-3: that caveat lived in a comment and in `OWED.md`,
 *  neither of which is in front of the person reading the sweep output, so the
 *  green line read as "O114 is safe". It now says so on the line itself. */
const isUniform = (m) => m.size > 1 && new Set(m.values()).size === 1;

/** ROWS ARE ATTRIBUTED TO THE MUTANT THAT MOVED THEM — round-3 Low-5, and it is
 *  the finding that makes this guard usable rather than merely present.
 *
 *  **A sweep containing O114 and a working guard were mutually exclusive.**
 *  O114 deletes the tenancy predicate ON PURPOSE — that is how it proves the
 *  predicate is load-bearing — so on a healthy table it mass-writes every gym
 *  and the guard fired, exiting 4 with no green line obtainable; on an already
 *  flattened table it exited 0 and the guard was blind. **The round's own green
 *  PROVE figure was therefore only obtainable because the table was already
 *  destroyed**, and `OWED.md`'s remedy (clean the junk rows) guaranteed the next
 *  sweep would exit 4 and re-flatten it. The reviewer measured all of that.
 *
 *  The fix is attribution: fingerprint around EACH mutant, so "O114 rewrote the
 *  table" and "O119 rewrote the table" stop being the same event. A mutant that
 *  declares `writesRows` is EXPECTED to move rows — reported loudly, by name,
 *  with a count, and NOT an alarm. Any other mutant moving a row is the defect
 *  this guard exists for and still exits 4.
 *
 *  **`writesRows` is a CLAIM about a mutant and is checked in both directions**:
 *  a mutant that declares it and moves nothing is reported too, because a
 *  declaration nobody can observe is how a guard quietly stops guarding. */
const rowDamage = [];
let gymsChecked = false;
const verifyGymRows = () => {
  if (gymsChecked) return true;
  gymsChecked = true;
  const after = gymFingerprint();
  if (after === null) {
    console.error('\nCOULD NOT RE-READ `gyms` — the mass-write check did NOT run. Verify the table by hand.');
    return false;
  }
  const unexpected = rowDamage.filter((d) => !d.expected);
  if (unexpected.length > 0) {
    console.error(
      `\nA MUTANT REWROTE ROWS IT HAD NO BUSINESS TOUCHING.\n` +
      unexpected.map((d) => `  ${d.id}: ${String(d.ids.length)} row(s) — ${d.ids.slice(0, 3).join(', ')}`).join('\n') +
      `\n  The FILE restores above are byte-exact and say nothing about this — the\n` +
      `  database was written through the real route while a mutation was live.\n` +
      `  Nothing here can put them back: the audit log records only the one gym\n` +
      `  each call named. On a local database, re-seed:\n` +
      `  DATABASE_URL=<your url> corepack pnpm --filter api exec tsx src/db/seed.ts\n`,
    );
    return false;
  }
  for (const d of rowDamage) {
    console.log(
      `${d.id} rewrote ${String(d.ids.length)} pre-existing row(s) — EXPECTED, it declares writesRows\n` +
        `  ${d.ids.slice(0, 4).join(', ')}${d.ids.length > 4 ? ", …" : ""}`,
    );
  }
  const caveat = isUniform(after)
    ? ' (table is UNIFORM — a REPEAT mass-write is invisible to this check; see OWED)'
    : '';
  // **NAMES BOTH TABLES.** The previous wording said "gym rows verified" while
  // `subscriptions` was being rewritten underneath it (T3 round 1 on the trial
  // sweep, L-5). A green line naming a narrower subject than the run touched is
  // the exact failure this guard exists to prevent.
  console.log(`gyms + subscriptions verified — no unattributed changes${caveat}`);
  return true;
};

process.on('exit', () => {
  repairSeedDatabase();
  verifyGymRows();
});

let seedHandlersRegistered = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (seedMutated && !seedRepaired) {
      console.log(`\n${signal} — repairing the database before exiting; this takes about one suite run.`);
    }
    repairSeedDatabase();
    verifyGymRows();
    // 128+n is the conventional exit code for "died on signal", and using it
    // keeps a killed sweep distinguishable from an ABORT (2) or a clean run.
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}
seedHandlersRegistered = true;

/** THE REGISTRATION MUST ALREADY HAVE HAPPENED BEFORE THE LOOP RUNS, AND THIS
 *  IS WHAT ENFORCES IT — round-2 Low-6.
 *
 *  Round 1's C/H-2 was a repair that never ran because the handler was
 *  registered BELOW the loop; the fix moved it above, and the only thing
 *  protecting that placement was a comment saying "do not move this back
 *  down". **The round's own standing lesson is that reading the code did not
 *  reveal that defect — only causing it did — so a comment is precisely the
 *  instrument that lesson says does not work.**
 *
 *  There is no test harness for `tools/*.mjs` (building one is its own card),
 *  so the guard lives where it can actually fire: here, every run, costing
 *  microseconds. Move the handlers below this line and the next sweep aborts
 *  before it writes a byte. */
if (!seedHandlersRegistered) {
  abort('the seed-repair handlers are registered AFTER the mutation loop, so an early exit would skip the repair (round-1 C/H-2). Move them back above this check. Nothing has been run.');
}

const results = [];
/** Walks forward as each mutant is measured, so every mutant is compared
 *  against the table as the PREVIOUS one left it. Without this, one declared
 *  mass-write would make every mutant after it look guilty of the same rows. */
let rowsAtLastCheck = gymsBefore;
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
  if (m.target === 'seed') seedMutated = true;

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

  // ATTRIBUTION (round-3 Low-5): whose damage is this? Taken here, per mutant,
  // because "some mutant in this sweep rewrote the table" is not an actionable
  // report and cannot tell O114's own job from a defect.
  const nowRows = gymFingerprint();
  if (nowRows === null) {
    abort(`${m.id}: could not re-read \`gyms\` to attribute row changes. The tree is restored; the database is not verified.`);
  }
  const movedIds = [];
  for (const [id, f] of rowsAtLastCheck) {
    const now = nowRows.get(id);
    // Absent = the suite's cleanup deleted it, which is expected. Present and
    // different = this mutant rewrote a row that existed before it ran.
    if (now !== undefined && now !== f) movedIds.push(id);
  }
  if (movedIds.length > 0) {
    rowDamage.push({ id: m.id, ids: movedIds, expected: m.writesRows === true });
  } else if (m.writesRows === true) {
    // A DECLARATION NOBODY CAN OBSERVE IS HOW A GUARD QUIETLY STOPS GUARDING
    // (:5104 F5). Not fatal — an already-uniform table makes this the honest
    // outcome, which is the very blindness this guard documents — but it is
    // SAID, because on a healthy table it would mean the mutant stopped writing.
    console.log(`${m.id} declares writesRows and moved no row (table already uniform, or it stopped writing)`);
  }
  rowsAtLastCheck = nowRows;

  const verdict = failed ? 'RED' : 'ALIVE';
  results.push({ ...m, verdict, ok: verdict === 'RED' });
  console.log(`${m.id.padEnd(4)} ${verdict.padEnd(5)} ${verdict === 'RED' ? 'as expected' : 'UNEXPECTED'}  ${m.why}`);
}

// The happy path repairs EXPLICITLY, so its output lands in reading order and
// so a failed repair can still set a non-zero exit code — an exit handler
// cannot. The `process.on('exit')` registration above the loop is the backstop
// for every other way out.
if (!repairSeedDatabase()) process.exit(3);
// Same reasoning for the gym-row check: run it here so a wrecked table can set
// a non-zero exit code and land its report in reading order, with the exit
// handler as the backstop for every other way out.
if (!verifyGymRows()) process.exit(4);

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
