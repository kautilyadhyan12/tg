import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, Platform } from "react-native";
import * as Brightness from "expo-brightness";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import type { CheckinPassResponse } from "@app/shared";
import { App } from "../../src/App";
import { PHONE_KEY_PATH } from "../../src/screens/GymTab";
import {
  OFFLINE_ASK_AGAIN_MS,
  OWN_PASS_AFTER_MS,
  PASS_COULD_NOT,
  PASS_GETTING,
  PASS_OFFLINE,
  PASS_PATH,
  PassSheet,
  type FetchPass,
  type MakeOwnPass,
} from "../../src/screens/gym/Pass";
import { passCells, passPath } from "../../src/screens/gym/passView";
import { makePhonePass, phoneDay } from "../../src/screens/gym/phonePass";
import type { Answer, Ask } from "../../src/session/calls";
import { RAVI, fakeServer, kept, lost as lostRoute, memoryStore, never, profile, refusal, tokens, type Reply, type Route } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

const RAVI_PASS = "AHGPLG763ESHTVB2ZAG44DJVO6OZTIBY55AU7C4WIZRMWOB6SNIWULCDANFKYI";
const ASHA_PASS = "AHGPRB32WCZWQNH5DPF72VQT4RBYDABY55AVGD2T7324JFIASG2F7CA45QCLBQ";
const NEXT_PASS = "AHGPLIQVH3B3TFBQRGYIT4QBSLEYBABY55AWLYH5DPJHU5IYRWH74YHME353JM";
const ASHA = { ...RAVI, id: "2c9e7d41-5a3b-4f6e-8d2c-1b0a9f8e7d6c", email: "asha@example.com", displayName: "Asha" };

type Place = { id: string; name: string; city: string | null; orgType: string };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Pune", orgType: "gym" };
const MEERA: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Meera Fitness", city: null, orgType: "personal_trainer" };
const org = (gym: Place) => ({
  ...gym,
  slug: gym.name.toLowerCase().replace(" ", "-"),
  timezone: "Asia/Kolkata",
  locale: "en",
  currencyDisplay: "INR",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
});
const mine = (...gyms: Place[]) => ok({ orgs: gyms.map(org), formerOrgs: [] });
const passOf = (pass: string, refreshAt = new Date(Date.now() + 20_000).toISOString()) => ({ pass, refreshAt });

/** The code on screen, as the pass it draws, or null with none drawn; `more`: other passes it may be. */
function drawn(...more: (string | null)[]): string | null {
  const code = screen.queryByTestId("pass-code");
  if (code === null) return null;
  const d: unknown = code.props.d;
  for (const pass of [RAVI_PASS, ASHA_PASS, NEXT_PASS, ...more]) if (pass !== null && d === passPath(passCells(pass) ?? [])) return pass;
  return "something else";
}

// This sign-in's key for passes with no signal (the server's own test key, apps/api).
const OWN_KEY = "6kk2P5Zj8znws7IlJEBdalqwCFQdAxL2lgYYZUO3B6Q"; // dummy test value, gitleaks:allow
// Today's and tomorrow's keys, and the day the timed tests run on (2026-10-28).
const OWN_KEYS = [phoneDay(Date.now()), phoneDay(Date.now()) + 1, phoneDay(Date.parse("2026-10-28T10:00:00.000Z"))].map((day) => ({
  day,
  key: OWN_KEY,
}));
const keptWithKey = (n: number, more: object = {}) =>
  JSON.stringify({ ...(JSON.parse(kept(n)) as object), passKeys: OWN_KEYS.slice(0, 2), ...more });

