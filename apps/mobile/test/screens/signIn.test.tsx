import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { App } from "../../src/App";
import { RAVI, fakeServer, kept, lost, memoryStore, refusal, tokens, type Route } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };

const sent: Route = () => ({
  status: 200,
  body: { message: "We emailed you a 6-digit code.", resendAfterSeconds: 60, expiresInSeconds: 600 },
});
const signsIn =
  (isNewAccount = false): Route =>
  () => ({ status: 200, body: { user: RAVI, isNewAccount, tokens: tokens(1) } });

/** A refresh with no answer is tried again at once here, so no test leaves a clock running. */
const noWait = () => Promise.resolve();

/** The app as a phone opens it: `held` is what its key store kept from last time. */
async function openApp(routes: Record<string, Route>, held: string | null = null) {
  const server = fakeServer(routes);
  const store = memoryStore(held);
  await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
  return { server, store };
}

const type = (field: string, words: string) => fireEvent.changeText(screen.getByLabelText(field), words);
const press = (button: string) => fireEvent.press(screen.getByRole("button", { name: button }));

async function askForCode(email = "ravi@example.com") {
  await screen.findByText("Get started.");
  await type("Email", email);
  await press("Continue with email");
}

interface Drawn {
  props: { children?: unknown; style?: StyleProp<ViewStyle & TextStyle> };
}
const drawn = (node: Drawn) => StyleSheet.flatten(node.props.style);

