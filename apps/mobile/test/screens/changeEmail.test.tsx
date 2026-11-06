import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { App } from "../../src/App";
import { changedEmailLine } from "../../src/screens/Settings";
import { NO_ANSWER } from "../../src/screens/SignIn";
import type { Ask } from "../../src/session/calls";
import { RAVI, fakeServer, kept, lost, memoryStore, profile, refusal, tokens, type Reply, type Route } from "../kit";

// Change email on the phone (ROADMAP Stage 5 19c; RULINGS 2026-09-23, E): Settings' Account part, the new
// address, then the code emailed to it.

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

const CODE = "/v1/users/me/email-code";
const CHANGE = "/v1/users/me/email";
const NEW = "ravi.kumar@gmail.com";
const sentCode = ok({ message: `We emailed a 6-digit code to ${NEW}.`, resendAfterSeconds: 60, expiresInSeconds: 600 });
const WRONG = "That code didn’t work. Check it and try again, or ask for a new one.";

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
  [CODE]: sentCode,
  ...over,
});
const keptUser = (store: { value: string | null }) => (JSON.parse(store.value ?? "{}") as { user?: { email: string; displayName: string } }).user;

/** As far as the code: Change email, the new address, Email me a code. */
async function upToTheCode(address = NEW) {
  await fireEvent.press(await screen.findByLabelText("Change email"));
  await fireEvent.changeText(await screen.findByLabelText("New email address"), address);
  await fireEvent.press(screen.getByLabelText("Email me a code"));
  await screen.findByText("We emailed a 6-digit code to");
  expect(screen.getByText(address)).toBeTruthy();
}

