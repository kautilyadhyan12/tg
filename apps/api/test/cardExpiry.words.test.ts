// The words of the reminder before a card expires (ROADMAP 18d-iii-c): whose memberships the card
// pays for, and the email as its holder reads it. No database.
import { describe, expect, it } from "vitest";
import { cardExpiringEmail } from "../src/email/templates.js";
import { noticeLines, paysForWords } from "../src/modules/orgs/payments/cardExpiry.js";

describe("the reminder's words", () => {
  it("names whose memberships the card pays for", () => {
    expect(paysForWords(true, [])).toBe("your membership");
    expect(paysForWords(false, ["Kim Lee"])).toBe("Kim Lee's membership");
    expect(paysForWords(true, ["Kim Lee"])).toBe("memberships for you and Kim Lee");
    expect(paysForWords(false, ["Kim Lee", "Ann Lee"])).toBe("memberships for Kim Lee and Ann Lee");
    expect(paysForWords(true, ["Kim Lee", "Ann Lee"])).toBe("memberships for you, Kim Lee and Ann Lee");
    expect(paysForWords(true, ["A", "B", "C", "D"])).toBe("memberships for you, A, B and 2 others");
    expect(paysForWords(false, [""])).toBe("somebody on your account's membership");
  });

  it("says the card, its last month, what it pays for and where to bring the new one, with no link", () => {
    const lines = noticeLines("Iron Gym", {
      due: true,
      gym: { name: "Iron Gym", country: "US", contactEmail: "desk@irongym.example", contactPhone: "555 0100" },
      card: { brand: "VISA", last4: "1111", expMonth: 11, expYear: 2026 },
      holderName: "Gina Ortiz",
      paysForSelf: true,
      paysForOthers: [],
    });
    const mail = cardExpiringEmail({ to: "gina@example.test", ...lines });
    expect(mail.subject).toBe("Your card on file with Iron Gym expires this month");
    expect(mail.text).toBe(
      "Hi Gina,\n\n" +
        "Your Visa ending in 1111 expires at the end of November 2026. It pays for your membership at Iron Gym.\n\n" +
        "To keep your payments going, please give Iron Gym your new card at the front desk before then.\n\n" +
        "If you have any questions, you can call 555 0100 or email desk@irongym.example.\n\n" +
        "Thank you.\n\nIron Gym\n\nSent by AI Home Gym on behalf of Iron Gym, about the card you saved with them.\n",
    );
    expect(mail.html).not.toContain("<a ");
  });
});
