import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { App, TABS } from "../../src/App";
import { colours } from "../../src/look/colours";
import { fakeServer, kept, memoryStore, tokens } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
/** The server, with its health check up or down; a kept sign-in is always given its new token. */
const answers = (up: boolean) =>
  fakeServer({
    "/health": () => ({ status: up ? 200 : 503, body: { status: "ok" } }),
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
  }).ask;
/** The tabs are a signed-in person's: every test here opens the app already signed in. */
const signedIn = () => memoryStore(kept(1));

interface Drawn {
  props: {
    accessibilityLabel?: unknown;
    accessibilityState?: { selected?: unknown };
    children?: unknown;
    style?: StyleProp<ViewStyle & TextStyle>;
  };
}
const drawn = (node: Drawn) => StyleSheet.flatten(node.props.style);
const label = (tab: Drawn) => tab.props.accessibilityLabel;
const lit = (tab: Drawn) => tab.props.accessibilityState?.selected;
const words = (line: Drawn) => line.props.children;

async function open(tab: string) {
  await fireEvent.press(await screen.findByRole("tab", { name: tab }));
}

describe("the five tabs", () => {
  it("are Dashboard, Workout, Food, Gym and Me, in that order, opening on Dashboard", async () => {
    await render(<App extra={extra} store={signedIn()} ask={answers(true)} />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map(label)).toEqual(["Dashboard", "Workout", "Food", "Gym", "Me"]);
    expect(TABS.map((tab) => tab.name)).toEqual(["Dashboard", "Workout", "Food", "Gym", "Me"]);
    expect(tabs.map(lit)).toEqual([true, false, false, false, false]);
    expect(screen.getByRole("header", { name: "Dashboard" })).toBeTruthy();
  });

  it.each([
    ["Workout", "Workout", "Exercises, My Workout and Running"],
    ["Food", "Food", "Your meals"],
    ["Gym", "My gyms", "Your gym"],
    ["Me", "Me", "Settings, Progress and Achievements"],
    ["Dashboard", "Dashboard", "Your day"],
  ])("%s opens its own page and lights its own tab", async (tab, heading, box) => {
    await render(<App extra={extra} store={signedIn()} ask={answers(true)} />);
    await open(tab === "Dashboard" ? "Me" : "Dashboard");
    await open(tab);
    expect(await screen.findByRole("header", { name: heading })).toBeTruthy();
    expect(screen.getByRole("header", { name: box })).toBeTruthy();
    const on = (await screen.findAllByRole("tab")).filter((drawn) => lit(drawn) === true);
    expect(on.map(label)).toEqual([tab]);
    // What is drawn, not only what a screen reader is told: its word is orange, the other four are not.
    const inks = (await screen.findAllByRole("tab")).map((one) => [
      label(one),
      drawn(within(one).getByText(String(label(one)))).color === colours.orange,
    ]);
    expect(inks).toEqual(TABS.map((each) => [each.name, each.name === tab]));
  });

  it("no tab shows a made-up number", async () => {
    await render(<App extra={extra} store={signedIn()} ask={answers(true)} />);
    for (const tab of TABS) {
      await open(tab.name);
      expect(await screen.findAllByText("Not in the app yet.")).toHaveLength(1);
      const withDigits = screen.queryAllByText(/\d/).map(words);
      const copyLine = [["This is the ", "Feature 1", " copy, for testing."]];
      expect([tab.name, withDigits]).toEqual([tab.name, tab.name === "Me" ? copyLine : []]);
    }
  });

  it("no drawn words are under 11, and no drawn tab or button is under 44 tall", async () => {
    await render(<App extra={extra} store={signedIn()} ask={answers(false)} />);
    for (const tab of TABS) {
      await open(tab.name);
      const small = screen.getAllByText(/./).filter((line) => !((drawn(line).fontSize ?? 0) >= 11));
      expect([tab.name, small.map(words)]).toEqual([tab.name, []]);
    }
    await screen.findByRole("button", { name: "Try again" });
    const pressed = [...screen.getAllByRole("tab"), ...screen.getAllByRole("button")];
    expect(pressed.map(label).slice(5)).toEqual([undefined, undefined]);
    expect(pressed).toHaveLength(7);
    const heights = pressed.map((one) => Number(drawn(one).height ?? drawn(one).minHeight ?? 0));
    expect(heights.filter((height) => height < 44)).toEqual([]);
  });
});

describe("Me says which copy this is and whether it reaches its server", () => {
  it("connected", async () => {
    const asked: string[] = [];
    await render(
      <App
        extra={extra}
        store={signedIn()}
        ask={(url, init) => {
          asked.push(url);
          return answers(true)(url, init);
        }}
      />,
    );
    await open("Me");
    expect(await screen.findByText("This is the Feature 1 copy, for testing.")).toBeTruthy();
    expect(await screen.findByText("Connected to the server.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(asked.filter((url) => !url.includes("/v1/auth/"))).toEqual(["http://localhost:3000/health"]);
  });

  it("not reached, then Try again reaches it", async () => {
    let up = false;
    await render(<App extra={extra} store={signedIn()} ask={(url, init) => answers(up)(url, init)} />);
    await open("Me");
    expect(await screen.findByText(/^Can’t reach the server\. Check that the phone’s cable is in/)).toBeTruthy();
    expect(screen.queryByText("Connected to the server.")).toBeNull();
    up = true;
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Connected to the server.")).toBeTruthy();
    expect(screen.queryByText(/^Can’t reach the server/)).toBeNull();
  });

  it("a copy with no settings says so, shows no sign-in and no tabs, and asks nothing", async () => {
    const ask = jest.fn(answers(true));
    await render(<App extra={null} store={signedIn()} ask={ask} />);
    expect(
      await screen.findByText("This copy of the app has no settings. Stop it and start it again from the laptop."),
    ).toBeTruthy();
    expect(screen.queryByText("Connected to the server.")).toBeNull();
    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(screen.queryByText("Get started.")).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
});
