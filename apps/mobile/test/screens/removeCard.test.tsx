import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { MEMBER_CARD_WORDS, myCardViewSchema, myMembershipResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import { NO_ANSWER } from "../../src/screens/SignIn";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, lost, memoryStore, refusal, tokens, type Reply } from "../kit";

// Remove card on the phone (ROADMAP Stage 5 item 20e): the member's own card, while nothing can be charged to it. The
// server decides when (`myCardRemove.routes.test.ts`); the phone offers Remove card only where it says so, asks first,
// sends the card it showed, and says what happened in the box.

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
const mine = (...gyms: Place[]) => ok({ orgs: gyms.map(org), formerOrgs: [] });
const membershipOf = (gym: string) =>
  myMembershipResponseSchema.parse({ gym: { name: gym }, today: "2026-11-10", record: "own", paidBy: null, memberships: [], paysFor: [], earlierNotShown: 0, purchases: [], purchasesNotShown: 0 });

const card = (last4: string, savedAt: string) => ({
  brand: "VISA",
  last4,
  expMonth: 12,
  expYear: 2028,
  expired: false,
  expiresThisMonth: false,
  expiryReminder: null,
  expiryReminderOn: null,
  savedAt,
  savedFrom: "app",
});
const IRON_CARD = card("4242", "2026-11-01T09:00:00.000Z");
const LOTUS_CARD = card("1111", "2026-11-10T10:00:00.000Z");
const cardOf = (gym: string, over: Record<string, unknown> = {}) => ({
  myCard: myCardViewSchema.parse({
    record: "own",
    state: "ready",
    card: null,
    earlierCard: null,
    paidBy: null,
    canSave: true,
    gymName: gym,
    agreement: `I agree that ${gym} may save this card and charge it for my membership and any fees when they are due. I can remove it at the front desk at any time.`,
    form: { environment: "sandbox", applicationId: "sandbox-sq0idb-AbCdEfGhIjKlMnOp", locationId: "LOCATION0001", contact: { givenName: "Tara", familyName: "Shah", email: "tara@gmail.com", countryCode: "US" } },
    ...over,
  }),
});
const membershipPath = (place: Place) => `/v1/orgs/${place.id}/my-membership`;
const cardPath = (place: Place) => `/v1/orgs/${place.id}/my-card`;
const removePath = (place: Place) => `/v1/orgs/${place.id}/my-card/remove`;

async function openMembership(ask: Ask, place: Place) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
  await fireEvent.press(await screen.findByLabelText(`My membership at ${place.name}`));
}
const page = () => within(screen.getByTestId("membership-page"));
const removePosts = (asked: { method: string; path: string; body: unknown }[]) => asked.filter((a) => a.method === "POST" && a.path.endsWith("/my-card/remove"));
/** The box from the bottom's own Remove card: the last one on the screen. */
const confirmRemove = async () => {
  const buttons = await screen.findAllByText("Remove card");
  const last = buttons.at(-1);
  if (last === undefined || buttons.length < 2) throw new Error("the box did not open");
  await fireEvent.press(last);
};

describe("the worst thing: a card removed at one gym is that gym's card alone", () => {
  it("a member of two gyms removes their card at Lotus Yoga: only Lotus is sent it, naming the card shown, and the box says it went", async () => {
    let lotusGone = false;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON, LOTUS),
      [membershipPath(IRON)]: ok(membershipOf("Iron House")),
      [membershipPath(LOTUS)]: ok(membershipOf("Lotus Yoga")),
      [cardPath(IRON)]: ok(cardOf("Iron House", { card: IRON_CARD, canRemove: true })),
      [cardPath(LOTUS)]: () => ({ status: 200, body: cardOf("Lotus Yoga", lotusGone ? {} : { card: LOTUS_CARD, canRemove: true }) }),
      [removePath(LOTUS)]: () => {
        lotusGone = true;
        return { status: 200, body: cardOf("Lotus Yoga") };
      },
    });
    await openMembership(server.ask, LOTUS);
    await fireEvent.press(await page().findByText("Remove card"));
    expect(await screen.findByText("Remove Visa ending 1111?")).toBeTruthy();
    expect(screen.getByText("Lotus Yoga won’t be able to charge it. You can add a card again at any time.")).toBeTruthy();
    expect(removePosts(server.asked)).toHaveLength(0);

    await confirmRemove();
    await waitFor(() => {
      expect(page().getByText("Card removed: Visa ending 1111.")).toBeTruthy();
    });
    expect(page().getByText("No card on file")).toBeTruthy();
    expect(page().getByText("Add card")).toBeTruthy();
    expect(screen.queryByText("Remove Visa ending 1111?")).toBeNull();
    const posts = removePosts(server.asked);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.path).toBe(removePath(LOTUS));
    expect(posts[0]?.body).toEqual({ last4: "1111", savedAt: "2026-11-10T10:00:00.000Z" });
    expect(server.asked.some((a) => a.path.startsWith(`/v1/orgs/${IRON.id}/my-card`))).toBe(false);
  });
});

