import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { foodWords } from "./foodWords";

// Kd, 2026-11-14 (32c, the Food tab redrawn): "be careful no existing features gets deleted". The words
// the Food tab had on master before 32c are kept in fixtures/food-words.json; each must still be on it.
// A word changed on purpose is named here with what took its place, from Kd's drawing.
const REPLACED: Readonly<Record<string, string>> = {
  // The week's box and its box from the bottom are now one Week tab (32c-i): the tab is its title.
  "This Week": "the Week tab",
  "See your week": "the Week tab",
  "Your Week in Food": "the Week tab",
  // The box's "Line: your daily target, 2,300 kcal today" is the Week tab's same line, its unit read from the figure.
  "kcal today": "the Week tab's \"Line: your daily target, … {unit} today\"",
};

const before: readonly string[] = (JSON.parse(readFileSync(join(__dirname, "fixtures", "food-words.json"), "utf8")) as string[]).map((w) => w.trim()).filter((w) => w !== "");

describe("no word of the Food tab is lost (32c)", () => {
  it("every word it had before is still there, or was replaced on purpose", () => {
    const kept = new Set([...foodWords()].map((w) => w.trim()));
    const replaced = new Set(Object.keys(REPLACED).map((w) => w.trim()));
    // The whole words, never a part of another string: a word kept only inside a longer line is lost.
    const lost = before.filter((w) => !replaced.has(w) && !kept.has(w));
    expect(lost).toEqual([]);
  });

  it("a word named as replaced is really gone, so this list never hides a word that is still there", () => {
    const now = new Set([...foodWords()].map((w) => w.trim()));
    const stillThere = Object.keys(REPLACED).filter((w) => now.has(w.trim()));
    expect(stillThere).toEqual([]);
  });
});
