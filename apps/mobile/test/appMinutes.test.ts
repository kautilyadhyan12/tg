import { describe, expect, it } from "vitest";
import type { AppMinutesDay } from "@app/shared";
import type { TextStore } from "../src/screens/food/outbox";
import { createMinuteCounter, readMinutesFile, sendAsOwner, SEND_EVERY_MS, STRETCH_MOST_MS, type MinutesSendResult } from "../src/session/appMinutes";
import type { Session, SessionState } from "../src/session/session";
import { RAVI } from "./kit";

// The minutes the app is open on screen each day (ROADMAP Stage 5 21f): counted on the person's own
// days, kept in their own file until the server has them, and sent only as them.

const ASHA = { ...RAVI, id: "2c9e4f1a-8b7d-4e6f-9a5b-3d2c1e0f9a8b", email: "asha@example.com", displayName: "Asha" };
const MIN = 60_000;
/** 2026-11-09 10:00 in India (04:30 UTC). */
const MORNING_IST = Date.parse("2026-11-09T04:30:00Z");

function file(text: string | null = null): TextStore & { text: string | null; fail: boolean } {
  const store = {
    text,
    fail: false,
    read: () => Promise.resolve(store.text),
    write: (next: string) => {
      if (store.fail) return Promise.reject(new Error("disk full"));
      store.text = next;
      return Promise.resolve();
    },
  };
  return store;
}

/** A clock a test moves, and a server that takes what it is sent unless told otherwise. */
function rig(start = MORNING_IST, zone: string | null = "Asia/Kolkata") {
  const r = {
    at: start,
    zone,
    store: file(),
    answer: "taken" as MinutesSendResult,
    sends: [] as AppMinutesDay[][],
  };
  const counter = createMinuteCounter({
    store: r.store,
    now: () => r.at,
    zone: () => r.zone,
    send: (days) => {
      r.sends.push(days);
      return Promise.resolve(r.answer);
    },
  });
  return { r, counter };
}

/** Opens the app, then ticks each minute for `minutes`. */
async function openFor(counter: ReturnType<typeof rig>["counter"], r: ReturnType<typeof rig>["r"], minutes: number) {
  counter.opened();
  for (let i = 0; i < minutes; i++) {
    r.at += MIN;
    await counter.tick();
  }
}

function fakeSession(state: SessionState) {
  const calls: unknown[] = [];
  const signedIn: Session["signedIn"] = (request, shape) => {
    calls.push(request);
    const parsed = shape.safeParse({ kept: 1, ignored: 0 });
    return Promise.resolve(parsed.success ? { kind: "ok", data: parsed.data } : { kind: "no_answer" });
  };
  return { calls, session: { state: () => state, signedIn } };
}

describe("one person's minutes are never sent as somebody else (the worst thing)", () => {
  const days: AppMinutesDay[] = [{ day: "2026-11-09", minutes: 12, zone: "Asia/Kolkata" }];

  it("Ravi's saved minutes are not sent while Asha is signed in, and nothing reaches the server", async () => {
    const { session, calls } = fakeSession({ kind: "in", user: ASHA });
    expect(await sendAsOwner(session, RAVI.id)(days)).toBe("later");
    expect(calls).toEqual([]);
  });

  it("nor while nobody is signed in, or while the app is starting", async () => {
    for (const state of [{ kind: "out", note: null }, { kind: "starting" }] as SessionState[]) {
      const { session, calls } = fakeSession(state);
      expect(await sendAsOwner(session, RAVI.id)(days)).toBe("later");
      expect(calls).toEqual([]);
    }
  });

  it("they are sent once Ravi himself is signed in again", async () => {
    const { session, calls } = fakeSession({ kind: "in", user: RAVI });
    expect(await sendAsOwner(session, RAVI.id)(days)).toBe("taken");
    expect(calls).toEqual([{ method: "POST", path: "/v1/me/app-minutes", body: { days } }]);
  });

  it("a counter kept for Ravi while Asha is signed in keeps his minutes in his own file, untouched", async () => {
    const ravisFile = file();
    const { session, calls } = fakeSession({ kind: "in", user: ASHA });
    let at = MORNING_IST;
    const counter = createMinuteCounter({ store: ravisFile, now: () => at, zone: () => "Asia/Kolkata", send: sendAsOwner(session, RAVI.id) });
    await counter.start();
    counter.opened();
    for (let i = 0; i < 5; i++) {
      at += MIN;
      await counter.tick();
    }
    await counter.closed();
    expect(calls).toEqual([]);
    expect(readMinutesFile(ravisFile.text)).toEqual([{ day: "2026-11-09", zone: "Asia/Kolkata", seconds: 300 }]);
  });
});

