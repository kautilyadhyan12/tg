// A GYM'S STEPS, EACH IN ITS OWN TURN (spec Part 3 §16.2; ROADMAP 20b-iii): a gym whose
// day cannot be read still has its reminders sent, and the other way round.
import { describe, expect, it } from "vitest";
import { sendInTurn } from "../src/modules/orgs/messages/send.js";

describe("a gym's steps, each in its own turn", () => {
  it("a step that fails does not stop the one after it, nor lose what the one before it sent", async () => {
    const ran: string[] = [];
    const step = (name: string, answer: number | Error) => async (): Promise<number> => {
      ran.push(name);
      if (answer instanceof Error) throw answer;
      return await Promise.resolve(answer);
    };
    const dayFails = await sendInTurn([step("day", new TypeError("the day's read")), step("reminders", 3)]);
    expect(dayFails).toMatchObject({ sent: 3, failed: true });
    expect(dayFails.first).toBeInstanceOf(TypeError);
    const remindersFail = await sendInTurn([step("day", 2), step("reminders", new RangeError("the reminders' read"))]);
    expect(remindersFail).toMatchObject({ sent: 2, failed: true });
    expect(remindersFail.first).toBeInstanceOf(RangeError);
    expect(ran).toEqual(["day", "reminders", "day", "reminders"]);
  });

  it("both failing is one failure, the first; neither failing is none", async () => {
    const both = await sendInTurn([() => Promise.reject(new TypeError("first")), () => Promise.reject(new RangeError("second"))]);
    expect(both).toMatchObject({ sent: 0, failed: true });
    expect(both.first).toBeInstanceOf(TypeError);
    expect(await sendInTurn([() => Promise.resolve(1), () => Promise.resolve(4)])).toEqual({ sent: 5, failed: false, first: null });
  });
});
