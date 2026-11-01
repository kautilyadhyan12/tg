import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState } from "react-native";
import { gymChallengesResponseSchema, gymPostsResponseSchema, memberGymChallengeSchema } from "@app/shared";
import { App } from "../../src/App";
import { NO_ANSWER } from "../../src/screens/SignIn";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

type Place = { id: string; name: string };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House" };
const LOTUS: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Lotus Yoga" };
const org = (gym: Place) => ({
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
const mine = (...gyms: Place[]) => ok({ orgs: gyms.map(org), formerOrgs: [] });

const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const ME = "33333333-3333-4333-8333-333333333333";
const PRIYA = "44444444-4444-4444-8444-444444444444";
const ASHA = "55555555-5555-4555-8555-555555555555";
const RAVI = "66666666-6666-4666-8666-666666666666";
const T1 = "77777777-7777-4777-8777-777777777777";
const T2 = "88888888-8888-4888-8888-888888888888";

type Over = Record<string, unknown>;
const WORDS = { about: "Visits", one: "visit", many: "visits", print: "whole", how: "desk", howLine: "Checked in at the front desk", explain: "A visit counts when the front desk checks you in.", perDay: true };
const row = (userId: string, name: string, place: number, value: number, over: Over = {}) => ({ userId, name, initials: name.charAt(0), place, value, reached: false, isMe: false, ...over });
const board = (over: Over = {}) => ({ status: "shown", ranked: 3, top: [row(PRIYA, "Priya S.", 1, 9), row(ASHA, "Asha K.", 2, 7), row(RAVI, "Ravi M.", 3, 5)], leaders: 1, reached: null, ...over });
const me = (over: Over = {}) => ({ value: 4, place: 4, hidden: null, toNextPlace: 2, nextPlace: 3, reached: false, days: [], ...over });
const challenge = (id: string, name: string, over: Over = {}) =>
  memberGymChallengeSchema.parse({
    id,
    name,
    details: "",
    prize: "",
    subject: "visits",
    measure: null,
    countedBy: "app",
    exercises: [],
    words: WORDS,
    startsOn: "2099-11-01",
    endsOn: "2099-11-20",
    target: null,
    who: "everyone",
    unit: "",
    lowestWins: false,
    teams: "none",
    cancelled: false,
    state: "running",
    joined: false,
    can: { join: false, leave: false, pick: false },
    teamBoard: null,
    joinedCount: null,
    board: board(),
    me: me(),
    ...over,
  });
const listOf = (place: Place, challenges: unknown[], over: Over = {}) =>
  gymChallengesResponseSchema.parse({
    gymId: place.id,
    gymName: place.name,
    timezone: "Asia/Kolkata",
    today: "2099-11-10",
    status: "shown",
    checkingIn: true,
    challenges,
    asOf: "2099-11-10T05:00:00.000Z",
    ...over,
  });
const pathOf = (place: Place) => `/v1/orgs/${place.id}/challenges`;
const joinedOf = (place: Place, id: string) => `${pathOf(place)}/${id}/joined`;
const teamOf = (place: Place, id: string) => `${pathOf(place)}/${id}/team`;
const boardOf = (place: Place, id: string) => `${pathOf(place)}/${id}/board`;
const boardReply = (id: string, over: Over = {}) => ({ challengeId: id, status: "shown", ranked: 3, rows: board().top, me: me(), asOf: "2099-11-10T05:00:00.000Z", ...over });

const joinable = (over: Over = {}) => ({ who: "joined", joinedCount: 2, me: null, can: { join: true, leave: false, pick: false }, ...over });
const joinedOne = (over: Over = {}) => ({ who: "joined", joinedCount: 3, joined: true, me: me(), can: { join: false, leave: true, pick: false }, ...over });

async function openChallenges(ask: Ask, place: Place) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`Challenges at ${place.name}`));
}
const openOne = async (name: string) => {
  await fireEvent.press(await screen.findByLabelText(new RegExp(`^${name}\\.`)));
};
let handlers: ((state: "active") => void)[] = [];
const comeBack = () => {
  for (const handler of handlers) handler("active");
};
beforeEach(() => {
  handlers = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
    handlers.push(handler);
    return { remove: () => undefined };
  });
});
const onePage = () => within(screen.getByTestId("challenge-page"));
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));

const routes = (place: Place, list: unknown, more: Record<string, (body: unknown) => Reply | Promise<Reply>> = {}) => ({
  "/v1/auth/refresh": ok({ tokens: tokens(2) }),
  "/v1/orgs/mine": mine(place),
  [pathOf(place)]: ok(list),
  ...more,
});

