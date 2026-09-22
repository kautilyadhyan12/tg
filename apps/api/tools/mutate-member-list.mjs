/**
 * Mutation audit — the member list: the reconcile rule, the confirm that writes a
 * gym's list, and the two reads of the list it keeps (ROADMAP 3a-iii, Part 3 §9.6-§9.9).
 * Run from anywhere with Docker up:
 *   `node apps/api/tools/mutate-member-list.mjs`            — every mutant
 *   `node apps/api/tools/mutate-member-list.mjs --census`   — anchors only, no database
 *   `node apps/api/tools/mutate-member-list.mjs 12`         — one mutant by number
 *
 * **CLAUDE.md §4: run when this slice changes, never as a routine step and never in
 * CI.** It is here rather than in a chat's scratchpad because 3a-iv changes this same
 * rule and the feature's two hard passes read it; a harness that dies with the chat
 * that wrote it protects nothing.
 *
 * Every row is a rule the slice claims to hold, and the suite beside it must turn RED.
 * Anchors are matched against the file's own bytes, and every file is restored and
 * sha256-checked afterwards.
 *
 * **RUN `--census` FIRST, ALWAYS.** An anchor that no longer matches makes a mutant
 * run GREEN, which reads exactly like a rule that holds — this is not hypothetical, it
 * has happened twice in this feature (the orgs harness sat dead for five days, and the
 * High-3 fix moved the chips' ORDER BY into a lateral and rotted a row here).
 *
 * **TWO MUTANTS ARE EXPECTED GREEN and it is not a gap**: the gym-row lock and the
 * upload row's `FOR UPDATE`. No route-level race can tell them apart from the locks
 * Postgres takes anyway — inserting an entry takes `FOR KEY SHARE` on the `gyms` row,
 * and the confirm updates its own upload row before it commits — so telling them apart
 * needs a seam inside the transaction. They are kept because they are the module's one
 * lock order and because 3a-iv adds writers no route serialises for us.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVICE = `${ROOT}/apps/api/src/modules/orgs/memberList/service.ts`;
const REPO = `${ROOT}/apps/api/src/modules/orgs/memberList/repo.ts`;
const RECONCILE = `${ROOT}/apps/api/src/modules/orgs/memberList/reconcile.ts`;
const CURSOR = `${ROOT}/apps/api/src/modules/orgs/memberList/cursor.ts`;

const NEVER_KEEP = `${ROOT}/apps/api/src/modules/orgs/memberList/neverKeep.ts`;
const HEADER_WORDS = `${ROOT}/apps/api/src/modules/orgs/memberList/headerWords.ts`;
const FIELDS = `${ROOT}/apps/api/src/modules/orgs/memberList/fields.ts`;
const COLUMNS = `${ROOT}/apps/api/src/modules/orgs/memberList/columns.ts`;
const UNDERSTAND = `${ROOT}/apps/api/src/modules/orgs/memberList/understand.ts`;
const EXTRA_FIELDS = `${ROOT}/apps/api/src/modules/orgs/memberList/extraFields.ts`;

const CONFIRM_SUITE = "memberList.confirm.routes.test.ts";
const RULE_SUITE = "memberList.reconcile.unit.test.ts";
/** 3a-v-a's suites. They touch no database, so their mutants say `pure: true`
 *  and run vitest straight rather than booting Postgres for each one. */
const WIDER_SUITE = "memberList.wider.unit.test.ts";
const NEVER_KEEP_SUITE = "memberList.neverKeep.unit.test.ts";
/** 3a-v-b's suites: the table test for the rules that KEEP the wider row (pure), and
 *  the routes that write it against real Postgres. */
const KEEP_SUITE = "memberList.keep.unit.test.ts";
const KEPT_SUITE = "memberList.kept.routes.test.ts";

/** file, what it breaks, the anchor, the replacement, which suite must go red.
 *  `pure: true` runs the suite without a database. */
