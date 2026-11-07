// The Waiver page's words (ROADMAP Stage 5 item 20b): the day a signature was made is the business's own.
import { describe, expect, it } from "vitest";
import { signedDay, signedLine, waiverNotRead } from "../src/screens/gym/waiverView";

describe("the day signed", () => {
  it("is the business's own calendar day, not the phone's or UTC's", () => {
    // 23:30 in London on 6 November is already 7 November in Pune and still 6 November in Toronto.
    const at = "2026-11-06T23:30:00.000Z";
    expect(signedDay(at, "Europe/London")).toBe("6 November 2026");
    expect(signedDay(at, "Asia/Kolkata")).toBe("7 November 2026");
    expect(signedDay(at, "America/Toronto")).toBe("6 November 2026");
  });

  it("falls back to a plain day for a zone the phone does not know, and to nothing for no instant", () => {
    expect(signedDay("2026-11-07T10:00:00.000Z", "Not/AZone")).toBe("7 November 2026");
    expect(signedDay("not a time", "Europe/London")).toBe("");
  });

  it("is said with the name typed", () => {
    expect(signedLine({ name: "Asha Walk", at: "2026-11-07T10:00:00.000Z" }, "Asia/Kolkata")).toBe("Signed on 7 November 2026 as Asha Walk.");
  });
});

describe("a waiver that could not be read", () => {
  it("says why, in the business's own word for a member", () => {
    expect(waiverNotRead(404, "Lotus Yoga", "member")).toBe("You're no longer a member of Lotus Yoga.");
    expect(waiverNotRead(429, "Lotus Yoga", "member")).toBe("Too many tries. Please wait a few minutes and try again.");
    expect(waiverNotRead(null, "Lotus Yoga", "member")).toBe("We couldn't load Lotus Yoga's waiver. Check your connection and try again.");
  });
});
