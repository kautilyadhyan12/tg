// The page kept while Square's tab is over the app (20f, 20g), let go only by that page's own end (20h round one, N1): an
// older page told paid by Payment received never lets go of the page the member is on in the tab.
import { forgetPayAway, keepPayAway, payAwayPlace } from "../../src/screens/gym/payAway";

const store = jest.requireMock<{ kept: Map<string, string> }>("expo-secure-store").kept;
const USER = "0e3d7a11-58a4-4f0b-8f1d-6c2b9a7e4d10";
const GYM = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const IN_TAB = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OLDER = "c1111111-1111-4111-8111-111111111111";

beforeEach(() => {
  store.delete("pay-away");
});

describe("what is kept for the page in the tab", () => {
  it("an older page ending leaves it; its own end lets it go", async () => {
    await keepPayAway(USER, GYM, IN_TAB);
    await forgetPayAway(OLDER);
    expect(await payAwayPlace(USER)).toEqual({ gymId: GYM, purchaseId: null });
    await forgetPayAway(IN_TAB);
    expect(store.has("pay-away")).toBe(false);
  });

  it("a line being bought: kept with its purchase, and let go only by that purchase", async () => {
    await keepPayAway(USER, GYM, IN_TAB, Date.now(), IN_TAB);
    await forgetPayAway(OLDER);
    expect(await payAwayPlace(USER)).toEqual({ gymId: GYM, purchaseId: IN_TAB });
    await forgetPayAway(IN_TAB);
    expect(store.has("pay-away")).toBe(false);
  });

  it("one kept before 20h names no page and goes with any page's end; nothing named lets go of anything", async () => {
    store.set("pay-away", JSON.stringify({ userId: USER, gymId: GYM, at: Date.now(), purchaseId: null }));
    await forgetPayAway(OLDER);
    expect(store.has("pay-away")).toBe(false);
    await keepPayAway(USER, GYM, IN_TAB);
    await forgetPayAway();
    expect(store.has("pay-away")).toBe(false);
  });
});
