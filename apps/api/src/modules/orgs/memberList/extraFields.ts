// THE GYM'S OWN COLUMNS: its catalogue, and what a file's cells become (Part 3
// §11.1, §11.2; ROADMAP 3a-v-b). Pure — no clock, no database — so the rules
// that decide which of a gym's columns are kept, and which cells are never
// written, can be stated as data in a table test.
//
// **THE CATALOGUE IS THE GYM'S AND NOT THE FILE'S**, and everything here follows
// from that. A file brings headings; the catalogue remembers them, in the order
// they were first seen, under a key built from the heading itself — so next
// month's export with its columns in a different order lands in the same fields,
// and a whole-list upload does not un-keep a column the report it came from
// happens to leave out.
import { MEMBER_LIST_MAX_EXTRA_CHARS, MEMBER_LIST_MAX_STATUS_CHARS, type MemberListExtraField } from "@app/shared";
import { cut } from "./fields.js";
import { cardShapedCell, withoutCardNumbers } from "./neverKeep.js";
import type { KeptField } from "./reconcile.js";

/** One of the gym's own columns as the catalogue holds it. */
export interface FieldSlot {
  key: string;
  label: string;
  ord: number;
}

/** THE CATALOGUE AFTER THIS FILE, AND WHAT THIS FILE ADDED TO IT.
 *
 *  A heading the gym already has keeps its key, its label and its place: the label is
 *  the spelling the gym wrote FIRST, like a status word (§9.5), so a gym whose two
 *  exports head one column "Locker" and "LOCKER" reads its own first word. A heading it
 *  has never had is appended, while there is room.
 *
 *  **THE CEILING IS WHY THIS EXISTS AS A RULE RATHER THAN A STATEMENT.** One upload is
 *  already capped at `MEMBER_LIST_MAX_EXTRA_FIELDS` columns by the file reader, but the
 *  catalogue is not replaced by an upload — so a gym uploading differently-shaped
 *  exports would accumulate fields without limit, which is an unbounded document on
 *  every one of its people and an unbounded reply on every page. The columns beyond the
 *  ceiling are not kept, and the preview says so in its own words (`gym_fields_full`);
 *  every column already in the catalogue is kept as usual.
 *
 *  It is pure so that the confirm and the preview can ask the same question of the same
 *  data: the confirm with the gym's real catalogue under its row lock, the preview an
 *  hour earlier to tell staff what would happen. */
export function growFields(
  have: readonly FieldSlot[],
  wanted: readonly { key: string; label: string }[],
  most: number,
): { catalogue: FieldSlot[]; fresh: FieldSlot[] } {
  const known = new Set(have.map((field) => field.key));
  const room = most - have.length;
  const fresh: FieldSlot[] = [];
  let next = have.reduce((highest, field) => Math.max(highest, field.ord + 1), 0);
  for (const field of wanted) {
    if (known.has(field.key) || fresh.length >= room) continue;
    known.add(field.key);
    fresh.push({ key: field.key, label: field.label, ord: next });
    next += 1;
  }
  return { catalogue: [...have, ...fresh], fresh };
}

/** WHICH OF THE FILE'S OWN COLUMNS THIS GYM KEEPS, and how many it does not.
 *
 *  `at` is the cell's place in every row's `extra` list, carried rather than recomputed
 *  because this list is the file's fields FILTERED — filtering a list whose positions
 *  are its meaning is how a gym's "Locker" column ends up read out of its "Notes" cell.
 *
 *  The LABEL comes from the catalogue and not from the file, so what staff read in a
 *  breakdown of changes is the heading their gym has always used. */
export function keptFields(
  catalogue: readonly FieldSlot[],
  fileFields: readonly MemberListExtraField[],
): { kept: KeptField[]; over: number } {
  const byKey = new Map(catalogue.map((field) => [field.key, field]));
  const kept: KeptField[] = [];
  let over = 0;
  for (const [at, field] of fileFields.entries()) {
    const slot = byKey.get(field.key);
    if (slot === undefined) {
      over += 1;
      continue;
    }
    kept.push({ key: slot.key, label: slot.label, at });
  }
  return { kept, over };
}

