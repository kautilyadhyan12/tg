import { describe, expect, it } from "vitest";
import { NO_READS, SAME_PACK_MS, afterRead, allergenWords, checkWords, codeFromCamera, codeFromTyped, troubleWords } from "../src/screens/food/barcode";

// A pack's barcode on the phone (33b-iii-b). The allergen rows and sizes are real rows of Open Food
// Facts' list (`rulings/2026-10-30-33b-iii-a.md`, and its handoff's list of real typed words).

describe("the worst thing: nothing about allergens reads as clear", () => {
  it("an empty list says nothing about the food, and tells the person to check the pack", () => {
    expect(allergenWords({ allergens: [], mayContain: [], listedAsTyped: [] })).toEqual({ contains: null, mayContain: null, typed: null, noneListed: true });
  });
  it("Nutella's allergens are all shown, and what may be in it is kept apart", () => {
    const words = allergenWords({ allergens: ["milk", "nuts", "soybeans"], mayContain: ["eggs"], listedAsTyped: [] });
    expect(words).toMatchObject({ contains: "Milk, Nuts, Soybeans", mayContain: "Eggs", noneListed: false });
  });
  it("a warning that lives only in somebody's own words is shown as they typed it: lait, weizenmehl, blé", () => {
    const words = allergenWords({ allergens: [], mayContain: [], listedAsTyped: ["lait", "weizenmehl", "blé"] });
    expect(words.typed).toBe("lait, weizenmehl, blé");
    expect(words.contains).toBeNull();
    expect(words.noneListed).toBe(false);
  });
});

describe("numbers that are not certain say so", () => {
  it.each([
    ["lists_differ", 90, "Our food lists disagree on the calories. Check the pack."],
    ["doesnt_add_up", 300, "These numbers don’t add up. Check the pack."],
    ["part_missing", 0, "Some numbers are missing. Check the pack."],
    ["fine", 0, "Listed as 0 kcal. Check the pack."],
    ["fine", 42, null],
  ] as const)("%s at %d kcal", (check, kcal, words) => {
    expect(checkWords({ check, food: { kcal } })).toBe(words);
  });
});

describe("the code the server is asked for", () => {
  it("the worst thing: a UPC-E is written out, never asked for as the EAN-8 of the same digits", () => {
    // A real can's UPC-E and the UPC-A it stands for, by GS1's table.
    expect(codeFromCamera("upc_e", "04965802")).toBe("049000006582");
    expect(codeFromTyped("04965802")).toBe("049000006582");
  });
  it("a UPC-E already written out by the camera stays as it is", () => {
    expect(codeFromCamera("upc_e", "049000006582")).toBe("049000006582");
  });
  it("a read that isn't a whole code is not asked for", () => {
    expect(codeFromCamera("upc_e", "12345")).toBeNull();
    expect(codeFromCamera("ean13", "ABC")).toBeNull();
    expect(codeFromCamera("ean13", "123")).toBeNull();
  });
  it("EAN-13, EAN-8 and UPC-A pass as printed", () => {
    expect(codeFromCamera("ean13", "3017620422003")).toBe("3017620422003");
    expect(codeFromCamera("ean8", "73513537")).toBe("73513537");
    expect(codeFromCamera("upc_a", "049000006582")).toBe("049000006582");
  });
  it("typed digits lose their spaces, and too few are refused", () => {
    expect(codeFromTyped("3 017620 422003")).toBe("3017620422003");
    expect(codeFromTyped("12345")).toBeNull();
    expect(codeFromTyped("")).toBeNull();
  });
});

describe("when a read from the camera is looked up", () => {
  it("the worst thing: one read alone is never looked up, so a misread shows no other product", () => {
    expect(afterRead(NO_READS, "3017620422003", 0).look).toBe(false);
  });
  it("two alike in a row are", () => {
    const first = afterRead(NO_READS, "3017620422003", 0);
    expect(afterRead(first.memory, "3017620422003", 50).look).toBe(true);
  });
  it("two that differ are not", () => {
    const first = afterRead(NO_READS, "3017620422003", 0);
    expect(afterRead(first.memory, "3017620422004", 50).look).toBe(false);
  });
  it("the same pack still in view isn't asked again; looked at again after moving away, it is", () => {
    const looked = afterRead(afterRead(NO_READS, "3017620422003", 0).memory, "3017620422003", 50).memory;
    const still = afterRead(looked, "3017620422003", 50 + SAME_PACK_MS);
    expect(still.look).toBe(false);
    expect(afterRead(still.memory, "3017620422003", 50 + SAME_PACK_MS * 3).look).toBe(true);
  });
});

describe("a code with no product says what to do next", () => {
  it.each([
    [{ status: "not_found", code: "1" }, "This product isn’t on our list."],
    [{ status: "store_only" }, "This is the shop’s own code. Search for the food instead."],
    [{ status: "not_a_food" }, "This barcode isn’t a food. Try another one."],
    [{ status: "bad_code" }, "That barcode isn’t right. Scan it again, or check the number."],
  ] as const)("%o", (reply, words) => {
    expect(troubleWords(reply)).toBe(words);
  });
});
