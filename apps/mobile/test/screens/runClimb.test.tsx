// A run's elevation gain on its summary (ROADMAP 37b-ii): what it says, and how it asks again while a
// piece of the map is still coming or there is no signal (every 30 s, for 15 minutes at most).
import { renderHook, act } from "@testing-library/react-native";
import type { RunClimb } from "@app/shared";
import { CLIMB_ASK_AGAIN_MS, CLIMB_ASK_FOR_MS, climbWords, useRunClimb } from "../../src/screens/running/runClimb";
import type { Session } from "../../src/session/session";
import type { Answer } from "../../src/session/calls";

const ASK = { elapsedMs: 60_000, points: [[0, 26.1, 91.7, 5]] as [number, number, number, number | null][], pauses: [] };

/** A session whose answers to the climb are `replies`, one an ask, the last kept after. */
function sessionAnswering(replies: Answer<{ climb: RunClimb }>[]): { session: Session; asks: () => number } {
  let asks = 0;
  const signedIn = () => {
    const reply = replies[Math.min(asks, replies.length - 1)];
    asks++;
    return Promise.resolve(reply);
  };
  // Only signedIn is called by the hook.
  const session = { signedIn } as unknown as Session;
  return { session, asks: () => asks };
}
const ok = (climb: RunClimb): Answer<{ climb: RunClimb }> => ({ kind: "ok", data: { climb } });
const refused = (status: number): Answer<{ climb: RunClimb }> => ({ kind: "refused", status, error: "x", message: "x", retryAfterSeconds: null, robotCheckKey: null, body: null });

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});
const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("the words", () => {
  it.each([
    [{ kind: "done", m: 28, hills: [] } as const, "metric", "28 m"],
    [{ kind: "done", m: 28, hills: [] } as const, "imperial", "92 ft"],
    [{ kind: "done", m: 0, hills: [] } as const, "imperial", "0 ft"],
    [{ kind: "done", m: 1000, hills: [] } as const, "imperial", "3281 ft"],
    [{ kind: "asking" } as const, "metric", "--"],
    [{ kind: "none" } as const, "imperial", "--"],
  ])("%j in %s is %s", (climb, units, words) => {
    expect(climbWords(climb, units === "imperial" ? "imperial" : "metric")).toBe(words);
  });
});

describe("asking the server", () => {
  it("a piece of the map still coming: asked again in 30 s, and the number shown when it comes", async () => {
    const { session, asks } = sessionAnswering([ok({ state: "waiting" }), ok({ state: "done", m: 41, hills: [] })]);
    const { result } = await renderHook(() => useRunClimb(session, ASK));
    await settle();
    expect(result.current).toEqual({ kind: "asking" });
    expect(asks()).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(CLIMB_ASK_AGAIN_MS - 1);
      await Promise.resolve();
    });
    expect(asks()).toBe(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await settle();
    expect(asks()).toBe(2);
    expect(result.current).toEqual({ kind: "done", m: 41, hills: [] });
  });

  it.each([
    ["no signal", { kind: "no_answer" } as const],
    ["too many at once", refused(429)],
    ["a fault of the server's", refused(503)],
  ])("%s: asked again, and never past 15 minutes", async (_why, answer) => {
    const { session, asks } = sessionAnswering([answer]);
    const { result } = await renderHook(() => useRunClimb(session, ASK));
    await settle();
    for (let i = 0; i < 40; i++) {
      await act(async () => {
        jest.advanceTimersByTime(CLIMB_ASK_AGAIN_MS);
        await Promise.resolve();
      });
      await settle();
    }
    // The first ask, then one every 30 s up to the fifteenth minute, and none after it.
    expect(asks()).toBe(1 + CLIMB_ASK_FOR_MS / CLIMB_ASK_AGAIN_MS);
    expect(result.current).toEqual({ kind: "asking" });
  });

  it("a refusal it will give again (400): no number, and not asked again", async () => {
    const { session, asks } = sessionAnswering([refused(400)]);
    const { result } = await renderHook(() => useRunClimb(session, ASK));
    await settle();
    expect(result.current).toEqual({ kind: "none" });
    await act(async () => {
      jest.advanceTimersByTime(CLIMB_ASK_FOR_MS);
      await Promise.resolve();
    });
    expect(asks()).toBe(1);
  });

  it("the summary closed: not asked again", async () => {
    const { session, asks } = sessionAnswering([ok({ state: "waiting" })]);
    const { unmount } = await renderHook(() => useRunClimb(session, ASK));
    await settle();
    await act(async () => {
      await unmount();
    });
    await act(async () => {
      jest.advanceTimersByTime(CLIMB_ASK_AGAIN_MS * 3);
      await Promise.resolve();
    });
    expect(asks()).toBe(1);
  });
});
