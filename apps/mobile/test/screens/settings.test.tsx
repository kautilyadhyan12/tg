import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, Linking } from "react-native";
import { missingPlanInputSchema } from "@app/shared";
import { App } from "../../src/App";
import { NO_ANSWER } from "../../src/screens/SignIn";
import { memberSinceText } from "../../src/screens/Settings";
import type { Ask } from "../../src/session/calls";
import { RAVI, fakeServer, kept, lost, memoryStore, profile, refusal, tokens, type Reply, type Route } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

const HIDE_ME = "/v1/users/me/leaderboard";
const ME = "/v1/users/me";
const SETUP = "/v1/users/me/onboarding";
const IRON = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House" };
const org = (gym: { id: string; name: string }) => ({
  ...gym,
  city: null,
  orgType: "gym",
  clockFormat: "12h",
  slug: gym.name.toLowerCase().replace(" ", "-"),
  timezone: "Asia/Kolkata",
  locale: "en",
  currencyDisplay: "INR",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
});
const leaderboardOf = (hidden: boolean, gymName: string) => ({
  gymId: IRON.id,
  gymName,
  timezone: "Asia/Kolkata",
  board: "gym_days",
  period: "this_week",
  from: "2026-10-26",
  to: "2026-11-01",
  circleDays: ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"],
  status: "shown",
  boardsOff: [],
  ranked: 1,
  rows: [],
  me: { value: 2, place: null, hidden: hidden ? "self" : null, toNextPlace: null, nextPlace: null, circles: [] },
  asOf: "2026-11-01T06:00:00.000Z",
});

/** The server's own person: a name, units and Hide me that only its answers change. */
function account() {
  const held = { displayName: RAVI.displayName, units: RAVI.units, hidden: false };
  const me: Route = (body) => {
    if (body !== undefined) Object.assign(held, body);
    return { status: 200, body: { user: { ...profile(true).user, displayName: held.displayName, units: held.units } } };
  };
  const hide: Route = (body) => {
    if (body !== undefined) held.hidden = (body as { hidden: boolean }).hidden;
    return { status: 200, body: { hidden: held.hidden, hideMe: held.hidden, under18: false } };
  };
  return { held, me, hide };
}

/** The leaderboard route names its query, which the kit's server leaves out. */
function withBoard(server: ReturnType<typeof fakeServer>, hidden: () => boolean): Ask {
  return async (url, init) => {
    const { pathname } = new URL(url);
    if (pathname !== `/v1/orgs/${IRON.id}/leaderboard`) return server.ask(url, init);
    return { ok: true, status: 200, json: () => Promise.resolve(leaderboardOf(hidden(), IRON.name)) };
  };
}

/** The app coming back to the front, as Android says it. */
function listenForComeBack(): () => Promise<void> {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    listeners.push(handler as (state: string) => void);
    return { remove: () => undefined };
  });
  return async () => {
    await act(() => {
      for (const one of listeners) one("active");
    });
  };
}
afterEach(() => {
  jest.restoreAllMocks();
});