describe("the worst thing: somebody shown who is hidden, or a win or a join the server does not hold", () => {
  it("names on the page are only the ones the server sent: nobody else, and never the member's own name as a rival", async () => {
    const server = fakeServer(routes(IRON, listOf(IRON, [challenge(C1, "October Six", { board: board({ top: [row(ME, "Hidden Me", 1, 9, { isMe: true }), row(PRIYA, "Priya S.", 2, 7)] }) })])));
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    expect(await screen.findByLabelText("1st: you, 9 visits")).toBeTruthy();
    expect(screen.queryByText("Hidden Me")).toBeNull();
    expect(screen.getByText("Priya S.")).toBeTruthy();
    expect(screen.queryByText("Asha K.")).toBeNull();
  });

  it("a hidden member's own place is not said on the challenge, and no one else's place depends on it", async () => {
    const server = fakeServer(routes(IRON, listOf(IRON, [challenge(C1, "October Six", { me: me({ hidden: "hide_me", place: 2 }) })])));
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    expect(await screen.findByText("Hide me is on. Only you see this row.")).toBeTruthy();
    expect(screen.queryByText(/2nd of/)).toBeNull();
  });

  it("too few people with a number: no names at all, and it says why", async () => {
    const server = fakeServer(routes(IRON, listOf(IRON, [challenge(C1, "October Six", { board: board({ status: "too_few", ranked: 0, top: [], leaders: 0 }) })])));
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    expect(await screen.findByText("The places show once 3 people have a visit in this challenge.")).toBeTruthy();
    expect(screen.queryByLabelText(/whole board/)).toBeNull();
  });

  it("Join says You're in only after the server answers; with no answer it does not, and reads again", async () => {
    let release: (reply: Reply) => void = () => undefined;
    let held = listOf(IRON, [challenge(C1, "October Six", joinable({ state: "coming", startsOn: "2099-12-01", endsOn: "2099-12-20", board: board({ status: "not_started", ranked: 0, top: [], leaders: 0 }) }))]);
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: () => ({ status: 200, body: held }),
      [joinedOf(IRON, C1)]: () => new Promise<Reply>((resolve) => { release = resolve; }),
    });
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    await fireEvent.press(await screen.findByLabelText("Join October Six"));
    expect(screen.queryByText("You’re in.")).toBeNull();
    expect(onePage().queryByLabelText("Leave October Six")).toBeNull();
    expect(onePage().getByLabelText("Join October Six")).toBeTruthy();
    const nowIn = challenge(C1, "October Six", joinedOne({ state: "coming", startsOn: "2099-12-01", endsOn: "2099-12-20", me: me({ value: 0, place: null }), board: board({ status: "not_started", ranked: 0, top: [], leaders: 0 }) }));
    held = listOf(IRON, [nowIn]);
    await act(async () => {
      release({ status: 200, body: { challenge: nowIn } });
      await Promise.resolve();
    });
    expect(await onePage().findByText("You’re in.")).toBeTruthy();
    expect(screen.queryByLabelText("Join October Six")).toBeNull();
  });

  it("Join with no answer stays as the server holds it, says so, and the next read decides", async () => {
    const server = fakeServer({
      ...routes(IRON, listOf(IRON, [challenge(C1, "October Six", joinable())])),
      [joinedOf(IRON, C1)]: lost,
    });
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    const before = server.asked.filter((a) => a.path === pathOf(IRON)).length;
    await fireEvent.press(await screen.findByLabelText("Join October Six"));
    expect(await screen.findByLabelText("Join October Six")).toBeTruthy();
    await waitFor(() => {
      expect(onePage().getByText(NO_ANSWER)).toBeTruthy();
    });
    await waitFor(() => {
      expect(server.asked.filter((a) => a.path === pathOf(IRON)).length).toBeGreaterThan(before);
    });
  });

  it("a slow read asked before Join never draws over Join's answer", async () => {
    const before = listOf(IRON, [challenge(C1, "October Six", joinable())]);
    const nowIn = challenge(C1, "October Six", joinedOne());
    const releases: ((reply: Reply) => void)[] = [];
    let count = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: () => {
        count += 1;
        return count === 1 ? { status: 200, body: before } : new Promise<Reply>((resolve) => { releases.push(resolve); });
      },
      [joinedOf(IRON, C1)]: ok({ challenge: nowIn }),
    });
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    await act(async () => {
      comeBack();
      await Promise.resolve();
    });
    await fireEvent.press(await screen.findByLabelText("Join October Six"));
    expect(await screen.findByLabelText("Leave October Six")).toBeTruthy();
    await act(async () => {
      for (const release of releases) release({ status: 200, body: before });
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByLabelText("Leave October Six")).toBeTruthy();
    expect(screen.queryByLabelText("Join October Six")).toBeNull();
  });

  it("a read begun while Join is on its way never draws over Join's answer", async () => {
    const before = listOf(IRON, [challenge(C1, "October Six", joinable())]);
    const nowIn = challenge(C1, "October Six", joinedOne());
    const reads: ((reply: Reply) => void)[] = [];
    let release: (reply: Reply) => void = () => undefined;
    let count = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: () => {
        count += 1;
        return count === 1 ? { status: 200, body: before } : new Promise<Reply>((resolve) => { reads.push(resolve); });
      },
      [joinedOf(IRON, C1)]: () => new Promise<Reply>((resolve) => { release = resolve; }),
    });
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    await fireEvent.press(await screen.findByLabelText("Join October Six"));
    await act(async () => {
      comeBack();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(reads.length).toBeGreaterThan(0);
    });
    await act(async () => {
      release({ status: 200, body: { challenge: nowIn } });
      await Promise.resolve();
    });
    expect(await onePage().findByLabelText("Leave October Six")).toBeTruthy();
    await act(async () => {
      for (const one of reads) one({ status: 200, body: before });
      await Promise.resolve();
    });
    await settle();
    expect(onePage().getByLabelText("Leave October Six")).toBeTruthy();
    expect(onePage().queryByLabelText("Join October Six")).toBeNull();
  });

  it("another place's answer is never drawn under this one", async () => {
    const server = fakeServer(routes(IRON, listOf(LOTUS, [challenge(C1, "Their Secret")])));
    await openChallenges(server.ask, IRON);
    expect(await screen.findByText("Couldn’t load the challenges.")).toBeTruthy();
    expect(screen.queryByText("Their Secret")).toBeNull();
  });

  it("a Join answered about another challenge is not drawn as this one", async () => {
    const server = fakeServer({
      ...routes(IRON, listOf(IRON, [challenge(C1, "October Six", joinable())])),
      [joinedOf(IRON, C1)]: ok({ challenge: challenge(C2, "Other", joinedOne()) }),
    });
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    await fireEvent.press(await screen.findByLabelText("Join October Six"));
    expect(await onePage().findByText(NO_ANSWER)).toBeTruthy();
    expect(onePage().getByLabelText("Join October Six")).toBeTruthy();
    expect(screen.queryByText("Other")).toBeNull();
  });

  it("a board answered about another challenge is not drawn", async () => {
    const server = fakeServer({
      ...routes(IRON, listOf(IRON, [challenge(C1, "October Six")])),
      [boardOf(IRON, C1)]: ok(boardReply(C2, { rows: [row(RAVI, "Wrong Person", 1, 3)] })),
    });
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    await fireEvent.press(await screen.findByLabelText("See the whole board of October Six"));
    expect(await screen.findByText("Couldn’t load the board.")).toBeTruthy();
    expect(screen.queryByText("Wrong Person")).toBeNull();
  });

  it("a stranger to the place (404) is told it isn't available, with nothing kept", async () => {
    const server = fakeServer(routes(IRON, null, { [pathOf(IRON)]: () => refusal(404, "not_found", "Not found") }));
    await openChallenges(server.ask, IRON);
    expect(await screen.findByText("Iron House’s challenges aren’t available right now.")).toBeTruthy();
  });
});

