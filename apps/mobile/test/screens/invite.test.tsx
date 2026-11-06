// Invite a friend on the phone (ROADMAP Stage 5 item 20a). The first block is the worst thing this
// job could do to a real person: share somebody else's link, so a friend reads another member's
// first name and that member gets the gift. Every answer is read through the server's own shape.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { Share } from "react-native";
import { memberReferralResponseSchema, referralMemberGiftWords, referralTickets } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, memoryStore, refusal, tokens, type Reply } from "../kit";

const WEB = "http://localhost:5173";
const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000", webUrl: WEB };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

type Place = { id: string; name: string; city: string | null; orgType: string; clockFormat: "12h" | "24h" };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Leeds", orgType: "gym", clockFormat: "12h" };
const LOTUS: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Lotus Yoga", city: null, orgType: "studio", clockFormat: "24h" };
const org = (gym: Place) => ({
  ...gym,
  slug: gym.name.toLowerCase().replace(" ", "-"),
  timezone: "Europe/London",
  locale: "en",
  currencyDisplay: "GBP",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
});
const mine = (...gyms: Place[]) => ok({ orgs: gyms.map(org), formerOrgs: [] });
const pathOf = (place: Place) => `/v1/orgs/${place.id}/referral`;

const IRON_CODE = "ironmaya2345abcd";
const LOTUS_CODE = "lotusmaya567efgh";
const TEN_POUNDS = referralMemberGiftWords({ kind: "amount", percentBp: null, amountMinor: 1000, currency: "GBP", on: "membership" });
const FREE_DAYS = referralMemberGiftWords({ kind: "amount", percentBp: null, amountMinor: 1000, currency: "GBP", on: "membership", days: 14 });

/** The server's answer for one place, as the route makes it. */
function on(place: Place, code: string, member: { gift: string; instead: string | null } | null, friend: string | null, over: Record<string, unknown> = {}) {
  return memberReferralResponseSchema.parse({
    status: "on",
    gymId: place.id,
    gymName: place.name,
    path: `/invite/${code}`,
    memberGift: member?.gift ?? null,
    friendGift: friend,
    lines: ["The offer's lines, which the phone does not show."],
    tickets: referralTickets(place.name, member, friend, "Maya"),
    ...over,
  });
}
const off = (place: Place) => memberReferralResponseSchema.parse({ status: "off", gymId: place.id, gymName: place.name });

async function openGym(ask: Ask, copy: typeof extra | Omit<typeof extra, "webUrl"> = extra) {
  await render(<App extra={copy} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
}
const page = () => within(screen.getByTestId("invite-page"));
let shared: jest.SpyInstance;

beforeEach(() => {
  shared = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
});
afterEach(() => {
  shared.mockRestore();
});

describe("the worst thing: somebody else's link shared, under their name", () => {
  it("each place's line opens that place's page with its own link, and Share sends that link and no other", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [pathOf(IRON)]: ok(on(IRON, IRON_CODE, TEN_POUNDS, "10% off the first payment of a membership")),
      [pathOf(LOTUS)]: ok(on(LOTUS, LOTUS_CODE, null, "A free class")),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByLabelText("Invite a friend to Lotus Yoga"));
    expect(await page().findByText(`${WEB}/invite/${LOTUS_CODE}`)).toBeTruthy();
    expect(page().getByText("Lotus Yoga")).toBeTruthy();
    expect(page().queryByText(new RegExp(IRON_CODE))).toBeNull();
    await fireEvent.press(page().getByLabelText("Share my invite link for Lotus Yoga"));
    expect(shared).toHaveBeenCalledTimes(1);
    expect(shared).toHaveBeenLastCalledWith({ message: `Join me at Lotus Yoga: ${WEB}/invite/${LOTUS_CODE}` });

    await fireEvent.press(page().getByLabelText("Back"));
    await fireEvent.press(await screen.findByLabelText("Invite a friend to Iron House. You get £10.00 off your next membership payment"));
    expect(await page().findByText(`${WEB}/invite/${IRON_CODE}`)).toBeTruthy();
    expect(page().queryByText(new RegExp(LOTUS_CODE))).toBeNull();
    await fireEvent.press(page().getByLabelText("Share my invite link for Iron House"));
    expect(shared).toHaveBeenLastCalledWith({ message: `Join me at Iron House: ${WEB}/invite/${IRON_CODE}` });
    // Each share carried its own place's link alone.
    const messages = shared.mock.calls.map((call: unknown[]) => JSON.stringify(call));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain(LOTUS_CODE);
    expect(messages[0]).not.toContain(IRON_CODE);
    expect(messages[1]).toContain(IRON_CODE);
    expect(messages[1]).not.toContain(LOTUS_CODE);
  });

  it("an answer that names another place is never shown, or shared, under this one", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      // Iron House's route answering with Lotus Yoga's link.
      [pathOf(IRON)]: ok(on(LOTUS, LOTUS_CODE, TEN_POUNDS, null)),
      [pathOf(LOTUS)]: ok(off(LOTUS)),
    });
    await openGym(server.ask);
    await waitFor(() => {
      expect(server.paths()).toContain(pathOf(IRON));
    });
    expect(await screen.findAllByText("Show your pass at the front desk when you arrive.")).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId(`invite-line-${IRON.id}`)).toBeNull();
    expect(screen.queryByTestId(`invite-line-${LOTUS.id}`)).toBeNull();
    expect(screen.queryByText(/Invite a friend/)).toBeNull();
  });

  it("a page closed before its answer came never shows that answer under the next place", async () => {
    let release: (reply: Reply) => void = () => undefined;
    let ironReads = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [pathOf(IRON)]: () => {
        ironReads += 1;
        // The Gym tab's own read answers; the page's read waits.
        if (ironReads === 1) return { status: 200, body: on(IRON, IRON_CODE, TEN_POUNDS, null) };
        return new Promise<Reply>((resolve) => {
          release = resolve;
        });
      },
      [pathOf(LOTUS)]: ok(on(LOTUS, LOTUS_CODE, null, "A free class")),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`invite-line-${IRON.id}`));
    await waitFor(() => {
      expect(ironReads).toBe(2);
    });
    await fireEvent.press(page().getByLabelText("Back"));
    await fireEvent.press(await screen.findByTestId(`invite-line-${LOTUS.id}`));
    expect(await page().findByText(`${WEB}/invite/${LOTUS_CODE}`)).toBeTruthy();
    await act(async () => {
      release({ status: 200, body: on(IRON, IRON_CODE, TEN_POUNDS, null) });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(page().queryByText(new RegExp(IRON_CODE))).toBeNull();
    expect(page().getByText(`${WEB}/invite/${LOTUS_CODE}`)).toBeTruthy();
  });
});

