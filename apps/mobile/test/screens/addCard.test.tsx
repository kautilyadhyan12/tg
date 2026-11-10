import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { myCardViewSchema, myMembershipResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, memoryStore, refusal, tokens, type Reply } from "../kit";

// Add card on the phone (ROADMAP Stage 5 item 20d). Square's page is a plain box in a test (`setup.js`): a test says
// back what Square's page would, and reads what the app asked the page to run.

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
const PAGE = "http://localhost:3000/";
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

type Place = { id: string; name: string; city: string | null; orgType: string; clockFormat: "12h" | "24h" };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Austin", orgType: "gym", clockFormat: "12h" };
const LOTUS: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Lotus Yoga", city: null, orgType: "studio", clockFormat: "24h" };
const org = (gym: Place) => ({
  ...gym,
  slug: gym.name.toLowerCase().replace(" ", "-"),
  timezone: "UTC",
  locale: "en",
  currencyDisplay: "USD",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
});
const mine = (...gyms: Place[]) => ok({ orgs: gyms.map(org), formerOrgs: [] });

const membershipOf = (gym: string) =>
  myMembershipResponseSchema.parse({
    gym: { name: gym },
    today: "2026-11-10",
    record: "own",
    paidBy: null,
    memberships: [],
    paysFor: [],
    earlierNotShown: 0,
    purchases: [],
    purchasesNotShown: 0,
  });

const agreementOf = (gym: string) => `I agree that ${gym} may save this card and charge it for my membership and any fees when they are due. I can remove it at the front desk at any time.`;
const VISA = {
  brand: "VISA",
  last4: "1111",
  expMonth: 12,
  expYear: 2028,
  expired: false,
  expiresThisMonth: false,
  expiryReminder: null,
  expiryReminderOn: null,
  savedAt: "2026-11-10T10:00:00.000Z",
  savedFrom: "app",
};
const cardOf = (gym: string, location: string, over: Record<string, unknown> = {}) => ({
  myCard: myCardViewSchema.parse({
    record: "own",
    state: "ready",
    card: null,
    earlierCard: null,
    paidBy: null,
    canSave: true,
    gymName: gym,
    agreement: agreementOf(gym),
    form: {
      environment: "sandbox",
      applicationId: "sandbox-sq0idb-AbCdEfGhIjKlMnOp",
      locationId: location,
      contact: { givenName: "Tara", familyName: "Shah", email: "tara@gmail.com", countryCode: "US" },
    },
    ...over,
  }),
});

const membershipPath = (place: Place) => `/v1/orgs/${place.id}/my-membership`;
const cardPath = (place: Place) => `/v1/orgs/${place.id}/my-card`;

type Box = {
  props: { testID?: string; source: { html: string; baseUrl: string }; onMessage: (event: { nativeEvent: { data: string; url: string } }) => void };
  gone: boolean;
  injected: string[];
};
const { boxes } = jest.requireMock<{ boxes: Box[] }>("react-native-webview");
const cardBoxes = () => boxes.filter((b) => !b.gone && b.props.testID === "card-boxes");
const openBox = (): Box => {
  const box = cardBoxes().at(-1);
  if (box === undefined) throw new Error("no card boxes drawn");
  return box;
};
const say = async (box: Box, message: unknown, url = PAGE) => {
  await act(async () => {
    box.props.onMessage({ nativeEvent: { data: JSON.stringify(message), url } });
    await Promise.resolve();
  });
};

beforeEach(() => {
  boxes.length = 0;
});

async function openMembership(ask: Ask, place: Place) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`My membership at ${place.name}`));
}
const page = () => within(screen.getByTestId("membership-page"));

/** Add card pressed, Square's boxes drawn and the agreement ticked. */
async function readyToSave(): Promise<Box> {
  await fireEvent.press(await page().findByText("Add card"));
  await screen.findByTestId("add-card");
  await waitFor(() => {
    expect(cardBoxes()).toHaveLength(1);
  });
  const box = openBox();
  await say(box, { kind: "ready" });
  await fireEvent.press(screen.getByTestId("card-agree"));
  return box;
}