/** What writing one person's own columns came to. */
export interface WrittenExtra {
  document: Record<string, string>;
  /** Cells dropped here because they are shaped like a payment card (§11.2). */
  cardsDropped: number;
}

/** ONE PERSON'S CELLS UNDER THE GYM'S OWN COLUMNS, AS THEY ARE WRITTEN — with §11.2's
 *  cell rule run AGAIN, over the very values about to reach the database.
 *
 *  **THIS IS THE ONE PLACE A NEVER-KEPT CELL COULD STILL GET IN, AND IT IS THE FIRST
 *  JOB THAT WRITES THESE COLUMNS AT ALL.** 3a-v-a drops a card-shaped cell in the file
 *  reader, before any row crosses to the request thread — and that is where the rule
 *  belongs. But a staged upload lives an hour and is a document in the database: it
 *  outlives a deploy that tightens the rule, it can be reached by a hand-run statement
 *  during an incident, and the confirm reads it back and writes it out. §11.2 says
 *  nothing of a never-keep column reaches the database, not that the reader tries hard;
 *  so the boundary that writes checks it too.
 *
 *  **A CARD-SHAPED CELL IS DROPPED, NOT REFUSED.** Refusing the confirm would leave a
 *  gym unable to load its own list because one cell in ten thousand passes a check
 *  digit, with nothing it could do about it; dropping the cell is as safe for the person
 *  and leaves the gym its list. It is counted so the count can be logged — a count, and
 *  never the cell.
 *
 *  **ONLY THE CARD CHECK IS ASKED OF A SINGLE CELL, and that is measured rather than
 *  assumed** (3a-v-a): 7,269 of 100,000 made-up twelve-digit numbers pass Aadhaar's
 *  Verhoeff check, so asking the government-ID shapes of one cell would throw away a
 *  gym's own member numbers. Those shapes are asked of a whole COLUMN in the reader,
 *  where a share of the column can answer; the card check is the one §11.2 states as a
 *  rule about ANY cell, and it is the one that can be asked here. */
export function extraForWriting(cells: readonly string[], fields: readonly KeptField[]): WrittenExtra {
  const document: Record<string, string> = {};
  let cardsDropped = 0;
  for (const field of fields) {
    const cell = cells[field.at] ?? "";
    if (cell !== "" && cardShapedCell(cell)) {
      cardsDropped += 1;
      // The KEY is still written, with nothing under it: the column is the gym's and
      // the cell is gone, which is what "kept under the gym's own heading, minus the
      // never-keep list" means. A key left out instead would be merged over by
      // whatever the record held before — the old cell, kept by the very write that
      // was dropping it.
      document[field.key] = "";
      continue;
    }
    // …and a card written INSIDE a note has its own digits taken out while the note
    // stays (round one, High-4). The reader does this too; this is the boundary that
    // writes, and it checks what it writes.
    const scrubbed = withoutCardNumbers(cell);
    cardsDropped += scrubbed.removed;
    const text = scrubbed.text;
    document[field.key] = cut(text, MEMBER_LIST_MAX_EXTRA_CHARS);
  }
  return { document, cardsDropped };
}

/** One of the gym's own words as it is written: the same cell rule, for the three words
 *  a record keeps (§11.2). A date cannot be a card, so the three dates are not asked.
 *
 *  A word that is card-shaped becomes NOTHING rather than the card: a status of
 *  "4111 1111 1111 1111" is not a status, and a gym whose export has its card numbers
 *  in the wrong column must not have them written into one we show. */
export function wordForWriting(word: string | null): { value: string | null; card: boolean } {
  if (word === null || word === "") return { value: word, card: false };
  if (cardShapedCell(word)) return { value: null, card: true };
  // A word with a card INSIDE it is not a word either — a status of "paid by card
  // 4111 1111 1111 1111" is a note somebody put in the wrong column, and what must not
  // survive is the number (round one, High-4).
  const scrubbed = withoutCardNumbers(word);
  if (scrubbed.removed === 0) return { value: word, card: false };
  // The marker is longer than some card numbers, so cut again: the column's CHECK is 40.
  return { value: cut(scrubbed.text, MEMBER_LIST_MAX_STATUS_CHARS), card: true };
}