const gymTab = async () => {
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  return tab;
};
const press = (name: string) => fireEvent.press(screen.getByRole("button", { name }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("the worst thing: nobody else's pass is ever shown on this phone", () => {
  it("Ravi's pass that answers after he signed out is never drawn for Asha, who signs in next", async () => {
    // Ravi's pass is held until the test lets it go; Asha's answers at once.
    const held: (() => void)[] = [];
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/auth/logout": ok({}),
      "/v1/auth/code/send": ok({ message: "Sent.", resendAfterSeconds: 60, expiresInSeconds: 600 }),
      "/v1/auth/code/verify": ok({ user: ASHA, isNewAccount: false, tokens: tokens(7) }),
      "/v1/users/me": ok(profile(true, ASHA)),
      "/v1/orgs/mine": mine(IRON),
    });
    const ask: Ask = async (url, init) => {
      const path = new URL(url).pathname;
      const as = init.headers?.authorization;
      if (path === PASS_PATH && as === "Bearer access-2") {
        await new Promise<void>((resolve) => held.push(resolve));
        return { ok: true, status: 200, json: () => Promise.resolve(passOf(RAVI_PASS)) };
      }
      if (path === PASS_PATH && as === "Bearer access-7") return { ok: true, status: 200, json: () => Promise.resolve(passOf(ASHA_PASS)) };
      return server.ask(url, init);
    };
    const store = memoryStore(kept(1));
    await render(<App extra={extra} ask={ask} store={store} wait={noWait} />);
    await fireEvent.press(await gymTab());
    await fireEvent.press(await screen.findByRole("button", { name: "Show my pass" }));
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });
    expect(screen.getByText(PASS_GETTING)).toBeTruthy();

    // Ravi closes his pass and signs out with it still away; Asha signs in on the same phone.
    await press("Close");
    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    await press("Sign out");
    const inTheBox = screen.getAllByRole("button", { name: "Sign out" })[1];
    if (inTheBox === undefined) throw new Error("the box's Sign out was expected");
    await fireEvent.press(inTheBox);
    await fireEvent.changeText(await screen.findByLabelText("Email"), ASHA.email);
    await press("Continue");
    await fireEvent.changeText(await screen.findByLabelText("6-digit code"), "123456");
    await press("Continue");
    await fireEvent.press(await gymTab());
    await fireEvent.press(await screen.findByRole("button", { name: "Show my pass" }));
    await waitFor(() => {
      expect(drawn()).toBe(ASHA_PASS);
    });

    // Ravi's pass lands now: it is drawn nowhere, and Asha's stays.
    await act(async () => {
      for (const go of held) go();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(drawn()).toBe(ASHA_PASS);
    expect(store.value ?? "").not.toContain(RAVI_PASS);
    expect(store.value ?? "").not.toContain(ASHA_PASS);
  });

  it("closing the pass and opening it again asks the server again: no pass is kept to show", async () => {
    let n = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [PASS_PATH]: () => {
        n += 1;
        return { status: 200, body: passOf(n === 1 ? RAVI_PASS : NEXT_PASS) };
      },
    });
    const store = memoryStore(kept(1));
    await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
    await fireEvent.press(await gymTab());
    await fireEvent.press(await screen.findByRole("button", { name: "Show my pass" }));
    await waitFor(() => {
      expect(drawn()).toBe(RAVI_PASS);
    });
    await press("Close");
    await fireEvent.press(screen.getByRole("button", { name: "Show my pass" }));
    expect(drawn()).not.toBe(RAVI_PASS);
    await waitFor(() => {
      expect(drawn()).toBe(NEXT_PASS);
    });
    expect(server.paths().filter((path) => path === PASS_PATH)).toHaveLength(2);
    expect(store.value ?? "").not.toContain(RAVI_PASS);
  });
});