describe("counting", () => {
  it("counts the minutes the app is open, and none while it is closed", async () => {
    const { r, counter } = rig();
    await counter.start();
    await openFor(counter, r, 7);
    await counter.closed();
    r.at += 3 * 60 * MIN; // three hours closed
    await openFor(counter, r, 2);
    await counter.closed();
    expect(counter.days()).toEqual([{ day: "2026-11-09", zone: "Asia/Kolkata", seconds: 9 * 60 }]);
  });

  it("a phone that slept without telling the app counts at most one stretch, not the hours asleep", async () => {
    const { r, counter } = rig();
    await counter.start();
    counter.opened();
    r.at += 5 * 60 * MIN;
    await counter.tick();
    expect(counter.days()[0]?.seconds).toBe(STRETCH_MOST_MS / 1000);
  });

  it("a clock moved back counts nothing for that stretch", async () => {
    const { r, counter } = rig();
    await counter.start();
    counter.opened();
    r.at -= 10 * MIN;
    await counter.tick();
    r.at += MIN;
    await counter.tick();
    expect(counter.days()).toEqual([{ day: "2026-11-09", zone: "Asia/Kolkata", seconds: 60 }]);
  });

  it("a minute across midnight is split between the two days, in the phone's own time zone", async () => {
    // 23:59:30 in India on the 9th.
    const { r, counter } = rig(Date.parse("2026-11-09T18:29:30Z"));
    await counter.start();
    counter.opened();
    r.at += MIN;
    await counter.tick();
    const got = counter.days().map((d) => [d.day, Math.round(d.seconds)]);
    expect(got).toEqual([
      ["2026-11-09", 30],
      ["2026-11-10", 30],
    ]);
  });

  it("the same moment is a different day in another time zone: 05:00 UTC is the 9th in India and the 8th in Los Angeles", async () => {
    const at = Date.parse("2026-11-09T05:00:00Z");
    const india = rig(at, "Asia/Kolkata");
    const la = rig(at, "America/Los_Angeles");
    for (const { r, counter } of [india, la]) {
      await counter.start();
      await openFor(counter, r, 1);
    }
    expect(india.counter.days()[0]?.day).toBe("2026-11-09");
    expect(la.counter.days()[0]?.day).toBe("2026-11-08");
  });

  it("a changed time zone counts on in the new one, and the day carries the zone it was last counted in", async () => {
    const { r, counter } = rig();
    await counter.start();
    await openFor(counter, r, 2);
    r.zone = "Asia/Dubai";
    await openFor(counter, r, 3);
    expect(counter.days()).toEqual([{ day: "2026-11-09", zone: "Asia/Dubai", seconds: 300 }]);
  });

  it("a phone that names no time zone, or one this phone cannot read, counts in UTC", async () => {
    for (const zone of [null, "Mars/Olympus"]) {
      const { r, counter } = rig(Date.parse("2026-11-09T23:30:00Z"), zone);
      await counter.start();
      await openFor(counter, r, 1);
      expect(counter.days()).toEqual([{ day: "2026-11-09", zone: "UTC", seconds: 60 }]);
    }
  });

  it("nothing is counted before the file is read", async () => {
    const { r, counter } = rig();
    counter.opened();
    r.at += MIN;
    await counter.tick();
    expect(counter.days()).toEqual([]);
    expect(r.store.text).toBeNull();
  });
});

