import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AppState, ScrollView } from "react-native";
import { myCardViewSchema, myMembershipResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, tokens, type Reply, type Route } from "../kit";

// Add card from a place's card request (ROADMAP Stage 5 item 20l): the message in the Inbox has Add card under it, which
// opens My membership at that same place, on Add card where a card can be added there.

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000" };
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

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const M3 = "33333333-3333-4333-8333-333333333333";
// The server's own words for a card request (18d-vii, `rulings/2026-11-14-18d-vii.md`).
const askBody = (gym: string) =>
  `${gym} asks you to add a card for your Gold Monthly membership. It will be charged automatically each time it renews. To add it, open My membership and tap Add card.`;
const message = (id: string, kind: string, body: string, over: Record<string, unknown> = {}) => ({
  id,
  kind,
  body,
  sentAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  link: null,
  read: false,
  ...over,
});
const inboxOf = (place: Place, messages: unknown[]) => ({
  gymId: place.id,
  gymName: place.name,
  status: "shown",
  messages,
  unread: 0,
  asOf: "2026-11-16T10:00:00.000Z",
  contact: { phone: null, email: null },
  groupMessages: true,
  off: [],
});
const membershipOf = (gym: string) =>
  myMembershipResponseSchema.parse({
    gym: { name: gym },
    today: "2026-11-16",
    record: "own",
    paidBy: null,
    memberships: [],
    paysFor: [],
    earlierNotShown: 0,
    purchases: [],
    purchasesNotShown: 0,
  });
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
    agreement: `I agree that ${gym} may save this card and charge it for my membership and any fees when they are due. I can remove it at the front desk at any time.`,
    form: {
      environment: "sandbox",
      applicationId: "sandbox-sq0idb-AbCdEfGhIjKlMnOp",
      locationId: location,
      contact: { givenName: "Tara", familyName: "Shah", email: "tara@gmail.com", countryCode: "US" },
    },
    ...over,
  }),
});

const inboxPath = (place: Place) => `/v1/orgs/${place.id}/inbox`;
const membershipPath = (place: Place) => `/v1/orgs/${place.id}/my-membership`;
const cardPath = (place: Place) => `/v1/orgs/${place.id}/my-card`;
/** Two places, each with its own card request, its own My membership and its own Square location. */
const twoPlaces = (over: Record<string, Route> = {}): Record<string, Route> => ({
  "/v1/auth/refresh": ok({ tokens: tokens(2) }),
  "/v1/orgs/mine": ok({ orgs: [org(IRON), org(LOTUS)], formerOrgs: [] }),
  [inboxPath(IRON)]: ok(inboxOf(IRON, [message(M1, "card_request", askBody("Iron House"))])),
  [inboxPath(LOTUS)]: ok(inboxOf(LOTUS, [message(M2, "card_request", askBody("Lotus Yoga"))])),
  [membershipPath(IRON)]: ok(membershipOf("Iron House")),
  [membershipPath(LOTUS)]: ok(membershipOf("Lotus Yoga")),
  [cardPath(IRON)]: ok(cardOf("Iron House", "LOCATIONIRON01")),
  [cardPath(LOTUS)]: ok(cardOf("Lotus Yoga", "LOCATIONLOTUS1")),
  ...over,
});

type Box = { props: { testID?: string; source: { html: string } }; gone: boolean };
const { boxes } = jest.requireMock<{ boxes: Box[] }>("react-native-webview");
const cardBoxes = () => boxes.filter((b) => !b.gone && b.props.testID === "card-boxes");
type PhoneScreen = { marks: string[]; missing: boolean; hold: boolean };
const { screen: phoneScreen } = jest.requireMock<{ screen: PhoneScreen }>("../../src/look/screenCaptureNative");

beforeEach(() => {
  boxes.length = 0;
  phoneScreen.marks.length = 0;
  phoneScreen.missing = false;
  phoneScreen.hold = false;
});
afterEach(() => {
  jest.restoreAllMocks();
});