describe("the line on a place's card", () => {
  it("only where the place has switched it on, with the member's own gift, or the words alone where there is none", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [pathOf(IRON)]: ok(off(IRON)),
      [pathOf(LOTUS)]: ok(on(LOTUS, LOTUS_CODE, null, "A free class")),
    });
    await openGym(server.ask);
    const line = await screen.findByTestId(`invite-line-${LOTUS.id}`);
    expect(within(line).getByText("Invite a friend")).toBeTruthy();
    expect(within(line).queryByText(/^You get/)).toBeNull();
    expect(screen.queryByTestId(`invite-line-${IRON.id}`)).toBeNull();
  });

  it("a read that fails shows no line", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: () => refusal(500, "internal", "Something went wrong"),
    });
    await openGym(server.ask);
    await waitFor(() => {
      expect(server.paths()).toContain(pathOf(IRON));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId(`invite-line-${IRON.id}`)).toBeNull();
    expect(screen.queryByText(/Invite a friend/)).toBeNull();
  });

  it("a copy that does not know its website shows no line, for it has no link to give", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(on(IRON, IRON_CODE, TEN_POUNDS, null)),
    });
    await openGym(server.ask, { copyName: "Feature 1", apiUrl: "http://localhost:3000" });
    await waitFor(() => {
      expect(server.paths()).toContain(pathOf(IRON));
    });
    expect(await screen.findByText("Show your pass at the front desk when you arrive.")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId(`invite-line-${IRON.id}`)).toBeNull();
  });
});

