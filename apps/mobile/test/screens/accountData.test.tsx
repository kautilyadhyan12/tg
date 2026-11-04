import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, Linking } from "react-native";
import { SIGNED_IN_ELSEWHERE } from "@app/shared";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { App } from "../../src/App";
import { NO_ANSWER } from "../../src/screens/SignIn";
import { deletesOnText, deletedNote, namesText } from "../../src/screens/Settings";
import type { Ask } from "../../src/session/calls";
import { RAVI, fakeServer, kept, lost, memoryStore, profile, refusal, tokens, type Reply, type Route } from "../kit";

// Settings' Your data (ROADMAP Stage 5 item 19b): Download my data, and Delete account with the
// emailed code; the undo is the link in the email, on the website's own page.

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

const ME = "/v1/users/me";
const CODE = "/v1/users/me/delete-code";
const EXPORT = "/v1/users/me/export";
const ANOTHER = "0e4f1d2c-3b4a-4596-8a7b-6c5d4e3f2a1b";
const place = (name: string, more: object) => ({
  id: name === "Iron House" ? "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f" : "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
  name,
  city: null,
  orgType: "gym",
  clockFormat: "12h",
  slug: name.toLowerCase().replace(" ", "-"),
  timezone: "Asia/Kolkata",
  locale: "en",
  currencyDisplay: "INR",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
  ...more,
});
const IRON = place("Iron House", {});
// The gym's own owner: the server sends the website's page where they delete their account (19b-ii).
const PULSE_ACCOUNT = "http://localhost:5173/console/pulse-studio/account";
const PULSE = place("Pulse Studio", { staffRole: "owner", isMember: false, handOver: { url: PULSE_ACCOUNT, askedName: null } });
const ON_THE_WEB = "You own Pulse Studio. Delete your account on our website, where you manage your gym.";
// A co-owner is removed from the gym on deleting; only the gym's own owner stays.
const LOTUS = place("Lotus Yoga", { id: "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b", staffRole: "owner", coOwner: true, isMember: false });
const sentCode = ok({ message: "We emailed you a 6-digit code.", resendAfterSeconds: 60, expiresInSeconds: 600 });
const deleted = (emailSent: boolean) => ok({ message: "Account scheduled for deletion.", emailSent });
const anExport = (userId: string) => ({
  exportedAt: "2026-11-04T06:00:00.000Z",
  schemaVersion: 2,
  user: { id: userId, email: RAVI.email, display_name: RAVI.displayName },
  data: { meal_logs: [{ id: "m1", name: "Poha" }] },
  truncated: {},
});

/** `/v1/users/me` reads the profile; with a code in the body it is the DELETE. */
const me = (onDelete: Route): Route => (body) =>
  body !== undefined && typeof body === "object" && body !== null && "code" in body ? onDelete(body) : { status: 200, body: profile(true) };

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
  "/v1/orgs/mine": ok({ orgs: [IRON], formerOrgs: [] }),
  [CODE]: sentCode,
  ...over,
});

/** As far as the code: Delete account, Email me a code, the six digits typed. */
async function upToTheCode(code = "123456") {
  await fireEvent.press(await screen.findByLabelText("Delete account"));
  await fireEvent.press(await screen.findByLabelText("Email me a code"));
  await fireEvent.changeText(await screen.findByPlaceholderText("6-digit code"), code);
}

const write = (name: string, text: string) => {
  const file = new File(Paths.document, name);
  file.create();
  file.write(text);
};

afterEach(() => {
  for (const one of [...Paths.document.list(), ...Paths.cache.list()]) one.delete();
  jest.mocked(Sharing.shareAsync).mockClear();
});

