import { afterEach, describe, expect, it, vi } from "vitest";
import { SIGNED_IN_ELSEWHERE } from "@app/shared";
import { createSession, type SessionState } from "../src/session/session";
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

const signedInAs = (user: typeof RAVI) => ({ kind: "in", user });

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
    // With no answer it is tried again after 2, 5 and 10 seconds, the same token each time.
    expect(waits).toEqual(was === "answered" ? [] : [2000, 5000, 10000]);
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
    expect(store.value).toBe(kept(7, MEERA, null, false));
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

  it("a key store that fails once is asked once more, to read and to write", async () => {
    const { session, store, server } = phone({ "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }) }, kept(1));
    const read = store.read;
    const write = store.write;
    let reads = 0;
    let writes = 0;
    store.read = () => (++reads === 1 ? Promise.reject(new Error("keystore busy")) : read());
    store.write = (value) => (++writes === 1 ? Promise.reject(new Error("keystore busy")) : write(value));
    await session.start();
    expect(session.state()).toEqual(signedInAs(RAVI));
    expect([reads, writes]).toEqual([2, 2]);
    expect(store.value).toBe(kept(2));
    expect(server.asked).toHaveLength(1);
  });

  it("a key store that cannot be read at all opens signed out, and asks the server nothing", async () => {
    const { session, store, server } = phone({}, kept(1));
    store.read = () => Promise.reject(new Error("keystore gone"));
    await session.start();
    expect(session.state()).toEqual({ kind: "out", note: null });
    expect(server.asked).toEqual([]);
  });

  it("a kept sign-in opens signed in, takes a new token and keeps it", async () => {
    const { session, store, server } = phone({ "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }) }, kept(1));
    await session.start();
    expect(session.state()).toEqual(signedInAs(RAVI));
    expect(server.asked).toEqual([
      { method: "POST", path: "/v1/auth/refresh", body: { refreshToken: "refresh-1" }, headers: { "content-type": "application/json" } },
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
  it("two more asks while one is away send no second request", async () => {
    let answer: (reply: Reply) => void = () => undefined;
    const { session, server } = phone(
      { "/v1/auth/refresh": () => new Promise<Reply>((resolve) => (answer = resolve)) },
      kept(1),
    );
    const started = session.start();
    // The first refresh is away, held open, and the person is signed in.
    await vi.waitFor(() => {
      expect(server.paths()).toEqual(["/v1/auth/refresh"]);
    });
    expect(session.state().kind).toBe("in");
    const more = [session.refresh(), session.refresh()];
    answer({ status: 200, body: { tokens: tokens(2) } });
    await Promise.all([started, ...more]);
    expect(server.paths()).toEqual(["/v1/auth/refresh"]);
    expect(session.accessToken()).toBe("access-2");
  });

  it("the last person's refresh, still away, is not the next person's: theirs is sent with their own token", async () => {
    const answers: ((reply: Reply) => void)[] = [];
    const { session, server, store } = phone(
      {
        "/v1/auth/refresh": () => new Promise<Reply>((resolve) => answers.push(resolve)),
        "/v1/auth/logout": () => ({ status: 200, body: {} }),
        "/v1/auth/code/verify": () => ({ status: 200, body: { user: MEERA, isNewAccount: false, tokens: tokens(7) } }),
      },
      kept(1),
    );
    const started = session.start();
    await vi.waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    await session.signOut();
    await session.verifyCode(MEERA.email, "123456");
    const hers = session.refresh();
    await vi.waitFor(() => {
      expect(answers).toHaveLength(2);
    });
    expect(server.asked.filter((one) => one.path === "/v1/auth/refresh").map((one) => one.body)).toEqual([
      { refreshToken: "refresh-1" },
      { refreshToken: "refresh-7" },
    ]);
    answers[1]?.({ status: 200, body: { tokens: tokens(8) } });
    await hers;
    // The last person's answer comes last, and changes nothing of hers.
    answers[0]?.({ status: 200, body: { tokens: tokens(2) } });
    await started;
    expect(store.value).toBe(kept(8, MEERA, null, false));
    expect(session.accessToken()).toBe("access-8");
    // Her one-at-a-time rule still holds after his run has ended.
    const again = [session.refresh(), session.refresh()];
    await vi.waitFor(() => {
      expect(answers).toHaveLength(3);
    });
    answers[2]?.({ status: 200, body: { tokens: tokens(9) } });
    await Promise.all(again);
    expect(answers).toHaveLength(3);
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
      { method: "POST", path: "/v1/auth/code/send", body: { email: RAVI.email }, headers: { "content-type": "application/json" } },
      {
        method: "POST",
        path: "/v1/auth/code/verify",
        body: { email: RAVI.email, code: "123456", client: "phone" },
        headers: { "content-type": "application/json" },
      },
    ]);
    expect(session.state()).toEqual({ kind: "in", user: RAVI });
    expect(store.value).toBe(kept(1, RAVI, null, false));
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

/** A route that waits until it is let go, so a test can act while a request is away. */
function held(answer: Reply) {
  let open: () => void = () => undefined;
  const shut = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    route: async () => shut.then(() => answer),
    open: () => {
      open();
    },
  };
}

const anyReply = { safeParse: (raw: unknown) => ({ success: true as const, data: raw }) };

describe("a signed-in request is only ever sent as the person who made it", () => {
  it.each([
    ["Sign out", "its first send"],
    ["another person signs in", "its first send"],
    ["Sign out", "the refresh after its 401"],
    ["another person signs in", "the refresh after its 401"],
  ])("%s during %s: no answer, and nothing is sent with anybody else's token", async (what, when) => {
    const firstSend = held(refusal(401, "unauthorized", "Sign in again."));
    const secondRefresh = held({ status: 200, body: { tokens: tokens(3) } });
    let refreshes = 0;
    let sends = 0;
    const { session, server } = phone(
      {
        "/v1/auth/refresh": () => {
          refreshes += 1;
          if (refreshes === 2 && when === "the refresh after its 401") return secondRefresh.route();
          return { status: 200, body: { tokens: tokens(refreshes + 1) } };
        },
        "/v1/users/me/consents": () => {
          sends += 1;
          if (sends === 1) return when === "its first send" ? firstSend.route() : refusal(401, "unauthorized", "Sign in again.");
          return { status: 201, body: { recorded: true } };
        },
        "/v1/auth/code/verify": () => ({ status: 200, body: { user: MEERA, isNewAccount: false, tokens: tokens(7) } }),
        "/v1/auth/logout": () => ({ status: 200, body: {} }),
      },
      kept(1, RAVI, null),
    );
    await session.start();
    const asked = session.signedIn({ method: "POST", path: "/v1/users/me/consents", body: {} }, anyReply);
    await vi.waitFor(() => {
      expect(server.paths()).toContain(when === "its first send" ? "/v1/users/me/consents" : "/v1/auth/refresh");
      if (when !== "its first send") expect(refreshes).toBe(2);
    });
    if (what === "Sign out") await session.signOut();
    else await session.verifyCode(MEERA.email, "123456");
    firstSend.open();
    secondRefresh.open();
    expect(await asked).toEqual({ kind: "no_answer" });
    const sentWith = server.asked.filter((one) => one.path === "/v1/users/me/consents").map((one) => one.headers.authorization);
    expect(sentWith).toEqual(["Bearer access-2"]);
  });
});

describe("a late write never undoes a sign-out", () => {
  /** A key store whose writes, while `slow`, finish only when the test says. */
  function slowStore(value: string) {
    const store = memoryStore(value);
    const write = store.write;
    const away: (() => void)[] = [];
    const control = {
      slow: false,
      finish: () => {
        for (const done of away.splice(0)) done();
      },
    };
    store.write = (next: string) =>
      control.slow
        ? new Promise<void>((resolve) => {
            away.push(() => {
              void write(next).then(resolve);
            });
          })
        : write(next);
    return { store, control };
  }

  it.each([
    ["Sign out", null],
    ["another person signs in", kept(7, MEERA, null, false)],
  ])("the tick's write, finished after %s, leaves the key store as the phone holds it now", async (what, after) => {
    const { store, control } = slowStore(kept(1, RAVI, null));
    const server = fakeServer({
      "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
      "/v1/auth/code/verify": () => ({ status: 200, body: { user: MEERA, isNewAccount: false, tokens: tokens(7) } }),
      "/v1/auth/logout": () => ({ status: 200, body: {} }),
    });
    const session = createSession({
      server: { apiUrl: API, ask: server.ask },
      store,
      onChange: () => undefined,
      wait: () => Promise.resolve(),
    });
    await session.start();
    control.slow = true;
    const keeping = session.keepSignUpNote("v4");
    control.slow = false;
    if (what === "Sign out") await session.signOut();
    else await session.verifyCode(MEERA.email, "123456");
    expect(store.value).toBe(after);
    // The tick's write lands only now, after the phone has moved on.
    control.finish();
    await keeping;
    expect(store.value).toBe(after);
  });
});

// The keys for passes with no signal (ROADMAP Stage 5 item 15c) are this sign-in's alone.
describe("the keys for passes with no signal", () => {
  const KEYS = [
    { day: 20_486, key: "6kk2P5Zj8znws7IlJEBdalqwCFQdAxL2lgYYZUO3B6Q" }, // dummy test value, gitleaks:allow
    { day: 20_487, key: "7kk2P5Zj8znws7IlJEBdalqwCFQdAxL2lgYYZUO3B6Q" }, // dummy test value, gitleaks:allow
  ];
  const OTHER = [{ day: 20_487, key: "8kk2P5Zj8znws7IlJEBdalqwCFQdAxL2lgYYZUO3B6Q" }]; // dummy test value, gitleaks:allow
  const refreshed = { "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }) };

  it("are kept in the key store with the sign-in, and stay through a refresh", async () => {
    const { session, store } = phone(refreshed, kept(1));
    await session.start();
    expect(session.passKeys()).toEqual([]);
    await session.keepPassKeys(KEYS, session.signInNumber());
    expect(session.passKeys()).toEqual(KEYS);
    expect(JSON.parse(store.value ?? "{}")).toMatchObject({ refreshToken: "refresh-2", passKeys: KEYS });
    await session.refresh();
    expect(session.passKeys()).toEqual(KEYS);
    expect(JSON.parse(store.value ?? "{}")).toMatchObject({ passKeys: KEYS });
  });

  it("THE WORST THING: signing out takes them away, and a new sign-in starts with none", async () => {
    const { session, store } = phone(
      {
        ...refreshed,
        "/v1/auth/logout": () => ({ status: 200, body: {} }),
        "/v1/auth/code/verify": () => ({ status: 200, body: { user: MEERA, isNewAccount: false, tokens: tokens(7) } }),
      },
      kept(1),
    );
    await session.start();
    await session.keepPassKeys(KEYS, session.signInNumber());
    await session.keepBelongs(true);
    await session.signOut();
    expect(session.passKeys()).toEqual([]);
    expect(session.belongs()).toBeNull();
    expect(store.value ?? "").not.toContain(KEYS[0]?.key ?? "?");
    await session.verifyCode(MEERA.email, "123456");
    expect(session.passKeys()).toEqual([]);
    expect(store.value ?? "").not.toContain(KEYS[0]?.key ?? "?");
  });

  it("THE WORST THING: keys that come back after a sign-out and a new sign-in are not kept with the new one", async () => {
    const { session, store } = phone(
      {
        ...refreshed,
        "/v1/auth/logout": () => ({ status: 200, body: {} }),
        "/v1/auth/code/verify": () => ({ status: 200, body: { user: RAVI, isNewAccount: false, tokens: tokens(7) } }),
      },
      kept(1),
    );
    await session.start();
    const asked = session.signInNumber();
    await session.signOut();
    await session.verifyCode(RAVI.email, "123456");
    await session.keepPassKeys(KEYS, asked);
    expect(session.passKeys()).toEqual([]);
    expect(store.value ?? "").not.toContain(KEYS[0]?.key ?? "?");
    // The new sign-in's own keys are kept, and newer ones replace them.
    await session.keepPassKeys(KEYS, session.signInNumber());
    await session.keepPassKeys(OTHER, session.signInNumber());
    expect(session.passKeys()).toEqual(OTHER);
  });

  it("whether the person belongs anywhere is kept with the sign-in, unknown until the places are read", async () => {
    const { session, store } = phone(refreshed, kept(1));
    await session.start();
    expect(session.belongs()).toBeNull();
    await session.keepBelongs(false);
    expect(session.belongs()).toBe(false);
    expect(JSON.parse(store.value ?? "{}")).toMatchObject({ belongs: false });
  });

  it("a key store written before this job, with no keys, still opens signed in", async () => {
    const { session } = phone(refreshed, kept(1));
    await session.start();
    expect(session.state()).toEqual(signedInAs(RAVI));
    expect(session.passKeys()).toEqual([]);
  });
});
