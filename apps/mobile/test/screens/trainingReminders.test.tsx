import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { App, tabOfTap } from "../../src/App";
import { channelOf, identifierOf, tappedOf } from "../../src/notifications/phone";
import { DONE_LINE, PAUSED_LINE, SAFE_MODE_LINE } from "../../src/screens/remindersView";
import { NO_ANSWER } from "../../src/screens/SignIn";
import type { Ask } from "../../src/session/calls";
import { OFF_REMINDERS, fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply, type Route } from "../kit";

// Your training's reminders in Settings (ROADMAP Stage 5 item 19e-i). The worst thing: a reminder reads
// Off while the server still holds it on, so the phone keeps sounding. Every switch, day and time shown
// is the server's answer.

const { notifications, reset } = jest.requireMock<{ notifications: { permission: unknown; afterAsk: unknown; asked: number; channelsOff: string[] }; reset: () => void }>("expo-notifications");
const YES = { granted: true, canAskAgain: true, status: "granted" };
const ASK = { granted: false, canAskAgain: true, status: "undetermined" };

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });
const LIST = "/v1/users/me/reminders";

type Held = (typeof OFF_REMINDERS)[number];
/** The server's own reminders: only its answers change them. */
function account(start: Partial<Record<string, Partial<Held>>> = {}, safeMode = false) {
  const held: Held[] = OFF_REMINDERS.map((r) => ({ ...r, days: [...r.days], ...start[r.kind] }));
  const list: Route = () => ({ status: 200, body: { reminders: held, safeMode } });
  const saveOf =
    (kind: string): Route =>
    (body) => {
      const one = held.find((r) => r.kind === kind);
      if (one === undefined || body === undefined) return refusal(400, "validation_error", "no");
      const { on, time, days } = body as { on: boolean; time: string; days: number[] };
      Object.assign(one, { on, time, days: kind === "workout" ? days : [1, 2, 3, 4, 5, 6, 7], paused: on ? false : one.paused });
      return { status: 200, body: { reminders: held, safeMode } };
    };
  const routes: Record<string, Route> = { [LIST]: list };
  for (const r of OFF_REMINDERS) routes[`${LIST}/${r.kind}`] = saveOf(r.kind);
  return { held, routes };
}

const routes = (over: Record<string, Route> = {}): Record<string, Route> => ({
  "/v1/auth/refresh": ok({ tokens: tokens(2) }),
  ...over,
});

