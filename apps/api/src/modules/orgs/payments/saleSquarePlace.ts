// WHICH PRODUCT TAKES A REFUND MADE IN SQUARE (ROADMAP 18d-iv-d-ii): Square names the payment and the amount, never a product, and a
// basket's products share one payment. Pure, so every case is a row of a table. The app places it only where nothing else is possible,
// or where staff already said which product by noting it; otherwise staff are asked, and nothing is guessed.

export interface PlaceLine {
  saleId: string;
  lineMinor: number;
  /** What stands refunded on it now, by any way. */
  refundedMinor: number;
}

/** A refund noted by card, oldest first: it may be this same money. */
export interface PlaceNote {
  id: string;
  saleId: string;
  amountMinor: number;
  restocked: number;
}

export interface PlacedPart {
  saleId: string;
  amountMinor: number;
  restock: number;
}

/** The notes this refund replaces: the oldest, until they cover its amount. */
export function notesCrossedOut<N extends { amountMinor: number }>(notes: readonly N[], amountMinor: number): N[] {
  const crossed: N[] = [];
  let covered = 0;
  for (const note of notes) {
    if (covered >= amountMinor) break;
    crossed.push(note);
    covered += note.amountMinor;
  }
  return crossed;
}

const sumOn = (notes: readonly PlaceNote[], saleId: string, read: (n: PlaceNote) => number): number => notes.filter((n) => n.saleId === saleId).reduce((total, n) => total + read(n), 0);

/** What a product can take once the notes being replaced are gone. */
const leftAfter = (line: PlaceLine, crossed: readonly PlaceNote[]): number => Math.max(0, line.lineMinor - (line.refundedMinor - sumOn(crossed, line.saleId, (n) => n.amountMinor)));

export type Placed = { kind: "place"; parts: PlacedPart[]; crossed: PlaceNote[] } | { kind: "ask" };

/** A note's shelf count stays with its product, as those goods did come back. */
export function placeSquareRefund(lines: readonly PlaceLine[], notes: readonly PlaceNote[], amountMinor: number): Placed {
  const crossed = notesCrossedOut(notes, amountMinor);
  const shelf = (saleId: string): number => sumOn(crossed, saleId, (n) => n.restocked);
  const covered = crossed.reduce((total, n) => total + n.amountMinor, 0);

  if (covered >= amountMinor) {
    // Staff already said which product: the notes place it.
    const parts: PlacedPart[] = [];
    let rest = amountMinor;
    for (const note of crossed) {
      const take = Math.min(note.amountMinor, rest);
      rest -= take;
      const part = parts.find((p) => p.saleId === note.saleId);
      if (part !== undefined) part.amountMinor += take;
      else if (take > 0) parts.push({ saleId: note.saleId, amountMinor: take, restock: shelf(note.saleId) });
    }
    return { kind: "place", parts, crossed };
  }

  const open = lines.filter((l) => leftAfter(l, crossed) > 0);
  const [first] = open;
  const totalLeft = open.reduce((total, l) => total + leftAfter(l, crossed), 0);
  const [onlyLine] = lines;
  if (lines.length === 1 && onlyLine !== undefined) return { kind: "place", parts: [{ saleId: onlyLine.saleId, amountMinor, restock: shelf(onlyLine.saleId) }], crossed };
  if (amountMinor >= totalLeft) {
    // All that is left went back. Past it, a note in cash stands too: what is written is what Square did, so the rest goes on the first product.
    const parts = open.map((l) => ({ saleId: l.saleId, amountMinor: leftAfter(l, crossed), restock: shelf(l.saleId) }));
    const over = amountMinor - totalLeft;
    const [firstPart] = parts;
    const [firstLine] = lines;
    if (over > 0 && firstPart !== undefined) firstPart.amountMinor += over;
    if (over > 0 && firstPart === undefined && firstLine !== undefined) parts.push({ saleId: firstLine.saleId, amountMinor: over, restock: 0 });
    return { kind: "place", parts, crossed };
  }
  if (open.length === 1 && first !== undefined) return { kind: "place", parts: [{ saleId: first.saleId, amountMinor, restock: shelf(first.saleId) }], crossed };
  return { kind: "ask" };
}

export interface AnswerLine extends PlaceLine {
  quantity: number;
  restocked: number;
  stockCounted: boolean;
}

export type AnswerCheck = { ok: true; parts: PlacedPart[]; crossed: PlaceNote[] } | { ok: false; reason: "not_on_sale" | "wrong_total" | "too_much" | "too_many_back" };

/** Staff's answer: every part on this sale, adding up to what Square gave back, none past what its product can take. The box's shelf
 *  count comes on top of what the replaced notes already put back. */
export function checkPlaceAnswer(lines: readonly AnswerLine[], notes: readonly PlaceNote[], amountMinor: number, answer: readonly PlacedPart[]): AnswerCheck {
  const crossed = notesCrossedOut(notes, amountMinor);
  if (answer.reduce((total, p) => total + p.amountMinor, 0) !== amountMinor) return { ok: false, reason: "wrong_total" };
  if (new Set(answer.map((p) => p.saleId)).size !== answer.length) return { ok: false, reason: "not_on_sale" };
  const parts: PlacedPart[] = [];
  for (const part of answer) {
    const line = lines.find((l) => l.saleId === part.saleId);
    if (line === undefined) return { ok: false, reason: "not_on_sale" };
    if (part.amountMinor > leftAfter(line, crossed)) return { ok: false, reason: "too_much" };
    const carried = sumOn(crossed, line.saleId, (n) => n.restocked);
    if (part.restock > 0 && (!line.stockCounted || line.restocked + part.restock > line.quantity)) return { ok: false, reason: "too_many_back" };
    parts.push({ saleId: part.saleId, amountMinor: part.amountMinor, restock: part.restock + carried });
  }
  return { ok: true, parts, crossed };
}
