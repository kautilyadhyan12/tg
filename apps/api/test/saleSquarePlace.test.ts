import { describe, expect, it } from "vitest";
import { checkPlaceAnswer, placeSquareRefund, type AnswerLine, type PlaceLine, type PlaceNote } from "../src/modules/orgs/payments/saleSquarePlace.js";

const A = "a";
const B = "b";
const line = (saleId: string, lineMinor: number, refundedMinor = 0): PlaceLine => ({ saleId, lineMinor, refundedMinor });
const note = (id: string, saleId: string, amountMinor: number, restocked = 0): PlaceNote => ({ id, saleId, amountMinor, restocked });

describe("which product takes a refund made in Square", () => {
  // [what it is, the lines, the notes by card, Square's amount, what must happen: parts as [product, amount, shelf], or "ask"]
  const cases: [string, PlaceLine[], PlaceNote[], number, [string, number, number][] | "ask"][] = [
    ["one product, part of it", [line(A, 2000)], [], 500, [[A, 500, 0]]],
    ["one product, all of it", [line(A, 2000)], [], 2000, [[A, 2000, 0]]],
    ["one product, a cash note stands: written in full, past what was paid", [line(A, 2000, 1000)], [], 2000, [[A, 2000, 0]]],
    ["a basket, part, nothing to tell them apart", [line(A, 400), line(B, 1500)], [], 300, "ask"],
    ["a basket, the exact price of one product is still no proof", [line(A, 400), line(B, 1500)], [], 400, "ask"],
    ["a basket, the exact price of the dearer one is still no proof", [line(A, 400), line(B, 1500)], [], 1500, "ask"],
    ["a basket, all of it", [line(A, 400), line(B, 1500)], [], 1900, [[A, 400, 0], [B, 1500, 0]]],
    ["a basket, all that is left", [line(A, 400, 400), line(B, 1500, 500)], [], 1000, [[B, 1000, 0]]],
    ["a basket, part of the one product with anything left", [line(A, 400, 400), line(B, 1500)], [], 300, [[B, 300, 0]]],
    ["a basket, more than is left, as a cash note stands: the rest on the first with something left", [line(A, 400, 400), line(B, 1500)], [], 1900, [[B, 1900, 0]]],
    ["a basket, nothing left, as cash notes stand: on the first product", [line(A, 400, 400), line(B, 1500, 1500)], [], 300, [[A, 300, 0]]],
    ["a card note of the same amount says which product", [line(A, 400, 300), line(B, 1500)], [note("n1", A, 300, 1)], 300, [[A, 300, 1]]],
    ["a card note of more than Square shows: all on its product", [line(A, 400), line(B, 1500, 1000)], [note("n1", B, 1000)], 500, [[B, 500, 0]]],
    ["two card notes on two products", [line(A, 400, 300), line(B, 1500, 500)], [note("n1", A, 300), note("n2", B, 500)], 800, [[A, 300, 0], [B, 500, 0]]],
    ["a card note of less, the rest unknown", [line(A, 400, 100), line(B, 1500)], [note("n1", A, 100)], 300, "ask"],
    ["a card note of less, then all that is left", [line(A, 400, 100), line(B, 1500)], [note("n1", A, 100, 1)], 1900, [[A, 400, 1], [B, 1500, 0]]],
  ];
  it.each(cases)("%s", (_what, lines, notes, amount, want) => {
    const got = placeSquareRefund(lines, notes, amount);
    if (want === "ask") {
      expect(got.kind).toBe("ask");
      return;
    }
    if (got.kind !== "place") throw new Error("it asked");
    expect(got.parts.map((p) => [p.saleId, p.amountMinor, p.restock])).toEqual(want);
    // What is written is what Square did: never a cent more or less.
    expect(got.parts.reduce((n, p) => n + p.amountMinor, 0)).toBe(amount);
  });

  it("crosses out only the notes it needs, the oldest first", () => {
    const got = placeSquareRefund([line(A, 400, 200), line(B, 1500, 500)], [note("old", A, 200), note("new", B, 500)], 200);
    expect(got).toMatchObject({ kind: "place", crossed: [{ id: "old" }] });
  });
});

describe("staff's answer", () => {
  const lines: AnswerLine[] = [
    { ...line(A, 400), quantity: 2, restocked: 0, stockCounted: true },
    { ...line(B, 1500), quantity: 1, restocked: 0, stockCounted: false },
  ];
  it.each([
    ["a part of another sale", [{ saleId: "x", amountMinor: 300, restock: 0 }], "not_on_sale"],
    ["the same product twice", [{ saleId: A, amountMinor: 100, restock: 0 }, { saleId: A, amountMinor: 200, restock: 0 }], "not_on_sale"],
    ["less than Square gave back", [{ saleId: A, amountMinor: 200, restock: 0 }], "wrong_total"],
    ["more than Square gave back", [{ saleId: B, amountMinor: 301, restock: 0 }], "wrong_total"],
    ["a shelf count on a product not counted", [{ saleId: B, amountMinor: 300, restock: 1 }], "too_many_back"],
    ["more on the shelf than were sold", [{ saleId: A, amountMinor: 300, restock: 3 }], "too_many_back"],
  ])("refuses %s", (_what, parts, reason) => {
    expect(checkPlaceAnswer(lines, [], 300, parts)).toEqual({ ok: false, reason });
  });
  it("refuses more than the product can take", () => {
    expect(checkPlaceAnswer(lines, [], 500, [{ saleId: A, amountMinor: 500, restock: 0 }])).toEqual({ ok: false, reason: "too_much" });
  });
  it("takes a split that adds up, and keeps a replaced note's shelf count", () => {
    const noted = [{ ...lines[0], refundedMinor: 100, restocked: 1 } as AnswerLine, lines[1] as AnswerLine];
    const got = checkPlaceAnswer(noted, [note("n1", A, 100, 1)], 300, [{ saleId: A, amountMinor: 100, restock: 0 }, { saleId: B, amountMinor: 200, restock: 0 }]);
    expect(got).toMatchObject({ ok: true, parts: [{ saleId: A, amountMinor: 100, restock: 1 }, { saleId: B, amountMinor: 200, restock: 0 }], crossed: [{ id: "n1" }] });
  });
});