describe("the worst thing: a card added for one gym is saved at that gym alone", () => {
  it("a member of two gyms adds a card at Lotus Yoga: Lotus's own Square location draws the boxes, and only Lotus is sent the card", async () => {
    let lotusSaved = false;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [membershipPath(IRON)]: ok(membershipOf("Iron House")),
      [membershipPath(LOTUS)]: ok(membershipOf("Lotus Yoga")),
      [cardPath(IRON)]: ok(cardOf("Iron House", "LOCATIONIRON01")),
      [cardPath(LOTUS)]: (body) => {
        if (body !== undefined) lotusSaved = true;
        return { status: 200, body: cardOf("Lotus Yoga", "LOCATIONLOTUS1", lotusSaved ? { card: VISA } : {}) };
      },
    });
    await openMembership(server.ask, LOTUS);
    const box = await readyToSave();
    expect(box.props.source.html).toContain("LOCATIONLOTUS1");
    expect(box.props.source.html).not.toContain("LOCATIONIRON01");
    expect(box.props.source.baseUrl).toBe(PAGE);

    await fireEvent.press(screen.getByLabelText("Save this card for Lotus Yoga"));
    expect(box.injected).toEqual(["window.kwazoSave&&window.kwazoSave();true;"]);
    await say(box, { kind: "token", token: "cnon:card-nonce-ok" });

    await waitFor(() => {
      expect(page().getByTestId("card-said")).toBeTruthy();
    });
    expect(page().getByText("Card saved: Visa ending 1111.")).toBeTruthy();
    expect(page().getByText("Visa ending 1111")).toBeTruthy();
    const posts = server.asked.filter((a) => a.method === "POST" && a.path.endsWith("/my-card"));
    expect(posts).toHaveLength(1);
    expect(posts[0]?.path).toBe(cardPath(LOTUS));
    expect(posts[0]?.body).toEqual({ sourceId: "cnon:card-nonce-ok", agreed: true, agreement: agreementOf("Lotus Yoga"), requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown });
    expect(server.asked.some((a) => a.path === cardPath(IRON))).toBe(false);
  });

  it("a token Square's page sends without Save card, or a frame inside the page sends, is never sent anywhere", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [membershipPath(IRON)]: ok(membershipOf("Iron House")),
      [cardPath(IRON)]: ok(cardOf("Iron House", "LOCATIONIRON01")),
    });
    await openMembership(server.ask, IRON);
    const box = await readyToSave();
    await say(box, { kind: "token", token: "cnon:nobody-asked" });
    await fireEvent.press(screen.getByLabelText("Save this card for Iron House"));
    await say(box, { kind: "token", token: "cnon:from-a-frame" }, "https://sandbox.web.squarecdn.com/v1/card");
    await say(box, { kind: "token", token: "not a token <script>" });
    expect(server.asked.filter((a) => a.method === "POST" && a.path.endsWith("/my-card"))).toHaveLength(0);
    // The page's own answer to the press is still taken, once.
    await say(box, { kind: "token", token: "cnon:asked" });
    await say(box, { kind: "token", token: "cnon:again" });
    await waitFor(() => {
      expect(server.asked.filter((a) => a.method === "POST" && a.path.endsWith("/my-card")).map((a) => (a.body as { sourceId: string }).sourceId)).toEqual(["cnon:asked"]);
    });
  });

  it("Card saved never shows when the server did not save it: the bank's refusal is said, and nothing changes", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [membershipPath(IRON)]: ok(membershipOf("Iron House")),
      [cardPath(IRON)]: (body) => (body === undefined ? { status: 200, body: cardOf("Iron House", "LOCATIONIRON01") } : refusal(409, "card_declined", "The bank didn't accept this card. Try another card.")),
    });
    await openMembership(server.ask, IRON);
    const box = await readyToSave();
    await fireEvent.press(screen.getByLabelText("Save this card for Iron House"));
    await say(box, { kind: "token", token: "cnon:declined" });
    expect(await screen.findByText("The bank didn't accept this card. Try another card.")).toBeTruthy();
    // The page stays as it was, ticked, to try another card.
    expect(screen.getByTestId("add-card")).toBeTruthy();
    expect(screen.getByLabelText("Save this card for Iron House")).toBeEnabled();
    expect(screen.queryByText(/Card saved/)).toBeNull();
  });
});

describe("the box on My membership", () => {
  it("not one of Square's countries: no Card on file at all", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [membershipPath(IRON)]: ok(membershipOf("Iron House")),
      [cardPath(IRON)]: ok(cardOf("Iron House", "LOCATIONIRON01", { state: "not_offered", canSave: false, form: null })),
    });
    await openMembership(server.ask, IRON);
    await waitFor(() => {
      expect(server.paths()).toContain(cardPath(IRON));
    });
    expect(page().queryByText("Card on file")).toBeNull();
    expect(page().queryByText("Add card")).toBeNull();
  });

  it("a card on file reads its name and expiry, with Update card", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [membershipPath(IRON)]: ok(membershipOf("Iron House")),
      [cardPath(IRON)]: ok(cardOf("Iron House", "LOCATIONIRON01", { card: VISA })),
    });
    await openMembership(server.ask, IRON);
    expect(await page().findByText("Visa ending 1111")).toBeTruthy();
    expect(page().getByText("Expires 12/2028")).toBeTruthy();
    await fireEvent.press(page().getByText("Update card"));
    expect(await screen.findByTestId("add-card")).toBeTruthy();
  });
});

describe("the page while Square's boxes work", () => {
  it("Save card waits for Square's boxes and the tick", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [membershipPath(IRON)]: ok(membershipOf("Iron House")),
      [cardPath(IRON)]: ok(cardOf("Iron House", "LOCATIONIRON01")),
    });
    await openMembership(server.ask, IRON);
    await fireEvent.press(await page().findByText("Add card"));
    await waitFor(() => {
      expect(cardBoxes()).toHaveLength(1);
    });
    const save = screen.getByLabelText("Save this card for Iron House");
    expect(save).toBeDisabled();
    expect(screen.getByText("Type your card and tick the box to save it.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("card-agree"));
    expect(save).toBeDisabled();
    await say(openBox(), { kind: "ready" });
    expect(screen.getByLabelText("Save this card for Iron House")).toBeEnabled();
  });

  it("what Square did not take is said; boxes that did not load are drawn again on Try again", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [membershipPath(IRON)]: ok(membershipOf("Iron House")),
      [cardPath(IRON)]: ok(cardOf("Iron House", "LOCATIONIRON01")),
    });
    await openMembership(server.ask, IRON);
    const box = await readyToSave();
    await fireEvent.press(screen.getByLabelText("Save this card for Iron House"));
    await say(box, { kind: "not_taken" });
    expect(screen.getByText("Check the card details in the boxes above, then try again.")).toBeTruthy();
    await say(box, { kind: "blocked" });
    expect(screen.getByText("Square’s card boxes didn’t load. Check your internet and try again.")).toBeTruthy();
    expect(cardBoxes()).toHaveLength(0);
    await fireEvent.press(within(screen.getByTestId("add-card")).getByText("Try again"));
    await waitFor(() => {
      expect(cardBoxes()).toHaveLength(1);
    });
    expect(server.asked.filter((a) => a.method === "POST" && a.path.endsWith("/my-card"))).toHaveLength(0);
  });
});