describe("the worst thing, on the screen", () => {
  it("opened with no internet, a signed-in person is on their tabs, never the sign-in screen", async () => {
    const { server, store } = await openApp({ "/health": lost, "/v1/auth/refresh": lost }, kept(1));
    expect(await screen.findByRole("header", { name: "Dashboard" })).toBeTruthy();
    expect(screen.queryByText("Get started.")).toBeNull();
    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    expect(await screen.findByText("ravi@example.com")).toBeTruthy();
    // Every later try has had no answer either, and the person is where they were.
    await waitFor(() => {
      expect(server.paths().filter((path) => path === "/v1/auth/refresh")).toHaveLength(4);
    });
    expect(screen.getByText("ravi@example.com")).toBeTruthy();
    expect(screen.queryByText("Get started.")).toBeNull();
    expect(store.value).toBe(kept(1));
  });

  it("after Sign out the screen holds nothing of the person, and neither does the phone", async () => {
    const { store, server } = await openApp(
      { "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }), "/v1/auth/logout": lost },
      kept(1),
    );
    await fireEvent.press(await screen.findByRole("tab", { name: "Me" }));
    await press("Sign out");
    // Nothing happens until the person says so in the box from the bottom.
    expect(screen.getByText("Sign out?")).toBeTruthy();
    expect(store.value).toBe(kept(2));
    await press("Cancel");
    expect(screen.queryByText("Sign out?")).toBeNull();
    expect(screen.getByText("ravi@example.com")).toBeTruthy();

    await press("Sign out");
    // The page's button and the box's: the box's is the one that signs out.
    const [onThePage, inTheBox, ...more] = screen.getAllByRole("button", { name: "Sign out" });
    if (onThePage === undefined || inTheBox === undefined || more.length > 0) throw new Error("two Sign out buttons were expected");
    await fireEvent.press(inTheBox);
    expect(await screen.findByText("Get started.")).toBeTruthy();
    expect(screen.getByText("You’re signed out.")).toBeTruthy();
    expect(screen.queryByText(/ravi/i)).toBeNull();
    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(store.value).toBeNull();
    expect(server.paths().at(-1)).toBe("/v1/auth/logout");
  });

  it("signed in on another phone: this one opens on the sign-in screen, says why, and shows nothing of the person", async () => {
    const { store } = await openApp(
      {
        "/v1/auth/refresh": () =>
          refusal(401, "signed_in_elsewhere", "You were signed out because your account was signed in on another phone."),
      },
      kept(1),
    );
    expect(
      await screen.findByText("You were signed out because your account was signed in on another phone."),
    ).toBeTruthy();
    expect(screen.getByText("Get started.")).toBeTruthy();
    expect(screen.queryByText(/ravi/i)).toBeNull();
    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(store.value).toBeNull();
  });
});

describe("signing in by email code", () => {
  it("a phone that holds no sign-in opens on Get started, with no tabs", async () => {
    const { server } = await openApp({});
    expect(await screen.findByText("Get started.")).toBeTruthy();
    expect(screen.getByText("Sign in or create your account — no password needed")).toBeTruthy();
    // The browser's own picture and its line, at the top.
    expect(screen.getByText("AI-Powered Training")).toBeTruthy();
    expect(screen.getByText("“Real-time form correction.\nEvery rep. Every set.”")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(server.asked).toEqual([]);
  });

  it("email, then the code, then the tabs; the sign-in is kept on the phone", async () => {
    const { server, store } = await openApp({ "/v1/auth/code/send": sent, "/v1/auth/code/verify": signsIn() });
    // Typed as people type it: the server is sent the address as it reads it.
    await askForCode("  Ravi@Example.com ");
    expect(await screen.findByText("ravi@example.com")).toBeTruthy();
    expect(screen.getByText("Enter the 6-digit code sent to")).toBeTruthy();
    await type("6-digit code", "12 34x56");
    expect(screen.getByLabelText("6-digit code").props.value).toBe("123456");
    await press("Continue");
    expect(await screen.findByRole("header", { name: "Dashboard" })).toBeTruthy();
    expect(screen.queryByText("Welcome! Your account is ready.")).toBeNull();
    expect(server.asked.map((one) => [one.path, one.body])).toEqual([
      ["/v1/auth/code/send", { email: "ravi@example.com" }],
      ["/v1/auth/code/verify", { email: "ravi@example.com", code: "123456", client: "phone" }],
    ]);
    expect(store.value).toBe(kept(1));
    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    expect(await screen.findByText("ravi@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("a new address is told its account is ready", async () => {
    await openApp({ "/v1/auth/code/send": sent, "/v1/auth/code/verify": signsIn(true) });
    await askForCode();
    await type("6-digit code", "123456");
    await press("Continue");
    expect(await screen.findByText("Welcome! Your account is ready.")).toBeTruthy();
  });

  it.each([
    ["nothing typed", "   ", "Enter your email address."],
    ["not an address", "ravi at example", "Enter a valid email address."],
  ])("%s: said under the box, and the server is asked nothing", async (_name, typed, line) => {
    const { server } = await openApp({ "/v1/auth/code/send": sent });
    await askForCode(typed);
    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
    expect(server.asked).toEqual([]);
  });

  it.each<[string, Route, string]>([
    ["no internet", lost, "Can’t connect. Check your internet and try again."],
    [
      "three codes already today",
      () => refusal(429, "code_limit", "You have asked for too many codes today. Try again in about 5 hours.", { retryAfterSeconds: 18_000 }),
      "You have asked for too many codes today. Try again in about 5 hours.",
    ],
    [
      "the email could not be sent",
      () => refusal(503, "code_send_failed", "We could not send the code. Please try again in a minute."),
      "We could not send the code. Please try again in a minute.",
    ],
    [
      "the server asks for the robot check, which this job's phone cannot show",
      () => refusal(403, "robot_check", "One quick check that you're not a robot, then we'll send your code.", { robotCheckKey: "0x4AAA" }),
      "Too many requests from this network. Try again later.",
    ],
  ])("a code that cannot be sent (%s) says why, and stays on the email step", async (_name, route, line) => {
    await openApp({ "/v1/auth/code/send": route });
    await askForCode();
    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
    // The button can be pressed again.
    expect(screen.getByRole("button", { name: "Continue with email" }).props.accessibilityState).toEqual({ disabled: false, busy: false });
  });

  it("asked again inside the minute: the code box opens for the code already sent, and Resend waits the server's time", async () => {
    await openApp({
      "/v1/auth/code/send": () =>
        refusal(429, "code_too_soon", "Please wait 42 seconds before asking for a new code.", { retryAfterSeconds: 42 }),
    });
    await askForCode();
    expect(await screen.findByLabelText("6-digit code")).toBeTruthy();
    expect(screen.getByText("Enter the 6-digit code sent to")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resend code in 42s" }).props.accessibilityState).toEqual({ disabled: true, busy: false });
  });

  it("a wrong code says what the server says and empties the box; no internet keeps the digits", async () => {
    let online = true;
    const { store } = await openApp({
      "/v1/auth/code/send": sent,
      "/v1/auth/code/verify": () =>
        online ? refusal(400, "invalid_code", "That code is wrong. You have 4 tries left.") : lost(),
    });
    await askForCode();
    await screen.findByLabelText("6-digit code");
    await press("Continue");
    expect(screen.getByText("Enter the 6-digit code.")).toBeTruthy();
    await type("6-digit code", "111111");
    await press("Continue");
    expect(await screen.findByText("That code is wrong. You have 4 tries left.")).toBeTruthy();
    expect(screen.getByLabelText("6-digit code").props.value).toBe("");
    online = false;
    await type("6-digit code", "222222");
    await press("Continue");
    expect(await screen.findByText("Can’t connect. Check your internet and try again.")).toBeTruthy();
    expect(screen.getByLabelText("6-digit code").props.value).toBe("222222");
    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(store.value).toBeNull();
  });

  it("Resend code waits out the server's minute, then sends and says so; Use a different email goes back", async () => {
    // The server's own wait is what the button counts: one second here, sixty in the app.
    const { server } = await openApp({
      "/v1/auth/code/send": () => ({ status: 200, body: { message: "Sent.", resendAfterSeconds: 1, expiresInSeconds: 600 } }),
    });
    await askForCode();
    const resend = () => screen.getByRole("button", { name: /^Resend code/ });
    expect((await screen.findByRole("button", { name: "Resend code in 1s" })).props.accessibilityState).toEqual({ disabled: true, busy: false });
    await fireEvent.press(resend());
    expect(server.paths()).toEqual(["/v1/auth/code/send"]);
    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: "Resend code" }).props.accessibilityState).toEqual({ disabled: false, busy: false });
      },
      { timeout: 4000 },
    );
    await press("Resend code");
    expect(await screen.findByText("New code sent.")).toBeTruthy();
    expect(server.paths()).toEqual(["/v1/auth/code/send", "/v1/auth/code/send"]);
    expect(screen.getByRole("button", { name: "Resend code in 1s" })).toBeTruthy();

    await press("Use a different email");
    expect(screen.getByLabelText("Email").props.value).toBe("ravi@example.com");
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
  });

  it("no drawn words are under 11, and nothing pressed or typed in is under 44 tall", async () => {
    await openApp({ "/v1/auth/code/send": sent });
    await askForCode();
    await screen.findByLabelText("6-digit code");
    const small = screen.getAllByText(/./).filter((line) => !((drawn(line).fontSize ?? 0) >= 11));
    expect(small.map((line: Drawn) => line.props.children)).toEqual([]);
    const pressed = [...screen.getAllByRole("button"), screen.getByLabelText("6-digit code")];
    expect(pressed).toHaveLength(4);
    expect(pressed.map((one) => Number(drawn(one).height ?? 0)).filter((height) => height < 44)).toEqual([]);
  });
});