async function openInbox(ask: Ask, place: Place) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(new RegExp(`^Inbox at ${place.name}`)));
}
const inbox = () => within(screen.getByTestId("inbox-page"));
const membership = () => within(screen.getByTestId("membership-page"));
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 30)));
async function pressAddCard(place: Place) {
  await fireEvent.press(await inbox().findByLabelText(`Add card at ${place.name}`));
}
const backKey = async () => {
  const shown = screen.container.queryAll((node) => node.props["visible"] === true && typeof node.props["onRequestClose"] === "function").at(-1);
  if (shown === undefined) throw new Error("no page open");
  await fireEvent(shown, "requestClose");
};

describe("the worst thing: Add card in a place's message opens Add card at that place alone, never at another", () => {
  it("a member of two places presses Add card in Lotus Yoga's message: Lotus's My membership and Lotus's own Square location", async () => {
    const server = fakeServer(twoPlaces());
    await openInbox(server.ask, LOTUS);
    await pressAddCard(LOTUS);
    await screen.findByTestId("add-card");
    expect(screen.queryByTestId("inbox-page")).toBeNull();
    expect(membership().getAllByText("Lotus Yoga").length).toBeGreaterThan(0);
    expect(server.asked.some((a) => a.path === membershipPath(LOTUS))).toBe(true);
    await waitFor(() => {
      expect(cardBoxes()).toHaveLength(1);
    });
    const html = cardBoxes()[0]?.props.source.html ?? "";
    expect(html).toContain("LOCATIONLOTUS1");
    expect(html).not.toContain("LOCATIONIRON01");
    expect(screen.getByLabelText("Save this card for Lotus Yoga")).toBeTruthy();
    expect(server.asked.some((a) => a.path === cardPath(IRON) || a.path === membershipPath(IRON))).toBe(false);
  });

  it("the same person presses Add card in Iron House's message: Iron House's, not Lotus's", async () => {
    const server = fakeServer(twoPlaces());
    await openInbox(server.ask, IRON);
    await pressAddCard(IRON);
    await screen.findByTestId("add-card");
    await waitFor(() => {
      expect(cardBoxes()).toHaveLength(1);
    });
    expect(cardBoxes()[0]?.props.source.html).toContain("LOCATIONIRON01");
    expect(screen.getByLabelText("Save this card for Iron House")).toBeTruthy();
    expect(server.asked.some((a) => a.path === cardPath(LOTUS) || a.path === membershipPath(LOTUS))).toBe(false);
  });
});

describe("Add card is under a card request alone", () => {
  it("a message staff typed, a review request and a payment notice have no Add card; the card request has one", async () => {
    const server = fakeServer(
      twoPlaces({
        [inboxPath(IRON)]: ok(
          inboxOf(IRON, [
            message(M1, "group", "Pool closed Sunday."),
            message(M2, "review", "Tell others what you think.", { link: "https://g.page/r/iron-house/review" }),
            message(M3, "payment_overdue", "Your payment of $40.00 to Iron House is overdue."),
          ]),
        ),
      }),
    );
    await openInbox(server.ask, IRON);
    await inbox().findByText("Pool closed Sunday.");
    expect(inbox().queryByText("Add card")).toBeNull();
    expect(inbox().getByText("Leave a review")).toBeTruthy();
  });

  it("the card request's words stay as the server wrote them, with Add card under them", async () => {
    const server = fakeServer(twoPlaces());
    await openInbox(server.ask, IRON);
    expect(await inbox().findByText(askBody("Iron House"))).toBeTruthy();
    expect(within(inbox().getByTestId(`message-${M1}`)).getByText("Add card")).toBeTruthy();
  });
});

