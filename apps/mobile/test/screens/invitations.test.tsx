import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { GYM_CAN_SEE, GYM_NEVER_SEES, GYM_SEES_IF_YOU_ALLOW, INVITATION_WORDS, WAIVER_AGREE_LABEL, WAIVER_WORDS } from "@app/shared";
import { App } from "../../src/App";
import { RAVI, fakeServer, kept, lost, memoryStore, refusal, tokens, type Route } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();

const IRON = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Pune", orgType: "gym" };
const LOTUS = { id: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a", name: "Lotus Yoga", city: null, orgType: "yoga_studio" };
const WAIVER = { id: "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b", version: 1, text: "I train at my own risk." };
const NEW_WAIVER = { id: "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c", version: 2, text: "I train at my own risk, and I tell staff about any injury." };

const invitation = (gym: typeof IRON | typeof LOTUS, more: object = {}) => ({
  id: gym === IRON ? "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d" : "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  state: "pending",
  gym,
  canTakeMembers: true,
  notMe: false,
  yourPlan: null,
  waiver: null,
  ...more,
});
const waiting = (...invitations: object[]): Route => () => ({
  status: 200,
  body: { address: RAVI.email, addressProved: true, invitations },
});
const org = (gym: typeof IRON | typeof LOTUS) => ({
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
const joinedTo = (gym: typeof IRON | typeof LOTUS): Reply => ({
  status: 200,
  body: { outcome: "joined", gym: { id: gym.id, slug: "iron-house", name: gym.name, orgType: gym.orgType }, featuresOn: true },
});
type Reply = Awaited<ReturnType<Route>>;

const accept = (id: string) => `/v1/orgs/invitations/${id}/accept`;
const decline = (id: string) => `/v1/orgs/invitations/${id}/decline`;
const notMe = (id: string) => `/v1/orgs/invitations/${id}/not-me`;
const IRON_ID = invitation(IRON).id;

/** Signed in by code just now: "Before you start" ticked, so the next thing is any invitation. */
async function signIn(routes: Record<string, Route>) {
  const server = fakeServer({
    "/v1/auth/code/send": () => ({ status: 200, body: { message: "We emailed you a 6-digit code.", resendAfterSeconds: 60, expiresInSeconds: 600 } }),
    "/v1/auth/code/verify": () => ({ status: 200, body: { user: RAVI, isNewAccount: false, tokens: tokens(1) } }),
    "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }),
    ...routes,
  });
  const store = memoryStore(null);
  await render(<App extra={extra} ask={server.ask} store={store} wait={noWait} />);
  await fireEvent.changeText(await screen.findByLabelText("Email"), RAVI.email);
  await press("Continue");
  await fireEvent.changeText(await screen.findByLabelText("6-digit code"), "123456");
  await press("Continue");
  return server;
}

/** Already signed in on this phone, opening on the Gym tab. */
async function openGym(routes: Record<string, Route>) {
  const server = fakeServer({ "/v1/auth/refresh": () => ({ status: 200, body: { tokens: tokens(2) } }), ...routes });
  await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
  await fireEvent.press(await gymTab());
  return server;
}

/** The fourth tab, whatever word the person's places give it. */
const gymTab = async () => {
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  return tab;
};
const press = (name: string) => fireEvent.press(screen.getByRole("button", { name }));
const answers = (server: { paths: () => string[] }) => server.paths().filter((path) => /\/(accept|decline|not-me)$/.test(path));
/** The invitation's View invitation, by the place's name: it opens the invitation to review. */
const review = async (gym: string) => fireEvent.press(await screen.findByRole("button", { name: `View invitation from ${gym}` }));
const disabled = (name: string): unknown => {
  const state: unknown = screen.getByRole("button", { name }).props.accessibilityState;
  return typeof state === "object" && state !== null && "disabled" in state ? state.disabled : undefined;
};

describe("the worst thing: nobody is put into a gym they did not press Join for, or without its waiver signed", () => {
  it("the invitation is listed, opening it answers nothing, and closing it answers nothing", async () => {
    const server = await signIn({ "/v1/orgs/invitations": waiting(invitation(IRON)) });
    expect(await screen.findByRole("header", { name: "You’re invited" })).toBeTruthy();
    expect(screen.getByText("Invited")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    await review("Iron House");
    expect(await screen.findByText("Iron House invited you to join as a member.")).toBeTruthy();
    await press("Close");
    expect(answers(server)).toEqual([]);
  });

  it("Not now goes on to the tabs and answers nothing", async () => {
    const server = await signIn({ "/v1/orgs/invitations": waiting(invitation(IRON)), [accept(IRON_ID)]: () => joinedTo(IRON) });
    await screen.findByRole("header", { name: "You’re invited" });
    await press("Not now");
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    expect(answers(server)).toEqual([]);
  });

  it.each([
    ["Decline", decline(IRON_ID), { state: "declined" }],
    ["This invitation isn’t for me", notMe(IRON_ID), { state: "declined", notMe: true }],
  ])("%s sends only its own answer, never a Join", async (button, path, body) => {
    const server = await signIn({
      "/v1/orgs/invitations": waiting(invitation(IRON)),
      [path]: () => ({ status: 200, body }),
      [accept(IRON_ID)]: () => joinedTo(IRON),
    });
    await review("Iron House");
    await press(button);
    await press("Close");
    expect(await screen.findByText("Declined")).toBeTruthy();
    await screen.findByRole("button", { name: "Continue" });
    expect(answers(server)).toEqual([path]);
  });

  it("with a waiver, Join does nothing until the name is typed and the box ticked, then sends both", async () => {
    const server = await signIn({
      "/v1/orgs/invitations": waiting(invitation(IRON, { waiver: WAIVER })),
      [accept(IRON_ID)]: () => joinedTo(IRON),
    });
    await review("Iron House");
    expect(await screen.findByText(WAIVER.text)).toBeTruthy();
    expect(screen.getByText("Written by Iron House")).toBeTruthy();
    expect(disabled("Join Iron House")).toBe(true);
    expect(screen.getByText("Enter your full name and tick the box to join.")).toBeTruthy();
    await press("Join Iron House");
    await fireEvent.changeText(screen.getByLabelText("Full name"), "  Ravi   Kumar ");
    expect(disabled("Join Iron House")).toBe(true);
    await fireEvent.press(screen.getByRole("checkbox", { name: WAIVER_AGREE_LABEL }));
    expect(answers(server)).toEqual([]);
    await press("Join Iron House");
    expect(await screen.findByText("You’re a member of Iron House.")).toBeTruthy();
    const sent = server.asked.filter((one) => one.path === accept(IRON_ID));
    expect(sent.map((one) => one.body)).toEqual([{ waiver: { id: WAIVER.id, name: "Ravi Kumar" } }]);
    expect(sent[0]?.headers.authorization).toBe("Bearer access-1");
  });

  it("a waiver the gym changed while it was open is shown again, unticked, and Join signs the new one", async () => {
    let reads = 0;
    const server = await signIn({
      "/v1/orgs/invitations": () => {
        reads += 1;
        return waiting(invitation(IRON, { waiver: reads === 1 ? WAIVER : NEW_WAIVER }))(undefined);
      },
      [accept(IRON_ID)]: (body) =>
        JSON.stringify(body).includes(NEW_WAIVER.id)
          ? joinedTo(IRON)
          : refusal(409, "waiver_changed", WAIVER_WORDS.waiver_changed("Iron House")),
    });
    await review("Iron House");
    await screen.findByText(WAIVER.text);
    await fireEvent.changeText(screen.getByLabelText("Full name"), "Ravi Kumar");
    await fireEvent.press(screen.getByRole("checkbox", { name: WAIVER_AGREE_LABEL }));
    await press("Join Iron House");
    expect(await screen.findByText(WAIVER_WORDS.waiver_changed("Iron House"))).toBeTruthy();
    expect(await screen.findByText(NEW_WAIVER.text)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: WAIVER_AGREE_LABEL }).props.accessibilityState).toMatchObject({ checked: false });
    expect(disabled("Join Iron House")).toBe(true);
    await fireEvent.press(screen.getByRole("checkbox", { name: WAIVER_AGREE_LABEL }));
    await press("Join Iron House");
    expect(await screen.findByText("You’re a member of Iron House.")).toBeTruthy();
    const bodies = server.asked.filter((one) => one.path === accept(IRON_ID)).map((one) => one.body);
    expect(bodies).toEqual([
      { waiver: { id: WAIVER.id, name: "Ravi Kumar" } },
      { waiver: { id: NEW_WAIVER.id, name: "Ravi Kumar" } },
    ]);
  });

  it("a gym that cannot take members has no Join, says so, and can still be declined", async () => {
    const server = await signIn({
      "/v1/orgs/invitations": waiting(invitation(IRON, { canTakeMembers: false })),
      [decline(IRON_ID)]: () => ({ status: 200, body: { state: "declined" } }),
    });
    await review("Iron House");
    expect(await screen.findByText(INVITATION_WORDS.gym_not_taking_members("Iron House", "gym"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join Iron House" })).toBeNull();
    await press("Decline");
    expect(await screen.findByText("You declined this invitation.")).toBeTruthy();
    expect(answers(server)).toEqual([decline(IRON_ID)]);
  });
});

describe("You're invited", () => {
  it("shows what the gym can see, only with the person's yes, and never: the browser's own lists", async () => {
    await signIn({ "/v1/orgs/invitations": waiting(invitation(IRON)) });
    await review("Iron House");
    expect(await screen.findByText("What Iron House can see")).toBeTruthy();
    expect(screen.getByText("Can see")).toBeTruthy();
    expect(screen.getByText("Only if you allow it")).toBeTruthy();
    expect(screen.getByText("Never")).toBeTruthy();
    for (const line of [...GYM_CAN_SEE, ...GYM_SEES_IF_YOU_ALLOW, ...GYM_NEVER_SEES]) expect(screen.getByText(line)).toBeTruthy();
    expect(screen.queryByText(/before you joined/)).toBeNull();
  });

  it("Join, Done, then Continue to the tabs; the person's place is on the Gym tab", async () => {
    let member = false;
    await signIn({
      "/v1/orgs/invitations": () => waiting(...(member ? [] : [invitation(IRON)]))(undefined),
      [accept(IRON_ID)]: () => {
        member = true;
        return joinedTo(IRON);
      },
      "/v1/orgs/mine": () => ({ status: 200, body: { orgs: member ? [org(IRON)] : [], formerOrgs: [] } }),
    });
    await review("Iron House");
    await press("Join Iron House");
    expect(await screen.findByText("Your gym's features are on.")).toBeTruthy();
    await press("Done");
    expect(await screen.findByText("Joined")).toBeTruthy();
    await press("Continue");
    await fireEvent.press(await gymTab());
    expect(await screen.findByRole("header", { name: "My gyms" })).toBeTruthy();
    expect(await screen.findByText("Iron House")).toBeTruthy();
    expect(screen.getByText("Gym · Pune")).toBeTruthy();
    expect(screen.queryByText("Invited")).toBeNull();
  });

  it.each([
    ["the gym is full", () => refusal(409, "gym_full", INVITATION_WORDS.gym_full("Iron House")), INVITATION_WORDS.gym_full("Iron House")],
    ["no internet", lost, "Can’t connect. Check your internet and try again."],
  ])("when %s, Join says so on the page and the person can go on", async (_, route, words) => {
    await signIn({ "/v1/orgs/invitations": waiting(invitation(IRON)), [accept(IRON_ID)]: route });
    await review("Iron House");
    await press("Join Iron House");
    expect(await screen.findByText(words)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Join Iron House" })).toBeTruthy();
    await press("Close");
    expect(screen.getByText("Invited")).toBeTruthy();
    await press("Not now");
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
  });

  it.each([
    ["the read fails", (): Reply => refusal(500, "internal", "Something went wrong.")],
    ["nothing is waiting", waiting()],
    ["only a declined invitation is open", waiting(invitation(IRON, { state: "declined" }))],
  ])("when %s, the tabs open with no stop", async (_, route) => {
    await signIn({ "/v1/orgs/invitations": route });
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    expect(screen.queryByText("You’re invited")).toBeNull();
  });

  it("two invitations, each answered on its own page", async () => {
    const lotusId = invitation(LOTUS).id;
    const server = await signIn({
      "/v1/orgs/invitations": waiting(invitation(IRON), invitation(LOTUS)),
      [accept(lotusId)]: () => joinedTo(LOTUS),
      [decline(IRON_ID)]: () => ({ status: 200, body: { state: "declined" } }),
    });
    expect(await screen.findByRole("header", { name: "You have 2 invitations" })).toBeTruthy();
    expect(screen.getByText("Yoga studio")).toBeTruthy();
    await review("Lotus Yoga");
    await press("Join Lotus Yoga");
    expect(await screen.findByText("You’re a member of Lotus Yoga.")).toBeTruthy();
    expect(screen.getByText("Your yoga studio's features are on.")).toBeTruthy();
    await press("Done");
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    await review("Iron House");
    await press("Decline");
    await press("Close");
    await fireEvent.press(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("tab", { name: "Dashboard" })).toBeTruthy();
    expect(answers(server)).toEqual([accept(lotusId), decline(IRON_ID)]);
  });
});

describe("an invitation opened again", () => {
  it("after Decline it opens declined, with Join and no Decline; after Join its row no longer opens", async () => {
    const lotusId = invitation(LOTUS).id;
    const server = await signIn({
      "/v1/orgs/invitations": waiting(invitation(IRON), invitation(LOTUS)),
      [accept(lotusId)]: () => joinedTo(LOTUS),
      [decline(IRON_ID)]: () => ({ status: 200, body: { state: "declined" } }),
    });
    await review("Iron House");
    await press("Decline");
    await press("Close");
    await review("Iron House");
    expect(await screen.findByText("You declined this invitation. You can still join.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.getByRole("button", { name: "Join Iron House" })).toBeTruthy();
    await press("Close");
    await review("Lotus Yoga");
    await press("Join Lotus Yoga");
    await fireEvent.press(await screen.findByRole("button", { name: "Done" }));
    expect(await screen.findByText("Joined")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View invitation from Lotus Yoga" })).toBeNull();
    expect(answers(server)).toEqual([decline(IRON_ID), accept(lotusId)]);
  });
});

describe("the Gym tab", () => {
  it("a person in no place sees their address; Check for an invitation asks again and says what to do", async () => {
    let reads = 0;
    await openGym({
      "/v1/orgs/invitations": () => {
        reads += 1;
        return waiting()(undefined);
      },
    });
    expect(await screen.findByRole("header", { name: "Where you train" })).toBeTruthy();
    expect(screen.getByText(RAVI.email)).toBeTruthy();
    expect(screen.queryByText(INVITATION_WORDS.no_invitation(RAVI.email))).toBeNull();
    const before = reads;
    await press("Check for an invitation");
    expect(await screen.findByText(INVITATION_WORDS.no_invitation(RAVI.email))).toBeTruthy();
    expect(reads).toBe(before + 1);
  });

  it("a yoga member reads 'My yoga studios', never gyms, with a declined invitation still open to Join", async () => {
    const server = await openGym({
      "/v1/orgs/mine": () => ({ status: 200, body: { orgs: [org(LOTUS)], formerOrgs: [] } }),
      "/v1/orgs/invitations": waiting(invitation(IRON, { state: "declined" })),
      [accept(IRON_ID)]: () => joinedTo(IRON),
    });
    expect(await screen.findByRole("header", { name: "My yoga studios" })).toBeTruthy();
    expect(screen.getByText("Lotus Yoga")).toBeTruthy();
    // The tab under its icon is a studio's, never "Gym".
    expect(await screen.findByRole("tab", { name: "Studio" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Gym" })).toBeNull();
    expect(await screen.findByText("Declined")).toBeTruthy();
    await review("Iron House");
    expect(await screen.findByText("You declined this invitation. You can still join.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    await press("Join Iron House");
    expect(await screen.findByText("You’re a member of Iron House.")).toBeTruthy();
    expect(answers(server)).toEqual([accept(IRON_ID)]);
  });

  it("a place that removed the person says so", async () => {
    await openGym({
      "/v1/orgs/mine": () => ({ status: 200, body: { orgs: [], formerOrgs: [{ ...org(IRON), removedAt: "2026-10-20T04:41:16.656Z" }] } }),
    });
    expect(await screen.findByText("You’re no longer a member of Iron House")).toBeTruthy();
  });

  it("a sign-in that has not proved the address is asked to sign in again, and Sign in again signs out", async () => {
    await openGym({
      "/v1/orgs/invitations": () => ({ status: 200, body: { address: RAVI.email, addressProved: false, invitations: [] } }),
      "/v1/auth/logout": () => ({ status: 200, body: { ok: true } }),
    });
    expect(await screen.findByText(INVITATION_WORDS.address_not_proved(RAVI.email))).toBeTruthy();
    expect(screen.queryByText("Check for an invitation")).toBeNull();
    await press("Sign in again");
    await waitFor(() => {
      expect(screen.queryAllByRole("tab")).toHaveLength(0);
    });
  });

  it("with no internet it says so, and Try again reads again", async () => {
    let up = false;
    const down: Route = () => {
      if (!up) throw new TypeError("Network request failed");
      return { status: 200, body: { orgs: [org(IRON)], formerOrgs: [] } };
    };
    await openGym({ "/v1/orgs/mine": down, "/v1/orgs/invitations": () => (up ? waiting()(undefined) : lost()) });
    expect(await screen.findByText("Can’t connect. Check your internet and try again.")).toBeTruthy();
    up = true;
    await press("Try again");
    expect(await screen.findByText("Iron House")).toBeTruthy();
    expect(screen.getByRole("header", { name: "My gyms" })).toBeTruthy();
  });
});
