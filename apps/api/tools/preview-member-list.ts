// Prints what an upload WOULD do to a gym's list (spec Part 3 §9.6–§9.9). There
// is no screen until ROADMAP item 5, so this is how a real export is tried
// against a real gym — and it is what the reviewer runs the real exports through.
//
//   corepack pnpm --filter api exec tsx tools/preview-member-list.ts <path> \
//     --gym=<slug> --database-url=postgres://… [--mode=add] [--show=5] \
//     [--confirm [--acknowledge-large-change]]
//
// It calls the SERVICE the route calls, so the reader, the one reconcile rule and
// the wrong-file guard are the ones that answer a request. Without `--confirm`
// nothing about anybody's membership changes and nobody is emailed: it stages one
// upload row, exactly as the route does, and prints the preview.
//
// **`--confirm` IS THE ONLY THING HERE THAT WRITES** (3a-iii-b). It applies the
// preview it has just printed, under the gym's row lock, and then reads the list
// back — which is how a reviewer puts a real export through the whole of this
// feature. Still nobody is emailed: that is 3b's button and nothing here has it.
//
// THE DATABASE IS NAMED BY THIS TOOL'S OWN ARGUMENT AND NOTHING ELSE. It does not
// read `apps/api/.env`, and it does not fall back to `DATABASE_URL`: on Kd's
// machine both point at the real data, and the last thing an operator tool should
// do is stage an upload there because it was run without thinking.
//
// WITHOUT `--show` no cell of the file is printed, only counts and headings;
// `--show=N` prints N people from each group, which is the file's own data — real
// members' names, addresses and phone numbers — on your screen.
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import {
  memberListWarningWords,
  MEMBER_LIST_FIELD_WORDS,
  MEMBER_LIST_NEVER_KEPT_WORDS,
  MEMBER_LIST_SKIP_WORDS,
  type MemberListMode,
  type MemberListRowGroup,
} from "@app/shared";
import { databaseUrlFrom } from "./import-usda-args.js";
import * as service from "../src/modules/orgs/memberList/service.js";
import { createMemoryRedis } from "../src/redis.js";
import { OrgsError } from "../src/modules/orgs/service.js";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const path = process.argv[2];
const slug = arg("gym");
if (path === undefined || path.startsWith("--") || slug === undefined) {
  throw new Error(
    "usage: tsx tools/preview-member-list.ts <path> --gym=<slug> --database-url=<url> [--mode=add] [--show=5]",
  );
}
const chosen = databaseUrlFrom(process.argv, process.env);
if (!("url" in chosen)) {
  throw new Error(
    "no database was named. Pass --database-url=<url>, or --database-url-env=<VARIABLE> to keep it off the command line.\n" +
      "It never reads apps/api/.env and never falls back to DATABASE_URL — on this machine both point at the real data.",
  );
}
const mode: MemberListMode = arg("mode") === "add" ? "add" : "whole_list";
/** WITHOUT THIS FLAG THE TOOL CHANGES NOTHING, which is what it has always
 *  promised. With it, the preview is applied through the same service the route
 *  calls — the lock, the stale-preview refusal and the wrong-file guard included —
 *  and the gym's list is written. */
const confirming = process.argv.includes("--confirm");
const show = Number(arg("show") ?? "0");
if (!Number.isInteger(show) || show < 0) throw new Error("--show must be a whole number of rows");

