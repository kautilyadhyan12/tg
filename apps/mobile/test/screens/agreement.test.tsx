// Signing a membership agreement on the phone (ROADMAP Stage 5 item 20c). The first block is the worst thing this job
// could do to a real person: hold them to a price or terms they never saw — one membership's details or one business's
// words under another's name, or details changed while the page was open — or say it is signed when it is not. Every
// answer is read through the server's own shape.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { AGREEMENT_AGREE_LABEL, AGREEMENT_WORDS, MY_AGREEMENT_WORDS, UNSIGNED_BOOKING_WORDS, myAgreementResponseSchema, myMembershipResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { fakeServer, kept, memoryStore, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000", webUrl: "http://localhost:5173" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

type Place = { id: string; name: string; city: string | null; orgType: string; clockFormat: "12h" | "24h" };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Leeds", orgType: "gym", clockFormat: "12h" };
const LOTUS: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Lotus Yoga", city: null, orgType: "yoga_studio", clockFormat: "24h" };
const M_IRON = "11111111-1111-4111-8111-111111111111";
const M_LOTUS = "22222222-2222-4222-8222-222222222222";
const M_PACK = "33333333-3333-4333-8333-333333333333";
const org = (gym: Place, toSign: { membershipId: string; name: string }[]) => ({
  ...gym,
  slug: gym.name.toLowerCase().replace(" ", "-"),
  timezone: "Europe/London",
  locale: "en",
  currencyDisplay: "GBP",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
  agreementsToSign: toSign,
});
const IRON_TERMS = { id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", version: 1, text: "Iron House's membership terms.", name: null };
const IRON_TERMS_2 = { id: "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa", version: 2, text: "Iron House's new membership terms.", name: null };
const LOTUS_TERMS = { id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb", version: 1, text: "Lotus Yoga's membership terms.", name: "Class pass terms" };
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const KEY_C = "c".repeat(64);
const facts = (gym: string, price: string) => [
  { label: "Business", value: gym },
  { label: "Member", value: "Maya Patel" },
  { label: "Membership", value: "Gold Monthly" },
  { label: "Price", value: price },
];
const AT = "2026-11-07T10:30:00.000Z";
type Over = Record<string, unknown>;
const pageOf = (place: Place, membershipId: string, over: Over = {}) =>
  myAgreementResponseSchema.parse({
    gymId: place.id,
    membershipId,
    gymName: place.name,
    timezone: "Europe/London",
    membershipName: "Gold Monthly",
    state: "to_sign",
    why: null,
    agreement: null,
    facts: null,
    factsKey: null,
    signed: null,
    ...over,
  });
type Terms = { id: string; version: number; text: string; name: string | null };
const toSign = (place: Place, membershipId: string, terms: Terms, price: string, key: string) =>
  pageOf(place, membershipId, { agreement: terms, facts: facts(place.name, price), factsKey: key });
const signedReply = (gym: string, text: string) => ({ signed: { name: "Maya Patel", at: AT, text, facts: facts(gym, "£50.00 every month"), agreementName: null }, emailed: "sent" });
const readPath = (place: Place, membershipId: string) => `/v1/orgs/${place.id}/memberships/${membershipId}/agreement/mine`;
const signPath = (place: Place, membershipId: string) => `${readPath(place, membershipId)}/sign`;

async function openGym(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
}
const signIt = async (name: string) => {
  await fireEvent.changeText(await screen.findByLabelText("Full name"), name);
  await fireEvent.press(screen.getByLabelText(AGREEMENT_AGREE_LABEL));
};
const posts = (asked: { method: string; path: string; body: unknown }[]) => asked.filter((one) => one.method === "POST" && one.path.includes("/agreement/"));

describe("the worst thing: terms or a price signed that were never shown, or said to be signed when not", () => {
  it("each card asks for its own membership; each page shows and signs that membership's own details and words", async () => {
    let ironSigned = false;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": () => ({
        status: 200,
        body: { orgs: [org(IRON, ironSigned ? [] : [{ membershipId: M_IRON, name: "Gold Monthly" }]), org(LOTUS, [{ membershipId: M_LOTUS, name: "10-class pass" }])], formerOrgs: [] },
      }),
      [readPath(IRON, M_IRON)]: ok(toSign(IRON, M_IRON, IRON_TERMS, "£50.00 every month", KEY_A)),
      [readPath(LOTUS, M_LOTUS)]: ok(toSign(LOTUS, M_LOTUS, LOTUS_TERMS, "£80.00", KEY_B)),
      [signPath(IRON, M_IRON)]: () => {
        ironSigned = true;
        return { status: 200, body: signedReply("Iron House", IRON_TERMS.text) };
      },
    });
    await openGym(server.ask);
    expect(await screen.findByTestId(`agreement-ask-${M_IRON}`)).toBeTruthy();
    expect(screen.getByText("Iron House asks you to sign the agreement for Gold Monthly.")).toBeTruthy();
    expect(screen.getByText("Lotus Yoga asks you to sign the agreement for 10-class pass.")).toBeTruthy();

    await fireEvent.press(screen.getByTestId(`agreement-ask-${M_IRON}`));
    const paper = within(await screen.findByTestId("agreement-paper"));
    // Iron House's details and words, never Lotus Yoga's.
    expect(paper.getByText("£50.00 every month")).toBeTruthy();
    expect(paper.getByText(IRON_TERMS.text)).toBeTruthy();
    expect(paper.getByText("Iron House’s terms")).toBeTruthy();
    expect(paper.queryByText("£80.00")).toBeNull();
    expect(paper.queryByText(LOTUS_TERMS.text)).toBeNull();
    // Sign waits for the name and the tick.
    expect(screen.getByLabelText("Sign Iron House's membership agreement")).toBeDisabled();
    await signIt("  Maya   Patel ");
    await fireEvent.press(screen.getByLabelText("Sign Iron House's membership agreement"));
    expect(await screen.findByText("You signed Iron House’s membership agreement.")).toBeTruthy();
    expect(screen.getByText("Signed on 7 November 2026 as Maya Patel. A copy was emailed to you.")).toBeTruthy();
    expect(posts(server.asked)).toEqual([expect.objectContaining({ path: signPath(IRON, M_IRON), body: { agreementId: IRON_TERMS.id, factsKey: KEY_A, name: "Maya Patel" } })]);

    // Done reads the places again: Iron's ask has gone, Lotus Yoga's stays.
    await fireEvent.press(screen.getByText("Done"));
    await waitFor(() => {
      expect(screen.queryByTestId(`agreement-ask-${M_IRON}`)).toBeNull();
    });
    expect(screen.getByTestId(`agreement-ask-${M_LOTUS}`)).toBeTruthy();

    // Lotus Yoga's own page: its own details, words and the agreement's own name.
    await fireEvent.press(screen.getByTestId(`agreement-ask-${M_LOTUS}`));
    const lotus = within(await screen.findByTestId("agreement-paper"));
    expect(lotus.getByText("£80.00")).toBeTruthy();
    expect(lotus.getByText("Class pass terms")).toBeTruthy();
    expect(lotus.queryByText(IRON_TERMS.text)).toBeNull();
  });

  it("an answer naming another membership or another business is never shown, or signed, under this one", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [org(IRON, [{ membershipId: M_IRON, name: "Gold Monthly" }, { membershipId: M_PACK, name: "10-class pack" }]), org(LOTUS, [])], formerOrgs: [] }),
      // Iron House's Gold Monthly answered with its pack's page, and its pack with Lotus Yoga's.
      [readPath(IRON, M_IRON)]: ok(toSign(IRON, M_PACK, IRON_TERMS, "£90.00", KEY_C)),
      [readPath(IRON, M_PACK)]: ok(toSign(LOTUS, M_PACK, LOTUS_TERMS, "£80.00", KEY_B)),
    });
    await openGym(server.ask);
    for (const id of [M_IRON, M_PACK]) {
      await fireEvent.press(await screen.findByTestId(`agreement-ask-${id}`));
      expect(await screen.findByText("We couldn't load the agreement. Please try again.")).toBeTruthy();
      expect(screen.queryByText("£90.00")).toBeNull();
      expect(screen.queryByText(LOTUS_TERMS.text)).toBeNull();
      expect(screen.queryByLabelText("Sign Iron House's membership agreement")).toBeNull();
      await fireEvent.press(screen.getByLabelText("Close"));
    }
    expect(posts(server.asked)).toEqual([]);
  });

  it("details or words changed while the page was open are never signed: the page says so and shows them as they are now", async () => {
    let reads = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [org(IRON, [{ membershipId: M_IRON, name: "Gold Monthly" }])], formerOrgs: [] }),
      [readPath(IRON, M_IRON)]: () => {
        reads += 1;
        if (reads === 1) return { status: 200, body: toSign(IRON, M_IRON, IRON_TERMS, "£50.00 every month", KEY_A) };
        if (reads === 2) return { status: 200, body: toSign(IRON, M_IRON, IRON_TERMS, "£55.00 every month", KEY_B) };
        return { status: 200, body: toSign(IRON, M_IRON, IRON_TERMS_2, "£55.00 every month", KEY_B) };
      },
      [signPath(IRON, M_IRON)]: (body) => {
        const sent = body as { agreementId: string; factsKey: string };
        if (sent.factsKey !== KEY_B) return refusal(409, "facts_changed", AGREEMENT_WORDS.facts_changed);
        if (sent.agreementId !== IRON_TERMS_2.id) return refusal(409, "agreement_changed", AGREEMENT_WORDS.agreement_changed("Iron House"));
        return { status: 200, body: signedReply("Iron House", IRON_TERMS_2.text) };
      },
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`agreement-ask-${M_IRON}`));
    await screen.findByText("£50.00 every month");
    await signIt("Maya Patel");
    const sign = () => screen.getByLabelText("Sign Iron House's membership agreement");
    await fireEvent.press(sign());
    // The price changed at the desk: said, and the new price shown; the tick asked again.
    expect(await screen.findByText(AGREEMENT_WORDS.facts_changed)).toBeTruthy();
    expect(await screen.findByText("£55.00 every month")).toBeTruthy();
    expect(screen.queryByText("£50.00 every month")).toBeNull();
    expect(sign()).toBeDisabled();
    await fireEvent.press(screen.getByLabelText(AGREEMENT_AGREE_LABEL));
    await fireEvent.press(sign());
    // Then the words changed too: said, and the new words shown.
    expect(await screen.findByText(AGREEMENT_WORDS.agreement_changed("Iron House"))).toBeTruthy();
    expect(await screen.findByText(IRON_TERMS_2.text)).toBeTruthy();
    expect(screen.queryByText(/You signed/)).toBeNull();
    await fireEvent.press(screen.getByLabelText(AGREEMENT_AGREE_LABEL));
    await fireEvent.press(sign());
    expect(await screen.findByText("You signed Iron House’s membership agreement.")).toBeTruthy();
    const sent = posts(server.asked).map((one) => one.body as { agreementId: string; factsKey: string });
    expect(sent).toEqual([
      { agreementId: IRON_TERMS.id, factsKey: KEY_A, name: "Maya Patel" },
      { agreementId: IRON_TERMS.id, factsKey: KEY_B, name: "Maya Patel" },
      { agreementId: IRON_TERMS_2.id, factsKey: KEY_B, name: "Maya Patel" },
    ]);
  });
});