describe("Show my pass on the Gym tab", () => {
  it("each place has it with its own line, and the old Coming soon is gone", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, MEERA),
      [PASS_PATH]: ok(passOf(RAVI_PASS)),
    });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await screen.findAllByRole("button", { name: "Show my pass" })).toHaveLength(2);
    expect(screen.getByText("Show your pass at the front desk when you arrive.")).toBeTruthy();
    expect(screen.getByText("Show your pass to your trainer when you arrive.")).toBeTruthy();
    expect(screen.queryByText("Coming soon")).toBeNull();
    expect(server.paths()).not.toContain(PASS_PATH);

    // The trainer's own button says who scans it; the pass is the same person's.
    const trainers = screen.getAllByRole("button", { name: "Show my pass" })[1];
    if (trainers === undefined) throw new Error("two buttons were expected");
    await fireEvent.press(trainers);
    expect(await screen.findByText("Hold this up for your trainer to scan.")).toBeTruthy();
    expect(screen.getByRole("image", { name: "Your check-in pass" })).toBeTruthy();
    expect(drawn()).toBe(RAVI_PASS);
    await press("Close");
    await fireEvent.press(screen.getAllByRole("button", { name: "Show my pass" })[0] ?? trainers);
    expect(await screen.findByText("Hold this up to the scanner to check in.")).toBeTruthy();
  });

  it("somebody who has joined nowhere has no pass to show", async () => {
    const server = fakeServer({ "/v1/auth/refresh": ok({ tokens: tokens(2) }) });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await screen.findByText("Check for an invitation")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show my pass" })).toBeNull();
  });
});