async function openSettings(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[4];
  if (tab === undefined) throw new Error("no fifth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText("Settings"));
  await screen.findByText("Your training");
}
const saves = (asked: { path: string; method: string; body: unknown }[], kind: string) =>
  asked.filter((a) => a.path === `${LIST}/${kind}` && a.method === "PUT").map((a) => a.body);

beforeEach(() => {
  reset();
  notifications.permission = YES;
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("Your training shows and saves only the server's answer", () => {
  it("all four start off, under Your training, with the line about days already done", async () => {
    await openSettings(fakeServer(routes(account().routes)).ask);
    for (const label of ["Workout reminder", "Breakfast", "Lunch", "Dinner"]) expect(screen.getByLabelText(label).props.value).toBe(false);
    expect(screen.getAllByText("Off.")).toHaveLength(4);
    expect(screen.getByText(DONE_LINE)).toBeTruthy();
  });

  it("switched on: the whole reminder is sent, the server holds it, and its days and time show", async () => {
    const acct = account();
    const server = fakeServer(routes(acct.routes));
    await openSettings(server.ask);
    await act(() => fireEvent(screen.getByLabelText("Workout reminder"), "valueChange", true));
    await waitFor(() => {
      expect(screen.getByLabelText("Workout reminder").props.value).toBe(true);
    });
    expect(saves(server.asked, "workout")).toEqual([{ on: true, time: "18:00", days: [1, 2, 3, 4, 5, 6, 7] }]);
    expect(acct.held[0]?.on).toBe(true);
    expect(screen.getByText("Every day at 6:00\u00a0PM.")).toBeTruthy();
    expect(screen.getByLabelText("Monday").props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByLabelText("Workout reminder time, 6:00 PM")).toBeTruthy();
  });

  it("a refused save keeps it off, as the server holds it, and says the server's words in its row", async () => {
    const acct = account();
    const refuse: Route = () => refusal(429, "rate_limited", "Too many changes. Please try again later.");
    await openSettings(fakeServer(routes({ ...acct.routes, [`${LIST}/lunch`]: refuse })).ask);
    await act(() => fireEvent(screen.getByLabelText("Lunch"), "valueChange", true));
    const row = screen.getByTestId("reminder-lunch");
    expect(await within(row).findByText("Too many changes. Please try again later.")).toBeTruthy();
    expect(screen.getByLabelText("Lunch").props.value).toBe(false);
    expect(acct.held[2]?.on).toBe(false);
  });

  it("a lost save keeps it on, as it was, and says so", async () => {
    const acct = account({ dinner: { on: true } });
    await openSettings(fakeServer(routes({ ...acct.routes, [`${LIST}/dinner`]: () => lost() })).ask);
    await act(() => fireEvent(screen.getByLabelText("Dinner"), "valueChange", false));
    expect(await screen.findByText(NO_ANSWER)).toBeTruthy();
    expect(screen.getByLabelText("Dinner").props.value).toBe(true);
  });

  it("a day pressed is saved with the others; the last day cannot be taken away", async () => {
    const acct = account({ workout: { on: true, days: [1, 3], time: "18:30" } });
    const server = fakeServer(routes(acct.routes));
    await openSettings(server.ask);
    expect(screen.getByText("Mon and Wed at 6:30\u00a0PM.")).toBeTruthy();
    await act(() => fireEvent.press(screen.getByLabelText("Friday")));
    expect(await screen.findByText("Mon, Wed and Fri at 6:30\u00a0PM.")).toBeTruthy();
    await act(() => fireEvent.press(screen.getByLabelText("Monday")));
    expect(await screen.findByText("Wed and Fri at 6:30\u00a0PM.")).toBeTruthy();
    // Down to one day: pressing it says so and saves nothing.
    await act(() => fireEvent.press(screen.getByLabelText("Wednesday")));
    expect(await screen.findByText("Fri at 6:30\u00a0PM.")).toBeTruthy();
    expect(saves(server.asked, "workout").map((b) => (b as { days: number[] }).days)).toEqual([
      [1, 3, 5],
      [3, 5],
      [5],
    ]);
    const before = saves(server.asked, "workout").length;
    await act(() => fireEvent.press(screen.getByLabelText("Friday")));
    expect(await screen.findByText("Pick at least one day.")).toBeTruthy();
    expect(saves(server.asked, "workout")).toHaveLength(before);
  });

  it("the time box: a wheel moved and Save sends the new time, and the line reads it", async () => {
    const acct = account({ lunch: { on: true, time: "13:00" } });
    const server = fakeServer(routes(acct.routes));
    await openSettings(server.ask);
    await act(() => fireEvent.press(screen.getByLabelText("Lunch time, 1:00 PM")));
    const minute = await screen.findByTestId("wheel-Minute");
    for (let i = 0; i < 6; i += 1) await act(() => fireEvent(minute, "accessibilityAction", { nativeEvent: { actionName: "increment" } }));
    await act(() => fireEvent(screen.getByTestId("wheel-Hour"), "accessibilityAction", { nativeEvent: { actionName: "decrement" } }));
    await act(() => fireEvent(screen.getByTestId("wheel-Hour"), "accessibilityAction", { nativeEvent: { actionName: "increment" } }));
    await act(() => fireEvent(screen.getByTestId("wheel-Hour"), "accessibilityAction", { nativeEvent: { actionName: "increment" } }));
    await act(() => fireEvent.press(screen.getByText("Save")));
    expect(await screen.findByText("Every day at 2:30\u00a0PM.")).toBeTruthy();
    expect(saves(server.asked, "lunch")).toEqual([{ on: true, time: "14:30", days: [1, 2, 3, 4, 5, 6, 7] }]);
  });

  it("paused: says why, and Turn on sends it on again and the box goes", async () => {
    const acct = account({ workout: { on: true, paused: true, time: "07:00", days: [1, 2, 3, 4, 5] } });
    const server = fakeServer(routes(acct.routes));
    await openSettings(server.ask);
    expect(screen.getByText(PAUSED_LINE)).toBeTruthy();
    await act(() => fireEvent.press(screen.getByLabelText("Turn on Workout reminder")));
    await waitFor(() => {
      expect(screen.queryByText(PAUSED_LINE)).toBeNull();
    });
    expect(saves(server.asked, "workout")).toEqual([{ on: true, time: "07:00", days: [1, 2, 3, 4, 5] }]);
    expect(screen.getByText("Weekdays at 7:00\u00a0AM.")).toBeTruthy();
  });

  it("not loaded: no switch to read wrongly, and Try again reads them", async () => {
    const acct = account({ breakfast: { on: true } });
    let fail = true;
    const list: Route = (body) => (fail ? lost() : (acct.routes[LIST]?.(body) ?? lost()));
    await openSettings(fakeServer(routes({ ...acct.routes, [LIST]: list })).ask);
    expect(screen.getByText("Couldn’t load your reminders.")).toBeTruthy();
    expect(screen.queryByLabelText("Breakfast")).toBeNull();
    fail = false;
    await act(() => fireEvent.press(screen.getByLabelText("Try reminders again")));
    expect((await screen.findByLabelText("Breakfast")).props.value).toBe(true);
  });

  it("turned on while the phone has never been asked: Android is asked", async () => {
    notifications.permission = ASK;
    notifications.afterAsk = YES;
    const acct = account();
    await openSettings(fakeServer(routes(acct.routes)).ask);
    const asked = notifications.asked;
    await act(() => fireEvent(screen.getByLabelText("Breakfast"), "valueChange", true));
    await waitFor(() => {
      expect(notifications.asked).toBe(asked + 1);
    });
  });

  it("Safe mode: the workout reminder says why it waits, keeps its switch, and shows no days or time; meals as usual", async () => {
    await openSettings(fakeServer(routes(account({ workout: { on: true, time: "18:30", days: [1, 3, 5] }, lunch: { on: true } }, true).routes)).ask);
    // The workout reminder's, and the streak reminder's under it (19e-ii).
    expect(screen.getAllByText(SAFE_MODE_LINE)).toHaveLength(2);
    expect(screen.getByLabelText("Workout reminder").props.value).toBe(true);
    expect(screen.queryByLabelText("Monday")).toBeNull();
    expect(screen.queryByLabelText("Workout reminder time, 6:30 PM")).toBeNull();
    expect(screen.getByLabelText("Lunch time, 1:00 PM")).toBeTruthy();
  });

  it("Reminders turned off in the phone's own settings: the row says so", async () => {
    notifications.channelsOff = ["training-reminders"];
    await openSettings(fakeServer(routes(account({ dinner: { on: true } }).routes)).ask);
    expect(await screen.findByText("Reminders are off on this phone.")).toBeTruthy();
    expect(screen.getByLabelText("Open phone settings for Reminders")).toBeTruthy();
  });
});

describe("a reminder's notification on the phone", () => {
  it("is read as ours, on its own channel, one at a time, and a tap opens Workout or Food", () => {
    const workout = tappedOf({ kind: "training_reminder", open: "workout" });
    const food = tappedOf({ kind: "training_reminder", open: "food" });
    expect(workout).toEqual({ kind: "training", open: "workout" });
    expect(food).toEqual({ kind: "training", open: "food" });
    expect(tappedOf({ kind: "training_reminder", open: "gym" })).toBeNull();
    if (workout === null || food === null) throw new Error("not read");
    expect(channelOf(workout)).toBe("training-reminders");
    expect(identifierOf(workout)).toBe(identifierOf(food));
    expect(tabOfTap(workout)).toBe("Workout");
    expect(tabOfTap(food)).toBe("Food");
    expect(tabOfTap({ kind: "inbox", gymId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f" })).toBe("Gym");
  });
  it("the streak reminder opens Workout (on Running), a badge Me (where Achievements is), the summary the Dashboard (19e-ii)", () => {
    const streak = tappedOf({ kind: "training_nudge", open: "running" });
    expect(tappedOf({ kind: "training_nudge", open: "workout" })).toBeNull();
    const badge = tappedOf({ kind: "training_nudge", open: "achievements" });
    const week = tappedOf({ kind: "training_nudge", open: "dashboard" });
    expect(tappedOf({ kind: "training_nudge", open: "settings" })).toBeNull();
    if (streak === null || badge === null || week === null) throw new Error("not read");
    expect([streak, badge, week].map(channelOf)).toEqual(["training-progress", "training-progress", "training-progress"]);
    expect(identifierOf(streak)).toBe(identifierOf(week));
    expect(identifierOf(streak)).not.toBe(identifierOf({ kind: "training", open: "workout" }));
    expect([streak, badge, week].map(tabOfTap)).toEqual(["Workout", "Me", "Dashboard"]);
  });
});
