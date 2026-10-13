import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGNED_IN_ELSEWHERE } from "@app/shared";
import { createSession, REFRESH_RETRY_AFTER_MS, type SessionState } from "../src/session/session";
import { API, RAVI, fakeServer, kept, lost, memoryStore, never, refusal, tokens, type Reply, type Route } from "./kit";

const MEERA = { ...RAVI, id: "0e3d7a11-58a4-4f0b-8f1d-6c2b9a7e4d10", email: "meera@example.com", displayName: "Meera" };

function phone(routes: Record<string, Route>, held: string | null = null, clock = { now: 0 }) {
  const server = fakeServer(routes);
  const store = memoryStore(held);
  const seen: SessionState[] = [];
  const waits: number[] = [];
  const session = createSession({
    server: { apiUrl: API, ask: server.ask },
    store,
    onChange: (state) => seen.push(state),
    now: () => clock.now,
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
  return { session, store, server, seen, waits, clock };
}

const signedInAs = (user: typeof RAVI) => ({ kind: "in", user, isNewAccount: false });

afterEach(() => {
  vi.useRealTimers();
});

describe("the worst thing: no internet never signs anybody out, and a signed-out phone keeps nobody", () => {
  // `answered`: the server itself replied, so its token was not spent and nothing is tried again.
  it.each<[string, Route, "answered" | "no answer"]>([
    ["no connection at all", lost, "no answer"],
    ["the server is down (500)", () => refusal(500, "internal_error", "Something went wrong"), "answered"],
    ["the server is busy (503)", () => refusal(503, "unavailable", "Try again"), "answered"],
    ["too many requests (429)", () => refusal(429, "rate_limited", "Too many attempts."), "answered"],
    ["a page that is not this server's, with 401 on it (a café's sign-in page)", () => ({ status: 401, body: "<html>" }), "no answer"],
    ["a 401 with no words of this server's", () => ({ status: 401, body: { detail: "unauthorized" } }), "no answer"],
    ["a 200 that is not a sign-in", () => ({ status: 200, body: { ok: true } }), "no answer"],
    ["a 200 with half a sign-in", () => ({ status: 200, body: { tokens: { accessToken: "a" } } }), "no answer"],
  ])("opened with %s: still signed in, the key store untouched", async (_name, route, was) => {
    const { session, store, server, waits } = phone({ "/v1/auth/refresh": route }, kept(1));
    await session.start();
    expect(session.state()).toEqual(signedInAs(RAVI));
    expect(store.value).toBe(kept(1));
    // With no answer it is tried again inside the server's minute, the same token each time.
    expect(waits).toEqual(was === "answered" ? [] : [...REFRESH_RETRY_AFTER_MS]);
    expect(server.asked.map((one) => one.body)).toEqual(Array(was === "answered" ? 1 : 4).fill({ refreshToken: "refresh-1" }));
  });

  it("opened while the server never answers: signed in at once, and still signed in when every try has run out", async () => {
    vi.useFakeTimers();
    const { session, store, seen } = phone({ "/v1/auth/refresh": never }, kept(1));
    const started = session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([signedInAs(RAVI)]);
    await vi.advanceTimersByTimeAsync(60_000);
    await started;
    expect(session.state()).toEqual(signedInAs(RAVI));
    expect(store.value).toBe(kept(1));
  });

  it("Sign out with no internet: signed out at once, and nothing of the person is left on the phone", async () => {
    const { session, store, seen } = phone({ "/v1/auth/logout": lost }, kept(1));
    await session.start();
    await session.signOut();
    expect(seen.at(-1)).toEqual({ kind: "out", note: "You’re signed out." });
    expect(store.value).toBeNull();
    expect(session.accessToken()).toBeNull();
  });

  it("a key store that will not delete is overwritten, so the next opening is signed out", async () => {
    const { session, store, server } = phone({}, kept(1));
    await session.start();
    store.clear = () => Promise.reject(new Error("keystore busy"));
    await session.signOut();
    expect(store.value).toBe("");
    const again = createSession({ server: { apiUrl: API, ask: server.ask }, store, onChange: () => undefined });
    await again.start();
    expect(again.state()).toEqual({ kind: "out", note: null });
  });

  it("a refresh answered after Sign out signs nobody back in", async () => {
    let answer: (reply: Reply) => void = () => undefined;
    const { session, store } = phone(
      { "/v1/auth/refresh": () => new Promise<Reply>((resolve) => (answer = resolve)), "/v1/auth/logout": () => ({ status: 200, body: {} }) },
      kept(1),
    );
    const started = session.start();
    await vi.waitFor(() => {
      expect(session.state().kind).toBe("in");
    });
    await session.signOut();
    answer({ status: 200, body: { tokens: tokens(2) } });
    await started;
    expect(session.state()).toEqual({ kind: "out", note: "You’re signed out." });
    expect(store.value).toBeNull();
    expect(session.accessToken()).toBeNull();
  });

  it("a refresh of the last person's, answered after somebody else signed in, changes nothing of theirs", async () => {
    let answer: (reply: Reply) => void = () => undefined;
    const { session, store } = phone(
      {
        "/v1/auth/refresh": () => new Promise<Reply>((resolve) => (answer = resolve)),
        "/v1/auth/logout": () => ({ status: 200, body: {} }),
        "/v1/auth/code/verify": () => ({ status: 200, body: { user: MEERA, isNewAccount: false, tokens: tokens(7) } }),
      },
      kept(1),
    );
    const started = session.start();
    await vi.waitFor(() => {
      expect(session.state().kind).toBe("in");
    });
    await session.signOut();
    await session.verifyCode(MEERA.email, "123456");
    answer(refusal(401, SIGNED_IN_ELSEWHERE.error, SIGNED_IN_ELSEWHERE.message));
    await started;
    expect(session.state()).toEqual(signedInAs(MEERA));
    expect(store.value).toBe(kept(7, MEERA));
    expect(session.accessToken()).toBe("access-7");
  });
});

describe("opening the app", () => {
  it.each([
    ["nothing", null],
    ["something that is not a sign-in", "{not json"],
    ["a sign-in with no person", JSON.stringify({ refreshToken: "refresh-1" })],
    ["an emptied one", ""],
  ])("a key store holding %s opens signed out, and asks the server nothing", async (_name, held) => {
    const { session, server } = phone({}, held);
    await session.start();
    expect(session.state()).toEqual({ kind: "out", note: null });
    expect(server.asked).toEqual([]);
  });

  it("a kept sign-in opens signed in, takes a new token and keeps it", async () => {
    const { session, store, server } = phone({ "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }) }, kept(1));
    await session.start();
    expect(session.state()).toEqual(signedInAs(RAVI));
    expect(server.asked).toEqual([
      { path: "/v1/auth/refresh", body: { refreshToken: "refresh-1" }, headers: { "content-type": "application/json" } },
    ]);
    expect(store.value).toBe(kept(2));
    expect(session.accessToken()).toBe("access-2");
  });

  it("signed in on another phone: signed out, told why, and nothing of the person kept", async () => {
    const { session, store, server } = phone(
      { "/v1/auth/refresh": () => refusal(401, SIGNED_IN_ELSEWHERE.error, SIGNED_IN_ELSEWHERE.message) },
      kept(1),
    );
    await session.start();
    expect(session.state()).toEqual({
      kind: "out",
      note: "You were signed out because your account was signed in on another phone.",
    });
    expect(store.value).toBeNull();
    expect(session.accessToken()).toBeNull();
    expect(server.asked).toHaveLength(1);
  });

  it("a sign-in the server has ended for another reason: signed out, asked to sign in again", async () => {
    const { session, store } = phone({ "/v1/auth/refresh": () => refusal(401, "invalid_refresh", "Invalid refresh token") }, kept(1));
    await session.start();
    expect(session.state()).toEqual({ kind: "out", note: "Your session ended. Sign in again." });
    expect(store.value).toBeNull();
  });
});

describe("one refresh at a time, and the answer to the last try", () => {
  it("two asks while one is away send one request", async () => {
    const { session, server } = phone({ "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }) }, kept(1));
    await Promise.all([session.start(), session.refresh(), session.refresh()]);
    expect(server.paths()).toEqual(["/v1/auth/refresh"]);
  });

  it("a reply that comes too late is dropped: the same token is sent again and the LAST try's answer is kept", async () => {
    vi.useFakeTimers();
    let tries = 0;
    const late: ((reply: Reply) => void)[] = [];
    const { session, store, server } = phone(
      {
        "/v1/auth/refresh": () => {
          tries += 1;
          // The first try's reply is held back past the phone's wait; the second answers at once.
          if (tries === 1) return new Promise<Reply>((resolve) => late.push(resolve));
          return { status: 200, body: { tokens: tokens(3) } };
        },
      },
      kept(1),
    );
    const started = session.start();
    await vi.advanceTimersByTimeAsync(8_000);
    await started;
    late[0]?.({ status: 200, body: { tokens: tokens(2) } });
    await vi.advanceTimersByTimeAsync(0);
    expect(server.asked.map((one) => one.body)).toEqual([{ refreshToken: "refresh-1" }, { refreshToken: "refresh-1" }]);
    expect(store.value).toBe(kept(3));
    expect(session.accessToken()).toBe("access-3");
  });

  it("back in the app within ten minutes asks nothing; after ten, a new token", async () => {
    let n = 1;
    const { session, server, clock } = phone({ "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(++n) } }) }, kept(1));
    await session.start();
    clock.now = 9 * 60 * 1000;
    await session.refreshIfDue();
    expect(server.asked).toHaveLength(1);
    clock.now = 10 * 60 * 1000;
    await session.refreshIfDue();
    expect(server.asked.map((one) => one.body)).toEqual([{ refreshToken: "refresh-1" }, { refreshToken: "refresh-2" }]);
  });

  it("a refresh that got no answer when the app opened is asked again on coming back", async () => {
    let up = false;
    const { session, server, store } = phone(
      { "/v1/auth/refresh": () => (up ? { status: 200, body: { tokens: tokens(2) } } : lost()) },
      kept(1),
    );
    await session.start();
    up = true;
    await session.refreshIfDue();
    expect(server.asked).toHaveLength(5);
    expect(store.value).toBe(kept(2));
  });
});

describe("signing in with a code", () => {
  it("asks for the code, then signs in as a phone and keeps the sign-in in the key store", async () => {
    const { session, store, server } = phone({
      "/v1/auth/code/send": () => ({ status: 200, body: { message: "We emailed you a 6-digit code.", resendAfterSeconds: 60, expiresInSeconds: 600 } }),
      "/v1/auth/code/verify": () => ({ status: 200, body: { user: RAVI, isNewAccount: true, tokens: tokens(1) } }),
    });
    await session.start();
    expect(await session.sendCode(RAVI.email)).toMatchObject({ kind: "ok", data: { resendAfterSeconds: 60 } });
    expect((await session.verifyCode(RAVI.email, "123456")).kind).toBe("ok");
    expect(server.asked).toEqual([
      { path: "/v1/auth/code/send", body: { email: RAVI.email }, headers: { "content-type": "application/json" } },
      {
        path: "/v1/auth/code/verify",
        body: { email: RAVI.email, code: "123456", client: "phone" },
        headers: { "content-type": "application/json" },
      },
    ]);
    expect(session.state()).toEqual({ kind: "in", user: RAVI, isNewAccount: true });
    expect(store.value).toBe(kept(1));
    expect(session.accessToken()).toBe("access-1");
  });

  it.each<[string, Route]>([
    ["a wrong code", () => refusal(400, "invalid_code", "That code is wrong or has expired. Ask for a new one.")],
    ["no connection", lost],
    ["a browser's reply, with no tokens in it", () => ({ status: 200, body: { user: RAVI, isNewAccount: false } })],
  ])("%s signs nobody in and keeps nothing", async (_name, route) => {
    const { session, store } = phone({ "/v1/auth/code/verify": route });
    await session.start();
    expect((await session.verifyCode(RAVI.email, "123456")).kind).not.toBe("ok");
    expect(session.state()).toEqual({ kind: "out", note: null });
    expect(store.value).toBeNull();
    expect(session.accessToken()).toBeNull();
  });

  it("Sign out tells the server which sign-in to end", async () => {
    const { session, server } = phone(
      { "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }), "/v1/auth/logout": () => ({ status: 200, body: {} }) },
      kept(1),
    );
    await session.start();
    await session.signOut();
    expect(server.asked.at(-1)).toMatchObject({ path: "/v1/auth/logout", body: { refreshToken: "refresh-2" } });
  });
});