describe("where a card can't be added now, My membership opens and says why", () => {
  it("a card was added since the message: My membership shows it, and Add card's page does not open", async () => {
    const server = fakeServer(twoPlaces({ [cardPath(IRON)]: ok(cardOf("Iron House", "LOCATIONIRON01", { card: VISA })) }));
    await openInbox(server.ask, IRON);
    await pressAddCard(IRON);
    expect(await membership().findByText("Visa ending 1111")).toBeTruthy();
    await settle();
    expect(screen.queryByTestId("add-card")).toBeNull();
  });

  it("somebody else pays for them now: the box says whose card is used", async () => {
    const server = fakeServer(twoPlaces({ [cardPath(IRON)]: ok(cardOf("Iron House", "LOCATIONIRON01", { paidBy: "Priya Sharma", canSave: false, form: null })) }));
    await openInbox(server.ask, IRON);
    await pressAddCard(IRON);
    expect(await membership().findByText("Priya Sharma pays for you, so Priya Sharma’s card is used.")).toBeTruthy();
    expect(screen.queryByTestId("add-card")).toBeNull();
  });

  it("the place takes no cards in the app now: a line in Card on file's place says to ask at the front desk", async () => {
    const server = fakeServer(twoPlaces({ [cardPath(IRON)]: ok(cardOf("Iron House", "LOCATIONIRON01", { state: "not_offered", canSave: false, form: null })) }));
    await openInbox(server.ask, IRON);
    await pressAddCard(IRON);
    expect(await membership().findByText("Iron House can’t save cards in the app right now. Ask at the front desk.")).toBeTruthy();
    expect(membership().getByText("Card on file")).toBeTruthy();
    expect(screen.queryByTestId("add-card")).toBeNull();
  });

  it("opened by itself, the same place says nothing about cards, as before", async () => {
    const server = fakeServer(twoPlaces({ [cardPath(IRON)]: ok(cardOf("Iron House", "LOCATIONIRON01", { state: "not_offered", canSave: false, form: null })) }));
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    const tab = (await screen.findAllByRole("tab"))[3];
    if (tab === undefined) throw new Error("no fourth tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText("My membership at Iron House"));
    await settle();
    expect(membership().queryByText("Card on file")).toBeNull();
    expect(screen.queryByTestId("add-card")).toBeNull();
  });

  it("the card could not be read: the line says so, and Try again opens Add card once it reads", async () => {
    let fail = true;
    const server = fakeServer(
      twoPlaces({ [cardPath(IRON)]: () => (fail ? lost() : { status: 200, body: cardOf("Iron House", "LOCATIONIRON01") }) }),
    );
    await openInbox(server.ask, IRON);
    await pressAddCard(IRON);
    expect(await membership().findByText("Couldn’t load your card.")).toBeTruthy();
    expect(screen.queryByTestId("add-card")).toBeNull();
    fail = false;
    await fireEvent.press(membership().getByText("Try again"));
    expect(await screen.findByTestId("add-card")).toBeTruthy();
  });
});

describe("leaving Add card", () => {
  it("back from Add card: My membership says No card on file with Add card, and the page does not open again by itself", async () => {
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      listeners.push(handler as (state: string) => void);
      return { remove: () => undefined };
    });
    const server = fakeServer(twoPlaces());
    await openInbox(server.ask, IRON);
    await pressAddCard(IRON);
    await screen.findByTestId("add-card");
    await backKey();
    await waitFor(() => {
      expect(screen.queryByTestId("add-card")).toBeNull();
    });
    expect(await membership().findByText("No card on file")).toBeTruthy();
    expect(membership().getByText("Add card")).toBeTruthy();
    await act(() => {
      for (const one of listeners) one("active");
    });
    await settle();
    expect(screen.queryByTestId("add-card")).toBeNull();
  });

  it("back from My membership lands on the Gym tab, where the place's Inbox and My membership are", async () => {
    const server = fakeServer(twoPlaces());
    await openInbox(server.ask, IRON);
    await pressAddCard(IRON);
    await screen.findByTestId("add-card");
    await backKey();
    await waitFor(() => {
      expect(screen.queryByTestId("add-card")).toBeNull();
    });
    await backKey();
    await waitFor(() => {
      expect(screen.queryByTestId("membership-page")).toBeNull();
    });
    expect(screen.getByLabelText(/^Inbox at Iron House/)).toBeTruthy();
    expect(screen.getByLabelText("My membership at Iron House")).toBeTruthy();
  });
});

