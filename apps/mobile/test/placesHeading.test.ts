import { describe, expect, it } from "vitest";
import { orgTypeSchema } from "@app/shared";
import { placesHeading, tabWord } from "../src/screens/placesHeading";

// The Gym tab's heading for every kind of business the app takes, alone, mixed and none
// (Kd, rulings/2026-10-23-18u-i.md: a yoga or Pilates member is never told "gyms").
describe("the Gym tab's heading", () => {
  it.each([
    [["gym"], "My gyms"],
    [["gym", "gym"], "My gyms"],
    [["studio"], "My studios"],
    [["crossfit_box"], "My CrossFit gyms"],
    [["yoga_studio"], "My yoga studios"],
    [["pilates_studio"], "My Pilates studios"],
    [["personal_trainer"], "My trainers"],
    [["clinic"], "My clinics"],
    [[], "Where you train"],
    [["gym", "yoga_studio"], "Where you train"],
    [["pilates_studio", "personal_trainer"], "Where you train"],
    // A kind a newer server knows and this phone does not is spoken of as a gym, never left blank.
    [["boxing_club"], "My gyms"],
  ])("%j reads %s", (types, heading) => {
    expect(placesHeading(types)).toBe(heading);
  });

  it("no kind on its own is ever called 'Where you train', and none but a gym is called gyms", () => {
    for (const type of orgTypeSchema.options) {
      const heading = placesHeading([type]);
      expect(heading).toMatch(/^My /);
      if (type !== "gym") expect(heading === "My gyms").toBe(false);
    }
  });
});

describe("the Gym tab's word under its icon", () => {
  it.each([
    [[], "Gym"],
    [["gym"], "Gym"],
    [["crossfit_box"], "Gym"],
    [["gym", "crossfit_box"], "Gym"],
    [["yoga_studio"], "Studio"],
    [["pilates_studio", "studio"], "Studio"],
    [["personal_trainer"], "Trainer"],
    [["clinic"], "Clinic"],
    [["gym", "yoga_studio"], "Places"],
    [["boxing_club"], "Gym"],
  ])("%j reads %s", (types, word) => {
    expect(tabWord(types)).toBe(word);
  });

  it("no kind is named so long it crowds the bar", () => {
    for (const type of orgTypeSchema.options) expect(tabWord([type]).length).toBeLessThanOrEqual(7);
  });
});