describe("Remove card is offered only where the server says nothing is charged to the card", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["a membership renews on it", { stays: "renews" }, "Your membership renews on this card, so it stays on file. Use Update card to change it, or ask the front desk."],
    ["a payment still to make", { stays: "owed" }, "You have a payment still to make, so this card stays on file. Use Update card to change it, or ask the front desk."],
    ["it pays for Aarav too", { stays: "pays_for", paysFor: { names: ["Aarav Sharma"], more: 0 } }, "This card also pays for Aarav Sharma, so it stays on file. Use Update card to change it, or ask the front desk."],
    ["the server says nothing either way", {}, "To remove this card, ask the front desk."],
  ])("%s: no Remove card, and the line says why", async (_name, over, line) => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [membershipPath(IRON)]: ok(membershipOf("Iron House")),
      [cardPath(IRON)]: ok(cardOf("Iron House", { card: IRON_CARD, ...over })),
    });
    await openMembership(server.ask, IRON);
    expect(await page().findByText(line)).toBeTruthy();
    expect(page().getByText("Update card")).toBeTruthy();
    expect(page().queryByText("Remove card")).toBeNull();
  });
});

describe("pressing it", () => {
  const withCard = (remove: () => Reply, after: () => Record<string, unknown> = () => ({ card: IRON_CARD, canRemove: true })) =>
    fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": mine(IRON),
      [membershipPath(IRON)]: ok(membershipOf("Iron House")),
      [cardPath(IRON)]: () => ({ status: 200, body: cardOf("Iron House", after()) }),
      [removePath(IRON)]: remove,
    });

  it("Cancel sends nothing and keeps the card", async () => {
    const server = withCard(() => ({ status: 200, body: cardOf("Iron House") }));
    await openMembership(server.ask, IRON);
    await fireEvent.press(await page().findByText("Remove card"));
    await fireEvent.press(await screen.findByText("Cancel"));
    await waitFor(() => {
      expect(screen.queryByText("Remove Visa ending 4242?")).toBeNull();
    });
    expect(removePosts(server.asked)).toHaveLength(0);
    expect(page().getByText("Visa ending 4242")).toBeTruthy();
  });

  it("refused because a membership was given meanwhile: the box says why, only Close is left, and Card on file says it too", async () => {
    let given = false;
    const line = "Your membership renews on this card, so it stays on file. Use Update card to change it, or ask the front desk.";
    const server = withCard(
      () => {
        given = true;
        return refusal(409, "card_stays", line);
      },
      () => (given ? { card: IRON_CARD, stays: "renews" } : { card: IRON_CARD, canRemove: true }),
    );
    await openMembership(server.ask, IRON);
    await fireEvent.press(await page().findByText("Remove card"));
    await confirmRemove();
    expect(await within(await screen.findByTestId("remove-problem")).findByText(line)).toBeTruthy();
    expect(screen.queryByText("Cancel")).toBeNull();
    await fireEvent.press(screen.getAllByText("Close").at(-1) ?? screen.getByText("Close"));
    expect(await page().findByText(line)).toBeTruthy();
    expect(page().queryByText("Remove card")).toBeNull();
    expect(page().queryByText(/Card removed/)).toBeNull();
  });

  it("the card replaced on another screen meanwhile: said, and nothing is removed", async () => {
    const server = withCard(() => refusal(409, "card_changed", MEMBER_CARD_WORDS.card_changed));
    await openMembership(server.ask, IRON);
    await fireEvent.press(await page().findByText("Remove card"));
    await confirmRemove();
    expect(await screen.findByText(MEMBER_CARD_WORDS.card_changed)).toBeTruthy();
    expect(page().queryByText(/Card removed/)).toBeNull();
  });

  it("no answer, and the card is gone when read again: it went, and is said so", async () => {
    let gone = false;
    const server = withCard(
      () => {
        gone = true;
        return lost();
      },
      () => (gone ? {} : { card: IRON_CARD, canRemove: true }),
    );
    await openMembership(server.ask, IRON);
    await fireEvent.press(await page().findByText("Remove card"));
    await confirmRemove();
    await waitFor(() => {
      expect(page().getByText("Card removed: Visa ending 4242.")).toBeTruthy();
    });
  });

  it("no answer, and the card is still there: says so, and Remove card can be pressed again", async () => {
    const server = withCard(lost);
    await openMembership(server.ask, IRON);
    await fireEvent.press(await page().findByText("Remove card"));
    await confirmRemove();
    expect(await screen.findByText(NO_ANSWER)).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
    expect(page().queryByText(/Card removed/)).toBeNull();
  });
});