const BREAKS = [
  {
    name: "tenancy: the upload is fetched by its id alone",
    file: REPO,
    from: "    WHERE gym_id = ${gymId} AND id = ${uploadId}\n    FOR UPDATE`;",
    to: "    WHERE id = ${uploadId}\n    FOR UPDATE`;",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the stale-preview check is dropped (a moved list is applied anyway)",
    file: SERVICE,
    from: "    if (version !== upload.baseVersion) {",
    to: "    if (false && version !== upload.baseVersion) {",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the wrong-file guard is dropped",
    file: SERVICE,
    from: "    if (reconciled.guard.needsTick && !input.acknowledgeLargeChange) {",
    to: "    if (false && reconciled.guard.needsTick && !input.acknowledgeLargeChange) {",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the tick is remembered from a previous request (it is stored, not asked)",
    file: SERVICE,
    from: "    if (reconciled.guard.needsTick && !input.acknowledgeLargeChange) {",
    to: "    if (reconciled.guard.needsTick && !input.acknowledgeLargeChange && reconciled.gone.length !== 11) {",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the gym's row is not locked (two confirms can interleave)",
    file: SERVICE,
    from: "    await repo.lockGym(tx, gymId);",
    to: "    if (false) await repo.lockGym(tx, gymId);",
    suite: CONFIRM_SUITE,
  },
  {
    name: "an already-confirmed upload is applied again",
    file: SERVICE,
    from: '    if (upload.status === "confirmed") return { kind: "confirmed", confirmed: storedAnswer(upload, before?.version ?? 0) };',
    to: '    if (false) return { kind: "confirmed", confirmed: storedAnswer(upload, before?.version ?? 0) };',
    suite: CONFIRM_SUITE,
  },
  {
    name: "the version is bumped even when nothing changed",
    file: SERVICE,
    from: "    const bump = added + revived + updated + removed > 0;",
    to: "    const bump = true;",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the upload's cells are kept after it is confirmed",
    file: REPO,
    from: "    SET status = 'confirmed', confirmed_at = ${input.at}, rows = NULL,",
    to: "    SET status = 'confirmed', confirmed_at = ${input.at},",
    suite: CONFIRM_SUITE,
  },
  {
    name: "people coming off the list are not taken off it (3a-v-b: marked former, not deleted)",
    file: SERVICE,
    from: "    const removed = await repo.markEntriesFormer(tx, gymId, reconciled.gone.map((person) => person.identityKey), at);",
    to: "    const removed = reconciled.gone.length;",
    suite: CONFIRM_SUITE,
  },
  {
    name: "a changed person's own status is not written",
    file: REPO,
    from: "    SET status         = CASE WHEN ${carries.status} THEN r.status ELSE e.status END,",
    to: "    SET status         = e.status,",
    suite: CONFIRM_SUITE,
  },
  {
    name: "only the NEW list's members are stamped, not the ones coming off",
    file: RECONCILE,
    from: "    if (onNewList || member.onList) onEitherList.push(member.userId);",
    to: "    if (onNewList) onEitherList.push(member.userId);",
    suite: RULE_SUITE,
  },
  {
    name: "the stamp is computed inside the hasList gate (a gym's first confirm stamps nobody)",
    file: RECONCILE,
    from: "    if (onNewList || member.onList) onEitherList.push(member.userId);",
    to: "    if (hasList && (onNewList || member.onList)) onEitherList.push(member.userId);",
    suite: RULE_SUITE,
  },
  {
    name: "the audit row carries a person's name",
    file: SERVICE,
    from: "        mode: upload.mode,",
    to: "        mode: upload.mode,\n        who: reconciled.new[0]?.fullName ?? reconciled.gone[0]?.fullName ?? 'none',",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the entries page counts only the rows it returns, not the filtered set",
    file: REPO,
    from: "    totals AS (SELECT count(*)::int AS total FROM filtered)",
    to: "    totals AS (SELECT least(count(*), 100)::int AS total FROM filtered)",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the search's LIKE wildcards are not escaped",
    file: SERVICE,
    from: 'const escapeLike = (text: string): string => text.replace(/[\\\\%_]/g, (char) => `\\\\${char}`);',
    to: "const escapeLike = (text: string): string => text;",
    suite: CONFIRM_SUITE,
  },
  {
    name: "a bad cursor quietly starts again from the top",
    file: SERVICE,
    from: '    throw new OrgsError(400, "bad_cursor", "That page of the list could not be read. Open the list again.");',
    to: "    /* silently from the top */",
    suite: CONFIRM_SUITE,
  },
  {
    name: "a word filter is matched with its case unfolded (the status, the membership word and the payment word all)",
    file: SERVICE,
    from: "  return [...new Set(words.map((word) => word.trim().toLowerCase()))];",
    to: "  return [...new Set(words.map((word) => word.trim()))];",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the in-app filter counts members rather than the entries they match",
    file: SERVICE,
    from: "  for (const member of members) if (member.entryId !== null) ids.add(member.entryId);",
    to: "  for (const member of members) if (member.entryId !== null) ids.add(member.entryId);\n  ids.delete([...ids][0] ?? '');",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the cursor comparison includes the person it left off at (a page repeats somebody)",
    file: REPO,
    from: "            > (${input.cursor?.name ?? \"\"}::text, ${input.cursor?.id ?? EMPTY_UUID}::uuid)",
    to: "            >= (${input.cursor?.name ?? \"\"}::text, ${input.cursor?.id ?? EMPTY_UUID}::uuid)",
    suite: CONFIRM_SUITE,
  },
  {
    name: "a cursor is decoded without being parsed (somebody else's document is believed)",
    file: CURSOR,
    from: "  const cursor = entryCursorSchema.safeParse(parsed);\n  return cursor.success ? cursor.data : null;",
    to: "  const cursor = entryCursorSchema.safeParse(parsed);\n  return cursor.success ? cursor.data : { name: \"\", id: \"00000000-0000-0000-0000-000000000000\" };",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the chip's label is taken from the LAST spelling, not the list's first",
    file: REPO,
    from: "             (array_agg(mine.status ORDER BY mine.listed_seq))[1] AS label,",
    to: "             (array_agg(mine.status ORDER BY mine.listed_seq DESC))[1] AS label,",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the chips come back in the reverse of the list's own order",
    file: REPO,
    from: "    ORDER BY c.kind, c.first_seq`;",
    to: "    ORDER BY c.kind, c.first_seq DESC`;",
    suite: CONFIRM_SUITE,
  },
  {
    name: "a family sharing one address is answered by the LAST of them, not the first",
    file: REPO,
    from: "         ORDER BY x.listed_seq\n         LIMIT 1)",
    to: "         ORDER BY x.listed_seq DESC\n         LIMIT 1)",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the pure rule is handed the gym's list in reverse",
    file: REPO,
    from: "    ORDER BY listed_seq`;",
    to: "    ORDER BY listed_seq DESC`;",
    suite: CONFIRM_SUITE,
  },
  {
    name: "listed_seq is stamped against the file's order instead of with it",
    file: REPO,
    from: "    ord: index,",
    to: "    ord: -index,",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the upload row is not locked FOR UPDATE (what really serialises two presses)",
    file: REPO,
    from: "    WHERE gym_id = ${gymId} AND id = ${uploadId}\n    FOR UPDATE`;",
    to: "    WHERE gym_id = ${gymId} AND id = ${uploadId}`;",
    suite: CONFIRM_SUITE,
  },
  {
    name: "only paid seats count as being in the app (the SQL half)",
    file: REPO,
    from: "      AND m.removed_at IS NULL",
    to: "      AND m.removed_at IS NULL AND m.complimentary = false",
    suite: CONFIRM_SUITE,
  },
  {
    name: "only paid seats count as being in the app (the rule half)",
    file: RECONCILE,
    from: "  for (const member of members) addContact({ email: member.email, phone: member.statedPhone }, memberEmails, memberPhones);",
    to: "  for (const member of members) if (member.seatCounted) addContact({ email: member.email, phone: member.statedPhone }, memberEmails, memberPhones);",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the marks and the leavers are measured over every live member, not the paid seats",
    file: RECONCILE,
    from: "    .filter((member) => member.seatCounted)",
    to: "    .filter(() => true)",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the whole-list counts are the CAPPED chips added up, not the whole list",
    file: SERVICE,
    from: "  const counts: MemberListCounts = totals;",
    to: "  const counts: MemberListCounts = statuses.reduce((sum, row) => ({ entries: sum.entries + row.count, inApp: sum.inApp + row.inApp, canBeInvited: sum.canBeInvited + row.canBeInvited, noEmail: sum.noEmail + row.noEmail }), { entries: 0, inApp: 0, canBeInvited: 0, noEmail: 0 });",
    suite: CONFIRM_SUITE,
  },
  {
    name: "the chips have no ceiling",
    file: REPO,
    from: "      WHERE r.rn <= ${MEMBER_LIST_STATUS_CHIPS_MAX}",
    to: "      WHERE r.rn <= 100000",
    suite: CONFIRM_SUITE,
  },
  // ---------------------------------------------------------------------
  // 3a-v-a: WHAT IS NEVER KEPT (spec §11.2). These are the ONE core rule of
  // that card — the rule behind its worst-thing line: a member's bank card
  // number or medical note left in our database, or an emergency contact's
  // details shown as the member's own. Every one of them was RED when the card
  // was built, and two of them are faults this harness's own suites caught
  // while it was being written, not hypotheticals.
  // ---------------------------------------------------------------------
  {
    name: "§11.2: a payment card number is not recognised at all",
    file: NEVER_KEEP,
    from: '  return looksLikeAPaymentCard(text.replace(/[^0-9]/g, ""));',
    to: "  return false;",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "§11.2: one card-shaped cell drops its whole column (a gym's member numbers are thrown away)",
    file: NEVER_KEEP,
    from: "  const mostly = (count: number): boolean => shapes.written > 0 && count / shapes.written >= MEMBER_LIST_NEVER_KEEP_SHARE;",
    to: "  const mostly = (count: number): boolean => count > 0;",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "§11.2: a dropped column is taken back on its CELLS and read as the member's phone",
    file: COLUMNS,
    from: "  const unheaded = stats.filter((stat) => stat.neverKept === null && !taken.has(stat.index) && (stat.reading === null || stat.reading.field === null));",
    to: "  const unheaded = stats.filter((stat) => !taken.has(stat.index) && (stat.reading === null || stat.reading.field === null));",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "§11.2: a dropped column shows three of its own cells to staff",
    file: COLUMNS,
    from: "      samples: stat.neverKept === null ? stat.samples : [],",
    to: "      samples: stat.samples,",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "§11.2: a card-shaped cell is still shown as one of its column's samples",
    file: COLUMNS,
    // IT BREAKS BOTH HALVES NOW, and that is a finding of its own. Since round one a
    // sample is scrubbed of a card written INSIDE it as well as skipped for being one,
    // so dropping the `!card` guard alone left the whole-cell card redacted and the
    // mutant ran GREEN — a rule guarded twice cannot be disproved by breaking it once.
    // What this row is for is "a card-shaped cell is never SHOWN", so it takes out both.
    from: "      if (!card && stat.samples.length < MEMBER_LIST_COLUMN_SAMPLES) stat.samples.push(withoutCardNumbers(text).text);",
    to: "      if (stat.samples.length < MEMBER_LIST_COLUMN_SAMPLES) stat.samples.push(text);",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "§11.2: staff can map a dropped column onto a field after all",
    file: UNDERSTAND,
    from: "  const kept = (index: number): boolean => index < width && !dropped.has(index);",
    to: "  const kept = (index: number): boolean => index < width;",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    // REPLACED after round one (review of PR #90, test note 6). The old row
    // broke this rule into "a bare PIN is always kept", which goes red only on
    // a sheet with NO address — and Critical 3 shipped underneath it, because
    // the shipped rule ALREADY kept a door PIN on every sheet that had one.
    // This row now breaks it back to exactly what shipped and round one caught.
    name: "§11.2: a bare PIN asks only whether the sheet has an address, and holds rather than IS its word",
    file: NEVER_KEEP,
    from: '  if (BARE_PIN_WORDS.some((word) => isWord(header, word))) return hints.hasAddress && !hints.hasPostcode ? null : "password_or_pin";',
    to: '  if (BARE_PIN_WORDS.some((word) => holdsWord(header, word))) return hints.hasAddress ? null : "password_or_pin";',
    suite: NEVER_KEEP_SUITE,
    pure: true,
  },
  {
    name: "§11.2: the member-number card check reads bare digits, so a card typed with spaces is kept (round one, Critical 1)",
    file: FIELDS,
    from: "  if (cardShapedCell(value)) return { value: null, shortened: false, card: true };",
    to: '  if (/^[0-9]{13,19}$/.test(value) && cardShapedCell(value)) return { value: null, shortened: false, card: true };',
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "§11.1: the never-lists stop matching the plural, so Guardians Email becomes the member's (round one, Critical 2)",
    file: HEADER_WORDS,
    from: "const holdsOrPlural = (header: string, word: string): boolean => holds(header, word) || holds(header, `${word}s`);",
    to: "const holdsOrPlural = (header: string, word: string): boolean => holds(header, word);",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "§11.3: a date column's order is read from the first 200 cells again (round one, High 5)",
    file: UNDERSTAND,
    from: "evidenceInColumn(cellsDown(rows, firstDataRow, column));",
    to: "evidenceInColumn([...cellsDown(rows, firstDataRow, column)].slice(0, 200));",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    // Re-check of PR #90. The fix for round one's Critical 3 opened this: a
    // heading that QUALIFIES the word ("Member PIN", "Gym PIN", "Check-in
    // PIN") fell through both rules and was kept on every sheet.
    name: "\u00a711.2: a qualified PIN is not a key, so a gym's keypad code is kept on every member",
    file: NEVER_KEEP,
    from: "    return \"password_or_pin\";\n  }",
    to: "    return null;\n  }",
    suite: NEVER_KEEP_SUITE,
    pure: true,
  },
  {
    name: "\u00a711.2: the abbreviations match their plural again, so Fins is a Singapore ID and GPS Watch a doctor",
    file: NEVER_KEEP,
    from: "  word.length <= LONGEST_ABBREVIATION ? holdsWordExactly(header, word) : holdsWord(header, word);",
    to: "  holdsWord(header, word);",
    suite: NEVER_KEEP_SUITE,
    pure: true,
  },

  // ── 3a-v-b: §11.2 AT THE BOUNDARY THAT WRITES ────────────────────────────────
  //
  // **THE ONE CORE RULE OF THIS JOB** (CLAUDE.md §4's deliberate breaks). Everything
  // above tests what the file READER drops; these three test what the CONFIRM drops,
  // which is the first place in this feature where a missed cell reaches a real table
  // and sits there under a member's name.
  {
    name: "\u00a711.2: the confirm stops asking whether a cell of the gym's own column is a card",
    file: EXTRA_FIELDS,
    from: '    if (cell !== "" && cardShapedCell(cell)) {',
    to: "    if (false) {",
    suite: KEEP_SUITE,
    pure: true,
  },
  {
    name: "\u00a711.2: a dropped cell leaves its KEY OUT, so the merge keeps the card the write was dropping",
    file: EXTRA_FIELDS,
    from: '      document[field.key] = "";\n      continue;',
    to: "      continue;",
    suite: KEEP_SUITE,
    pure: true,
  },
  {
    name: "\u00a711.2: a card can be written as one of the gym's own WORDS (a status of 4111 1111 1111 1111)",
    file: EXTRA_FIELDS,
    from: "  if (cardShapedCell(word)) return { value: null, card: true };",
    to: "  if (false) return { value: null, card: true };",
    suite: KEEP_SUITE,
    pure: true,
  },
  // ── 3a-v-b: A FORMER RECORD ADMITS NOBODY (\u00a711.1) ────────────────────────
  //
  // The job's other worst-thing line: an ex-member counted where an invite is decided.
  {
    name: "\u00a711.1: the rule measures everything against EVERY record, so a former one is still on the list",
    file: RECONCILE,
    from: "  const current = entries.filter((entry) => !entry.former);",
    to: "  const current = entries;",
    suite: KEEP_SUITE,
    pure: true,
  },
  {
    name: "\u00a711.1: a member is matched to a FORMER record, so somebody the gym took off reads on your list",
    file: REPO,
    from: "         WHERE x.gym_id = m.gym_id AND x.former_at IS NULL AND v.proved AND x.email = u.email",
    to: "         WHERE x.gym_id = m.gym_id AND v.proved AND x.email = u.email",
    suite: KEPT_SUITE,
  },
  {
    name: "\u00a711.1: the list's counts and chips include the people the gym has taken off",
    file: REPO,
    from: "      WHERE e.gym_id = ${gymId} AND e.former_at IS NULL\n    ),",
    to: "      WHERE e.gym_id = ${gymId}\n    ),",
    suite: KEPT_SUITE,
  },
  // ── 3a-v-b: A CORRECTION IS NEVER WRITTEN OVER WITHOUT A TICK (\u00a711.4) ────
  {
    name: "\u00a711.4: the confirm applies a file that would replace staff's own corrections, with no tick",
    file: SERVICE,
    from: "    if (reconciled.handEdits.entries > 0 && !input.acknowledgeHandEdits) {",
    to: "    if (false) {",
    suite: KEPT_SUITE,
  },
  {
    name: "\u00a711.4: a field the file does not CARRY is written anyway, so a narrower export empties the record",
    file: SERVICE,
    from: "  status: mapping.status !== null,\n  membershipType: mapping.membershipType !== null,",
    to: "  status: true,\n  membershipType: true,",
    suite: KEPT_SUITE,
  },
  {
    name: "\u00a711.1: a person coming off the list is DELETED again, as \u00a79.2 rule 2 had it",
    file: REPO,
    from: "    UPDATE gym_member_list_entries\n    SET former_at = ${at}",
    to: "    DELETE FROM gym_member_list_entries",
    suite: KEPT_SUITE,
    note: "expected GREEN on its own: marking an already-former row again is what this refuses, and no route can produce one",
  },

  // ── ROUND ONE'S OWN FOUR, each driven by the reviewer against the real service ─
  {
    name: "round one High-1: the gym's catalogue is written BEFORE the tick gates, so a refused confirm keeps it",
    file: SERVICE,
    from: "    await repo.addFields(tx, gymId, grown.fresh);",
    to: "",
    extra: {
      from: "    const grown = growFields(await repo.listFields(tx, gymId), file.understanding.extraFields, MEMBER_LIST_MAX_EXTRA_FIELDS);",
      to:
        "    const grown = growFields(await repo.listFields(tx, gymId), file.understanding.extraFields, MEMBER_LIST_MAX_EXTRA_FIELDS);\n" +
        "    await repo.addFields(tx, gymId, grown.fresh);",
    },
    suite: KEPT_SUITE,
  },
  {
    name: "round one High-2: the end-or-renewal KIND is compared without its day, so an empty cell is changed for ever",
    file: RECONCILE,
    from: "  const rowKind = row.endsOn === null ? null : endsOnKind;",
    to: "  const rowKind = endsOnKind;",
    suite: KEEP_SUITE,
    pure: true,
  },
  {
    name: "round one High-3: an unnamed column is keyed by its place again, so inserting a column beside it makes a second field",
    file: UNDERSTAND,
    from: "    unnamed.n += 1;\n    key = `unnamed_${String(unnamed.n)}`;",
    to: "    key = `unnamed_${String(taken.size + 1)}`;",
    // THE READER'S suite, not the pure one: the key is made in `understand.ts`, and
    // the first version of this row pointed at a table test that builds its fields BY
    // HAND and never reaches the rule at all — so the mutant ran GREEN and read exactly
    // like a rule that holds. Found by running it.
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "round one High-4: a card written inside a note is written to the database with the note",
    file: EXTRA_FIELDS,
    from: "    const scrubbed = withoutCardNumbers(cell);",
    to: "    const scrubbed = { text: cell, removed: 0 };",
    suite: KEEP_SUITE,
    pure: true,
  },
  {
    name: "round one High-4, the reader's half: a note reaches the staged file with its card still in it",
    file: UNDERSTAND,
    from: "    const scrubbed = withoutCardNumbers(raw);",
    to: "    const scrubbed = { text: raw, removed: 0 };",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "round one Low-2: a former record cannot say that its person is in the app",
    file: SERVICE,
    from: "    inAppEntryIds: records === \"current\" ? inAppEntryIds(members) : inAppEntryIdsWithFormer(members),",
    to: "    inAppEntryIds: inAppEntryIds(members),",
    suite: KEPT_SUITE,
  },
  {
    name: "round one High-4, the samples: a card inside a note is still SHOWN beside its heading",
    file: COLUMNS,
    from: "if (!card && stat.samples.length < MEMBER_LIST_COLUMN_SAMPLES) stat.samples.push(withoutCardNumbers(text).text);",
    to: "if (!card && stat.samples.length < MEMBER_LIST_COLUMN_SAMPLES) stat.samples.push(text);",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "round one High-4, the gym's own words: a card inside a status or a payment word reaches the staged file",
    file: FIELDS,
    from: "  return cut(withoutCardNumbers(text).text, MEMBER_LIST_MAX_STATUS_CHARS);",
    to: "  return cut(text, MEMBER_LIST_MAX_STATUS_CHARS);",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "round one High-4, a name: a card written beside a person's name is kept with it",
    file: FIELDS,
    from: "  if (full !== \"\") return cut(withoutCardNumbers(full).text, MEMBER_LIST_MAX_NAME_CHARS);",
    to: "  if (full !== \"\") return cut(full, MEMBER_LIST_MAX_NAME_CHARS);",
    suite: WIDER_SUITE,
    pure: true,
  },
  // ── the re-check: the in-text card rule, and the length cap ─────────────────
  {
    name: "re-check Open-1: no issuer prefix, so any 13-19 digits that pass Luhn are a card",
    file: NEVER_KEEP,
    from: "const isCardNumber = (digits: string): boolean => issuerPrefix(digits) && looksLikeAPaymentCard(digits);",
    to: "const isCardNumber = (digits: string): boolean => looksLikeAPaymentCard(digits);",
    suite: KEEP_SUITE,
    pure: true,
  },
  {
    name: "re-check Open-1: any group may be short, so a list of small numbers becomes a card",
    file: NEVER_KEEP,
    from: "          if (next.digits.length !== 4 && next.digits.length !== 6) break;",
    to: "",
    suite: KEEP_SUITE,
    pure: true,
  },
  {
    name: "re-check §3: a word is cut before its card is replaced, so the marker pushes it past the cap",
    file: FIELDS,
    from: "  return cut(withoutCardNumbers(text).text, MEMBER_LIST_MAX_STATUS_CHARS);",
    to: "  return withoutCardNumbers(cut(text, MEMBER_LIST_MAX_STATUS_CHARS)).text;",
    suite: WIDER_SUITE,
    pure: true,
  },
  {
    name: "re-check §3: the write boundary does not cut after replacing a card",
    file: EXTRA_FIELDS,
    from: "  return { value: cut(scrubbed.text, MEMBER_LIST_MAX_STATUS_CHARS), card: true };",
    to: "  return { value: scrubbed.text, card: true };",
    suite: KEEP_SUITE,
    pure: true,
  },
];

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** AN ANCHOR HAS TO MATCH THE FILE'S OWN LINE ENDING. These files are CRLF in the
 *  working tree (git checks them out that way here) and an anchor written with
 *  plain \n silently fails to match — which makes a break run GREEN and read as a
 *  rule that holds. */