const membership = (id: string, name: string, agreement: Over | null): Over => ({
  id,
  name,
  kind: "recurring",
  priceMinor: 5000,
  currency: "GBP",
  status: "active",
  startsOn: "2026-11-07",
  fromList: false,
  endsOn: null,
  renewsOn: "2026-12-07",
  frozenOn: null,
  classesLeft: null,
  packClasses: null,
  owed: null,
  payments: [],
  olderPeriodsNotShown: 0,
  fees: [],
  agreement,
});
const myMembership = (memberships: Over[], paidBy: string | null = null) =>
  myMembershipResponseSchema.parse({ gym: { name: "Iron House" }, today: "2026-11-07", record: "own", paidBy, memberships, paysFor: [], earlierNotShown: 0, purchases: [], purchasesNotShown: 0 });

describe("My membership, Classes and the desk", () => {
  it("My membership says each membership's agreement: View opens what was signed, Sign opens it to sign, the desk's has no button", async () => {
    const signedPage = pageOf(IRON, M_IRON, { state: "signed", signed: { name: "Maya Patel", at: AT, text: IRON_TERMS.text, facts: facts("Iron House", "£50.00 every month"), agreementName: null } });
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [org(IRON, [{ membershipId: M_PACK, name: "10-class pack" }])], formerOrgs: [] }),
      "/v1/orgs/1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f/my-membership": ok(
        myMembership([
          membership(M_IRON, "Gold Monthly", { state: "signed", signedOn: "2026-11-07", signedName: "Maya Patel", view: true }),
          membership(M_PACK, "10-class pack", { state: "to_sign", signedOn: null, signedName: null, view: false }),
          membership(M_LOTUS, "Family plan", { state: "at_desk", signedOn: null, signedName: null, view: false }),
        ]),
      ),
      [readPath(IRON, M_IRON)]: ok(signedPage),
      [readPath(IRON, M_PACK)]: ok(toSign(IRON, M_PACK, IRON_TERMS, "£90.00", KEY_C)),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByLabelText("My membership at Iron House"));
    const gold = within(await screen.findByTestId(`agreement-row-${M_IRON}`));
    expect(gold.getByText("Agreement signed")).toBeTruthy();
    expect(gold.getByText("7 November 2026, as Maya Patel")).toBeTruthy();
    const pack = within(screen.getByTestId(`agreement-row-${M_PACK}`));
    expect(pack.getByText("Agreement not signed")).toBeTruthy();
    expect(pack.getByText("Iron House asks you to sign it.")).toBeTruthy();
    const family = within(screen.getByTestId(`agreement-row-${M_LOTUS}`));
    expect(family.getByText("Sign it at the front desk.")).toBeTruthy();
    expect(family.queryByText("Sign")).toBeNull();

    // View: what was signed, when and as whom, and nothing to sign.
    await fireEvent.press(screen.getByLabelText("View the agreement for Gold Monthly"));
    const paper = within(await screen.findByTestId("agreement-paper"));
    expect(paper.getByText(IRON_TERMS.text)).toBeTruthy();
    expect(paper.getByText("Signed on 7 November 2026 as Maya Patel.")).toBeTruthy();
    expect(screen.queryByLabelText("Sign Iron House's membership agreement")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Close"));

    // Sign: the pack's own page.
    await fireEvent.press(screen.getByLabelText("Sign the agreement for 10-class pack"));
    expect(await screen.findByText("£90.00")).toBeTruthy();
    expect(screen.getByLabelText("Sign Iron House's membership agreement")).toBeTruthy();
  });

  it("a membership signed at the front desk says why, and offers no Sign", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [org(IRON, [])], formerOrgs: [] }),
      "/v1/orgs/1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f/my-membership": ok(
        myMembership([membership(M_IRON, "Gold Monthly", { state: "signed", signedOn: "2026-11-07", signedName: "Maya Patel", view: false })], "Ravi Patel"),
      ),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByLabelText("My membership at Iron House"));
    const gold = within(await screen.findByTestId(`agreement-row-${M_IRON}`));
    expect(gold.getByText("Agreement signed")).toBeTruthy();
    // Somebody else pays: what was signed holds the price, so it is not opened here.
    expect(screen.queryByLabelText("View the agreement for Gold Monthly")).toBeNull();
    expect(MY_AGREEMENT_WORDS.paid_by_other).toContain("front desk");
  });

  it("Classes, where the business stops bookings until it is signed: Sign agreement opens it; with nothing to sign in the app, the server's own words", async () => {
    const klass = {
      sessionId: "44444444-4444-4444-8444-444444444444",
      className: "Morning Flow",
      localDate: "2026-11-09",
      localStartMinute: 7 * 60,
      timezone: "Europe/London",
      startsAt: "2026-11-09T07:00:00.000Z",
      minutes: 60,
      cancelled: false,
      places: 12,
      booked: 3,
      waitlisted: 0,
      opensAt: "2026-11-02T07:00:00.000Z",
      freeCancelUntil: "2026-11-09T05:00:00.000Z",
      mine: null,
      can: { book: false, joinWaitlist: false, claim: false, cancel: null, why: "agreement_not_signed" },
      online: null,
      fees: null,
    };
    const weekOf = { week: 0, from: "2026-11-08", to: "2026-11-14", timezone: "Europe/London", classes: [klass], more: false };
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [org(IRON, [{ membershipId: M_IRON, name: "Gold Monthly" }]), org(LOTUS, [])], formerOrgs: [] }),
      [`/v1/orgs/${IRON.id}/member-classes`]: ok(weekOf),
      [`/v1/orgs/${LOTUS.id}/member-classes`]: ok(weekOf),
      [readPath(IRON, M_IRON)]: ok(toSign(IRON, M_IRON, IRON_TERMS, "£50.00 every month", KEY_A)),
    });
    await openGym(server.ask);
    // Lotus Yoga: nothing to sign in the app, so its own words, and no button.
    await fireEvent.press(await screen.findByLabelText("Classes at Lotus Yoga"));
    const lotusBox = within(await screen.findByTestId(`class-${klass.sessionId}`));
    expect(lotusBox.getByText(UNSIGNED_BOOKING_WORDS)).toBeTruthy();
    expect(lotusBox.queryByText("Sign agreement")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Back"));

    // Iron House: the line and its button, which opens the agreement over Classes.
    await fireEvent.press(await screen.findByLabelText("Classes at Iron House"));
    const box = within(await screen.findByTestId(`class-${klass.sessionId}`));
    expect(box.getByText("Your membership agreement isn't signed yet. Sign it to book.")).toBeTruthy();
    expect(box.queryByText(UNSIGNED_BOOKING_WORDS)).toBeNull();
    await fireEvent.press(box.getByText("Sign agreement"));
    expect(await screen.findByText(IRON_TERMS.text)).toBeTruthy();
    expect(screen.getByLabelText("Sign Iron House's membership agreement")).toBeTruthy();
  });
});