describe("the list", () => {
  it("each challenge is one short row, in the server's order, and a place on no plan shows none", async () => {
    const server = fakeServer(routes(IRON, listOf(IRON, [challenge(C1, "October Six"), challenge(C2, "Coming Up", joinable({ state: "coming", startsOn: "2099-11-12", endsOn: "2099-11-30", board: board({ status: "not_started", ranked: 0, top: [], leaders: 0 }) }))])));
    await openChallenges(server.ask, IRON);
    const first = await screen.findByTestId(`challenge-${C1}`);
    expect(within(first).getByText("Most visits wins")).toBeTruthy();
    expect(within(first).getByText("11 days left")).toBeTruthy();
    expect(within(first).getByText("4 visits · 4th of 3")).toBeTruthy();
    const second = screen.getByTestId(`challenge-${C2}`);
    expect(within(second).getByText("Starts in 2 days")).toBeTruthy();
    expect(within(second).getByText("Not joined yet")).toBeTruthy();
  });

  it("no challenges, and a place on no plan, each say so", async () => {
    const none = fakeServer(routes(IRON, listOf(IRON, [])));
    await openChallenges(none.ask, IRON);
    expect(await screen.findByText("Iron House has no challenges on right now.")).toBeTruthy();
  });

  it("paused: not available", async () => {
    const paused = fakeServer(routes(IRON, listOf(IRON, [], { status: "paused" })));
    await openChallenges(paused.ask, IRON);
    expect(await screen.findByText("Iron House’s challenges aren’t available right now.")).toBeTruthy();
  });

  it("reads again when the app comes back", async () => {
    const server = fakeServer(routes(IRON, listOf(IRON, [challenge(C1, "October Six")])));
    await openChallenges(server.ask, IRON);
    await screen.findByTestId(`challenge-${C1}`);
    const before = server.asked.filter((a) => a.path === pathOf(IRON)).length;
    await act(async () => {
      comeBack();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(server.asked.filter((a) => a.path === pathOf(IRON)).length).toBeGreaterThan(before);
    });
  });

  it("a read that fails on coming back keeps what is on screen", async () => {
    let count = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: () => {
        count += 1;
        return count === 1 ? { status: 200, body: listOf(IRON, [challenge(C1, "October Six")]) } : lost();
      },
    });
    await openChallenges(server.ask, IRON);
    await screen.findByTestId(`challenge-${C1}`);
    await act(async () => {
      comeBack();
      await Promise.resolve();
    });
    await settle();
    expect(screen.getByTestId(`challenge-${C1}`)).toBeTruthy();
  });
});

