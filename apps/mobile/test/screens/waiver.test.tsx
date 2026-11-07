// Signing a business's waiver on the phone (ROADMAP Stage 5 item 20b). The first block is the worst
// thing this job could do to a real person: tell them they signed a waiver they never signed, or sign
// words they were never shown — one business's words under another's name, or older words. Every
// answer is read through the server's own shape.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { WAIVER_AGREE_LABEL, WAIVER_WORDS, myWaiverResponseSchema } from "@app/shared";
import { App } from "../../src/App";
import type { Ask } from "../../src/session/calls";
import { NO_ANSWER } from "../../src/screens/SignIn";
import { fakeServer, kept, memoryStore, refusal, tokens, type Reply } from "../kit";

const extra = { copyName: "Feature 1", apiUrl: "http://localhost:3000", webUrl: "http://localhost:5173" };
const noWait = () => Promise.resolve();
const ok = (body: unknown) => (): Reply => ({ status: 200, body });

type Place = { id: string; name: string; city: string | null; orgType: string; clockFormat: "12h" | "24h" };
const IRON: Place = { id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", name: "Iron House", city: "Leeds", orgType: "gym", clockFormat: "12h" };
const LOTUS: Place = { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Lotus Yoga", city: null, orgType: "yoga_studio", clockFormat: "24h" };
const org = (gym: Place, waiver: "to_sign" | "signed" | null) => ({
  ...gym,
  slug: gym.name.toLowerCase().replace(" ", "-"),
  timezone: "Europe/London",
  locale: "en",
  currencyDisplay: "GBP",
  status: "active",
  staffRole: null,
  isMember: true,
  joinedAt: "2026-10-01T00:00:00.000Z",
  waiver,
});
const IRON_V1 = { id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", version: 1, text: "Iron House's waiver, first words." };
const IRON_V2 = { id: "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa", version: 2, text: "Iron House's waiver, new words." };
const LOTUS_V1 = { id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb", version: 1, text: "Lotus Yoga's waiver." };
const mineOf = (place: Place, waiver: typeof IRON_V1 | null, signed: { name: string; at: string } | null = null) =>
  myWaiverResponseSchema.parse({ gymId: place.id, gymName: place.name, timezone: "Europe/London", waiver, signed });
const readPath = (place: Place) => `/v1/orgs/${place.id}/waiver/mine`;
const signPath = (place: Place) => `/v1/orgs/${place.id}/waiver/sign`;
const AT = "2026-11-07T10:30:00.000Z";

async function openGym(ask: Ask) {
  await render(<App extra={extra} ask={ask} store={memoryStore(kept(1))} wait={noWait} />);
  const tab = (await screen.findAllByRole("tab"))[3];
  if (tab === undefined) throw new Error("no fourth tab");
  await fireEvent.press(tab);
}
const signIt = async (name: string) => {
  await fireEvent.changeText(await screen.findByLabelText("Full name"), name);
  await fireEvent.press(screen.getByLabelText(WAIVER_AGREE_LABEL));
};
const askOf = (place: Place) => screen.queryByTestId(`waiver-ask-${place.id}`);

describe("the worst thing: a waiver said to be signed that was not, or words signed that were never shown", () => {
  it("each card asks only for its own business; each page shows and signs that business's own words", async () => {
    let ironSigned = false;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": () => ({ status: 200, body: { orgs: [org(IRON, ironSigned ? "signed" : "to_sign"), org(LOTUS, "signed")], formerOrgs: [] } }),
      [readPath(IRON)]: ok(mineOf(IRON, IRON_V1)),
      [readPath(LOTUS)]: ok(mineOf(LOTUS, LOTUS_V1, { name: "Maya Patel", at: AT })),
      [signPath(IRON)]: () => {
        ironSigned = true;
        return { status: 200, body: { signed: { name: "Maya Patel", at: AT } } };
      },
    });
    await openGym(server.ask);
    expect(await screen.findByTestId(`waiver-ask-${IRON.id}`)).toBeTruthy();
    // Lotus Yoga's was signed: no ask, its Waiver link instead.
    expect(askOf(LOTUS)).toBeNull();
    expect(screen.queryByLabelText("Waiver at Iron House")).toBeNull();
    expect(screen.getByLabelText("Waiver at Lotus Yoga")).toBeTruthy();

    await fireEvent.press(screen.getByTestId(`waiver-ask-${IRON.id}`));
    expect(await screen.findByText(IRON_V1.text)).toBeTruthy();
    expect(screen.queryByText(LOTUS_V1.text)).toBeNull();
    // Sign waits for the name and the tick.
    const sign = screen.getByLabelText("Sign Iron House's waiver");
    expect(sign).toBeDisabled();
    await signIt("  Maya   Patel ");
    await fireEvent.press(screen.getByLabelText("Sign Iron House's waiver"));
    expect(await screen.findByText("You signed Iron House’s waiver.")).toBeTruthy();
    expect(screen.getByText("Signed on 7 November 2026 as Maya Patel.")).toBeTruthy();
    const posts = server.asked.filter((one) => one.method === "POST" && one.path.includes("/waiver/"));
    expect(posts).toEqual([expect.objectContaining({ path: signPath(IRON), body: { waiverId: IRON_V1.id, name: "Maya Patel" } })]);

    // Done reads the places again: the ask has gone and Iron's Waiver link is there.
    await fireEvent.press(screen.getByText("Done"));
    await waitFor(() => {
      expect(askOf(IRON)).toBeNull();
    });
    expect(screen.getByLabelText("Waiver at Iron House")).toBeTruthy();

    // Lotus Yoga's link opens its own words, with the day and name it was signed under, and no Sign.
    await fireEvent.press(screen.getByLabelText("Waiver at Lotus Yoga"));
    const paper = within(await screen.findByTestId("waiver-paper"));
    expect(paper.getByText(LOTUS_V1.text)).toBeTruthy();
    expect(paper.getByText("Signed on 7 November 2026 as Maya Patel.")).toBeTruthy();
    expect(paper.queryByText(IRON_V1.text)).toBeNull();
    expect(screen.queryByLabelText("Sign Lotus Yoga's waiver")).toBeNull();
  });

  it("an answer that names another business is never shown, or signed, under this one", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [org(IRON, "to_sign"), org(LOTUS, "to_sign")], formerOrgs: [] }),
      // Iron House's route answering with Lotus Yoga's waiver.
      [readPath(IRON)]: ok(mineOf(LOTUS, LOTUS_V1)),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`waiver-ask-${IRON.id}`));
    expect(await screen.findByText("We couldn't load Iron House's waiver. Please try again.")).toBeTruthy();
    expect(screen.queryByText(LOTUS_V1.text)).toBeNull();
    expect(screen.queryByLabelText("Sign Iron House's waiver")).toBeNull();
    expect(server.asked.some((one) => one.method === "POST" && one.path.includes("/waiver/"))).toBe(false);
  });

  it("words changed while the page was open are never signed: the page says so and shows the new words", async () => {
    let reads = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [org(IRON, "to_sign")], formerOrgs: [] }),
      [readPath(IRON)]: () => {
        reads += 1;
        return { status: 200, body: mineOf(IRON, reads === 1 ? IRON_V1 : IRON_V2) };
      },
      [signPath(IRON)]: (body) =>
        (body as { waiverId: string }).waiverId === IRON_V2.id
          ? { status: 200, body: { signed: { name: "Maya Patel", at: AT } } }
          : refusal(409, "waiver_changed", WAIVER_WORDS.waiver_changed("Iron House")),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`waiver-ask-${IRON.id}`));
    await screen.findByText(IRON_V1.text);
    await signIt("Maya Patel");
    await fireEvent.press(screen.getByLabelText("Sign Iron House's waiver"));
    expect(await screen.findByText(WAIVER_WORDS.waiver_changed("Iron House"))).toBeTruthy();
    expect(await screen.findByText(IRON_V2.text)).toBeTruthy();
    expect(screen.queryByText(IRON_V1.text)).toBeNull();
    expect(screen.queryByText(/You signed/)).toBeNull();
    // The tick is asked for again, for the new words; the name typed stays.
    expect(screen.getByLabelText("Sign Iron House's waiver")).toBeDisabled();
    await fireEvent.press(screen.getByLabelText(WAIVER_AGREE_LABEL));
    await fireEvent.press(screen.getByLabelText("Sign Iron House's waiver"));
    expect(await screen.findByText("You signed Iron House’s waiver.")).toBeTruthy();
    const sent = server.asked.filter((one) => one.path === signPath(IRON)).map((one) => (one.body as { waiverId: string }).waiverId);
    expect(sent).toEqual([IRON_V1.id, IRON_V2.id]);
  });
});

