import { describe, expect, it } from "vitest";
import { includedLines, type ForSaleIncluded, type ForSaleType } from "../src/forSale.js";

// What a line sold in the app gives, on the phone's Buy (Stage 5 item 20g), in the console's own words. The cases are the
// console's (`apps/web/src/pages/console/membershipTypesView.test.js`, `includesLine`), taken from outside this code: the
// phone reads one line a part where the console joins them with " · ".

const ALL: ForSaleIncluded = { access: "all_classes", bookingsLimit: null, bookingsPeriod: null, classNames: null, includesPt: false, ptLimit: null, ptPeriod: null };
const once: Pick<ForSaleType, "kind" | "packClasses" | "packDays"> = { kind: "one_time", packClasses: null, packDays: null };
const pack: Pick<ForSaleType, "kind" | "packClasses" | "packDays"> = { kind: "pack", packClasses: 10, packDays: 60 };
const dayPass: Pick<ForSaleType, "kind" | "packClasses" | "packDays"> = { kind: "pack", packClasses: 1, packDays: 1 };
const inc = (over: Partial<ForSaleIncluded> = {}): ForSaleIncluded => ({ ...ALL, ...over });

describe("what a line gives, as the console says it", () => {
  it.each([
    ["every class, paid once", inc(), once, "gym", ["Unlimited classes"]],
    ["no classes", inc({ access: "gym_only" }), once, "gym", ["No classes, gym only"]],
    ["3 classes a week", inc({ access: "limited", bookingsLimit: 3, bookingsPeriod: "week" }), once, "gym", ["3 classes a week"]],
    ["8 classes a month", inc({ access: "limited", bookingsLimit: 8, bookingsPeriod: "month" }), once, "gym", ["8 classes a month"]],
    ["1 class a week", inc({ access: "limited", bookingsLimit: 1, bookingsPeriod: "week" }), once, "gym", ["1 class a week"]],
    ["only some classes", inc({ classNames: ["Yoga", "Spin"] }), once, "gym", ["Only Yoga, Spin"]],
    ["a limit and some classes", inc({ access: "limited", bookingsLimit: 2, bookingsPeriod: "week", classNames: ["Yoga"] }), once, "gym", ["2 classes a week", "Only Yoga"]],
    ["a pack", inc(), pack, "gym", ["Any class"]],
    ["a day pass", inc(), dayPass, "gym", ["The gym or any class"]],
    ["a day pass of one class", inc({ classNames: ["Yoga"] }), dayPass, "gym", ["Only Yoga"]],
    ["a pack of one class", inc({ classNames: ["Yoga"] }), pack, "gym", ["Only Yoga"]],
    ["more than three classes", inc({ classNames: ["A", "B", "C", "D", "E"] }), once, "gym", ["Only A, B, C and 2 more"]],
    ["personal training only", inc({ classNames: [], includesPt: true }), pack, "gym", ["Personal training only"]],
    ["every class and personal training", inc({ includesPt: true }), once, "gym", ["Unlimited classes", "Personal training"]],
    ["no classes and personal training", inc({ access: "gym_only", includesPt: true }), once, "gym", ["No classes, gym only", "Personal training"]],
    ["a pack and personal training", inc({ includesPt: true }), pack, "gym", ["Any class", "Personal training"]],
    ["4 sessions a month", inc({ includesPt: true, ptLimit: 4, ptPeriod: "month" }), once, "gym", ["Unlimited classes", "4 personal training sessions a month"]],
  ])("%s", (_name, included, type, orgType, lines) => {
    expect(includedLines(included, type, orgType)).toEqual(lines);
  });

  it.each([
    ["gym", "No classes, gym only", "The gym or any class"],
    ["crossfit_box", "No classes, open gym only", "Open gym or any class"],
    ["studio", "No classes, open studio only", "Open studio or any class"],
    ["yoga_studio", "No classes, open studio only", "Open studio or any class"],
    ["pilates_studio", "No classes, open studio only", "Open studio or any class"],
    ["personal_trainer", "No classes, open gym only", "Open gym or any class"],
    ["clinic", "No classes, open gym only", "Open gym or any class"],
    ["not_a_kind", "No classes, gym only", "The gym or any class"],
  ])("a %s names a place without classes in its own words", (orgType, only, day) => {
    expect(includedLines(inc({ access: "gym_only" }), once, orgType)).toEqual([only]);
    expect(includedLines(inc(), dayPass, orgType)).toEqual([day]);
  });
});