describe("one challenge", () => {
  it("leaving asks first, and goes only on Leave", async () => {
    const left = challenge(C1, "October Six", joinable({ joinedCount: 2 }));
    const server = fakeServer({
      ...routes(IRON, listOf(IRON, [challenge(C1, "October Six", joinedOne())])),
      [joinedOf(IRON, C1)]: ok({ challenge: left }),
    });
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    await fireEvent.press(await screen.findByLabelText("Leave October Six"));
    expect(await screen.findByText("Leave October Six?")).toBeTruthy();
    expect(server.asked.some((a) => a.method === "DELETE")).toBe(false);
    await fireEvent.press(screen.getByText("Stay in"));
    expect(server.asked.some((a) => a.method === "DELETE")).toBe(false);
    await fireEvent.press(await screen.findByLabelText("Leave October Six"));
    await fireEvent.press(screen.getByLabelText("Leave the challenge"));
    expect(await screen.findByLabelText("Join October Six")).toBeTruthy();
    expect(server.asked.filter((a) => a.method === "DELETE").map((a) => a.path)).toEqual([joinedOf(IRON, C1)]);
  });

  it("a refusal says the server's words and reads again", async () => {
    const server = fakeServer({
      ...routes(IRON, listOf(IRON, [challenge(C1, "October Six", joinable())])),
      [joinedOf(IRON, C1)]: () => refusal(409, "challenge_ended", "This challenge has ended."),
    });
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    const before = server.asked.filter((a) => a.path === pathOf(IRON)).length;
    await fireEvent.press(await screen.findByLabelText("Join October Six"));
    expect(await screen.findByText("This challenge has ended.")).toBeTruthy();
    await waitFor(() => {
      expect(server.asked.filter((a) => a.path === pathOf(IRON)).length).toBeGreaterThan(before);
    });
  });

  it("a target: how far, what is left, and Done only where the server says reached", async () => {
    const server = fakeServer(routes(IRON, listOf(IRON, [challenge(C1, "Twelve", { target: 12, board: board({ reached: 1 }), me: me({ value: 12, place: null, reached: false, toNextPlace: null, nextPlace: null }) }), challenge(C2, "Done One", { target: 12, board: board({ reached: 1 }), me: me({ value: 12, reached: true }) })])));
    await openChallenges(server.ask, IRON);
    await openOne("Twelve");
    expect(await screen.findByText("0 to go")).toBeTruthy();
    expect(screen.queryByText(/Done\./)).toBeNull();
  });

  it("a cancelled challenge says so and offers nothing", async () => {
    const server = fakeServer(routes(IRON, listOf(IRON, [challenge(C1, "October Six", joinable({ cancelled: true, can: { join: false, leave: false, pick: false } }))])));
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    expect(await screen.findByText("Iron House cancelled this challenge.")).toBeTruthy();
    expect(screen.queryByLabelText("Join October Six")).toBeNull();
    expect(screen.queryByLabelText(/whole board/)).toBeNull();
  });

  it("a challenge at a place that checks nobody in says so, never a bare number", async () => {
    const server = fakeServer(routes(IRON, listOf(IRON, [challenge(C1, "October Six", { me: me({ value: 0, place: null, toNextPlace: null, nextPlace: null }), board: board({ status: "too_few", ranked: 0, top: [], leaders: 0 }) })], { checkingIn: false })));
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    expect(await screen.findByText(/hasn’t checked anyone in at the front desk/)).toBeTruthy();
  });

  it("gone from the list while open: says so, and Back still works", async () => {
    let count = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: () => {
        count += 1;
        return { status: 200, body: listOf(IRON, count === 1 ? [challenge(C1, "October Six")] : []) };
      },
    });
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    await onePage().findByText("Most visits wins");
    await act(async () => {
      comeBack();
      await Promise.resolve();
    });
    expect(await screen.findByText("This challenge isn’t shown any more.")).toBeTruthy();
  });
});

