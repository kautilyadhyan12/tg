// What one publish does to the Library's rows (spec Part 2 §13.4, job 60b). Pure: the checked files
// and the rows already published in; the download's list, the rows to write and the rows to mark
// removed out. The rule it holds: a member's history never shows a set with no exercise.
// - A Library row is never deleted: it is the one place a gone exercise's name is kept.
// - An exercise whose file is gone is 'hidden' (in the download, so history names it) while a saved
//   set names it, and always for one of the old 58, which the old save route can still name.
// - Otherwise it is 'removed': out of the download, its entry kept. Every publish asks again about
//   every gone row, so a set that arrives later (an offline phone) brings it back as 'hidden'.
import type { CompendiumTable, ExerciseFile, LibraryEntry } from "@app/shared";
import { canonicalJson } from "./canonical.js";

/** A row already published: its exercise, its id word, its status, whether it is one of the old 58
 *  (its `exercises` row has the old facts), and the entry it was last published with, as stored. A
 *  stored entry is not trusted: it is checked again as part of the new list. */
export interface PublishedRow {
  exerciseId: string;
  slug: string;
  status: string;
  old: boolean;
  entry: unknown;
}

export interface PublishPlan {
  /** The download's exercises, by id word: every file's, and every hidden one's. Unchecked: the
   *  hidden ones are stored entries. */
  list: { id: string; entry: unknown }[];
  /** The rows to write with their entry from the list: new, changed, or newly hidden. An unchanged
   *  row is not written. `exerciseId` is null for an exercise the Library has not published before. */
  write: { slug: string; exerciseId: string | null }[];
  /** Rows newly marked removed, by exercise id: file gone, nothing names them, not one of the old 58. */
  markRemoved: string[];
}

/** The rows whose file is gone, whatever their status: every publish asks about all of them. */
export function rowsWithoutFile(files: readonly ExerciseFile[], rows: readonly PublishedRow[]): PublishedRow[] {
  const ids = new Set(files.map((f) => f.id));
  return rows.filter((r) => !ids.has(r.slug));
}

/** The entry for a file: the file as it is, with the MET its Compendium code names. */
export function entryOf(file: ExerciseFile, compendium: CompendiumTable): LibraryEntry {
  const row = compendium.rows.find((r) => r.code === file.energy.compendium);
  // The check refuses a file whose code the table lacks, so this is a broken caller, never a file.
  if (row === undefined) throw new Error(`plan: ${file.id} names ${file.energy.compendium}, which the checked table lacks`);
  return { ...file, met: row.met };
}

/** A stored entry, marked hidden. Every fact it was published with is kept: the phone names the
 *  exercise in history from it. */
export function hiddenEntry(stored: unknown): unknown {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return stored;
  return { ...stored, status: "hidden" };
}

export function planPublish(input: {
  files: readonly ExerciseFile[];
  compendium: CompendiumTable;
  rows: readonly PublishedRow[];
  /** Of the rows whose file is gone, the exercise ids a saved set names. */
  named: ReadonlySet<string>;
}): PublishPlan {
  const bySlug = new Map(input.rows.map((r) => [r.slug, r]));
  const plan: PublishPlan = { list: [], write: [], markRemoved: [] };

  for (const file of input.files) {
    const entry = entryOf(file, input.compendium);
    const row = bySlug.get(file.id);
    if (row === undefined || row.status !== entry.status || canonicalJson(row.entry) !== canonicalJson(entry)) {
      plan.write.push({ slug: file.id, exerciseId: row?.exerciseId ?? null });
    }
    plan.list.push({ id: file.id, entry });
  }

  for (const row of rowsWithoutFile(input.files, input.rows)) {
    if (!row.old && !input.named.has(row.exerciseId)) {
      if (row.status !== "removed") plan.markRemoved.push(row.exerciseId);
      continue;
    }
    const entry = hiddenEntry(row.entry);
    if (row.status !== "hidden" || canonicalJson(row.entry) !== canonicalJson(entry)) {
      plan.write.push({ slug: row.slug, exerciseId: row.exerciseId });
    }
    plan.list.push({ id: row.slug, entry });
  }

  plan.list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  plan.markRemoved.sort();
  return plan;
}
