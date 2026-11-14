// Ask to add card (ROADMAP 18d-vii): the message the member reads, always within the inbox's limit.
import { describe, expect, it } from "vitest";
import { GYM_MESSAGE_BODY_MAX, cardRequestMessage, gymMessageLength } from "../src/index.js";

const tail = " To add it, open My membership and tap Add card.";

describe("the card request message", () => {
  it("names their one membership, says the gym, and what happens next", () => {
    expect(cardRequestMessage("Iron House", { own: ["Gold Monthly"], others: false })).toBe(
      `Iron House asks you to add a card for your Gold Monthly membership. It will be charged automatically each time it renews.${tail}`,
    );
  });

  it("several of their own, or ones they pay for: no name, and the right words", () => {
    expect(cardRequestMessage("Iron House", { own: ["Gold", "Swim"], others: false })).toBe(
      `Iron House asks you to add a card for your membership. It will be charged automatically each time it renews.${tail}`,
    );
    expect(cardRequestMessage("Iron House", { own: ["Gold"], others: true })).toBe(
      `Iron House asks you to add a card for the memberships you pay for. It will be charged automatically each time one renews.${tail}`,
    );
  });

  it("stays within the inbox's limit whatever the names are", () => {
    const longGym = "G".repeat(200);
    const longType = "T".repeat(400);
    for (const what of [{ own: [longType], others: false }, { own: [], others: true }, { own: [], others: false }]) {
      const body = cardRequestMessage(longGym, what);
      expect(gymMessageLength(body)).toBeLessThanOrEqual(GYM_MESSAGE_BODY_MAX);
    }
    expect(cardRequestMessage("Iron House", { own: [longType], others: false })).toBe(
      `Iron House asks you to add a card for your membership. It will be charged automatically each time it renews.${tail}`,
    );
    expect(cardRequestMessage("G".repeat(500), { own: [], others: false })).toBe(`Your gym asks you to add a card for your membership. It will be charged automatically each time it renews.${tail}`);
  });
});
