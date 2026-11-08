// Our Terms and Privacy Policy, opened from the phone (ROADMAP Stage 5 21b-i): Get started's line and
// Settings (its test, settings.test.tsx) open this copy's website at the page named, in the phone's browser.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import { App } from "../../src/App";
import { legalUrl } from "../../src/screens/legalLinks";
import { fakeServer, memoryStore } from "../kit";

const extra = { copyName: "Feature 2", apiUrl: "http://localhost:3001", webUrl: "http://127.0.0.1:5174" };
const noWait = () => Promise.resolve();

let opened: string[] = [];
beforeEach(() => {
  opened = [];
  jest.spyOn(Linking, "openURL").mockImplementation((url: string) => {
    opened.push(url);
    return Promise.resolve(true);
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("the addresses", () => {
  it("are the website's own pages, and none without a website", () => {
    expect(legalUrl("http://127.0.0.1:5174", "terms")).toBe("http://127.0.0.1:5174/terms");
    expect(legalUrl("https://kwazo.example/", "privacy")).toBe("https://kwazo.example/privacy");
    expect(legalUrl(undefined, "privacy")).toBeNull();
  });
});

describe("Get started's line", () => {
  it("Terms opens the Terms of Use and Privacy Policy opens the Privacy Policy", async () => {
    const server = fakeServer({});
    await render(<App extra={extra} ask={server.ask} store={memoryStore(null)} wait={noWait} waitingStore={memoryStore()} />);
    await screen.findByText("Get started.");
    await fireEvent.press(screen.getByRole("link", { name: "Terms" }));
    await fireEvent.press(screen.getByRole("link", { name: "Privacy Policy" }));
    expect(opened).toEqual(["http://127.0.0.1:5174/terms", "http://127.0.0.1:5174/privacy"]);
  });
});

