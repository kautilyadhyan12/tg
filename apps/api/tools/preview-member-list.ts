// Prints what an upload WOULD do to a gym's list (spec Part 3 §9.6–§9.9). There
// is no screen until ROADMAP item 5, so this is how a real export is tried
// against a real gym — and it is what the reviewer runs the real exports through.
//
//   corepack pnpm --filter api exec tsx tools/preview-member-list.ts <path> \
//     --gym=<slug> --database-url=postgres://… [--mode=add] [--show=5]
//
// It calls the SERVICE the route calls, so the reader, the one reconcile rule and
// the wrong-file guard are the ones that answer a request. Nothing about anybody's
// membership changes and nobody is emailed: it stages one upload row, exactly as
// the route does, and prints the preview.
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
      column.guess !== null
        ? ` → ${column.guess} (${column.confidence ?? "?"})`
        : column.headerSays !== null
          ? ` → named ${column.headerSays}, NOT used`
          : "";
    console.log(
      `  ${String(column.index).padStart(3)} ${(column.header ?? "").slice(0, 28).padEnd(30)}${said.padEnd(28)}` +
        column.samples.map((s) => s.slice(0, 20)).join(" | "),
    );
  }

  console.log("\nIn the file");
  for (const [what, howMany] of Object.entries(preview.file)) console.log(`  ${what.padEnd(18)} ${String(howMany)}`);

  console.log("\nWhat it would do to the list");
  for (const [what, howMany] of Object.entries(preview.list)) console.log(`  ${what.padEnd(18)} ${String(howMany)}`);
  console.log(`  ${"members leaving".padEnd(18)} ${String(preview.members.leaving)} of ${String(preview.members.listedNow)} on the list now`);

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

  console.log(`\nStaged as ${preview.uploadId}, expires ${preview.expiresAt}. NOTHING was changed and NOBODY was emailed.`);
} catch (err) {
  if (err instanceof OrgsError) {
    console.log(`REFUSED (${err.code})\n${err.message}`);
    process.exitCode = 1;
  } else throw err;
} finally {
  await sql.end({ timeout: 5 });
}