describe("the pass while it is open", () => {
  const start = Date.parse("2026-10-28T10:00:00.000Z");
  let listeners: ((state: string) => void)[] = [];

  beforeEach(() => {
    jest.useFakeTimers({ now: start });
    listeners = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listeners.push(handler as (state: string) => void);
      return { remove: () => undefined };
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** The server, one answer a call in turn; `null` never answers. */
  function answers(...replies: (Answer<CheckinPassResponse> | null)[]) {
    const asked: number[] = [];
    const fetchPass: FetchPass = jest.fn(() => {
      asked.push(Date.now() - start);
      const reply = replies.shift();
      return reply === null || reply === undefined ? new Promise<never>(() => undefined) : Promise.resolve(reply);
    });
    return { fetchPass, asked };
  }
  const good = (pass: string, endsInMs: number): Answer<CheckinPassResponse> => ({
    kind: "ok",
    data: { pass, refreshAt: new Date(Date.now() + endsInMs).toISOString() },
  });
  const later = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
    });
  };
  const appMoves = async (state: string) => {
    await act(async () => {
      for (const one of listeners) one(state);
      await Promise.resolve();
    });
  };

  it("a new pass is asked for when the server's window ends, and drawn in the old one's place", async () => {
    // The second is asked for 20 s on, when the first's window ends (its own 20 s from then).
    const queue = [good(RAVI_PASS, 20_000), good(NEXT_PASS, 30_000)];
    const fetchPass: FetchPass = jest.fn(() => Promise.resolve(queue.shift() ?? good(NEXT_PASS, 30_000)));
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    await later(0);
    expect(drawn()).toBe(RAVI_PASS);
    await later(19_999);
    expect(fetchPass).toHaveBeenCalledTimes(1);
    await later(1);
    expect(fetchPass).toHaveBeenCalledTimes(2);
    expect(drawn()).toBe(NEXT_PASS);
  });

  it("a pass whose renewal has not come is taken off 30 seconds after it was asked for", async () => {
    const { fetchPass, asked } = answers(good(RAVI_PASS, 20_000), null);
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    await later(0);
    await later(29_999);
    expect(drawn()).toBe(RAVI_PASS);
    await later(1);
    expect(drawn()).toBeNull();
    expect(screen.getByText(PASS_GETTING)).toBeTruthy();
    expect(asked).toEqual([0, 20_000]);
  });

  it("no answer takes the pass off and says so; nothing asks again until Try again", async () => {
    const { fetchPass, asked } = answers(good(RAVI_PASS, 20_000), { kind: "no_answer" }, good(NEXT_PASS, 20_000));
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    await later(0);
    await later(20_000);
    expect(drawn()).toBeNull();
    expect(screen.getByText(PASS_COULD_NOT)).toBeTruthy();
    await later(120_000);
    expect(asked).toEqual([0, 20_000]);
    await press("Try again");
    await later(0);
    expect(drawn()).toBe(NEXT_PASS);
    expect(asked).toEqual([0, 20_000, 140_000]);
  });

  it("a refusal says the server's own words", async () => {
    const { fetchPass } = answers({
      kind: "refused",
      status: 429,
      error: "rate_limited",
      message: "Too many passes. Try again in a minute.",
      retryAfterSeconds: 60,
      robotCheckKey: null,
      body: {},
    });
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    await later(0);
    expect(screen.getByText("Too many passes. Try again in a minute.")).toBeTruthy();
    expect(drawn()).toBeNull();
  });

  it("in the background it asks nothing; back in front, a pass past its 30 seconds comes off and the next is asked for", async () => {
    const { fetchPass, asked } = answers(good(RAVI_PASS, 20_000), null);
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    await later(0);
    await appMoves("background");
    await later(25_000);
    expect(asked).toEqual([0]);
    // Timers are slow in the background; the phone's clock is not.
    jest.setSystemTime(start + 45_000);
    await appMoves("active");
    expect(drawn()).toBeNull();
    expect(asked).toEqual([0, 45_000]);
  });

  /** A server answer the test lets go by hand. */
  function heldAnswer() {
    let go: (answer: Answer<CheckinPassResponse>) => void = () => undefined;
    const answer = new Promise<Answer<CheckinPassResponse>>((resolve) => {
      go = resolve;
    });
    return { answer, go: (reply: Answer<CheckinPassResponse>) => { go(reply); } };
  }

  it("after Close nothing more is asked, even when an answer was still away", async () => {
    const held = heldAnswer();
    const fetchPass: FetchPass = jest.fn(() => held.answer);
    const view = await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    await later(0);
    await view.rerender(<PassSheet open={false} trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    held.go(good(RAVI_PASS, 20_000));
    // The answer lands first; only then does the clock move on.
    await later(0);
    await later(120_000);
    expect(fetchPass).toHaveBeenCalledTimes(1);
  });

  it("a slow answer comes off 30 seconds after it was asked for, not after it arrived", async () => {
    const asked: number[] = [];
    let n = 0;
    const fetchPass: FetchPass = jest.fn(() => {
      asked.push(Date.now() - start);
      n += 1;
      if (n > 1) return new Promise<never>(() => undefined);
      // The server answers 8 seconds later, with its window ending 20 seconds after that.
      return new Promise((resolve) => setTimeout(() => { resolve(good(RAVI_PASS, 20_000)); }, 8_000));
    });
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    await later(8_000);
    expect(drawn()).toBe(RAVI_PASS);
    await later(21_999);
    expect(drawn()).toBe(RAVI_PASS);
    await later(1);
    expect(drawn()).toBeNull();
    // The next was asked for 20 seconds after the answer, less the 8 it took: 20 s from the start.
    expect(asked).toEqual([0, 20_000]);
  });

  it("an answer that lands while the app is in the background asks nothing more", async () => {
    const held = heldAnswer();
    const fetchPass: FetchPass = jest.fn(() => held.answer);
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    await later(0);
    const was = AppState.currentState;
    Object.defineProperty(AppState, "currentState", { value: "background", configurable: true });
    try {
      await appMoves("background");
      held.go(good(RAVI_PASS, 20_000));
      // The answer lands first; only then does the clock move on.
      await later(0);
      await later(60_000);
      expect(fetchPass).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(AppState, "currentState", { value: was, configurable: true });
    }
  });

  it("where brightness is the whole phone's, the app in the background gives it back, and in front takes it again", async () => {
    const { fetchPass } = answers(good(RAVI_PASS, 20_000), null);
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    await later(0);
    expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(1);
    await appMoves("background");
    await later(0);
    expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.4);
    await appMoves("active");
    await later(0);
    expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(1);
  });

  it("the screen is kept awake and at full brightness while it is open, and both go back when it closes", async () => {
    const { fetchPass } = answers(good(RAVI_PASS, 20_000));
    const view = await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    await later(0);
    expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(1);
    expect(deactivateKeepAwake).not.toHaveBeenCalled();
    await view.rerender(<PassSheet open={false} trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
    await later(0);
    expect(deactivateKeepAwake).toHaveBeenCalledTimes(1);
    // The same hold it took, or the screen would never sleep again while the app is open.
    expect(jest.mocked(deactivateKeepAwake).mock.calls[0]?.[0]).toBe(jest.mocked(activateKeepAwakeAsync).mock.calls[0]?.[0]);
    expect(jest.mocked(activateKeepAwakeAsync).mock.calls[0]?.[0]).toEqual(expect.any(String));
    // Not Android: the brightness the phone had before is set again.
    expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.4);
  });

  it("on Android the phone's own brightness setting is given back", async () => {
    const was = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    try {
      const { fetchPass } = answers(good(RAVI_PASS, 20_000));
      const view = await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
      await later(0);
      expect(Brightness.getBrightnessAsync).not.toHaveBeenCalled();
      await view.rerender(<PassSheet open={false} trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={null} />);
      await later(0);
      expect(Brightness.restoreSystemBrightnessAsync).toHaveBeenCalledTimes(1);
      expect(Brightness.setBrightnessAsync).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, "OS", { value: was, configurable: true });
    }
  });
});

