import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, Platform } from "react-native";
import * as Brightness from "expo-brightness";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import type { CheckinPassResponse } from "@app/shared";
import { App } from "../../src/App";
import { PASS_COULD_NOT, PASS_GETTING, PASS_PATH, PassSheet, type FetchPass } from "../../src/screens/gym/Pass";
import { passCells, passPath } from "../../src/screens/gym/passView";
import type { Answer, Ask } from "../../src/session/calls";
import { RAVI, fakeServer, kept, memoryStore, profile, tokens, type Reply } from "../kit";

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

/** The code on screen, as the pass it draws, or null with none drawn. */
function drawn(): string | null {
  const code = screen.queryByTestId("pass-code");
  if (code === null) return null;
  const d: unknown = code.props.d;
  for (const pass of [RAVI_PASS, ASHA_PASS, NEXT_PASS]) if (d === passPath(passCells(pass) ?? [])) return pass;
  return "something else";
}

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
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} />);
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
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} />);
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
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} />);
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
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} />);
    await later(0);
    expect(screen.getByText("Too many passes. Try again in a minute.")).toBeTruthy();
    expect(drawn()).toBeNull();
  });

  it("in the background it asks nothing; back in front, a pass past its 30 seconds comes off and the next is asked for", async () => {
    const { fetchPass, asked } = answers(good(RAVI_PASS, 20_000), null);
    await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} />);
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

  it("the screen is kept awake and at full brightness while it is open, and both go back when it closes", async () => {
    const { fetchPass } = answers(good(RAVI_PASS, 20_000));
    const view = await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} />);
    await later(0);
    expect(activateKeepAwakeAsync).toHaveBeenCalledTimes(1);
    expect(Brightness.setBrightnessAsync).toHaveBeenCalledWith(1);
    expect(deactivateKeepAwake).not.toHaveBeenCalled();
    await view.rerender(<PassSheet open={false} trainer={false} onClose={() => undefined} fetchPass={fetchPass} />);
    await later(0);
    expect(deactivateKeepAwake).toHaveBeenCalledTimes(1);
    // Not Android: the brightness the phone had before is set again.
    expect(Brightness.setBrightnessAsync).toHaveBeenLastCalledWith(0.4);
  });

  it("on Android the phone's own brightness setting is given back", async () => {
    const was = Platform.OS;
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    try {
      const { fetchPass } = answers(good(RAVI_PASS, 20_000));
      const view = await render(<PassSheet open trainer={false} onClose={() => undefined} fetchPass={fetchPass} />);
      await later(0);
      expect(Brightness.getBrightnessAsync).not.toHaveBeenCalled();
      await view.rerender(<PassSheet open={false} trainer={false} onClose={() => undefined} fetchPass={fetchPass} />);
      await later(0);
      expect(Brightness.restoreSystemBrightnessAsync).toHaveBeenCalledTimes(1);
      expect(Brightness.setBrightnessAsync).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(Platform, "OS", { value: was, configurable: true });
    }
  });
});