describe("kept until the server has it", () => {
  it("sends each day's total in whole minutes on leaving, and keeps today to go on counting", async () => {
    const { r, counter } = rig();
    await counter.start();
    await openFor(counter, r, 4);
    r.at += 30_000;
    await counter.closed();
    expect(r.sends).toEqual([[{ day: "2026-11-09", minutes: 4, zone: "Asia/Kolkata" }]]);
    expect(counter.days()).toEqual([{ day: "2026-11-09", zone: "Asia/Kolkata", seconds: 270 }]);
  });

  it("no answer: every day stays in the file and is sent again, with its new total", async () => {
    const { r, counter } = rig();
    await counter.start();
    await openFor(counter, r, 3);
    r.answer = "later";
    await counter.closed();
    expect(readMinutesFile(r.store.text)).toEqual([{ day: "2026-11-09", zone: "Asia/Kolkata", seconds: 180 }]);
    r.answer = "taken";
    await openFor(counter, r, 2);
    await counter.closed();
    expect(r.sends.at(-1)).toEqual([{ day: "2026-11-09", minutes: 5, zone: "Asia/Kolkata" }]);
  });

  it("days counted with no signal survive the app being closed and opened again, and go once the server has them", async () => {
    const first = rig(Date.parse("2026-11-07T04:30:00Z"));
    first.r.answer = "later";
    await first.counter.start();
    await openFor(first.counter, first.r, 10);
    await first.counter.closed();
    first.r.at += 86_400_000;
    await openFor(first.counter, first.r, 6);
    await first.counter.closed();

    // The app opened again on the 9th, with a signal.
    let at = MORNING_IST;
    const sends: AppMinutesDay[][] = [];
    const again = createMinuteCounter({ store: first.r.store, now: () => at, zone: () => "Asia/Kolkata", send: (d) => (sends.push(d), Promise.resolve("taken")) });
    await again.start();
    await again.send();
    expect(sends).toEqual([
      [
        { day: "2026-11-07", minutes: 10, zone: "Asia/Kolkata" },
        { day: "2026-11-08", minutes: 6, zone: "Asia/Kolkata" },
      ],
    ]);
    expect(readMinutesFile(first.r.store.text)).toEqual([]);
    at += MIN;
    expect(again.days()).toEqual([]);
  });

  it("sending the same day twice sends the same total, which the server keeps once", async () => {
    const { r, counter } = rig();
    await counter.start();
    await openFor(counter, r, 3);
    await counter.closed();
    await counter.send();
    expect(r.sends).toEqual([
      [{ day: "2026-11-09", minutes: 3, zone: "Asia/Kolkata" }],
      [{ day: "2026-11-09", minutes: 3, zone: "Asia/Kolkata" }],
    ]);
  });

  it("a past day counted further while its send was away is kept and sent again", async () => {
    let release: (r: MinutesSendResult) => void = () => undefined;
    let at = Date.parse("2026-11-09T18:28:00Z"); // 23:58 in India
    const store = file();
    const sends: AppMinutesDay[][] = [];
    const counter = createMinuteCounter({
      store,
      now: () => at,
      zone: () => "Asia/Kolkata",
      send: (d) => {
        sends.push(d);
        return new Promise((res) => (release = res));
      },
    });
    await counter.start();
    counter.opened();
    at += MIN;
    await counter.tick();
    const away = counter.send();
    at += 2 * MIN; // past midnight: 30 s more for the 9th
    await counter.tick();
    release("taken");
    await away;
    expect(counter.days().map((d) => [d.day, Math.round(d.seconds)])).toEqual([
      ["2026-11-09", 90],
      ["2026-11-10", 60],
    ]);
  });

  it("sends every ten minutes while the app stays open, not every minute", async () => {
    const { r, counter } = rig();
    await counter.start();
    await openFor(counter, r, 25);
    expect(r.sends.length).toBe(Math.floor((25 * MIN) / SEND_EVERY_MS));
  });

  it("a day older than the server keeps is dropped, and nothing is sent when nothing was counted", async () => {
    const store = file(JSON.stringify({ version: 1, days: [{ day: "2026-09-01", zone: "Asia/Kolkata", seconds: 600 }] }));
    const sends: AppMinutesDay[][] = [];
    const counter = createMinuteCounter({ store, now: () => MORNING_IST, zone: () => "Asia/Kolkata", send: (d) => (sends.push(d), Promise.resolve("taken")) });
    await counter.start();
    await counter.send();
    expect(sends).toEqual([]);
    expect(counter.days()).toEqual([]);
  });

  it("a send with nothing to send never blocks the next one", async () => {
    const { r, counter } = rig();
    await counter.start();
    await counter.send();
    expect(r.sends).toEqual([]);
    await openFor(counter, r, 1);
    await counter.closed();
    expect(r.sends).toEqual([[{ day: "2026-11-09", minutes: 1, zone: "Asia/Kolkata" }]]);
  });

  it("a send the server refuses as it is (400) is never sent again as it was: past days go, today counts on in UTC", async () => {
    const store = file(JSON.stringify({ version: 1, days: [{ day: "2026-11-08", zone: "Asia/Kolkata", seconds: 600 }, { day: "2026-11-09", zone: "Asia/Kolkata", seconds: 120 }] }));
    const sends: AppMinutesDay[][] = [];
    let answer: MinutesSendResult = "refused";
    let at = MORNING_IST;
    const counter = createMinuteCounter({ store, now: () => at, zone: () => "Asia/Kolkata", send: (d) => (sends.push(d), Promise.resolve(answer)) });
    await counter.start();
    await counter.send();
    expect(counter.days()).toEqual([{ day: "2026-11-09", zone: "UTC", seconds: 120 }]);
    // A minute counted after the refusal keeps UTC, never the refused zone.
    counter.opened();
    at += MIN;
    await counter.closed();
    expect(sends.at(-1)).toEqual([{ day: "2026-11-09", minutes: 3, zone: "UTC" }]);
    answer = "taken";
    await counter.send();
    expect(sends.at(-1)).toEqual([{ day: "2026-11-09", minutes: 3, zone: "UTC" }]);
  });

  it("only a 400 counts as refused; no answer, a limit or the server down is tried again later", async () => {
    const answers = [
      { status: 400, want: "refused" },
      { status: 429, want: "later" },
      { status: 503, want: "later" },
      { status: 401, want: "later" },
    ];
    for (const { status, want } of answers) {
      const signedIn: Session["signedIn"] = () => Promise.resolve({ kind: "refused", status, error: "x", message: "x", retryAfterSeconds: null, robotCheckKey: null, body: null });
      expect(await sendAsOwner({ state: () => ({ kind: "in", user: RAVI }), signedIn }, RAVI.id)([])).toBe(want);
    }
    const lost: Session["signedIn"] = () => Promise.resolve({ kind: "no_answer" });
    expect(await sendAsOwner({ state: () => ({ kind: "in", user: RAVI }), signedIn: lost }, RAVI.id)([])).toBe("later");
  });

  it("a zone in the file that the server's own list would refuse is left out, never sent", () => {
    expect(readMinutesFile(JSON.stringify({ version: 1, days: [{ day: "2026-11-09", zone: "Mars/Olympus", seconds: 60 }, { day: "2026-11-08", zone: "UTC", seconds: 60, extra: 1 }] }))).toEqual([]);
  });

  it("a file it cannot read starts empty; a part it cannot read is left out", () => {
    expect(readMinutesFile("not json")).toEqual([]);
    expect(readMinutesFile(JSON.stringify({ version: 1, days: [{ day: "2026-11-09", zone: "Asia/Kolkata", seconds: 60 }, { day: "9 Nov", zone: "x", seconds: 1 }, { day: "2026-11-08", zone: "Asia/Kolkata", seconds: -5 }] }))).toEqual([
      { day: "2026-11-09", zone: "Asia/Kolkata", seconds: 60 },
    ]);
  });

  it("a write that fails is written again with the next count", async () => {
    const { r, counter } = rig();
    await counter.start();
    r.store.fail = true;
    await openFor(counter, r, 2);
    r.store.fail = false;
    await openFor(counter, r, 1);
    expect(readMinutesFile(r.store.text)).toEqual([{ day: "2026-11-09", zone: "Asia/Kolkata", seconds: 180 }]);
  });
});