describe("the page is scrolled to Card on file", () => {
  const scrolls = () => {
    const spy = jest.fn();
    jest.spyOn(ScrollView.prototype as unknown as { scrollTo: (o: unknown) => void }, "scrollTo").mockImplementation(spy);
    return spy;
  };
  const drawAt = async (y: number) => {
    await fireEvent(await membership().findByTestId("card-place"), "layout", { nativeEvent: { layout: { x: 0, y, width: 390, height: 200 } } });
  };

  it("opened from the message: once, to the box, so what Add card did is in view when it closes", async () => {
    const spy = scrolls();
    const server = fakeServer(twoPlaces());
    await openInbox(server.ask, IRON);
    await pressAddCard(IRON);
    await screen.findByTestId("add-card");
    await drawAt(1400);
    await drawAt(1500);
    expect(spy.mock.calls).toEqual([[{ y: 1392, animated: false }]]);
  });

  it("drawn before the page knew its height: scrolled again as it grows, until the box can be reached or the person scrolls", async () => {
    const spy = scrolls();
    const server = fakeServer(twoPlaces());
    await openInbox(server.ask, IRON);
    await pressAddCard(IRON);
    await screen.findByTestId("add-card");
    const page = membership().getByTestId("membership-scroll");
    await fireEvent(page, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } } });
    await fireEvent(page, "contentSizeChange", 390, 900);
    await drawAt(1400);
    // Not tall enough yet: kept, and scrolled again with each growth.
    await fireEvent(page, "contentSizeChange", 390, 1500);
    await fireEvent(page, "contentSizeChange", 390, 2400);
    // Reached: nothing more.
    await fireEvent(page, "contentSizeChange", 390, 2600);
    expect(spy.mock.calls).toEqual([[{ y: 1392, animated: false }], [{ y: 1392, animated: false }], [{ y: 1392, animated: false }]]);
  });

  it("the person scrolls by hand before the page is tall enough: never scrolled for them after that", async () => {
    const spy = scrolls();
    const server = fakeServer(twoPlaces());
    await openInbox(server.ask, IRON);
    await pressAddCard(IRON);
    await screen.findByTestId("add-card");
    const page = membership().getByTestId("membership-scroll");
    await fireEvent(page, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 700 } } });
    await drawAt(1400);
    await fireEvent(page, "scrollBeginDrag");
    await fireEvent(page, "contentSizeChange", 390, 2600);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("Add card's page closes: scrolled to the box again once, now this page is in front", async () => {
    const spy = scrolls();
    const server = fakeServer(twoPlaces());
    await openInbox(server.ask, IRON);
    await pressAddCard(IRON);
    await screen.findByTestId("add-card");
    await drawAt(1400);
    await backKey();
    await waitFor(() => {
      expect(screen.queryByTestId("add-card")).toBeNull();
    });
    expect(spy.mock.calls).toEqual([[{ y: 1392, animated: false }], [{ y: 1392, animated: false }]]);
    // Add card pressed again from the box, and closed: the box is already in view, and nothing scrolls.
    await fireEvent.press(membership().getByText("Add card"));
    await screen.findByTestId("add-card");
    await backKey();
    await waitFor(() => {
      expect(screen.queryByTestId("add-card")).toBeNull();
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("opened by itself: never scrolled", async () => {
    const spy = scrolls();
    const server = fakeServer(twoPlaces());
    await render(<App extra={extra} ask={server.ask} store={memoryStore(kept(1))} wait={noWait} />);
    const tab = (await screen.findAllByRole("tab"))[3];
    if (tab === undefined) throw new Error("no fourth tab");
    await fireEvent.press(tab);
    await fireEvent.press(await screen.findByLabelText("My membership at Iron House"));
    await drawAt(1400);
    expect(spy).not.toHaveBeenCalled();
  });
});
