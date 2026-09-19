// A sheet's rows, gathered within the limits of spec Part 3 §9.9 whatever the
// file claims: at most MEMBER_FILE_MAX_SHEET_ROWS rows, MEMBER_FILE_MAX_COLUMNS
// columns and MEMBER_FILE_MAX_CELL_CHARS characters a cell. A reader hands it
// rows one at a time and stops when it says the sheet runs past its cut, so a
// file of five million empty lines never becomes five million rows in memory.
import {
  MEMBER_FILE_MAX_CELL_CHARS,
  MEMBER_FILE_MAX_COLUMNS,
  MEMBER_FILE_MAX_SHEET_ROWS,
  type MemberFileSheet,
} from "@app/shared";

/** A cell counts as written when it holds more than white space. */
export const isWritten = (cell: string | undefined): boolean => cell !== undefined && cell.trim() !== "";

/** A cell cut to the limit, never between the two halves of an emoji or any
 *  other character outside the basic plane. */
export function cutCell(cell: string): string {
  if (cell.length <= MEMBER_FILE_MAX_CELL_CHARS) return cell;
  const last = cell.charCodeAt(MEMBER_FILE_MAX_CELL_CHARS - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? MEMBER_FILE_MAX_CELL_CHARS - 1 : MEMBER_FILE_MAX_CELL_CHARS;
  return cell.slice(0, end);
}

export class GridBuilder {
  private readonly rows: string[][] = [];
  /** Blank rows not yet kept: kept only once a written row follows them, so the
   *  blank rows after the last written one are never stored at all. */
  private blankRun = 0;
  private cutRows = false;
  private cutColumns = false;

  constructor(private readonly name: string | null) {}

  /** The sheet's next row. `writtenPastCut` is a reader's word that the row had
   *  a written cell it did not hand over (a CSV row past the last column).
   *  Returns false once the sheet is known to run past its last row: the reader
   *  may stop, nothing more will be kept. */
  addRow(cells: ReadonlyArray<string>, writtenPastCut = false): boolean {
    if (this.cutRows) return false;
    // The last written cell at all, and the last one inside the cut: a row
    // written only past the cut is a written row that keeps no cell.
    let lastWritten = -1;
    let lastKept = -1;
    for (let i = 0; i < cells.length; i++) {
      if (!isWritten(cells[i])) continue;
      lastWritten = i;
      if (i < MEMBER_FILE_MAX_COLUMNS) lastKept = i;
    }
    if (writtenPastCut || lastWritten >= MEMBER_FILE_MAX_COLUMNS) this.cutColumns = true;
    if (lastWritten < 0 && !writtenPastCut) {
      this.blankRun++;
      return true;
    }
    if (this.rows.length + this.blankRun + 1 > MEMBER_FILE_MAX_SHEET_ROWS) {
      this.cutRows = true;
      return false;
    }
    for (; this.blankRun > 0; this.blankRun--) this.rows.push([]);
    this.rows.push(cells.slice(0, lastKept + 1).map(cutCell));
    return true;
  }

  /** Every row as wide as the widest written one. */
  finish(): MemberFileSheet {
    const width = this.rows.reduce((widest, row) => Math.max(widest, row.length), 0);
    const rows = this.rows.map((row) => (row.length === width ? row : [...row, ...Array<string>(width - row.length).fill("")]));
    return { name: this.name, rows, truncated: { rows: this.cutRows, columns: this.cutColumns } };
  }
}