describe("a pass with no signal", () => {
  const lostAll = (routes: Record<string, Route>): Ask => {
    const server = fakeServer(routes);
    return (url, init) =>
      server.ask(url, init).then(() => {
        throw new TypeError("Network request failed");
      });
  };

  it("THE WORST THING: with no signal at all, Show my pass still opens, and draws this person's own pass made on the phone", async () => {
    await render(<App extra={extra} ask={lostAll({})} store={memoryStore(keptWithKey(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    await fireEvent.press(await screen.findByRole("button", { name: "Show my pass" }));
    expect(await screen.findByText(PASS_OFFLINE)).toBeTruthy();
    const now = makePhonePass(OWN_KEYS, RAVI.id, Date.now());
    const before = makePhonePass(OWN_KEYS, RAVI.id, Date.now() - 30_000);
    expect([now, before]).toContain(drawn(now, before));
    // The same key with another person's id makes another pass: this one names Ravi alone.
    const ashas = makePhonePass(OWN_KEYS, ASHA.id, Date.now());
    expect(drawn(now, before, ashas)).not.toBe(ashas);
  });

  it("opened where the server never answers, Show my pass is offered after two seconds, not after a minute of retries", async () => {
    const server = fakeServer({ "/v1/auth/refresh": never, "/v1/orgs/mine": never, [PASS_PATH]: never });
    await render(<App extra={extra} ask={server.ask} store={memoryStore(keptWithKey(1))} wait={() => new Promise(() => undefined)} />);
    await fireEvent.press(await gymTab());
    expect(screen.queryByRole("button", { name: "Show my pass" })).toBeNull();
    await fireEvent.press(await screen.findByRole("button", { name: "Show my pass" }, { timeout: 4_000 }));
    // The pass waits two seconds for the server's, then draws the phone's own.
    const now = makePhonePass(OWN_KEYS, RAVI.id, Date.now());
    await waitFor(
      () => {
        expect(drawn(now, makePhonePass(OWN_KEYS, RAVI.id, Date.now()))).not.toBeNull();
      },
      { timeout: 4_000 },
    );
    expect(drawn(now, makePhonePass(OWN_KEYS, RAVI.id, Date.now()))).not.toBe("something else");
  });

  it("with no key kept, no signal shows what it did before, and no Show my pass where the places could not be read", async () => {
    await render(<App extra={extra} ask={lostAll({})} store={memoryStore(kept(1))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show my pass" })).toBeNull();
  });

  it("the Gym tab asks for the key once with the internet and keeps it with the sign-in", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [PHONE_KEY_PATH]: ok({ keys: OWN_KEYS.slice(0, 2) }),
    });
    const store = memoryStore(kept(1));
    await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
    await fireEvent.press(await gymTab());
    await waitFor(() => {
      expect(store.value ?? "").toContain(OWN_KEY);
    });
    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    await fireEvent.press(await gymTab());
    expect(server.paths().filter((path) => path === PHONE_KEY_PATH)).toHaveLength(1);
  });

  it("a phone whose keys are for days gone by is not offered the pass with no signal: it could make none", async () => {
    const lost: Ask = (url, init) =>
      fakeServer({}).ask(url, init).then(() => {
        throw new TypeError("Network request failed");
      });
    const old = [{ day: phoneDay(Date.now()) - 3, key: OWN_KEY }, { day: phoneDay(Date.now()) - 2, key: OWN_KEY }];
    await render(<App extra={extra} ask={lost} store={memoryStore(keptWithKey(1, { passKeys: old }))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show my pass" })).toBeNull();
  });

  it("nobody whose last places held none is offered the pass with no signal", async () => {
    const lost: Ask = (url, init) =>
      fakeServer({}).ask(url, init).then(() => {
        throw new TypeError("Network request failed");
      });
    await render(<App extra={extra} ask={lost} store={memoryStore(keptWithKey(1, { belongs: false }))} wait={noWait} />);
    await fireEvent.press(await gymTab());
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show my pass" })).toBeNull();
  });

  it("keys that got no answer, or a refusal other than this not being a phone, are asked for again with the next read; not after that refusal", async () => {
    for (const [first, again] of [
      [lostRoute, 2],
      [() => refusal(429, "rate_limited", "Too many requests."), 2],
      [() => refusal(403, "phone_only", "Only the app on your phone can do this."), 1],
    ] as const) {
      let n = 0;
      const server = fakeServer({
        "/v1/auth/refresh": ok({ tokens: tokens(2) }),
        "/v1/orgs/mine": () => (n === 0 ? refusal(500, "internal_error", "Something went wrong") : mine(IRON)()),
        "/v1/invitations/mine": () => refusal(500, "internal_error", "Something went wrong"),
        [PHONE_KEY_PATH]: () => {
          n += 1;
          return n === 1 ? first() : ok({ keys: OWN_KEYS.slice(0, 2) })();
        },
      });
      const store = memoryStore(kept(1));
      const view = await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
      await fireEvent.press(await gymTab());
      await fireEvent.press(await screen.findByRole("button", { name: "Try again" }));
      await waitFor(() => {
        expect(server.paths().filter((path) => path === PHONE_KEY_PATH)).toHaveLength(again);
      });
      if (again === 2) {
        await waitFor(() => {
          expect(store.value ?? "").toContain(OWN_KEY);
        });
      } else expect(store.value ?? "").not.toContain(OWN_KEY);
      await view.unmount();
    }
  });

  it("a key the server refuses is not kept", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [PHONE_KEY_PATH]: () => refusal(403, "phone_only", "Only the app on your phone can do this."),
    });
    const store = memoryStore(kept(1));
    await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
    await fireEvent.press(await gymTab());
    await waitFor(() => {
      expect(server.paths()).toContain(PHONE_KEY_PATH);
    });
    expect(JSON.parse(store.value ?? "{}")).not.toHaveProperty("passKey");
  });
});

describe("a pass with no signal, while it is open", () => {
  const start = Date.parse("2026-10-28T10:00:05.000Z");
  const own: MakeOwnPass = (nowMs) => makePhonePass(OWN_KEYS, RAVI.id, nowMs);
  const ownAt = (ms: number) => makePhonePass(OWN_KEYS, RAVI.id, start + ms);

  beforeEach(() => {
    jest.useFakeTimers({ now: start });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  const later = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
    });
  };
  const good = (pass: string): Answer<CheckinPassResponse> => ({
    kind: "ok",
    data: { pass, refreshAt: new Date(Date.now() + 20_000).toISOString() },
  });

  it("the server's pass, when it comes at once, is the one drawn", async () => {
    const fetchPass: FetchPass = jest.fn(() => Promise.resolve(good(RAVI_PASS)));
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={own} />);
    await later(0);
    await later(OWN_PASS_AFTER_MS);
    expect(drawn(ownAt(0))).toBe(RAVI_PASS);
  });

  it("while the server is slow the phone's own is drawn after two seconds, with no word of being offline; the server's replaces it", async () => {
    let answer: (reply: Answer<CheckinPassResponse>) => void = () => undefined;
    const fetchPass: FetchPass = jest.fn(() => new Promise<Answer<CheckinPassResponse>>((resolve) => (answer = resolve)));
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={own} />);
    await later(OWN_PASS_AFTER_MS - 1);
    expect(drawn()).toBeNull();
    await later(1);
    expect(drawn(ownAt(0))).toBe(ownAt(0));
    expect(screen.queryByText(PASS_OFFLINE)).toBeNull();
    await act(async () => {
      answer(good(RAVI_PASS));
      await Promise.resolve();
    });
    expect(drawn(ownAt(0))).toBe(RAVI_PASS);
  });

  it("with the phone's own pass on screen the server is asked again, and when the signal is back its pass and words return", async () => {
    let answers = 0;
    const fetchPass: FetchPass = jest.fn(() => {
      answers += 1;
      return Promise.resolve<Answer<CheckinPassResponse>>(answers < 3 ? { kind: "no_answer" } : good(RAVI_PASS));
    });
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={own} />);
    await later(0);
    expect(screen.getByText(PASS_OFFLINE)).toBeTruthy();
    await later(OFFLINE_ASK_AGAIN_MS);
    expect(fetchPass).toHaveBeenCalledTimes(2);
    expect(screen.getByText(PASS_OFFLINE)).toBeTruthy();
    await later(OFFLINE_ASK_AGAIN_MS);
    expect(fetchPass).toHaveBeenCalledTimes(3);
    expect(drawn(ownAt(50_000))).toBe(RAVI_PASS);
    expect(screen.queryByText(PASS_OFFLINE)).toBeNull();
    expect(screen.getByText("It changes every 30 seconds.")).toBeTruthy();
  });

  it("with no answer it says it is offline and makes a new pass as each window begins", async () => {
    const fetchPass: FetchPass = jest.fn(() => Promise.resolve<Answer<CheckinPassResponse>>({ kind: "no_answer" }));
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={own} />);
    await later(0);
    expect(screen.getByText(PASS_OFFLINE)).toBeTruthy();
    expect(drawn(ownAt(0))).toBe(ownAt(0));
    expect(screen.queryByText(PASS_COULD_NOT)).toBeNull();
    // The window began at 10:00:00; the next begins at 10:00:30, 25 seconds on.
    await later(24_999);
    expect(drawn(ownAt(0))).toBe(ownAt(0));
    await later(1);
    expect(ownAt(25_000)).not.toBe(ownAt(0));
    expect(drawn(ownAt(25_000))).toBe(ownAt(25_000));
  });

  it("a refusal is never covered by the phone's own pass: the server's words show", async () => {
    const words = "Passes aren't working right now. Staff can check you in.";
    const fetchPass: FetchPass = jest.fn(() =>
      Promise.resolve<Answer<CheckinPassResponse>>({
        kind: "refused",
        status: 503,
        error: "passes_off",
        message: words,
        retryAfterSeconds: null,
        robotCheckKey: null,
        body: {},
      }),
    );
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} makeOwnPass={own} />);
    await later(0);
    await later(OWN_PASS_AFTER_MS);
    expect(screen.getByText(words)).toBeTruthy();
    expect(drawn(ownAt(0))).toBeNull();
  });
});
