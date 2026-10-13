import Constants from "expo-constants";
import { readAppExtra } from "../../src/appExtra";

jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: null } }));

const hand = (extra: unknown) => {
  (Constants as { expoConfig: unknown }).expoConfig = extra === undefined ? null : { extra };
};

describe("what the copy was handed when it opened", () => {
  it("reads the copy's name and its server", () => {
    hand({ copyName: "Feature 1", apiUrl: "http://localhost:3000" });
    expect(readAppExtra()).toEqual({ copyName: "Feature 1", apiUrl: "http://localhost:3000" });
  });

  it.each([
    ["nothing", undefined],
    ["no server", { copyName: "Feature 1" }],
    ["a server that is not an address", { copyName: "Feature 1", apiUrl: "the laptop" }],
    ["another app's settings", { eas: { projectId: "x" } }],
  ])("%s reads as no settings", (_name, extra) => {
    hand(extra);
    expect(readAppExtra()).toBeNull();
  });
});
