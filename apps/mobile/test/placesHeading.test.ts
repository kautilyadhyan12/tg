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

// Kd, 2026-11-15 (21c-i): a CrossFit box's members read "CrossFit", and somebody who has joined no business yet
// reads "Places", never "Gym"; the page under it keeps its words ("Where you train").
describe("the Gym tab's word under its icon", () => {
  it.each([
    [[], "Places"],
    [["gym"], "Gym"],
    [["crossfit_box"], "CrossFit"],
    [["gym", "crossfit_box"], "Places"],
    [["crossfit_box", "crossfit_box"], "CrossFit"],
    [["yoga_studio"], "Studio"],
    [["pilates_studio", "studio"], "Studio"],
    [["personal_trainer"], "Trainer"],
    [["clinic"], "Clinic"],
    [["gym", "yoga_studio"], "Places"],
    [["boxing_club"], "Gym"],
  ])("%j reads %s", (types, word) => {
    expect(tabWord(types)).toBe(word);
  });

  // Never longer than the bar's longest word, "Dashboard", which fits it at every size. Measured in Inter SemiBold at the
  // bar's 11 points (2026-11-15): Dashboard 58.0, Workout 45.7, CrossFit 44.2, Trainer 38.0, Places 35.2, Studio 34.1.
  it("no kind is named so long it crowds the bar", () => {
    for (const type of orgTypeSchema.options) expect(tabWord([type]).length).toBeLessThanOrEqual("Dashboard".length);
    expect(tabWord([]).length).toBeLessThanOrEqual("Dashboard".length);
  });
});
