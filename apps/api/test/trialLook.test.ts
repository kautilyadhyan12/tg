// The "have a look" warnings (Stage 3 item 2e-ii): which names and addresses are alike, and
// which gyms a free trial is compared with. The names are real gyms' and chains' names, and
// words the rule's own list has never heard of. The database half is orgs.trialLook.test.ts.
//
// THE WORST THING THIS JOB COULD DO: list an honest new gym beside a stranger's gym, so that
// Kd pauses it. The first test is that: names that share only the words every gym has, or one
// common word, are never alike.
import { describe, expect, it } from "vitest";
import {
  addressKey,
  nameCore,
  namesAlike,
  trialClues,
  type LookGym,
  type TrialGym,
} from "../src/modules/orgs/trialLook/clues.js";

const alike = (a: string, b: string, city: string | null = null) => namesAlike(nameCore(a, city), nameCore(b, city));

describe("two gyms that are not alike are never listed", () => {
  const table: [string, string, string | null][] = [
    ["Anytime Fitness", "Planet Fitness", null],
    ["Fitness First", "Fitness Zone", null],
    ["The Gym", "Gym Nation", null],
    ["Gym", "The Gym Studio", null],
    ["Power Gym", "Power House Gym", null],
    ["Muscle Factory", "Muscle Beach", null],
    ["Iron Paradise", "Iron Temple", null],
    ["Body Zone", "Body Tone", null],
    ["Spartan Gym", "Spartans MMA", null],
    ["Crunch Fitness", "Crunch Yoga", null],
    ["Yoga Studio", "Pilates Studio", null],
    ["24 Hour Fitness", "24/7 Fitness", null],
    ["Fitness Hub", "Fitness Arena", null],
    ["Pune Fitness", "Pune Gym", "Pune"],
    ["Mumbai Health Club", "The Mumbai Gym", "Mumbai"],
    ["Snap Fitness", "Snap Fitness Koregaon Park", null],
    ["शक्ति जिम", "शान्ति जिम", null],
    ["", "Gym", null],
  ];
  it.each(table)("%s · %s", (a, b, city) => {
    expect(alike(a, b, city)).toBe(false);
    expect(alike(b, a, city)).toBe(false);
  });
});

describe("two names that are alike", () => {
  const table: [string, string, string | null][] = [
    ["Gold's Gym", "Golds Gym", null],
    ["Gold's Gym", "Gold Gym", null],
    ["GOLD'S GYM", "gold’s gym", null],
    ["Iron House Gym", "IronHouse Fitness", null],
    ["Cult.fit", "Cult Fit", null],
    ["Talwalkars Gym", "Talwalkar's", null],
    ["Musclemania Gym", "Muscelmania Gym", null],
    ["Musclemania", "Musclmania Fitness", null],
    ["Iron House", "Iron House Elite", null],
    ["Body Builders Hub", "Bodybuilders Hub", null],
    ["Café Fitness Lounge", "Cafe Fitness Lounge", null],
    ["Fit & Fab Studio", "Fit and Fab", null],
    ["F45 Training", "F45", null],
    ["Iron House Pune", "Iron House Gym", "Pune"],
    ["Anytime Fitness", "Anytime Fitness", null],
    ["शक्ति जिम", "शक्ति  जिम", null],
  ];
  it.each(table)("%s · %s", (a, b, city) => {
    expect(alike(a, b, city)).toBe(true);
    expect(alike(b, a, city)).toBe(true);
  });
});

describe("the same address", () => {
  const same: [string, string][] = [
    ["12, M.G. Rd, Pune-411001", "12 MG Road Pune 411001"],
    ["Shop 4, Phoenix Mall,\nLower Parel, Mumbai 400013", "shop 4 phoenix mall lower parel mumbai 400013"],
    ["1st Flr, 22 Linking Rd, Bandra West", "1st Floor 22 Linking Road Bandra West"],
    ["123 Main St, Springfield, IL 62701", "123 Main Street, Springfield IL 62701"],
    ["Opp. City Mall, 5 Station Rd", "opposite city mall 5 station road"],
  ];
  it.each(same)("%s · %s", (a, b) => {
    const key = addressKey(a);
    expect(key).not.toBeNull();
    expect(addressKey(b)).toBe(key);
  });

  const different: [string, string][] = [
    ["Shop 4, Phoenix Mall, Mumbai 400013", "Shop 5, Phoenix Mall, Mumbai 400013"],
    ["12 MG Road Pune 411001", "12 MG Road Pune 411002"],
  ];
  it.each(different)("%s is not %s", (a, b) => {
    expect(addressKey(a)).not.toBe(addressKey(b));
  });

  it("is never said of an address too vague to tell two gyms apart", () => {
    expect(addressKey("Main Road, Pune")).toBeNull();
    expect(addressKey("Near bus stand")).toBeNull();
    expect(addressKey("Plot 4")).toBeNull();
    expect(addressKey("   ")).toBeNull();
    expect(addressKey(null)).toBeNull();
  });
});

describe("trialClues", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 10, day));
  const gym = (id: string, over: Partial<LookGym> = {}): LookGym => ({
    id,
    name: "Iron House Gym",
    city: "Pune",
    address: null,
    owner: `owner-${id}`,
    createdAt: at(1),
    ...over,
  });
  const trial = (id: string, over: Partial<TrialGym> = {}): TrialGym => ({
    ...gym(id, { createdAt: at(10) }),
    firstPeopleGymId: null,
    ...over,
  });

  it("finds an older gym of another owner in the same city with a similar name", () => {
    const t = trial("t", { name: "IronHouse Fitness" });
    expect(trialClues([t], [gym("a"), t]).get("t")).toEqual([{ kind: "name_city", gymId: "a" }]);
  });

  it("leaves out the owner's own gyms, by person, and gyms made after the trial's", () => {
    const t = trial("t", { owner: "ravi" });
    const others = [gym("own", { owner: "ravi" }), gym("later", { createdAt: at(20) }), t];
    expect(trialClues([t], others).has("t")).toBe(false);
  });

  it("needs the same city for a similar name", () => {
    const t = trial("t", { city: "Mumbai" });
    expect(trialClues([t], [gym("a"), gym("b", { city: null })]).has("t")).toBe(false);
    const spelt = trial("s", { city: " pune. " });
    expect(trialClues([spelt], [gym("a")]).get("s")).toEqual([{ kind: "name_city", gymId: "a" }]);
  });

  it("finds the same address in any city, whatever the name", () => {
    const t = trial("t", { name: "Spartan MMA", city: "Mumbai", address: "Shop 4, Phoenix Mall, Mumbai 400013" });
    const a = gym("a", { name: "Power Gym", city: null, address: "shop 4 phoenix mall mumbai 400013" });
    expect(trialClues([t], [a]).get("t")).toEqual([{ kind: "address", gymId: "a" }]);
  });

  it("lists 2d's first-people gym first, then the address, then the name, one line each", () => {
    const t = trial("t", { address: "12 MG Road Pune 411001", firstPeopleGymId: "c" });
    const others = [gym("b", { address: "12, M.G. Rd, Pune 411001" }), gym("a")];
    expect(trialClues([t], others).get("t")).toEqual([
      { kind: "first_people", gymId: "c" },
      { kind: "address", gymId: "b" },
      { kind: "name_city", gymId: "a" },
      { kind: "name_city", gymId: "b" },
    ]);
  });

  it("lists nothing for a trial with no clue", () => {
    const t = trial("t", { name: "Spartan MMA" });
    expect(trialClues([t], [gym("a"), gym("b", { name: "Anytime Fitness" })]).size).toBe(0);
  });
});
