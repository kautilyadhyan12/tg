import { fireEvent, render, screen } from "@testing-library/react-native";
import { App, TABS } from "../../src/App";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const answers = (ok: boolean) => () =>
  Promise.resolve({ ok, json: () => Promise.resolve({ status: "ok" }) });

interface Drawn {
  props: { accessibilityLabel?: unknown; accessibilityState?: { selected?: unknown }; children?: unknown };
}
const label = (tab: Drawn) => tab.props.accessibilityLabel;
const lit = (tab: Drawn) => tab.props.accessibilityState?.selected;
const words = (line: Drawn) => line.props.children;

async function open(tab: string) {
  await fireEvent.press(await screen.findByRole("tab", { name: tab }));
}

describe("the five tabs", () => {
  it("are Today, Workout, Food, Gym and Me, in that order, opening on Today", async () => {
    await render(<App extra={extra} ask={answers(true)} />);
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map(label)).toEqual(["Today", "Workout", "Food", "Gym", "Me"]);
    expect(TABS.map((tab) => tab.name)).toEqual(["Today", "Workout", "Food", "Gym", "Me"]);
    expect(tabs.map(lit)).toEqual([true, false, false, false, false]);
    expect(screen.getByRole("header", { name: "Today" })).toBeTruthy();
  });

  it.each([
    ["Workout", "Workout", "Exercises, My Workout and Running"],
    ["Food", "Food", "Your meals"],
    ["Gym", "My gyms", "Your gym"],
    ["Me", "Me", "Settings, Progress and Achievements"],
    ["Today", "Today", "Your day"],
  ])("%s opens its own page and lights its own tab", async (tab, heading, box) => {
    await render(<App extra={extra} ask={answers(true)} />);
    await open(tab === "Today" ? "Me" : "Today");
    await open(tab);
    expect(await screen.findByRole("header", { name: heading })).toBeTruthy();
    expect(screen.getByRole("header", { name: box })).toBeTruthy();
    const on = (await screen.findAllByRole("tab")).filter((drawn) => lit(drawn) === true);
    expect(on.map(label)).toEqual([tab]);
  });

  it("no tab shows a number while nobody is signed in", async () => {
    await render(<App extra={extra} ask={answers(true)} />);
    for (const tab of TABS) {
      await open(tab.name);
      expect(await screen.findAllByText("This copy of the app has no sign-in yet.")).toHaveLength(1);
      const withDigits = screen.queryAllByText(/\d/).map(words);
      const copyLine = [["This is the ", "Feature 1", " copy, for testing."]];
      expect([tab.name, withDigits]).toEqual([tab.name, tab.name === "Me" ? copyLine : []]);
    }
  });
});

describe("Me says which copy this is and whether it reaches its server", () => {
  it("connected", async () => {
    const asked: string[] = [];
    await render(
      <App
        extra={extra}
        ask={(url) => {
          asked.push(url);
          return answers(true)();
        }}
      />,
    );
    await open("Me");
    expect(await screen.findByText("This is the Feature 1 copy, for testing.")).toBeTruthy();
    expect(await screen.findByText("Connected to the server.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(asked).toEqual(["http://localhost:3000/health"]);
  });

  it("not reached, then Try again reaches it", async () => {
    let up = false;
    await render(<App extra={extra} ask={() => answers(up)()} />);
    await open("Me");
    expect(await screen.findByText(/^Can’t reach the server\. Check that the phone’s cable is in/)).toBeTruthy();
    expect(screen.queryByText("Connected to the server.")).toBeNull();
    up = true;
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Connected to the server.")).toBeTruthy();
    expect(screen.queryByText(/^Can’t reach the server/)).toBeNull();
  });

  it("a copy with no settings says so and asks nothing", async () => {
    const ask = jest.fn(answers(true));
    await render(<App extra={null} ask={ask} />);
    await open("Me");
    expect(
      await screen.findByText("This copy of the app has no settings. Stop it and start it again from the laptop."),
    ).toBeTruthy();
    expect(screen.queryByText("Connected to the server.")).toBeNull();
    expect(ask).not.toHaveBeenCalled();
  });
});