describe("teams", () => {
  const team = (id: string, name: string, place: number | null, value: number, over: Over = {}) => ({ id, name, people: 3, value, place, reached: false, waiting: 0, isMine: false, ...over });
  const inTeams = (over: Over = {}, boardOver: Over = {}) => ({
    teams: "members",
    who: "joined",
    joinedCount: 6,
    me: null,
    can: { join: false, leave: false, pick: true },
    teamBoard: { status: "shown", rows: [team(T1, "Red", 1, 20), team(T2, "Blue", 2, 12)], mine: null, ...boardOver },
    ...over,
  });

  it("picking a team asks first, says what it does, and sends that team", async () => {
    const after = challenge(C1, "Team Six", inTeams({ joined: true, me: me(), can: { join: false, leave: true, pick: false } }, { rows: [team(T1, "Red", 1, 20, { isMine: true }), team(T2, "Blue", 2, 12)], mine: { teamId: T1, people: [{ userId: ME, name: "Me", initials: "M", value: 4, isMe: true }], more: 0, counted: true } }));
    const server = fakeServer({
      ...routes(IRON, listOf(IRON, [challenge(C1, "Team Six", inTeams())])),
      [teamOf(IRON, C1)]: ok({ challenge: after }),
    });
    await openChallenges(server.ask, IRON);
    await openOne("Team Six");
    expect(await onePage().findByText("The team with the most visits wins")).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText("Join Red"));
    expect(await screen.findByText("Join Red?")).toBeTruthy();
    expect(screen.getByText(/This puts you in the challenge/)).toBeTruthy();
    expect(server.asked.some((a) => a.path === teamOf(IRON, C1))).toBe(false);
    await fireEvent.press(screen.getByLabelText("Yes, Join Red"));
    expect(await screen.findByText("Your team: Red")).toBeTruthy();
    expect(server.asked.filter((a) => a.path === teamOf(IRON, C1)).map((a) => a.body)).toEqual([{ teamId: T1 }]);
  });

  it("a member's own number that is not added to the team says so", async () => {
    const server = fakeServer(routes(IRON, listOf(IRON, [challenge(C1, "Team Six", inTeams({ joined: true, me: me({ hidden: "hide_me" }), can: { join: false, leave: true, pick: false } }, { rows: [team(T1, "Red", 1, 20, { isMine: true })], mine: { teamId: T1, people: [{ userId: ME, name: "Me", initials: "M", value: 4, isMe: true }], more: 0, counted: false } }))])));
    await openChallenges(server.ask, IRON);
    await openOne("Team Six");
    expect(await screen.findByText("Your number isn’t added to Red’s, because you aren’t shown on the boards.")).toBeTruthy();
  });
});

