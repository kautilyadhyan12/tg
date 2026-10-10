// What staff may type in a message to a group (spec Part 3 §16.8; ROADMAP 20f-i).
//
// The cases are not made from the rule's own list. The messages that must go are the
// wording gyms really send: Sinch's and Textus's published templates for gyms (read
// 2026-10-10) and notices written the way a front desk writes them, full stops and all.
// The addresses that must not go are the forms people really paste, and they include
// endings the rule's list has never heard of.
import { describe, expect, it } from "vitest";
import {
  GYM_GROUP_MESSAGE_PROBLEMS,
  GYM_GROUP_MESSAGE_PROBLEM_WORDS,
  GYM_GROUP_MESSAGE_WORDS,
  GYM_MESSAGE_BODY_MAX,
  gymGroupMessageSendRequestSchema,
  gymInboxResponseSchema,
  groupMessageProblem,
  tidyGroupMessage,
} from "../src/index.js";

const problem = (text: string) => groupMessageProblem(tidyGroupMessage(text));

describe("a message that must go", () => {
  const fine = [
    // Sinch, "SMS templates for gyms and fitness clubs".
    "Good news! A spot just opened in Spin at 6:30 PM today. Reply YES to grab it before it fills up again.",
    "Our 6 PM Yoga class is full! We've added a 7 PM class.",
    "A spot in HIIT just freed up.",
    // A front desk's own notices.
    "The gym is closed Mon. 12 Oct for the holiday. Open again Tue. at 6.30am.",
    "Class moved to 18.30 tonight.See you there",
    "New timetable from 1.11.2026. Ask at the desk, e.g. for the early classes.",
    "Open 6 a.m. to 10 p.m. this week.",
    "Membership is now £29.99 a month. No.1 for value!",
    "Pool closed until approx.3pm.",
    "Bring a towel...and water.",
    "Dr.Patel's physio hours: Wed & Fri.",
    "The U.S.A. Powerlifting meet is on Sat. Wish Sam luck.",
    "Lockers 1-40 are being replaced.it will take two days",
    "Ring us on 020 7946 0018 or ask at the desk.",
    "Parking is free at the back/side entrance.",
    "Spin, 7am/7pm, both full. Waitlist open.",
    "Version 2.0 of the app is out. Update when you can.",
    "Kettlebells: 8kg.12kg.16kg now in.",
    "Nous sommes fermés lundi. À mardi !",
    "آج جم بند ہے۔",
    "z".repeat(GYM_MESSAGE_BODY_MAX),
  ];
  it.each(fine)("%s", (text) => {
    expect(problem(text)).toBeNull();
  });
});

describe("a web address is refused, whatever its shape", () => {
  const links = [
    "Book here: https://ironhouse.example/book",
    "http://192.168.0.1/login",
    "Book at www.ironhouse.co.uk",
    "WWW.IRONHOUSE.COM for the timetable",
    "ironhouse.com has the new timetable",
    "See ironhouse.co.uk.",
    "Pay at bit.ly/3xYzAbc today",
    "Message us on wa.me/447700900123",
    "All our links: linktr.ee/ironhouse",
    "Photos on instagram.com/ironhouse",
    "Follow facebook.com/IronHouseGym!",
    // Endings the list does not hold, caught by the slash.
    "Sign up at ironhouse.fitness/join",
    "ironhouse.gym/offer ends Friday",
    "Join the group: t.me/ironhouse",
    "ftp://files.example/timetable.pdf",
    "Book:https://x.example",
    "(ironhouse.org)",
    "app.ironhouse.io",
    "Free trial → get-fit-now.xyz",
  ];
  it.each(links)("%s", (text) => {
    expect(problem(text)).toBe("link");
  });

  // Written down, not hidden: a bare address on an ending the list lacks, with no slash,
  // "www." or scheme, is not seen. The inbox shows words only, never a link to press.
  it.each(["Visit ironhouse.fitness", "ironhouse.studio is live"])("not caught: %s", (text) => {
    expect(problem(text)).toBeNull();
  });
});

describe("an @ is refused", () => {
  it.each(["Follow @ironhouse", "Email desk@ironhouse.example", "Insta: ＠ironhouse", "See you @ 6"])("%s", (text) => {
    expect(problem(text)).toBe("at");
  });
});

