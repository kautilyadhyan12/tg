import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState, StyleSheet, type AppStateStatus, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { App } from "../../src/App";
import type { AskGoogle, GoogleAnswer } from "../../src/session/google";
import { GOOGLE_FAILED, NO_ANSWER } from "../../src/screens/SignIn";
import { pictures } from "../../src/look/pictures";
import { DASHBOARD_READS } from "../../src/screens/Dashboard";
import { RAVI, fakeServer, kept, lost, memoryStore, refusal, tokens, type Route } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const DASHBOARD_PATHS: string[] = Object.values(DASHBOARD_READS).map((path) => path.split("?")[0] ?? path);

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
async function openApp(routes: Record<string, Route>, held: string | null = null, google?: AskGoogle) {
  const server = fakeServer(routes);
  const store = memoryStore(held);
  await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} {...(google === undefined ? {} : { google })} />);
  return { server, store };
}

const type = (field: string, words: string) => fireEvent.changeText(screen.getByLabelText(field), words);
const press = (button: string) => fireEvent.press(screen.getByRole("button", { name: button }));

async function askForCode(email = "ravi@example.com") {
  await screen.findByText("Get started.");
  await type("Email", email);
  await press("Continue");
}

interface Drawn {
  props: { children?: unknown; style?: StyleProp<ViewStyle & TextStyle> };
}
const drawn = (node: Drawn) => StyleSheet.flatten(node.props.style);