describe("the whole board", () => {
  it("the first hundred; a name opens that person's profile; the member's own row opens nothing", async () => {
    const server = fakeServer({
      ...routes(IRON, listOf(IRON, [challenge(C1, "October Six")])),
      [boardOf(IRON, C1)]: ok(boardReply(C1, { rows: [row(PRIYA, "Priya S.", 1, 9), row(ME, "Me", 2, 7, { isMe: true })] })),
      [`/v1/orgs/${IRON.id}/leaderboard/people/${PRIYA}`]: () => refusal(404, "not_found", "Not found"),
      [`/v1/orgs/${IRON.id}/posts/people/${PRIYA}`]: () => refusal(404, "not_found", "Not found"),
    });
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    await fireEvent.press(await screen.findByLabelText("See the whole board of October Six"));
    const page = within(await screen.findByTestId("challenge-board"));
    expect(await page.findByLabelText("2nd: you, 7 visits")).toBeTruthy();
    expect(page.queryByLabelText("2nd: you, 7 visits, see their profile")).toBeNull();
    await fireEvent.press(page.getByLabelText("1st: Priya S., 9 visits, see their profile"));
    await waitFor(() => {
      expect(server.asked.some((a) => a.path.includes(`/leaderboard/people/${PRIYA}`))).toBe(true);
    });
  });

  it("the member past the first hundred reads their own place under the list", async () => {
    const server = fakeServer({
      ...routes(IRON, listOf(IRON, [challenge(C1, "October Six")])),
      [boardOf(IRON, C1)]: ok(boardReply(C1, { me: me({ place: 140 }), ranked: 200 })),
    });
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    await fireEvent.press(await screen.findByLabelText("See the whole board of October Six"));
    expect(await screen.findByText("Members see the first 100. Your place is here.")).toBeTruthy();
    expect(screen.getByText("140th")).toBeTruthy();
  });
});

describe("the post that says a challenge has ended", () => {
  const postsOf = (place: Place) => `/v1/orgs/${place.id}/posts`;
  const endedOne = (over: Over = {}) => challenge(C1, "October Six", { state: "ended", startsOn: "2099-11-01", endsOn: "2099-11-09", prize: "A month free", ...over });
  const post = (result: unknown) => ({
    id: C2,
    author: { name: null, initials: "" },
    body: "October Six has ended.",
    photos: [],
    pinned: false,
    createdAt: "2099-11-10T05:00:00.000Z",
    reactions: { like: 0, love: 0, strong: 0, fire: 0 },
    mine: null,
    fromMember: false,
    authorId: null,
    own: false,
    wrote: false,
    reported: false,
    hidden: false,
    commentCount: 0,
    challengeResult: result,
  });
  const feed = (result: unknown) =>
    gymPostsResponseSchema.parse({ gymId: IRON.id, gymName: IRON.name, pinned: [], next: null, status: "shown", posting: "off", commenting: "on", blockedCount: 0, supportEmail: null, posts: [post(result)] });
  const openUpdates = async (ask: Ask) => {
    await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
    const tab = (await screen.findAllByRole("tab"))[3];
    if (tab === undefined) throw new Error("no fourth tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText(`Updates at ${IRON.name}`));
  };

  it("says who won from what was read with the post, and See the challenge opens it", async () => {
    const list = listOf(IRON, [endedOne()]);
    const server = fakeServer({
      ...routes(IRON, list),
      [postsOf(IRON)]: ok(feed({ today: "2099-11-10", canOpen: true, challenge: endedOne() })),
    });
    await openUpdates(server.ask);
    const box = within(await screen.findByTestId("challenge-result"));
    expect(box.getByText("Winner: Priya S., with 9 visits.")).toBeTruthy();
    expect(box.getByLabelText("2nd: Asha K., 7 visits")).toBeTruthy();
    expect(box.getByText("Prize: A month free")).toBeTruthy();
    await fireEvent.press(box.getByText("See the challenge"));
    expect(await onePage().findByText("Most visits wins")).toBeTruthy();
  });

  it("a challenge the reader's list no longer holds has no See the challenge; somebody hidden since is named by nobody", async () => {
    const server = fakeServer({
      ...routes(IRON, listOf(IRON, [])),
      [postsOf(IRON)]: ok(feed({ today: "2099-11-10", canOpen: false, challenge: endedOne({ board: board({ status: "too_few", ranked: 0, top: [], leaders: 0 }) }) })),
    });
    await openUpdates(server.ask);
    const box = within(await screen.findByTestId("challenge-result"));
    expect(box.getByText("It finished with fewer than 3 people in it, so there are no places.")).toBeTruthy();
    expect(box.queryByText("Priya S.")).toBeNull();
    expect(box.queryByText("See the challenge")).toBeNull();
  });
});

describe("Hide me and a missing name, from the challenge", () => {
  it("a hidden member gets a button to where Hide me is", async () => {
    const server = fakeServer(routes(IRON, listOf(IRON, [challenge(C1, "October Six", { me: me({ hidden: "hide_me" }) })])));
    await openChallenges(server.ask, IRON);
    await openOne("October Six");
    expect(await screen.findByLabelText("Change Hide me on the Leaderboard")).toBeTruthy();
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});
