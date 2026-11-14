// The members' email layout (Kd, 2026-11-14): every word escaped, the gym's letter in the circle, the plain-text
// twin carrying the same words, and the footer saying who sent it and why.
import { describe, expect, it } from "vitest";
import { memberEmail, type MemberEmailWords } from "../src/email/layout.js";

const base: MemberEmailWords = {
  to: "maya@example.com",
  subject: "Iron Gym asks you to add a card for your membership",
  gymName: "Iron Gym",
  preheader: "Iron Gym asks you to add a card.",
  heading: "Add a card for your membership",
  greeting: "Hi Maya,",
  body: [
    { kind: "paragraph", text: "Iron Gym asks you to add a card for your Gold membership." },
    { kind: "steps", title: "How to add it", items: ["Open the app on your phone.", "Tap Add card."] },
  ],
  contact: null,
  why: "You're receiving this because Iron Gym asked you to add a card for your membership.",
};

describe("the members' email layout", () => {
  it("draws the gym, the heading, the words, the steps and the footer, in the html and the text alike", () => {
    const mail = memberEmail(base);
    expect(mail.subject).toBe(base.subject);
    for (const words of ["Add a card for your membership", "Hi Maya,", "Iron Gym asks you to add a card for your Gold membership.", "How to add it", "Open the app on your phone.", "Sent by KWAZO on behalf of Iron Gym."]) {
      expect(mail.html).toContain(words);
    }
    expect(mail.html).toContain(">I</td>");
    expect(mail.text).toBe(
      "Hi Maya,\n\nIron Gym asks you to add a card for your Gold membership.\n\nHow to add it\n1. Open the app on your phone.\n2. Tap Add card.\n\nThank you,\n\nIron Gym\n\n—\n\nSent by KWAZO on behalf of Iron Gym. You're receiving this because Iron Gym asked you to add a card for your membership.",
    );
  });

  it("escapes every word a gym or a member wrote, and a button goes where it says", () => {
    const mail = memberEmail({ ...base, gymName: '<img src=x onerror="alert(1)">', greeting: "Hi <b>Sam</b>,", body: [...base.body, { kind: "button", label: "Open", href: 'https://kwazo.example/a"b', showLink: true }] });
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).not.toContain("<b>Sam</b>");
    expect(mail.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(mail.html).toContain('href="https://kwazo.example/a&quot;b"');
    expect(mail.text).toContain("Open: https://kwazo.example/a\"b");
  });

  it("the circle holds the gym's first letter or digit, whatever comes before it", () => {
    expect(memberEmail({ ...base, gymName: "  'zen' studio" }).html).toContain(">Z</td>");
    expect(memberEmail({ ...base, gymName: "24/7 Fitness" }).html).toContain(">2</td>");
    expect(memberEmail({ ...base, gymName: "Éclat" }).html).toContain(">É</td>");
  });
});