describe("the worst thing, on the screen", () => {
  it("opened with no internet, a signed-in person is on their tabs, never the sign-in screen", async () => {
    const { server, store } = await openApp({ "/health": lost, "/v1/auth/refresh": lost }, kept(1));
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    expect(screen.queryByText("Get started.")).toBeNull();
    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    expect(await screen.findByText("ravi@example.com")).toBeTruthy();
    // Every later try has had no answer either, and the person is where they were.
    // Four tries on opening; the Dashboard's reads, when they come after those, share four more.
    const refreshes = () => server.paths().filter((path) => path === "/v1/auth/refresh").length;
    await waitFor(() => {
      expect(refreshes()).toBeGreaterThanOrEqual(4);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect([4, 8]).toContain(refreshes());
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

describe("coming back to the app", () => {
  it("after ten minutes away a new token is asked for, so an older phone learns it was signed out; sooner, nothing", async () => {
    let heard: (next: AppStateStatus) => void = () => undefined;
    // For this opening of the app only: React Native's own stand-in is left as it was for the tests after.
    const listened = jest.spyOn(AppState, "addEventListener").mockImplementationOnce((_event, listener) => {
      heard = listener;
      return { remove: () => undefined };
    });
    const opened = 1_800_000_000_000;
    const clock = jest.spyOn(Date, "now").mockReturnValue(opened);
    try {
      let elsewhere = false;
      const { server, store } = await openApp(
        {
          "/v1/auth/refresh": () =>
            elsewhere
              ? refusal(401, "signed_in_elsewhere", "You were signed out because your account was signed in on another phone.")
              : { status: 200, body: { tokens: tokens(2) } },
        },
        kept(1),
      );
      const refreshes = () => server.paths().filter((path) => path === "/v1/auth/refresh");
      await screen.findByRole("tab", { name: "Dashboard" });
      await waitFor(() => {
        expect(refreshes()).toHaveLength(1);
      });
      expect(listened).toHaveBeenCalledWith("change", expect.any(Function));

      // Back after nine minutes, and the app going to the background: nothing is asked.
      clock.mockReturnValue(opened + 9 * 60 * 1000);
      await act(async () => {
        heard("active");
        heard("background");
        await Promise.resolve();
      });
      expect(refreshes()).toHaveLength(1);

      // Back after ten: asked, and this phone was signed out on another one meanwhile.
      elsewhere = true;
      clock.mockReturnValue(opened + 10 * 60 * 1000);
      await act(async () => {
        heard("active");
        await Promise.resolve();
      });
      expect(
        await screen.findByText("You were signed out because your account was signed in on another phone."),
      ).toBeTruthy();
      expect(refreshes()).toHaveLength(2);
      expect(store.value).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });
});

describe("signing in by email code", () => {
  it("a phone that holds no sign-in opens on Get started, with no tabs", async () => {
    const { server } = await openApp({});
    expect(await screen.findByText("Get started.")).toBeTruthy();
    expect(screen.getByText("Sign in or create your account")).toBeTruthy();
    // The browser's own picture, across the top.
    expect(screen.getByTestId("get-started-picture").props.source).toBe(pictures.getstarted);
    // Few words: the mark, the heading, one line, the box's own words, the two ways in and the terms.
    expect(screen.getAllByText(/./).map((line) => String(line.props.children))).toEqual([
      "AI Home Gym",
      "Get started.",
      "Sign in or create your account",
      "Continue",
      "or",
      "Continue with Google",
      "By continuing you agree to our Terms & Privacy Policy",
    ]);
    expect(screen.getByLabelText("Email").props.placeholder).toBe("Email address");
    expect(screen.queryAllByRole("tab")).toEqual([]);
    expect(server.asked).toEqual([]);
  });

  it("email, then the code, then the tabs; the sign-in is kept on the phone", async () => {
    const { server, store } = await openApp({ "/v1/auth/code/send": sent, "/v1/auth/code/verify": signsIn() });
    // Typed as people type it: the server is sent the address as it reads it.
    await askForCode("  Ravi@Example.com ");
    expect(await screen.findByText("ravi@example.com")).toBeTruthy();
    expect(screen.getByText("Check your email.")).toBeTruthy();
    expect(screen.queryByText("Get started.")).toBeNull();
    expect(screen.getByText("Enter the 6-digit code sent to")).toBeTruthy();
    await type("6-digit code", "12 34x56");
    expect(screen.getByLabelText("6-digit code").props.value).toBe("123456");
    await press("Continue");
    // On the Dashboard, greeted by name.
    expect(await screen.findByRole("header", { name: "Ravi" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Dashboard" }).props.accessibilityState).toEqual({ selected: true });
    // The Dashboard's own reads aside (test/screens/dashboard.test.tsx).
    const signingIn = server.asked.filter((one) => !DASHBOARD_PATHS.includes(one.path));
    expect(signingIn.map((one) => [one.path, one.body])).toEqual([
      ["/v1/auth/code/send", { email: "ravi@example.com" }],
      ["/v1/auth/code/verify", { email: "ravi@example.com", code: "123456", client: "phone" }],
      // "Before you start" is asked of the server, as the person signed in now.
      ["/v1/users/me", undefined],
      // Then what any gym has invited this address to, before the tabs.
      ["/v1/orgs/invitations", undefined],
      // Then whether setup is finished, before the tabs.
      ["/v1/users/me", undefined],
      // The profile once more, for the time zone the server keys the person's days in.
      ["/v1/users/me", undefined],
      // And the places the person is in, for the Gym tab's word.
      ["/v1/orgs/mine", undefined],
      // And again for the Dashboard's Your Rank, which gym.
      ["/v1/orgs/mine", undefined],
    ]);
    expect(signingIn.at(-1)?.headers.authorization).toBe("Bearer access-1");
    // The server said they ticked it, so the phone keeps that with the sign-in.
    expect(store.value).toBe(kept(1));
    await fireEvent.press(screen.getByRole("tab", { name: "Me" }));
    expect(await screen.findByText("ravi@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("a new address lands on the same Dashboard, greeted by name, with no box about its account", async () => {
    await openApp({ "/v1/auth/code/send": sent, "/v1/auth/code/verify": signsIn(true) });
    await askForCode();
    await type("6-digit code", "123456");
    await press("Continue");
    expect(await screen.findByRole("header", { name: "Ravi" })).toBeTruthy();
    expect(screen.getByText(/^Good (morning|afternoon|evening)$/)).toBeTruthy();
    expect(screen.queryByText(/account is ready/i)).toBeNull();
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
  ])("a code that cannot be sent (%s) says why, and stays on the email step", async (_name, route, line) => {
    await openApp({ "/v1/auth/code/send": route });
    await askForCode();
    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
    // The button can be pressed again.
    expect(screen.getByRole("button", { name: "Continue" }).props.accessibilityState).toEqual({ disabled: false, busy: false });
  });

  // Sign in, Sign out, the same address at once: the only code is the one that signed the
  // person in. Nothing was sent, so nothing says one was.
  it("asked again inside the minute: the code box opens, and never says a code was sent", async () => {
    let refused = true;
    await openApp({
      "/v1/auth/code/send": () =>
        refused
          ? refusal(429, "code_too_soon", "Please wait 1 seconds before asking for a new code.", { retryAfterSeconds: 1 })
          : { status: 200, body: { message: "Sent.", resendAfterSeconds: 60, expiresInSeconds: 600 } },
    });
    await askForCode();
    expect(await screen.findByLabelText("6-digit code")).toBeTruthy();
    expect(screen.getByText("Enter your code.")).toBeTruthy();
    expect(screen.getByText("You asked for a code less than a minute ago for")).toBeTruthy();
    expect(screen.getByText("Enter it, or resend when the countdown ends.")).toBeTruthy();
    expect(screen.queryByText("Check your email.")).toBeNull();
    expect(screen.queryByText(/sent/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Resend code in 1s" }).props.accessibilityState).toEqual({ disabled: true, busy: false });

    // The countdown over, "less than a minute ago" would be false, and is gone.
    expect(await screen.findByText("Enter the code you have for", {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText("Or resend for a new one.")).toBeTruthy();
    expect(screen.queryByText(/less than a minute ago/)).toBeNull();
    expect(screen.queryByText(/sent/i)).toBeNull();

    // A code that DID go out is the only thing that says so.
    refused = false;
    await press("Resend code");
    expect(await screen.findByText("Check your email.")).toBeTruthy();
    expect(screen.getByText("Enter the 6-digit code sent to")).toBeTruthy();
    expect(screen.getByText("New code sent.")).toBeTruthy();
  });

  it("a wrong code says what the server says and empties the box; no internet keeps the digits; the same digits refused after it are sent for a new code", async () => {
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
    // The same digits again, refused: the check that got no answer may have spent them at the
    // server, so the line sends the person for a new code, not to try these again.
    online = true;
    await press("Continue");
    expect(await screen.findByText("That code didn’t work. Resend code.")).toBeTruthy();
    // Other digits are only wrong, in the server's own words.
    await type("6-digit code", "333333");
    await press("Continue");
    expect(await screen.findByText("That code is wrong. You have 4 tries left.")).toBeTruthy();
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

describe("Continue with Google", () => {
  const NONCE = "f".repeat(64);
  const CLIENT = "our-app.apps.googleusercontent.com";
  const started: Route = () => ({ status: 200, body: { nonce: NONCE, clientId: CLIENT } });
  /** Google's box, answering as told, and what it was asked with. */
  const googleSays = (answer: GoogleAnswer) => {
    const asked: [string, string][] = [];
    const google: AskGoogle = (clientId, nonce) => {
      asked.push([clientId, nonce]);
      return Promise.resolve(answer);
    };
    return { google, asked };
  };

  it("the person's account from Google's box, then the tabs; the sign-in is kept on the phone", async () => {
    const { google, asked } = googleSays({ kind: "token", idToken: "google-answer" });
    const { server, store } = await openApp({ "/v1/auth/google/phone/start": started, "/v1/auth/google/phone": signsIn() }, null, google);
    await screen.findByText("Get started.");
    await press("Continue with Google");
    expect(await screen.findByRole("header", { name: "Ravi" })).toBeTruthy();
    // Google was asked with the server's own word and client id, and its answer went only to the server.
    expect(asked).toEqual([[CLIENT, NONCE]]);
    expect(server.asked.slice(0, 2).map((one) => [one.path, one.body])).toEqual([
      ["/v1/auth/google/phone/start", {}],
      ["/v1/auth/google/phone", { idToken: "google-answer" }],
    ]);
    expect(store.value).toBe(kept(1));
  });

  it("Google's box closed by the person: nothing is said and nobody is signed in", async () => {
    const { google } = googleSays({ kind: "closed" });
    const { server, store } = await openApp({ "/v1/auth/google/phone/start": started }, null, google);
    await screen.findByText("Get started.");
    await press("Continue with Google");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Continue with Google" }).props.accessibilityState).toMatchObject({ busy: false });
    });
    expect(server.paths()).not.toContain("/v1/auth/google/phone");
    expect(screen.queryByText(GOOGLE_FAILED)).toBeNull();
    expect(screen.getByText("Get started.")).toBeTruthy();
    expect(store.value).toBeNull();
  });

  it.each<[string, Record<string, Route>, GoogleAnswer, string]>([
    ["Google's box is broken on this phone", { "/v1/auth/google/phone/start": started }, { kind: "failed" }, GOOGLE_FAILED],
    [
      "the server refuses Google's answer",
      {
        "/v1/auth/google/phone/start": started,
        "/v1/auth/google/phone": () => refusal(401, "google_failed", "Google sign-in didn’t work. Try again, or sign in with your email."),
      },
      { kind: "token", idToken: "google-answer" },
      "Google sign-in didn’t work. Try again, or sign in with your email.",
    ],
    [
      "Google is not set up on the server",
      { "/v1/auth/google/phone/start": () => refusal(503, "google_not_configured", "Google sign-in isn’t available. Sign in with your email.") },
      { kind: "token", idToken: "google-answer" },
      "Google sign-in isn’t available. Sign in with your email.",
    ],
    ["no internet", { "/v1/auth/google/phone/start": lost }, { kind: "token", idToken: "google-answer" }, NO_ANSWER],
  ])("%s: the line under the button says so, and the email way still works", async (_name, routes, answer, words) => {
    const { google } = googleSays(answer);
    const { store } = await openApp(routes, null, google);
    await screen.findByText("Get started.");
    await press("Continue with Google");
    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" }).props.accessibilityState).toMatchObject({ disabled: false });
    expect(store.value).toBeNull();
  });

  it("Google's line goes once the email way is used, and does not come back with Use a different email", async () => {
    const { google } = googleSays({ kind: "failed" });
    await openApp({ "/v1/auth/google/phone/start": started, "/v1/auth/code/send": sent }, null, google);
    await screen.findByText("Get started.");
    await press("Continue with Google");
    await screen.findByText(GOOGLE_FAILED);
    await askForCode();
    await screen.findByLabelText("6-digit code");
    await press("Use a different email");
    await screen.findByLabelText("Email");
    expect(screen.queryByText(GOOGLE_FAILED)).toBeNull();
  });

  it("with no internet Google's box is never opened", async () => {
    const { google, asked } = googleSays({ kind: "token", idToken: "google-answer" });
    await openApp({ "/v1/auth/google/phone/start": lost }, null, google);
    await screen.findByText("Get started.");
    await press("Continue with Google");
    await screen.findByText(NO_ANSWER);
    expect(asked).toEqual([]);
  });
});