describe("the rest", () => {
  it("signed while the places are slow to read: the card says signed at once, and the name box is not changed while Sign is saved", async () => {
    let signal = true;
    let readsAfter = 0;
    let finish: (reply: Reply) => void = () => undefined;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": () => {
        if (!signal) {
          readsAfter += 1;
          // A slow connection: this read never comes back during the test.
          return new Promise<Reply>(() => undefined);
        }
        return { status: 200, body: { orgs: [org(IRON, "to_sign")], formerOrgs: [] } };
      },
      [readPath(IRON)]: ok(mineOf(IRON, IRON_V1)),
      [signPath(IRON)]: () =>
        new Promise<Reply>((resolve) => {
          finish = resolve;
        }),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`waiver-ask-${IRON.id}`));
    await screen.findByText(IRON_V1.text);
    await signIt("Maya Patel");
    await fireEvent.press(screen.getByLabelText("Sign Iron House's waiver"));
    await waitFor(() => {
      expect(screen.getByLabelText("Full name").props.editable).toBe(false);
    });
    signal = false;
    finish({ status: 200, body: { signed: { name: "Maya Patel", at: AT } } });
    await screen.findByText("You signed Iron House’s waiver.");
    await fireEvent.press(screen.getByText("Done"));
    await waitFor(() => {
      expect(readsAfter).toBeGreaterThan(0);
    });
    expect(askOf(IRON)).toBeNull();
    expect(screen.getByLabelText("Waiver at Iron House")).toBeTruthy();
  });

  it("no longer a member: said, with no Try again; any other failure offers Try again, which reads again", async () => {
    let reads = 0;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [org(IRON, "to_sign"), org(LOTUS, "to_sign")], formerOrgs: [] }),
      [readPath(IRON)]: () => refusal(404, "not_found", WAIVER_WORDS.not_found),
      [readPath(LOTUS)]: () => {
        reads += 1;
        return reads === 1 ? refusal(500, "internal", "Something went wrong") : { status: 200, body: mineOf(LOTUS, LOTUS_V1) };
      },
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`waiver-ask-${IRON.id}`));
    expect(await screen.findByText("You're no longer a member of Iron House.")).toBeTruthy();
    expect(within(screen.getByTestId("waiver-paper-failed")).queryByText("Try again")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Close"));
    await fireEvent.press(await screen.findByTestId(`waiver-ask-${LOTUS.id}`));
    expect(await screen.findByText("We couldn't load Lotus Yoga's waiver. Check your connection and try again.")).toBeTruthy();
    // The page's own, over the tab.
    const again = screen.getAllByText("Try again").at(-1);
    if (again === undefined) throw new Error("no Try again on the page");
    await fireEvent.press(again);
    expect(await screen.findByText(LOTUS_V1.text)).toBeTruthy();
  });

  it("a waiver stopped while the page was open: nothing to sign, and it says so", async () => {
    let stopped = false;
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [org(LOTUS, "to_sign")], formerOrgs: [] }),
      [readPath(LOTUS)]: () => ({ status: 200, body: mineOf(LOTUS, stopped ? null : LOTUS_V1) }),
      [signPath(LOTUS)]: () => {
        stopped = true;
        return refusal(409, "waiver_not_in_use", WAIVER_WORDS.waiver_not_in_use("Lotus Yoga"));
      },
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`waiver-ask-${LOTUS.id}`));
    await screen.findByText(LOTUS_V1.text);
    await signIt("Maya Patel");
    await fireEvent.press(screen.getByLabelText("Sign Lotus Yoga's waiver"));
    await waitFor(() => {
      expect(screen.queryByText(LOTUS_V1.text)).toBeNull();
    });
    expect(screen.getAllByText(WAIVER_WORDS.waiver_not_in_use("Lotus Yoga")).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Sign Lotus Yoga's waiver")).toBeNull();
    expect(screen.queryByText(/You signed/)).toBeNull();
  });

  it("a lost connection signs nothing, keeps what was typed, and says so", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [org(IRON, "to_sign")], formerOrgs: [] }),
      [readPath(IRON)]: ok(mineOf(IRON, IRON_V1)),
      [signPath(IRON)]: () => {
        throw new Error("no signal");
      },
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`waiver-ask-${IRON.id}`));
    await screen.findByText(IRON_V1.text);
    await signIt("Maya Patel");
    await fireEvent.press(screen.getByLabelText("Sign Iron House's waiver"));
    expect(await screen.findByText(NO_ANSWER)).toBeTruthy();
    expect(screen.queryByText(/You signed/)).toBeNull();
    expect(screen.getByDisplayValue("Maya Patel")).toBeTruthy();
    expect(screen.getByLabelText("Sign Iron House's waiver")).toBeEnabled();
  });

  it("closing the page without signing leaves the ask on the card", async () => {
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [org(IRON, "to_sign")], formerOrgs: [] }),
      [readPath(IRON)]: ok(mineOf(IRON, IRON_V1)),
    });
    await openGym(server.ask);
    await fireEvent.press(await screen.findByTestId(`waiver-ask-${IRON.id}`));
    await screen.findByText(IRON_V1.text);
    await fireEvent.press(screen.getByLabelText("Close"));
    await waitFor(() => {
      expect(screen.queryByText(IRON_V1.text)).toBeNull();
    });
    expect(askOf(IRON)).toBeTruthy();
    expect(screen.getByText("Iron House asks you to read and sign its waiver.")).toBeTruthy();
  });

  it("a place with no waiver, and an api too old to say, show neither the ask nor the link", async () => {
    const plain = { ...org(IRON, null) } as Record<string, unknown>;
    delete plain["waiver"];
    const server = fakeServer({
      "/v1/auth/refresh": ok({ tokens: tokens(2) }),
      "/v1/orgs/mine": ok({ orgs: [plain, org(LOTUS, null)], formerOrgs: [] }),
    });
    await openGym(server.ask);
    expect(await screen.findAllByText("Show your pass at the front desk when you arrive.")).toHaveLength(2);
    expect(screen.queryByText("Read and sign the waiver")).toBeNull();
    expect(screen.queryByLabelText(/^Waiver at/)).toBeNull();
    expect(server.paths().some((path) => path.includes("/waiver/"))).toBe(false);
  });
});