const eol = (text, file) => (readFileSync(file, "utf8").includes("\r\n") ? text.replace(/\n/g, "\r\n") : text);

// THE ANCHOR CENSUS FIRST, and no database (harness anchors rot under small cards;
// a break whose anchor no longer matches runs GREEN and looks like a passing rule).
if (process.argv[2] === "--census") {
  let missing = 0;
  for (const [i, brk] of BREAKS.entries()) {
    const text = readFileSync(brk.file, "utf8");
    const ok = text.includes(eol(brk.from, brk.file));
    if (!ok) missing += 1;
    console.log(`${ok ? "ok     " : "MISSING"} #${i} ${brk.name}`);
  }
  console.log(`\n${BREAKS.length - missing}/${BREAKS.length} anchors present`);
  process.exit(missing === 0 ? 0 : 1);
}

const only = process.argv[2] === undefined ? null : Number(process.argv[2]);
const results = [];
for (const [i, brk] of BREAKS.entries()) {
  if (only !== null && only !== i) continue;
  const before = readFileSync(brk.file, "utf8");
  const beforeSha = sha(brk.file);
  const from = eol(brk.from, brk.file);
  if (!before.includes(from)) {
    results.push({ i, name: brk.name, outcome: "ANCHOR MISSING" });
    continue;
  }
  let broken = before.replace(from, eol(brk.to, brk.file));
  if (brk.extra !== undefined) {
    if (!broken.includes(brk.extra.from)) {
      results.push({ i, name: brk.name, outcome: "EXTRA ANCHOR MISSING" });
      continue;
    }
    broken = broken.replace(brk.extra.from, brk.extra.to);
  }
  writeFileSync(brk.file, broken);
  let red = false;
  let note = "";
  try {
    const args =
      brk.pure === true ? ["pnpm", "--filter", "api", "exec", "vitest", "run", `test/${brk.suite}`] : ["pnpm", "--filter", "api", "test:local", brk.suite];
    execFileSync("corepack", args, {
      cwd: ROOT,
      stdio: "pipe",
      shell: true,
      timeout: 600_000,
    });
  } catch (e) {
    red = true;
    note = String(e.status ?? "");
  }
  writeFileSync(brk.file, before);
  const restored = sha(brk.file) === beforeSha;
  results.push({ i, name: brk.name, outcome: red ? "RED" : "GREEN", restored, note });
  console.log(`${red ? "RED  " : "GREEN"} #${i} ${brk.name}${restored ? "" : "  !! NOT RESTORED"}`);
}
console.log("\n--- summary ---");
for (const r of results) console.log(`#${r.i} ${r.outcome}${r.restored === false ? " NOT-RESTORED" : ""} :: ${r.name}`);
const green = results.filter((r) => r.outcome !== "RED");
console.log(`\n${results.length - green.length}/${results.length} red`);