describe("Change email (the worst thing: the phone shows or keeps an address the server never moved the account to)", () => {
  it("a wrong code changes nothing on the phone; the right one shows and keeps the new address, sent with the address the code went to", async () => {
    let tries = 0;
    const server = fakeServer(
      routes({
        [CHANGE]: () => {
          tries += 1;
          return tries === 1 ? refusal(400, "invalid_code", WRONG) : { status: 200, body: { message: `Your email is now ${NEW}.`, email: NEW, displayName: RAVI.displayName } };
        },
      }),
    );
    const store = await openSettings(server.ask);
    await upToTheCode();

    await fireEvent.changeText(screen.getByPlaceholderText("6-digit code"), "111111");
    await fireEvent.press(screen.getByLabelText("Confirm"));
    expect(await screen.findByText(WRONG)).toBeTruthy();
    expect(keptUser(store)?.email).toBe(RAVI.email);
    expect(within(screen.getByTestId("settings-page")).getByText(RAVI.email)).toBeTruthy();

    await fireEvent.changeText(screen.getByPlaceholderText("6-digit code"), "222222");
    await fireEvent.press(screen.getByLabelText("Confirm"));
    expect(await screen.findByText(changedEmailLine(NEW))).toBeTruthy();
    // The page's head reads it, and the Me tab under the page.
    expect(within(screen.getByTestId("settings-page")).getByText(NEW)).toBeTruthy();
    expect(screen.queryByText(RAVI.email)).toBeNull();
    expect(keptUser(store)?.email).toBe(NEW);
    expect(server.asked.filter((a) => a.path === CODE).map((a) => a.body)).toEqual([{ email: NEW }]);
    expect(server.asked.filter((a) => a.path === CHANGE).map((a) => a.body)).toEqual([
      { email: NEW, code: "111111" },
      { email: NEW, code: "222222" },
    ]);
  });

  it("a name that was only the old address's first part shows as the server's new one", async () => {
    const before = { ...RAVI, displayName: "ravi" };
    const server = fakeServer(
      routes({
        "/v1/users/me": ok(profile(true, before)),
        [CHANGE]: ok({ message: `Your email is now ${NEW}.`, email: NEW, displayName: "ravi.kumar" }),
      }),
    );
    const store = await openSettings(server.ask, memoryStore(kept(1, before)));
    await upToTheCode();
    await fireEvent.changeText(screen.getByPlaceholderText("6-digit code"), "123456");
    await fireEvent.press(screen.getByLabelText("Confirm"));
    await screen.findByText(changedEmailLine(NEW));
    expect(keptUser(store)).toMatchObject({ email: NEW, displayName: "ravi.kumar" });
    expect(within(screen.getByTestId("settings-page")).getByText("ravi.kumar")).toBeTruthy();
  });

  it("an empty box or an address that is not one is said once Email me a code is pressed, never while typing, and nothing is sent", async () => {
    const server = fakeServer(routes());
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Change email"));
    await fireEvent.press(await screen.findByLabelText("Email me a code"));
    expect(screen.getByText("Enter your new email address.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("New email address"), "ravi@gmail");
    expect(screen.queryByText("Enter your new email address.")).toBeNull();
    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Email me a code"));
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(server.asked.filter((a) => a.path === CODE)).toHaveLength(0);
  });

  it("the server's refusal of the address, and a lost connection, are said in the box; nothing is kept", async () => {
    let answer: Route = () => refusal(400, "same_email", "That’s already your email address.");
    const server = fakeServer(routes({ [CODE]: (body) => answer(body) }));
    const store = await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Change email"));
    await fireEvent.changeText(await screen.findByLabelText("New email address"), RAVI.email);
    await fireEvent.press(screen.getByLabelText("Email me a code"));
    expect(await screen.findByText("That’s already your email address.")).toBeTruthy();

    answer = lost;
    await fireEvent.changeText(screen.getByLabelText("New email address"), NEW);
    await fireEvent.press(screen.getByLabelText("Email me a code"));
    expect(await screen.findByText(NO_ANSWER)).toBeTruthy();
    expect(keptUser(store)?.email).toBe(RAVI.email);
  });

  it.each([
    ["email_in_use", "That address already has an account. Sign in with it instead, or choose another address."],
    ["email_changed", "Your email address was changed on another device. Close this and check it."],
  ])("%s at the code step goes back to the address, filled in, with the server's sentence", async (error, words) => {
    const server = fakeServer(routes({ [CHANGE]: () => refusal(409, error, words) }));
    const store = await openSettings(server.ask);
    await upToTheCode();
    await fireEvent.changeText(screen.getByPlaceholderText("6-digit code"), "123456");
    await fireEvent.press(screen.getByLabelText("Confirm"));
    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.getByLabelText("New email address").props.value).toBe(NEW);
    expect(screen.queryByPlaceholderText("6-digit code")).toBeNull();
    expect(keptUser(store)?.email).toBe(RAVI.email);
  });

  it("Email me a new code asks again for the same address and says so; Cancel and open again starts empty", async () => {
    const server = fakeServer(routes());
    await openSettings(server.ask);
    await upToTheCode();
    await fireEvent.press(screen.getByLabelText("Email me a new code"));
    expect(await screen.findByText("We emailed you a new code.")).toBeTruthy();
    expect(server.asked.filter((a) => a.path === CODE).map((a) => a.body)).toEqual([{ email: NEW }, { email: NEW }]);

    await fireEvent.press(screen.getByLabelText("Cancel"));
    await fireEvent.press(await screen.findByLabelText("Change email"));
    await waitFor(() => {
      expect(screen.getByLabelText("New email address").props.value).toBe("");
    });
  });

  it("an address changed in the browser shows when Settings reads the account", async () => {
    const server = fakeServer(routes({ "/v1/users/me": ok(profile(true, { ...RAVI, email: NEW })) }));
    const store = await openSettings(server.ask);
    await waitFor(() => {
      expect(within(screen.getByTestId("settings-page")).getByText(NEW)).toBeTruthy();
    });
    expect(screen.queryByText(RAVI.email)).toBeNull();
    expect(keptUser(store)?.email).toBe(NEW);
  });
});

// ── Item 19's security pass, L2: past the third code of a day the server asks for the robot check ──

const KEY = "1x00000000000000000000AA";
const ASKS = "One quick check that you're not a robot, then we'll send your code.";
const { boxes } = jest.requireMock<{ boxes: { props: { onMessage: (event: { nativeEvent: { data: string; url: string } }) => void }; gone: boolean }[] }>("react-native-webview");
const answerBox = async (token: string) => {
  const open = boxes.filter((one) => !one.gone).at(-1);
  if (open === undefined) throw new Error("no robot check box is open");
  await act(() => {
    open.props.onMessage({ nativeEvent: { data: JSON.stringify({ kind: "token", token }), url: "http://localhost:3000/" } });
  });
};
/** The server's gate: no answer gets the check, a good one sends the code. */
const gate: Route = (body) => ((body as { robotToken?: string }).robotToken === "answer-1" ? sentCode() : refusal(403, "robot_check", ASKS, { robotCheckKey: KEY }));

describe("Change email's robot check", () => {
  beforeEach(() => {
    boxes.length = 0;
  });

  it("the check opens over the box, and its answer sends the code with no second press", async () => {
    const server = fakeServer(routes({ [CODE]: gate }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Change email"));
    await fireEvent.changeText(await screen.findByLabelText("New email address"), NEW);
    await fireEvent.press(screen.getByLabelText("Email me a code"));
    expect(await screen.findByText("Security check")).toBeTruthy();
    expect(screen.getByText(ASKS)).toBeTruthy();
    await answerBox("answer-1");
    expect(await screen.findByText("We emailed a 6-digit code to")).toBeTruthy();
    expect(screen.queryByText("Security check")).toBeNull();
    expect(server.asked.filter((a) => a.path === CODE).map((a) => a.body)).toEqual([{ email: NEW }, { email: NEW, robotToken: "answer-1" }]);
  });

  it("closed before it passed: the box says why, keeps the address, and Email me a code opens the check again", async () => {
    const server = fakeServer(routes({ [CODE]: gate }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Change email"));
    await fireEvent.changeText(await screen.findByLabelText("New email address"), NEW);
    const pageCloses = screen.queryAllByRole("button", { name: "Close" });
    await fireEvent.press(screen.getByLabelText("Email me a code"));
    await screen.findByText("Security check");
    // The check's own Close: the one the page did not have before it opened.
    const close = screen.getAllByRole("button", { name: "Close" }).find((one) => !pageCloses.includes(one));
    if (close === undefined) throw new Error("the check has no Close");
    await fireEvent.press(close);
    expect(await screen.findByText(ASKS)).toBeTruthy();
    expect(screen.getByLabelText("New email address").props.value).toBe(NEW);
    await fireEvent.press(screen.getByLabelText("Email me a code"));
    expect(await screen.findByText("Security check")).toBeTruthy();
  });
});