async function openSettings(ask: Ask, store = memoryStore(kept(1))) {
  await render(<App extra={extra} ask={ask} store={store} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[4];
  if (tab === undefined) throw new Error("no fifth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText("Settings"));
  return store;
}
const routes = (over: Record<string, Route> = {}): Record<string, Route> => ({
  "/v1/auth/refresh": ok({ tokens: tokens(2) }),
  "/v1/orgs/mine": ok({ orgs: [org(IRON)], formerOrgs: [] }),
  ...over,
});

describe("Hide me in Settings is the leaderboards' own (the worst thing: Settings says hidden while a board shows the person)", () => {
  it("switched on in Settings, the server holds it and the gym's Leaderboard opens with it on", async () => {
    const acct = account();
    const server = fakeServer(routes({ [ME]: acct.me, [HIDE_ME]: acct.hide }));
    await openSettings(withBoard(server, () => acct.held.hidden));
    const settingsSwitch = await screen.findByLabelText("Hide me on leaderboards");
    expect(settingsSwitch.props.value).toBe(false);
    await act(() => fireEvent(settingsSwitch, "valueChange", true));
    await waitFor(() => {
      expect(screen.getByLabelText("Hide me on leaderboards").props.value).toBe(true);
    });
    expect(server.asked.filter((a) => a.path === HIDE_ME && a.method === "PUT").map((a) => a.body)).toEqual([{ hidden: true }]);
    expect(acct.held.hidden).toBe(true);

    await fireEvent.press(screen.getByLabelText("Close"));
    const gymTab = (await screen.findAllByRole("tab"))[3];
    if (gymTab === undefined) throw new Error("no fourth tab");
    await fireEvent.press(gymTab);
    await fireEvent.press(await screen.findByLabelText(`Leaderboard at ${IRON.name}`));
    const boardSwitch = await within(screen.getByTestId("leaderboard-page")).findByLabelText("Hide me on leaderboards");
    expect(boardSwitch.props.value).toBe(true);
  });

  it("changed on another screen while Settings is open, it shows the server's answer when the app comes back", async () => {
    const comeBack = listenForComeBack();
    const acct = account();
    const server = fakeServer(routes({ [ME]: acct.me, [HIDE_ME]: acct.hide }));
    await openSettings(server.ask);
    expect((await screen.findByLabelText("Hide me on leaderboards")).props.value).toBe(false);
    acct.held.hidden = true;
    acct.held.displayName = "Ravi Kumar";
    acct.held.units = "imperial";
    await comeBack();
    await waitFor(() => {
      expect(screen.getByLabelText("Hide me on leaderboards").props.value).toBe(true);
    });
    expect(await screen.findByDisplayValue("Ravi Kumar")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByLabelText("Pounds, feet and inches").props.accessibilityState).toMatchObject({ selected: true });
    });
  });

  it("shows the server's answer, not the press: a refused save leaves it off and says why", async () => {
    const acct = account();
    const server = fakeServer(
      routes({
        [ME]: acct.me,
        [HIDE_ME]: (body) => (body === undefined ? acct.hide(undefined) : refusal(429, "rate_limited", "Too many changes. Try again in a minute.")),
      }),
    );
    await openSettings(server.ask);
    await act(() => fireEvent(screen.getByLabelText("Hide me on leaderboards"), "valueChange", true));
    expect(await screen.findByText("Too many changes. Try again in a minute.")).toBeTruthy();
    expect(screen.getByLabelText("Hide me on leaderboards").props.value).toBe(false);
  });

  it("with no signal it says so and shows what the server last said", async () => {
    let gone = false;
    const acct = account();
    const server = fakeServer(routes({ [ME]: acct.me, [HIDE_ME]: (body) => (gone ? lost() : acct.hide(body)) }));
    await openSettings(server.ask);
    await screen.findByLabelText("Hide me on leaderboards");
    gone = true;
    await act(() => fireEvent(screen.getByLabelText("Hide me on leaderboards"), "valueChange", true));
    expect(await screen.findByText(NO_ANSWER)).toBeTruthy();
    expect(screen.getByLabelText("Hide me on leaderboards").props.value).toBe(false);
  });
});

describe("Your name", () => {
  it("saves a new name, and Me calls the person by it", async () => {
    const acct = account();
    const server = fakeServer(routes({ [ME]: acct.me }));
    const store = await openSettings(server.ask);
    const box = await screen.findByDisplayValue("Ravi");
    expect(screen.queryByLabelText("Save name")).toBeNull();
    await fireEvent.changeText(box, "  Ravi Kumar ");
    await fireEvent.press(screen.getByLabelText("Save name"));
    expect(await screen.findByText("Your name is saved.")).toBeTruthy();
    expect(server.asked.filter((a) => a.path === ME && a.method === "PATCH").map((a) => a.body)).toEqual([{ displayName: "Ravi Kumar" }]);
    expect((JSON.parse(store.value ?? "{}") as { user: { displayName: string } }).user.displayName).toBe("Ravi Kumar");
    await fireEvent.press(screen.getByLabelText("Close"));
    expect(await screen.findByText("Ravi Kumar")).toBeTruthy();
  });

  it("a name and units changed on another device show when Settings opens", async () => {
    const acct = account();
    acct.held.displayName = "Ravi Kumar";
    acct.held.units = "imperial";
    const server = fakeServer(routes({ [ME]: acct.me }));
    const store = await openSettings(server.ask);
    expect(await screen.findByDisplayValue("Ravi Kumar")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByLabelText("Pounds, feet and inches").props.accessibilityState).toMatchObject({ selected: true });
    });
    expect((JSON.parse(store.value ?? "{}") as { user: { displayName: string; units: string } }).user).toMatchObject({ displayName: "Ravi Kumar", units: "imperial" });
  });

  it("a blank name is never sent", async () => {
    const server = fakeServer(routes());
    await openSettings(server.ask);
    await fireEvent.changeText(await screen.findByDisplayValue("Ravi"), "   ");
    expect(screen.getByText("Enter your name.")).toBeTruthy();
    expect(screen.queryByLabelText("Save name")).toBeNull();
    expect(server.asked.some((a) => a.path === ME && a.method === "PATCH")).toBe(false);
  });
});