describe("Delete account (the worst thing: after deleting, the phone still shows or keeps the person, or stays signed in)", () => {
  it("signs out, keeps nothing of the person, leaves another person's waiting meals, and says when and how to undo", async () => {
    write(`meals-${RAVI.id}.json`, '{"meals":["Poha"]}');
    write(`photo-meal-${RAVI.id}.json`, '{"photo":"x"}');
    const draft = new Directory(Paths.document, `post-draft-${RAVI.id}-${IRON.id}`);
    draft.create();
    new File(draft, "post.json").create();
    write(`meals-${ANOTHER}.json`, '{"meals":["Idli"]}');
    // The copy of a download handed to the Share box earlier, and another person's.
    const exported = new Directory(Paths.cache, `export-${RAVI.id}`);
    exported.create();
    new File(exported, "aihomegym-export-2026-11-01.json").create();
    const theirs = new Directory(Paths.cache, `export-${ANOTHER}`);
    theirs.create();
    const server = fakeServer(routes({ [ME]: me(deleted(true)) }));
    const store = await openSettings(server.ask);
    await upToTheCode();
    await fireEvent.press(screen.getByLabelText("Delete"));

    expect(await screen.findByText(deletedNote(true, new Date()))).toBeTruthy();
    expect(screen.queryByTestId("settings-page")).toBeNull();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(store.value).toBeNull();
    expect(new File(Paths.document, `meals-${RAVI.id}.json`).exists).toBe(false);
    expect(new File(Paths.document, `photo-meal-${RAVI.id}.json`).exists).toBe(false);
    expect(draft.exists).toBe(false);
    expect(new File(Paths.document, `meals-${ANOTHER}.json`).exists).toBe(true);
    expect(exported.exists).toBe(false);
    expect(new File(exported, "aihomegym-export-2026-11-01.json").exists).toBe(false);
    // With nobody signed in no download's copy stays, anyone's: it is only ever a copy (their waiting meals stay).
    expect(theirs.exists).toBe(false);
    // The code went with the DELETE, and the server ended the sign-in itself: no Sign out is owed.
    expect(server.asked.filter((a) => a.path === ME && a.method === "DELETE").map((a) => a.body)).toEqual([{ code: "123456" }]);
    expect(server.paths()).not.toContain("/v1/auth/logout");
  });

  it("a wrong code keeps the box open with the server's words, and the person signed in", async () => {
    const server = fakeServer(routes({ [ME]: me(() => refusal(400, "invalid_code", "That code didn’t work. Try again.")) }));
    const store = await openSettings(server.ask);
    await upToTheCode("000000");
    await fireEvent.press(screen.getByLabelText("Delete"));
    expect(await screen.findByText("That code didn’t work. Try again.")).toBeTruthy();
    expect(screen.getByPlaceholderText("6-digit code").props.value).toBe("");
    expect(screen.getByTestId("settings-page")).toBeTruthy();
    expect(store.value).not.toBeNull();
  });

  it("with no answer it says so and deletes nothing on the phone", async () => {
    write(`meals-${RAVI.id}.json`, '{"meals":["Poha"]}');
    const server = fakeServer(routes({ [ME]: me(lost) }));
    const store = await openSettings(server.ask);
    await upToTheCode();
    await fireEvent.press(screen.getByLabelText("Delete"));
    expect(await screen.findByText(NO_ANSWER)).toBeTruthy();
    expect(store.value).not.toBeNull();
    expect(new File(Paths.document, `meals-${RAVI.id}.json`).exists).toBe(true);
  });

  it("a reply lost after the server deleted still leaves nothing of the person, and says the day", async () => {
    write(`meals-${RAVI.id}.json`, '{"meals":["Poha"]}');
    let gone = false;
    const server = fakeServer(
      routes({
        [ME]: (body) => {
          if (body !== undefined && typeof body === "object" && body !== null && "code" in body) {
            gone = true; // deleted, and every sign-in ended; the reply never arrives
            return lost();
          }
          return gone ? refusal(401, "unauthorized", "Sign in again.") : { status: 200, body: profile(true) };
        },
        "/v1/auth/refresh": () => (gone ? refusal(401, "unauthorized", "Sign in again.") : { status: 200, body: { tokens: tokens(2) } }),
      }),
    );
    const store = await openSettings(server.ask);
    await upToTheCode();
    await fireEvent.press(screen.getByLabelText("Delete"));
    expect(await screen.findByText(deletedNote(false, new Date()))).toBeTruthy();
    expect(store.value).toBeNull();
    expect(new File(Paths.document, `meals-${RAVI.id}.json`).exists).toBe(false);
  });

  it.each([
    ["signed in on another phone", SIGNED_IN_ELSEWHERE.error, SIGNED_IN_ELSEWHERE.message],
    ["a sign-in that simply ended", "invalid_refresh", "Your session ended. Sign in again."],
  ])("a sign-in turned away before the DELETE was read (%s) deletes nothing on the phone and says why", async (_case, error, note) => {
    write(`meals-${RAVI.id}.json`, '{"meals":["Poha"]}');
    let turnedAway = false;
    const server = fakeServer(
      routes({
        [ME]: (body) => {
          if (body !== undefined && typeof body === "object" && body !== null && "code" in body) {
            turnedAway = true; // the access key ran out; the server never read the DELETE
            return refusal(401, "unauthorized", "Sign in again.");
          }
          return { status: 200, body: profile(true) };
        },
        "/v1/auth/refresh": () => (turnedAway ? refusal(401, error, "Sign in again.") : { status: 200, body: { tokens: tokens(2) } }),
      }),
    );
    await openSettings(server.ask);
    await upToTheCode();
    await fireEvent.press(screen.getByLabelText("Delete"));
    expect(await screen.findByText(note)).toBeTruthy();
    expect(screen.queryByText(/will be deleted on/)).toBeNull();
    expect(new File(Paths.document, `meals-${RAVI.id}.json`).exists).toBe(true);
  });

  it("a DELETE with no reply, then a sign-in on another phone, deletes nothing on the phone and says why", async () => {
    write(`meals-${RAVI.id}.json`, '{"meals":["Poha"]}');
    let elsewhere = false;
    const server = fakeServer(
      routes({
        [ME]: (body) => {
          if (body !== undefined && typeof body === "object" && body !== null && "code" in body) {
            elsewhere = true; // no reply; meanwhile the person signs in on another phone
            return lost();
          }
          return elsewhere ? refusal(401, "unauthorized", "Sign in again.") : { status: 200, body: profile(true) };
        },
        "/v1/auth/refresh": () =>
          elsewhere ? refusal(401, SIGNED_IN_ELSEWHERE.error, SIGNED_IN_ELSEWHERE.message) : { status: 200, body: { tokens: tokens(2) } },
      }),
    );
    await openSettings(server.ask);
    await upToTheCode();
    await fireEvent.press(screen.getByLabelText("Delete"));
    expect(await screen.findByText(SIGNED_IN_ELSEWHERE.message)).toBeTruthy();
    expect(screen.queryByText(/will be deleted on/)).toBeNull();
    expect(new File(Paths.document, `meals-${RAVI.id}.json`).exists).toBe(true);
  });

  it("a meal written while the sign-in is being forgotten is removed too", async () => {
    // The key store is cleared in the middle of forgetting the person: a write already on its way lands then.
    const store = memoryStore(kept(1));
    store.clear = () => {
      store.value = null;
      write(`meals-${RAVI.id}.json`, '{"meals":["late"]}');
      return Promise.resolve();
    };
    const server = fakeServer(routes({ [ME]: me(deleted(true)) }));
    await openSettings(server.ask, store);
    await upToTheCode();
    await fireEvent.press(screen.getByLabelText("Delete"));
    expect(await screen.findByText(deletedNote(true, new Date()))).toBeTruthy();
    expect(new File(Paths.document, `meals-${RAVI.id}.json`).exists).toBe(false);
  });

  it("Delete waits for all six digits", async () => {
    const server = fakeServer(routes({ [ME]: me(deleted(true)) }));
    await openSettings(server.ask);
    await upToTheCode("12345");
    expect(screen.getByRole("button", { name: "Delete" }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByLabelText("Email me a new code"));
    expect(await screen.findByText("We emailed you a new code.")).toBeTruthy();
    expect(server.asked.filter((a) => a.method === "DELETE")).toEqual([]);
  });

  it("never says an email was sent when the server says none went", async () => {
    const server = fakeServer(routes({ [ME]: me(deleted(false)) }));
    await openSettings(server.ask);
    await upToTheCode();
    await fireEvent.press(screen.getByLabelText("Delete"));
    expect(await screen.findByText(deletedNote(false, new Date()))).toBeTruthy();
    expect(screen.queryByText(/link we emailed/)).toBeNull();
  });

  it("names the places the person leaves, a co-owned one among them, and sends no code until asked", async () => {
    const server = fakeServer(routes({ [ME]: me(deleted(true)), "/v1/orgs/mine": ok({ orgs: [IRON, LOTUS], formerOrgs: [] }) }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Delete account"));
    expect(await screen.findByText("You leave Iron House and Lotus Yoga today. To come back later, ask them to add you again.")).toBeTruthy();
    expect(screen.getByLabelText("Email me a code")).toBeTruthy();
    expect(server.paths()).not.toContain(CODE);
    await fireEvent.press(screen.getByLabelText("Cancel"));
    expect(server.paths()).not.toContain(CODE);
  });

  it("THE OWNER (19b-ii): a gym's own owner is sent to the website to delete their account, never asked for a code here; a co-owner of another gym is not why", async () => {
    const opened = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const server = fakeServer(routes({ "/v1/orgs/mine": ok({ orgs: [IRON, PULSE, LOTUS], formerOrgs: [] }) }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Delete account"));
    expect(await screen.findByText(ON_THE_WEB)).toBeTruthy();
    expect(screen.queryByLabelText("Email me a code")).toBeNull();
    expect(screen.queryByText(/Lotus Yoga/)).toBeNull();
    await fireEvent.press(screen.getByLabelText("Open the website"));
    expect(opened).toHaveBeenCalledWith(PULSE_ACCOUNT);
    expect(server.paths()).not.toContain(CODE);
    expect(server.asked.filter((a) => a.method === "DELETE")).toEqual([]);
    opened.mockRestore();
  });

  it("an owner of two gyms is told both, and the website opens once", async () => {
    const lotus = { ...LOTUS, coOwner: false, handOver: { url: "http://localhost:5173/console/lotus-yoga/account", askedName: null } };
    const opened = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const server = fakeServer(routes({ "/v1/orgs/mine": ok({ orgs: [PULSE, lotus], formerOrgs: [] }) }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Delete account"));
    expect(await screen.findByText("You own Pulse Studio and Lotus Yoga. Delete your account on our website, where you manage them.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Open the website"));
    expect(opened).toHaveBeenCalledWith(PULSE_ACCOUNT);
    expect(opened).toHaveBeenCalledTimes(1);
    opened.mockRestore();
  });

  it("a website that will not open is said in the box", async () => {
    const opened = jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("No app"));
    const server = fakeServer(routes({ "/v1/orgs/mine": ok({ orgs: [PULSE], formerOrgs: [] }) }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Delete account"));
    await fireEvent.press(await screen.findByLabelText("Open the website"));
    expect(await screen.findByText("Couldn’t open the browser.")).toBeTruthy();
    opened.mockRestore();
  });

  it("an owner the phone did not know of reads the server's refusal, and the box turns to the website's", async () => {
    let owns = false;
    const server = fakeServer(
      routes({
        "/v1/orgs/mine": () => ({ status: 200, body: { orgs: owns ? [IRON, PULSE] : [IRON], formerOrgs: [] } }),
        [CODE]: () => refusal(409, "owns_gym", "You own Pulse Studio. Before you delete your account, make someone else its owner."),
      }),
    );
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Delete account"));
    owns = true;
    await fireEvent.press(await screen.findByLabelText("Email me a code"));
    expect(await screen.findByText(ON_THE_WEB)).toBeTruthy();
    expect(await screen.findByLabelText("Open the website")).toBeTruthy();
    expect(screen.queryByLabelText("Email me a code")).toBeNull();
    expect(screen.queryByPlaceholderText("6-digit code")).toBeNull();
  });

  it("with the places not loaded, it still says the person leaves them", async () => {
    const server = fakeServer(routes({ "/v1/orgs/mine": () => refusal(500, "internal", "Something went wrong.") }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Delete account"));
    expect(await screen.findByText("You leave the places you’re a member of today.")).toBeTruthy();
  });

  it("a code refused by the server's limit says why and stays on the first step", async () => {
    const server = fakeServer(routes({ [CODE]: () => refusal(429, "code_too_soon", "Wait a minute before asking for another code.") }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Delete account"));
    await fireEvent.press(await screen.findByLabelText("Email me a code"));
    expect(await screen.findByText("Wait a minute before asking for another code.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("6-digit code")).toBeNull();
  });
});

describe("Download my data", () => {
  const NAME = "aihomegym-export-2026-11-04.json";
  const shared = () => jest.mocked(Sharing.shareAsync).mock.calls.map(([uri]) => uri);

  it("hands the server's file of the person's data to the phone's Share box, and says so in place", async () => {
    const server = fakeServer(routes({ [EXPORT]: ok(anExport(RAVI.id)) }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Download my data"));
    expect(await screen.findByText(`Your file is ${NAME}.`)).toBeTruthy();
    expect(shared()).toEqual([`cache/export-${RAVI.id}/${NAME}`]);
    expect(JSON.parse(await new File(`cache/export-${RAVI.id}/${NAME}`).text())).toEqual(anExport(RAVI.id));
  });

  it("never hands over a file that is not the signed-in person's", async () => {
    const server = fakeServer(routes({ [EXPORT]: ok(anExport(ANOTHER)) }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Download my data"));
    expect(await screen.findByText(NO_ANSWER)).toBeTruthy();
    expect(shared()).toEqual([]);
    expect(Paths.cache.list()).toEqual([]);
  });

  it("hands over nothing when the person signs out while the file is on its way", async () => {
    let send: (reply: Reply) => void = () => undefined;
    const server = fakeServer(routes({ [EXPORT]: () => new Promise<Reply>((resolve) => { send = resolve; }), "/v1/auth/logout": ok({}) }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Download my data"));
    await fireEvent.press(screen.getAllByLabelText("Close")[0] ?? screen.getByLabelText("Close"));
    await fireEvent.press(await screen.findByRole("button", { name: "Sign out" }));
    const inTheBox = screen.getAllByRole("button", { name: "Sign out" })[1];
    if (inTheBox === undefined) throw new Error("the box's Sign out was expected");
    await fireEvent.press(inTheBox);
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    send({ status: 200, body: anExport(RAVI.id) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shared()).toEqual([]);
    expect(Paths.cache.list()).toEqual([]);
  });

  it("signing out removes the copy handed to the Share box", async () => {
    const server = fakeServer(routes({ [EXPORT]: ok(anExport(RAVI.id)), "/v1/auth/logout": ok({}) }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Download my data"));
    expect(await screen.findByText(`Your file is ${NAME}.`)).toBeTruthy();
    expect(new File(`cache/export-${RAVI.id}/${NAME}`).exists).toBe(true);
    await fireEvent.press(screen.getAllByLabelText("Close")[0] ?? screen.getByLabelText("Close"));
    await fireEvent.press(await screen.findByRole("button", { name: "Sign out" }));
    const inTheBox = screen.getAllByRole("button", { name: "Sign out" })[1];
    if (inTheBox === undefined) throw new Error("the box's Sign out was expected");
    await fireEvent.press(inTheBox);
    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(new File(`cache/export-${RAVI.id}/${NAME}`).exists).toBe(false);
  });

  it("a refusal shows the server's words and shares nothing", async () => {
    const server = fakeServer(routes({ [EXPORT]: () => refusal(429, "rate_limited", "You've requested several exports recently. Please try again later.") }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Download my data"));
    expect(await screen.findByText("You've requested several exports recently. Please try again later.")).toBeTruthy();
    expect(shared()).toEqual([]);
  });

  it("says so on a phone that cannot share files, and when the Share box fails", async () => {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
    const server = fakeServer(routes({ [EXPORT]: ok(anExport(RAVI.id)) }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Download my data"));
    expect(await screen.findByText("This phone can’t share files.")).toBeTruthy();
    expect(shared()).toEqual([]);
    jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(new Error("no activity"));
    await fireEvent.press(screen.getByLabelText("Download my data"));
    expect(await screen.findByText("Couldn’t make the file. Try again.")).toBeTruthy();
  });
});

describe("the words", () => {
  it("the day is fourteen days on, across a month and a year", () => {
    expect(deletesOnText(new Date(2026, 10, 4, 23, 30))).toBe("18 November");
    expect(deletesOnText(new Date(2026, 11, 25, 0, 5))).toBe("8 January");
    expect(deletesOnText(new Date(2027, 1, 20))).toBe("6 March");
  });

  it("names are joined as a sentence says them", () => {
    expect(namesText(["Iron House"])).toBe("Iron House");
    expect(namesText(["Iron House", "Pulse"])).toBe("Iron House and Pulse");
    expect(namesText(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("back from the browser (19b-ii)", () => {
  it("once the new owner has accepted, the box reads the places again and asks for the code as for anybody", async () => {
    const listeners: ((state: string) => void)[] = [];
    // The last test of the file: put back mid-file, this breaks every later render.
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listeners.push(handler as (state: string) => void);
      return { remove: () => undefined };
    });
    let handedOver = false;
    const coOwner = { ...PULSE, coOwner: true, handOver: undefined };
    const server = fakeServer(routes({ "/v1/orgs/mine": () => ({ status: 200, body: { orgs: [handedOver ? coOwner : PULSE], formerOrgs: [] } }) }));
    await openSettings(server.ask);
    await fireEvent.press(await screen.findByLabelText("Delete account"));
    expect(await screen.findByLabelText("Open the website")).toBeTruthy();
    handedOver = true;
    await act(() => {
      for (const listener of listeners) listener("active");
    });
    expect(await screen.findByText("You leave Pulse Studio today. To come back later, ask them to add you again.")).toBeTruthy();
    expect(screen.getByLabelText("Email me a code")).toBeTruthy();
    expect(screen.queryByLabelText("Open the website")).toBeNull();
  });
});
