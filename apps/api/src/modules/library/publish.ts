// Publishing the Exercise Library (spec Part 2 §13.4, job 60b): run by the seed, so by every deploy
// and on GitHub. It checks every exercise file and refuses the whole publish, naming the file and the
// fact, while any fault is left; then, in one transaction and one publish at a time, it writes each
// exercise's row and, only when the content changed, one new numbered copy of the whole list for each
// of live and beta. A copy is never changed.
import type { TransactionSql } from "postgres";
import { checkLibrary, faultLine, libraryEntrySchema, type LibraryEntry, type LibraryFault, type LibraryInput, type LibraryList } from "@app/shared";
import { canonicalJson, sha256 } from "./canonical.js";
import { planPublish, rowsWithoutFile } from "./plan.js";
import * as repo from "./repo.js";

export class LibraryRefused extends Error {
  constructor(readonly faults: readonly LibraryFault[]) {
    super(`The Exercise Library was not published. Fix these first:\n${faults.map((f) => `  ${faultLine(f)}`).join("\n")}`);
    this.name = "LibraryRefused";
  }
}

export interface PublishOutcome {
  /** Exercises in the list, of each status. */
  live: number;
  retired: number;
  hidden: number;
  /** Rows written (new, changed or newly hidden), and rows removed. */
  written: number;
  removed: number;
  /** The new copies, one for each channel whose content changed; empty when nothing changed. */
  copies: { channel: repo.Channel; version: number }[];
  fingerprint: string;
}

const CHANNELS: readonly repo.Channel[] = ["live", "beta"];

/** The text of a copy, the fingerprint's text and the download's. */
export function copyText(list: LibraryList): string {
  return canonicalJson(list);
}

export async function publishLibrary(tx: TransactionSql, input: LibraryInput): Promise<PublishOutcome> {
  const checked = checkLibrary(input);
  if (checked.faults.length > 0 || checked.compendium === null) throw new LibraryRefused(checked.faults);

  await repo.lockPublishing(tx);
  const rows = await repo.publishedRows(tx);
  const named = await repo.namedBySavedSets(tx, rowsWithoutFile(checked.exercises, rows).map((r) => r.exerciseId));
  const plan = planPublish({ files: checked.exercises, compendium: checked.compendium, rows, named });

  // Every entry is checked before anything is written, the hidden ones' stored entries included: a
  // stored entry that no longer reads as an entry refuses the publish instead of reaching a phone.
  const entries = new Map<string, LibraryEntry>();
  const faults: LibraryFault[] = [];
  for (const { id, entry } of plan.list) {
    const parsed = libraryEntrySchema.safeParse(entry);
    if (parsed.success) entries.set(id, parsed.data);
    else faults.push({ file: `library_exercises (${id})`, at: "", problem: `its stored entry no longer reads as an exercise: ${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}` });
  }
  if (faults.length > 0) throw new LibraryRefused(faults);
  const entryOf = (slug: string): LibraryEntry => {
    const e = entries.get(slug);
    if (e === undefined) throw new Error(`publish: ${slug} is written but not in the list`);
    return e;
  };

  const ids = await repo.exerciseRowsFor(
    tx,
    plan.write.filter((w) => w.exerciseId === null).map((w) => ({ slug: w.slug, met: entryOf(w.slug).met })),
  );
  await repo.writeRows(
    tx,
    plan.write.map((w) => {
      const exerciseId = w.exerciseId ?? ids.get(w.slug);
      if (exerciseId === undefined) throw new Error(`publish: no exercises row for ${w.slug}`);
      return { exerciseId, entry: entryOf(w.slug) };
    }),
  );
  await repo.removeRows(tx, plan.remove);

  const list: LibraryList = { exercises: plan.list.map((l) => entryOf(l.id)), camera: [] };
  const body = copyText(list);
  const fingerprint = sha256(body);
  const copies: PublishOutcome["copies"] = [];
  for (const channel of CHANNELS) {
    const newest = await repo.newestCopy(tx, channel);
    if (newest?.sha256 !== fingerprint) copies.push({ channel, version: await repo.addCopy(tx, channel, fingerprint, body) });
  }

  const count = (s: LibraryEntry["status"]) => list.exercises.filter((e) => e.status === s).length;
  return {
    live: count("live"),
    retired: count("retired"),
    hidden: count("hidden"),
    written: plan.write.length,
    removed: plan.remove.length,
    copies,
    fingerprint,
  };
}
