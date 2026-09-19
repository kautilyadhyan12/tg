// A sheet's rows, gathered within the limits of spec Part 3 §9.9 whatever the
// file claims: at most MEMBER_FILE_MAX_SHEET_ROWS rows, MEMBER_FILE_MAX_COLUMNS
// columns and MEMBER_FILE_MAX_CELL_CHARS characters a cell. A reader hands it
// rows one at a time and stops when it says the sheet runs past its cut, so a
// file of five million empty lines never becomes five million rows in memory.
//
// The whole grid — every sheet together — also keeps within one budget of cells
// and characters (`GridBudget`). What a grid costs in the worker is not what it
// costs once posted: a workbook can point every cell at one shared string, one
// string in the worker and a copy per cell in the request's thread. The budget
// counts what the copy will hold.
import {
  MEMBER_FILE_MAX_CELL_CHARS,
  MEMBER_FILE_MAX_COLUMNS,
  MEMBER_FILE_MAX_GRID_CELLS,
  MEMBER_FILE_MAX_GRID_CHARS,
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

/** The cells and characters of one file's grid, all its sheets together. Once
 *  over, it stays over, and the file is refused `too_complex`. */
export class GridBudget {
  private settledCells = 0;
  private settledChars = 0;
  exceeded = false;

  /** Whether the finished sheets plus a sheet of `cells` cells and `chars`
   *  characters still fit. */
  fits(cells: number, chars: number): boolean {
    if (this.settledCells + cells > MEMBER_FILE_MAX_GRID_CELLS || this.settledChars + chars > MEMBER_FILE_MAX_GRID_CHARS) {
      this.exceeded = true;
    }
    return !this.exceeded;
  }

  /** A finished sheet's cells and characters, counted for the sheets after it. */
  settle(cells: number, chars: number): void {
    this.settledCells += cells;
    this.settledChars += chars;
  }
}

export class GridBuilder {
  private readonly rows: string[][] = [];
  /** Blank rows not yet kept: kept only once a written row follows them, so the
   *  blank rows after the last written one are never stored at all. */
  private blankRun = 0;
  private width = 0;
  private chars = 0;
  private cutRows = false;
  private cutColumns = false;
  private stopped = false;
  private finished = false;

  constructor(
    private readonly name: string | null,
    private readonly budget: GridBudget,
  ) {}

  /** The sheet's next row. `writtenPastCut` is a reader's word that the row had
   *  a written cell it did not hand over (a CSV row past the last column).
   *  Returns false once nothing more will be kept — the sheet runs past its last
   *  row, or the grid past its budget — so the reader may stop. */
  addRow(cells: ReadonlyArray<string>, writtenPastCut = false): boolean {
    if (this.stopped) return false;
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
    const rowsAfter = this.rows.length + this.blankRun + 1;
    if (rowsAfter > MEMBER_FILE_MAX_SHEET_ROWS) {
      this.cutRows = true;
      this.stopped = true;
      return false;
    }
    const kept = cells.slice(0, lastKept + 1).map(cutCell);
    const width = Math.max(this.width, kept.length);
    const chars = kept.reduce((sum, cell) => sum + cell.length, this.chars);
    // The sheet as it would be posted: every row padded to the widest.
    if (!this.budget.fits(rowsAfter * width, chars)) {
      this.stopped = true;
      return false;
    }
    for (; this.blankRun > 0; this.blankRun--) this.rows.push([]);
    this.rows.push(kept);
    this.width = width;
    this.chars = chars;
    return true;
  }

  /** Every row as wide as the widest written one. The sheet is done: nothing
   *  more is kept, and it counts once against the grid's budget. */
  finish(): MemberFileSheet {
    if (!this.finished) this.budget.settle(this.rows.length * this.width, this.chars);
    this.finished = true;
    this.stopped = true;
    const width = this.width;
    const rows = this.rows.map((row) => (row.length === width ? row : [...row, ...Array<string>(width - row.length).fill("")]));
    return { name: this.name, rows, truncated: { rows: this.cutRows, columns: this.cutColumns } };
  }
}