const bytes = await readFile(path);
const sql = postgres(chosen.url, { prepare: false, max: 2 });
try {
  const gyms = await sql<{ id: string; name: string; country: string | null; owner_user_id: string }[]>`
    SELECT id, name, country, owner_user_id FROM gyms WHERE slug = ${slug}`;
  const gym = gyms[0];
  if (gym === undefined) throw new Error(`no gym has the slug ${slug}`);

  // The gym's OWNER stands in for whoever would be signed in. An operator tool
  // holding the database is already past every gate the route has; this is not a
  // way round `members.confirm`, it is who the row is attributed to.
  const deps: service.MemberListDeps = {
    sql,
    redis: createMemoryRedis(),
    log: { warn: () => undefined },
    now: () => new Date(),
  };

  console.log(`${path} — ${String(bytes.byteLength)} bytes`);
  console.log(`${gym.name} (${slug}), country ${gym.country ?? "not set"}, as "${mode === "add" ? "add these people" : "my whole list"}"\n`);

  const preview = await service.previewUpload(
    deps,
    gym.owner_user_id,
    gym.id,
    { contentBase64: bytes.toString("base64"), mode },
    () => Promise.resolve(true),
  );
  if (preview === null) throw new Error("the rate limiter refused, which this tool cannot happen upon");

  console.log(
    `Opened as ${preview.kind}${preview.facts.encoding === undefined ? "" : `, read as ${preview.facts.encoding}`}` +
      (preview.facts.delimiter === undefined ? "" : `, columns split on ${JSON.stringify(preview.facts.delimiter)}`),
  );
  console.log(
    `Sheet ${String(preview.sheet.index + 1)}${preview.sheet.name === null ? "" : ` "${preview.sheet.name}"`}` +
      `, headings ${preview.headerRow === null ? "NONE" : `on row ${String(preview.headerRow + 1)}`}`,
  );
  if (preview.needsMapping) console.log("NO EMAIL OR PHONE COLUMN FOUND — staff would be asked which column is which.");
  if (preview.sameAsLastUpload) console.log("THIS IS THE FILE THIS GYM LAST CONFIRMED — applying it again would write nothing.");

  console.log("\nColumns");
  for (const column of preview.columns) {
    const said =
      column.neverKept !== null
        ? ` → NOT KEPT (${column.neverKept})`
        : column.guess !== null
          ? ` → ${column.guess} (${column.confidence ?? "?"})`
          : column.headerSays !== null
            ? ` → named ${column.headerSays}, NOT used`
            : " → the gym's own column";
    console.log(
      `  ${String(column.index).padStart(3)} ${(column.header ?? "").slice(0, 28).padEnd(30)}${said.padEnd(28)}` +
        column.samples.map((s) => s.slice(0, 20)).join(" | "),
    );
  }

  const dropped = preview.columns.filter((column) => column.neverKept !== null);
  if (dropped.length > 0) {
    console.log("\nNot kept, whatever the gym or its staff want (§11.2)");
    for (const column of dropped) {
      console.log(`  ${(column.header ?? "(no heading)").slice(0, 28).padEnd(30)}${MEMBER_LIST_NEVER_KEPT_WORDS[column.neverKept ?? "medical"]}`);
    }
  }

  console.log("\nIn the file");
  for (const [what, howMany] of Object.entries(preview.file)) console.log(`  ${what.padEnd(18)} ${String(howMany)}`);

  console.log("\nWhat it would do to the list");
  for (const [what, howMany] of Object.entries(preview.list)) console.log(`  ${what.padEnd(18)} ${String(howMany)}`);
  console.log(`  ${"members leaving".padEnd(18)} ${String(preview.members.leaving)} of ${String(preview.members.listedNow)} on the list now`);

  if (preview.fieldChanges.length > 0 || preview.extraChanges.length > 0) {
    console.log("\nWhat would change, field by field");
    for (const change of preview.fieldChanges) {
      console.log(`  ${MEMBER_LIST_FIELD_WORDS[change.field].padEnd(24)} ${String(change.count)}`);
    }
    for (const change of preview.extraChanges) {
      console.log(`  ${change.label.slice(0, 22).padEnd(24)} ${String(change.count)}`);
    }
  }

  if (preview.handEdits.entries > 0) {
    console.log(
      `\nWOULD REPLACE WHAT STAFF TYPED IN on ${String(preview.handEdits.entries)} record(s): ${preview.handEdits.fields.join(", ")}` +
        "\n  Confirming needs --acknowledge-hand-edits.",
    );
  }

  if (preview.statuses.length > 0) {
    console.log("\nThe gym's own words");
    for (const s of preview.statuses) {
      console.log(
        `  ${(s.label === "" ? "(no status)" : s.label).padEnd(24)} ${String(s.count).padStart(5)}` +
          `   new ${String(s.new)} · changed ${String(s.changed)} · same ${String(s.unchanged)} · off ${String(s.gone)}`,
      );
    }
  }

  console.log("\nSeats");
  console.log(`  cap ${preview.seat.cap === null ? "none" : String(preview.seat.cap)} · members now ${String(preview.seat.liveMembers)} · the list would hold ${String(preview.seat.listSize)}`);

  console.log("\nThe wrong-file guard");
  console.log(`  ${String(preview.guard.entriesGoing)} of ${String(preview.guard.listSize)} would come off the list`);
  console.log(`  ${String(preview.guard.membersLeaving)} of ${String(preview.guard.membersListedNow)} app members would be marked as dropped off`);
  console.log(`  needs a tick first: ${preview.guard.needsTick ? "YES" : "no"}${preview.guard.mostOfListWouldGo ? " · MORE THAN HALF THE LIST WOULD GO — offer 'add these people' instead" : ""}`);

  if (preview.warnings.length > 0) {
    console.log("\nWorth knowing");
    for (const warning of preview.warnings) console.log(`  - ${memberListWarningWords(warning)}`);
  }
  if (preview.skipped.length > 0) {
    console.log(`\nSkipped rows (${String(preview.skipped.length)})`);
    for (const skip of preview.skipped.slice(0, 10)) {
      console.log(`  row ${String(skip.row)}: ${MEMBER_LIST_SKIP_WORDS[skip.reason]}`);
    }
  }

  if (show > 0) {
    const groups: MemberListRowGroup[] = ["new", "changed", "unchanged", "gone", "members_leaving"];
    for (const group of groups) {
      const page = await service.readPreviewRows(deps, gym.owner_user_id, gym.id, preview.uploadId, group, 0, () =>
        Promise.resolve(true),
      );
      if (page === null || page.total === 0) continue;
      console.log(`\n${group} (${String(page.total)})`);
      for (const person of page.people.slice(0, show)) {
        const was = person.wasStatus === null || person.wasStatus === person.status ? "" : ` (was ${person.wasStatus})`;
        console.log(
          `  ${(person.row === null ? "—" : String(person.row)).padStart(5)} ${person.fullName.slice(0, 24).padEnd(26)}` +
            `${(person.email ?? "").slice(0, 28).padEnd(30)}${(person.phone ?? "").padEnd(16)}` +
            `${(person.status ?? "").padEnd(12)}${was}${person.inApp ? " · in the app" : ""}`,
        );
      }
    }
  }

  if (!confirming) {
    console.log(`\nStaged as ${preview.uploadId}, expires ${preview.expiresAt}. NOTHING was changed and NOBODY was emailed.`);
  } else {
    // **THIS IS THE ONE THING IN THIS TOOL THAT WRITES**, and it is behind its own
    // flag for that reason. It calls the same service the route calls, so the lock,
    // the stale-preview refusal and the wrong-file guard are the real ones.
    console.log("\n--- CONFIRMING (this WRITES to the gym's list) ---");
    const answer = await service.confirmUpload(
      deps,
      gym.owner_user_id,
      gym.id,
      preview.uploadId,
      {
        acknowledgeLargeChange: process.argv.includes("--acknowledge-large-change"),
        acknowledgeHandEdits: process.argv.includes("--acknowledge-hand-edits"),
      },
      () => Promise.resolve(true),
    );
    if (answer.kind === "rate_limited") throw new Error("the rate limiter refused, which this tool cannot happen upon");
    if (answer.kind === "list_changed") {
      console.log(
        `REFUSED (list_changed): the preview was measured against version ${String(answer.baseVersion)} and the list is on ${String(answer.version)}.\nNOTHING was changed.`,
      );
      process.exitCode = 1;
    } else if (answer.kind === "large_change") {
      console.log(
        `REFUSED (large_change): ${String(answer.guard.entriesGoing)} of ${String(answer.guard.listSize)} would come off, ` +
          `${String(answer.guard.membersLeaving)} of ${String(answer.guard.membersListedNow)} app members would be marked as dropped off.\n` +
          "NOTHING was changed. Re-run with --acknowledge-large-change to go ahead.",
      );
      process.exitCode = 1;
    } else if (answer.kind === "hand_edits") {
      console.log(
        `REFUSED (hand_edits): this file would replace details typed in here on ${String(answer.handEdits.entries)} record(s) — ` +
          `${answer.handEdits.fields.join(", ")}.
NOTHING was changed. Re-run with --acknowledge-hand-edits to let the file win.`,
      );
      process.exitCode = 1;
    } else {
      const done = answer.confirmed;
      console.log(
        done.alreadyConfirmed
          ? `Already applied at ${done.confirmedAt} — this press changed nothing.`
          : `Applied at ${done.confirmedAt}.`,
      );
      console.log(
        `  added ${String(done.applied.new)} (${String(done.applied.returning)} coming back) · changed ${String(done.applied.changed)} · ` +
          `unchanged ${String(done.applied.unchanged)} · made former ${String(done.applied.gone)}`,
      );
      console.log(`  the list is now on version ${String(done.version)} · NOBODY was emailed`);

      const list = await service.readList(deps, gym.owner_user_id, gym.id, () => Promise.resolve(true));
      if (list !== null) {
        console.log("\nThe list now holds");
        console.log(
          `  ${String(list.counts.entries)} people · ${String(list.counts.inApp)} already in the app · ` +
            `${String(list.counts.canBeInvited)} could be invited · ${String(list.counts.noEmail)} with no address · ` +
            `${String(list.counts.former)} former`,
        );
        for (const word of list.statuses) {
          console.log(
            `  ${(word.label === "" ? "(no status)" : word.label).padEnd(24)} ${String(word.count).padStart(5)}` +
              `   in the app ${String(word.inApp)} · could be invited ${String(word.canBeInvited)}`,
          );
        }
      }
    }
  }
} catch (err) {
  if (err instanceof OrgsError) {
    console.log(`REFUSED (${err.code})\n${err.message}`);
    process.exitCode = 1;
  } else throw err;
} finally {
  await sql.end({ timeout: 5 });
}