describe("Units", () => {
  it("lb · ft is saved to the account and kept on the phone", async () => {
    const acct = account();
    const server = fakeServer(routes({ [ME]: acct.me }));
    const store = await openSettings(server.ask);
    const imperial = await screen.findByLabelText("Pounds, feet and inches");
    expect(screen.getByLabelText("Kilograms and centimetres").props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(imperial);
    await waitFor(() => {
      expect(screen.getByLabelText("Pounds, feet and inches").props.accessibilityState).toMatchObject({ selected: true });
    });
    expect(server.asked.filter((a) => a.path === ME && a.method === "PATCH").map((a) => a.body)).toEqual([{ units: "imperial" }]);
    expect((JSON.parse(store.value ?? "{}") as { user: { units: string } }).user.units).toBe("imperial");
  });

  it("a press made before Settings' opening read answers is not undone by that read", async () => {
    const acct = account();
    let letGo = (): void => undefined;
    // Only the read Settings makes as it opens is held back.
    let armed = false;
    const server = fakeServer(
      routes({
        [ME]: (body) => {
          if (body !== undefined || !armed) return acct.me(body);
          armed = false;
          const then = acct.me(undefined);
          return new Promise<Reply>((resolve) => {
            letGo = () => {
              resolve(then);
            };
          });
        },
      }),
    );
    const store = memoryStore(kept(1));
    await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
    await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
    armed = true;
    await fireEvent.press(await screen.findByLabelText("Settings"));
    await fireEvent.press(await screen.findByLabelText("Pounds, feet and inches"));
    expect(armed).toBe(false);
    await waitFor(() => {
      expect(acct.held.units).toBe("imperial");
    });
    await act(() => {
      letGo();
      return new Promise<void>((resolve) => setTimeout(resolve, 30));
    });
    expect(screen.getByLabelText("Pounds, feet and inches").props.accessibilityState).toMatchObject({ selected: true });
    expect((JSON.parse(store.value ?? "{}") as { user: { units: string } }).user.units).toBe("imperial");
  });

  it("with no signal it stays as it was and says so", async () => {
    const acct = account();
    const server = fakeServer(routes({ [ME]: (body) => (body === undefined ? acct.me(undefined) : lost()) }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Pounds, feet and inches"));
    expect(await screen.findByText(NO_ANSWER)).toBeTruthy();
    expect(screen.getByLabelText("Kilograms and centimetres").props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe("What each place can see", () => {
  it("lists each place the person belongs to and opens its list", async () => {
    await openSettings(fakeServer(routes()).ask);
    await fireEvent.press(await screen.findByLabelText(`What ${IRON.name} can see`));
    expect(await screen.findByText("While you’re a member.")).toBeTruthy();
    expect(screen.getByText("Never")).toBeTruthy();
  });

  it("is not there for somebody with no place", async () => {
    await openSettings(fakeServer(routes({ "/v1/orgs/mine": ok({ orgs: [], formerOrgs: [] }), [HIDE_ME]: account().hide })).ask);
    await screen.findByText("Account");
    expect(screen.queryByText("Your privacy")).toBeNull();
    await screen.findByLabelText("Hide me on leaderboards");
    expect(screen.queryByText("The same at every place you belong to.")).toBeNull();
  });
});

describe("Account", () => {
  it("shows the email, the sign-in and the month the account was made", async () => {
    await openSettings(fakeServer(routes()).ask);
    const page = within(await screen.findByTestId("settings-page"));
    expect(await page.findByText("Member since October 2026")).toBeTruthy();
    expect(page.getByText(RAVI.email)).toBeTruthy();
    expect(page.getByText("Email code or Google")).toBeTruthy();
  });

  it("Start setup again asks first: Cancel sends nothing; Start again clears setup and opens it, in the units chosen", async () => {
    const missing = [...missingPlanInputSchema.options];
    const cleared = { answers: { displayName: "Ravi", weightGoal: null, fitnessGoals: [], age: null, gender: null, heightCm: null, weightKg: null, targetWeightKg: null, pace: null, dayActivity: null, fitnessLevel: null, pushUpsMax: null, plankHoldSeconds: null, trainingDays: null, sessionMinutes: null, availableEquipment: [], trainingPlaces: [], diet: null, mealsPerDay: null, onboardingCompleted: false, updatedAt: null }, plan: null, missing };
    const held = structuredClone(cleared);
    const acct = account();
    acct.held.units = "imperial";
    const server = fakeServer(
      routes({
        [ME]: acct.me,
        [SETUP]: (body) => {
          if (typeof body === "object" && body !== null) Object.assign(held.answers, body);
          return { status: 200, body: held };
        },
      }),
    );
    const store = await openSettings(server.ask, memoryStore(kept(1, { ...RAVI, units: "imperial" })));
    await fireEvent.press(await screen.findByLabelText("Start setup again"));
    await fireEvent.press(await screen.findByLabelText("Cancel"));
    expect(server.asked.some((a) => a.path === SETUP && a.method === "DELETE")).toBe(false);

    await fireEvent.press(screen.getByLabelText("Start setup again"));
    await fireEvent.press(await screen.findByLabelText("Start again"));
    await waitFor(() => {
      expect(server.asked.filter((a) => a.path === SETUP && a.method === "DELETE")).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("setup").props.visible).toBe(true);
    });
    expect((JSON.parse(store.value ?? "{}") as { setupDone?: boolean }).setupDone).not.toBe(true);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
    expect(server.asked.filter((a) => a.path === ME && a.method === "PATCH")).toEqual([]);
    // And setup itself is in the units chosen: About you weighs in pounds.
    await fireEvent.press(await screen.findByRole("button", { name: "Keep my weight" }));
    await fireEvent.press(screen.getByRole("button", { name: "Build muscle" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Continue" }).props.accessibilityState).toMatchObject({ disabled: false });
    });
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("header", { name: "About you" });
    expect(within(screen.getByTestId("setup")).getByRole("button", { name: "Pounds, feet and inches" }).props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe("memberSinceText", () => {
  it.each([
    // The month on the phone's own calendar, as the browser shows it: early on the 1st is that month.
    [new Date(2026, 9, 14, 9, 0).toISOString(), "October 2026"],
    [new Date(2026, 10, 1, 3, 0).toISOString(), "November 2026"],
    [new Date(2026, 0, 31, 23, 59).toISOString(), "January 2026"],
    ["not a date", null],
  ])("%s → %s", (at, words) => {
    expect(memberSinceText(at)).toBe(words);
  });
});

describe("Privacy and terms (21b-i)", () => {
  it("Privacy Policy and Terms of Use open the website's pages in the phone's browser", async () => {
    const opened: string[] = [];
    jest.spyOn(Linking, "openURL").mockImplementation((url: string) => {
      opened.push(url);
      return Promise.resolve(true);
    });
    const acct = account();
    const server = fakeServer(routes({ [ME]: acct.me }));
    await render(<App extra={{ ...extra, webUrl: "http://127.0.0.1:5174" }} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    const tab = (await screen.findAllByRole("tab"))[4];
    if (tab === undefined) throw new Error("no fifth tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText("Settings"));
    await fireEvent.press(await screen.findByRole("button", { name: "Privacy Policy" }));
    await fireEvent.press(screen.getByRole("button", { name: "Terms of Use" }));
    expect(opened).toEqual(["http://127.0.0.1:5174/privacy", "http://127.0.0.1:5174/terms"]);
    jest.restoreAllMocks();
  });
});