describe("empty and too long", () => {
  it.each(["", "   ", "\n\n", "​‍", "\t\r\n"])("nothing to send: %j", (text) => {
    expect(problem(text)).toBe("empty");
  });
  it("one character over", () => {
    expect(problem("z".repeat(GYM_MESSAGE_BODY_MAX + 1))).toBe("too_long");
    // Spaces at the ends do not count.
    expect(problem(`  ${"z".repeat(GYM_MESSAGE_BODY_MAX)}  `)).toBeNull();
  });
  it("every problem has its own sentence", () => {
    const sentences = GYM_GROUP_MESSAGE_PROBLEMS.map((one) => GYM_GROUP_MESSAGE_PROBLEM_WORDS[one]);
    expect(new Set(sentences).size).toBe(GYM_GROUP_MESSAGE_PROBLEMS.length);
    for (const sentence of sentences) expect(sentence).toMatch(/\.$/);
  });
});

describe("the words as kept", () => {
  const cases: [string, string, string][] = [
    ["ends trimmed", "  Hello.  ", "Hello."],
    ["Windows line breaks", "One.\r\nTwo.\rThree.", "One.\nTwo.\nThree."],
    ["one empty line at most", "One.\n\n\n\n\nTwo.", "One.\n\nTwo."],
    ["each line trimmed", "One.   \n   Two.", "One.\nTwo."],
    ["a tab and a no-break space are spaces", "One\tTwo Three", "One Two Three"],
    ["characters nobody sees go", "Hel​lo\u0007 the­re", "Hello there"],
    ["spaces inside a line stay", "Open   6 to 10", "Open   6 to 10"],
    ["an emoji stays", "See you there 💪", "See you there 💪"],
    ["an accent stays", "À mardi", "À mardi"],
  ];
  it.each(cases)("%s", (_name, typed, kept) => {
    expect(tidyGroupMessage(typed)).toBe(kept);
    // Tidied again it is the same.
    expect(tidyGroupMessage(kept)).toBe(kept);
  });
  it("a hidden character cannot split an address past the check", () => {
    expect(problem("ironhouse.c​om")).toBe("link");
    expect(problem("ht​tps://ironhouse.example")).toBe("link");
  });
});

describe("the other sentences", () => {
  it("names the word, or the words", () => {
    expect(GYM_GROUP_MESSAGE_WORDS.bad_words(["dumbass"])).toBe("We can't send a message with this word in it: dumbass. Take it out and try again.");
    expect(GYM_GROUP_MESSAGE_WORDS.bad_words(["a", "b"])).toBe("We can't send a message with these words in it: a, b. Take them out and try again.");
  });
});

describe("the shapes on the wire", () => {
  const selection = { kind: "ticked", entryIds: ["00000000-0000-4000-8000-000000000001"] };
  const press = { selection, body: "Hello.", sendCount: 1, key: "00000000-0000-4000-8000-000000000002" };
  it("a press needs its people, its number and its key, and nothing more", () => {
    expect(gymGroupMessageSendRequestSchema.safeParse(press).success).toBe(true);
    expect(gymGroupMessageSendRequestSchema.safeParse({ ...press, sendCount: 0 }).success).toBe(false);
    expect(gymGroupMessageSendRequestSchema.safeParse({ ...press, key: "again" }).success).toBe(false);
    expect(gymGroupMessageSendRequestSchema.safeParse({ ...press, userIds: ["x"] }).success).toBe(false);
    expect(gymGroupMessageSendRequestSchema.safeParse({ ...press, selection: { kind: "ticked", entryIds: [] } }).success).toBe(false);
  });
  it("an inbox holds a group message, and reads as switched on from an api too old to say", () => {
    const inbox = {
      gymId: "00000000-0000-4000-8000-000000000003",
      gymName: "Iron House",
      status: "shown",
      messages: [{ id: "00000000-0000-4000-8000-000000000004", kind: "group", body: "Closed Monday.", sentAt: "2026-10-09T06:30:00.000Z", read: false }],
      unread: 1,
      asOf: "2026-10-09T06:30:00.000Z",
    };
    expect(gymInboxResponseSchema.parse(inbox).groupMessages).toBe(true);
    expect(gymInboxResponseSchema.parse({ ...inbox, groupMessages: false }).groupMessages).toBe(false);
    expect(gymInboxResponseSchema.safeParse({ ...inbox, messages: [{ ...inbox.messages[0], kind: "advert" }] }).success).toBe(false);
  });
});