describe("the page", () => {
  it("both gifts on their tickets, what each needs, the link, the first name it shows and who set the offer", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(on(IRON, IRON_CODE, TEN_POUNDS, "10% off the first payment of a membership")),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`invite-line-${IRON.id}`));
    expect(await page().findByText("Invite a friend")).toBeTruthy();
    expect(page().getByText("You get")).toBeTruthy();
    expect(page().getByText("£10.00 off your next membership payment")).toBeTruthy();
    expect(page().getByText("When a friend you invite joins Iron House and makes their first payment. It comes off by itself, and we'll tell you in your inbox.")).toBeTruthy();
    expect(page().getByText("Your friend gets")).toBeTruthy();
    expect(page().getByText("10% off the first payment of a membership")).toBeTruthy();
    expect(page().getByText("Iron House adds it for them when they join.")).toBeTruthy();
    expect(page().getByText(`${WEB}/invite/${IRON_CODE}`)).toBeTruthy();
    expect(page().getByText("Your link shows your first name, Maya, to whoever opens it.")).toBeTruthy();
    expect(page().getByText("This offer is set by Iron House and may change.")).toBeTruthy();
    // The server's sentences are shown once, as tickets, never also as lines.
    expect(page().queryByText("The offer's lines, which the phone does not show.")).toBeNull();
  });

  it("free days, with the money a member with no membership gets instead; and no gift at all", async () => {
    let answer = on(IRON, IRON_CODE, FREE_DAYS, null);
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: () => ({ status: 200, body: answer }),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`invite-line-${IRON.id}`));
    expect(await page().findByText("14 free days on your membership")).toBeTruthy();
    expect(page().getByText("If you have no membership then, you get £10.00 off your next membership payment instead.")).toBeTruthy();
    expect(page().queryByText("Your friend gets")).toBeNull();
    await fireEvent.press(page().getByLabelText("Back"));

    // The page reads again each time it opens.
    answer = on(IRON, IRON_CODE, null, null);
    await fireEvent.press(await screen.findByTestId(`invite-line-${IRON.id}`));
    expect(await page().findByText("Send your link to a friend who'd like to join Iron House.")).toBeTruthy();
    expect(page().queryByText("You get")).toBeNull();
    expect(page().getByLabelText("Share my invite link for Iron House")).toBeTruthy();
  });

  it("switched off, or no longer showing, while open: says so in place, with Try again where it may help", async () => {
    let answer: Reply = { status: 200, body: on(IRON, IRON_CODE, TEN_POUNDS, null) };
    let reads = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: () => {
        reads += 1;
        return answer;
      },
    });
    await openGym(server.ask);
    const line = await screen.findByTestId(`invite-line-${IRON.id}`);
    answer = { status: 200, body: off(IRON) };
    await fireEvent.press(line);
    expect(await page().findByText("Iron House has switched off Invite a friend.")).toBeTruthy();
    expect(page().queryByLabelText("Share my invite link for Iron House")).toBeNull();
    await fireEvent.press(page().getByLabelText("Back"));

    answer = refusal(404, "not_found", "Not found");
    const before = reads;
    // The tab still shows the line it last read; the page reads again and says what it found.
    await fireEvent.press(screen.getByTestId(`invite-line-${IRON.id}`));
    await waitFor(() => {
      expect(reads).toBeGreaterThan(before);
    });
    expect(await page().findByText("Iron House isn’t showing your invite link right now.")).toBeTruthy();
    expect(page().queryByText(new RegExp(IRON_CODE))).toBeNull();
    expect(page().queryByLabelText("Try again")).toBeTruthy();
  });

  it("a page that cannot read says so with Try again, and Try again reads it", async () => {
    let answer: Reply = { status: 200, body: on(IRON, IRON_CODE, TEN_POUNDS, null) };
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: () => answer,
    });
    await openGym(server.ask);
    const line = await screen.findByTestId(`invite-line-${IRON.id}`);
    answer = refusal(500, "internal", "Something went wrong");
    await fireEvent.press(line);
    // A refusal says so; only a lost connection keeps what the page opened with.
    expect(await page().findByText("Couldn’t load your invite link.")).toBeTruthy();
    answer = { status: 200, body: on(IRON, IRON_CODE, TEN_POUNDS, null) };
    await fireEvent.press(page().getByLabelText("Try again"));
    expect(await page().findByText(`${WEB}/invite/${IRON_CODE}`)).toBeTruthy();
  });

  it("scrolled until its first words reach the Back button, the page gets a bar with its name behind Back", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(on(IRON, IRON_CODE, TEN_POUNDS, null)),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`invite-line-${IRON.id}`));
    expect(await page().findByText(`${WEB}/invite/${IRON_CODE}`)).toBeTruthy();
    const scroll = page().getByTestId("invite-scroll");
    const at = (y: number) => ({ nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 400, height: 1600 }, layoutMeasurement: { width: 400, height: 800 } } });
    await fireEvent.scroll(scroll, at(2));
    expect(page().queryByTestId("invite-bar")).toBeNull();
    await fireEvent.scroll(scroll, at(400));
    expect(within(page().getByTestId("invite-bar")).getByText("Invite a friend")).toBeTruthy();
    await fireEvent.scroll(scroll, at(0));
    expect(page().queryByTestId("invite-bar")).toBeNull();
  });

  it("sharing that cannot open says so under the button", async () => {
    shared.mockRejectedValueOnce(new Error("no share sheet"));
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [pathOf(IRON)]: ok(on(IRON, IRON_CODE, TEN_POUNDS, null)),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`invite-line-${IRON.id}`));
    await fireEvent.press(await page().findByLabelText("Share my invite link for Iron House"));
    expect(await page().findByText("Couldn’t open sharing. Try again.")).toBeTruthy();
    await fireEvent.press(page().getByLabelText("Share my invite link for Iron House"));
    await waitFor(() => {
      expect(page().queryByText("Couldn’t open sharing. Try again.")).toBeNull();
    });
  });
});
