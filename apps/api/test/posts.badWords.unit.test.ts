// THE BAD-WORDS HOLD: the word check against cases from outside the code (ROADMAP
// 19b-ii-b; spec Part 3 §15.3). `fixtures/bad-words/README.md` says where they come from.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG_58 } from "@app/shared";
import { BAD_WORDS_SHOWN, badWordsIn, hasBadWords } from "../src/modules/orgs/posts/badWords.js";

const lines = (name: string): string[] =>
  readFileSync(new URL(`./fixtures/bad-words/${name}`, import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

const inAPost = (word: string): string => `he is a ${word} honestly`;

describe("the bad-words hold", () => {
  const outside = lines("ldnoobw-en.txt");
  const letThrough = new Set(lines("let-through.txt"));

  it("every entry of the outside list is held, or is let through on purpose", () => {
    expect(outside.length).toBeGreaterThan(400);
    const missed = outside.filter((word) => !letThrough.has(word) && !hasBadWords(inAPost(word)));
    expect(missed).toEqual([]);
    // The let-through list holds nothing the check now catches, and nothing the outside list lacks.
    expect([...letThrough].filter((word) => hasBadWords(inAPost(word)))).toEqual([]);
    expect([...letThrough].filter((word) => !outside.includes(word))).toEqual([]);
  });

  it("holds slurs, explicit words and telling somebody to hurt themselves, however they are dressed up", () => {
    const held = [
      "what a tosser",
      "you fat paki",
      "go kill yourself",
      "KYS mate",
      "killl yourself",
      "blow job in the sauna",
      "FUCKING idiot",
      "fuuuuck off",
      "sh1t post",
      "b!tch",
      "a$$hole",
      "phuck you",
      "you are a w4nker",
      "Great session.\nShame the coach is a towelhead",
      "titties out",
      "jizzz",
    ];
    expect(held.filter((text) => !hasBadWords(text))).toEqual([]);
  });

  it("does not hold what a gym says every day", () => {
    const clean = [
      "Great class tonight, thanks coach",
      "New PB on the snatch today, 60 kg",
      "Hit a 100 kg clean and jerk",
      "Jerk technique session Saturday",
      "Kicked my butt today",
      "Hump day workout done",
      "Hardcore abs at 6",
      "Stripped the bar and racked the plates",
      "Booty band class at 6",
      "Push press and thrusters",
      "My glutes are on fire",
      "That WOD was hell",
      "Damn good session",
      "Lost a grey Nike hoodie in the changing room",
      "Size XXL hoodies are in",
      "Cockpit style rowing machine is back",
      "Shiitake stir fry after legs",
      "Spotted dick for pudding",
      "Kettlebells then a Dick's Sporting Goods run",
      "Pussy willow by the car park is in bloom",
      "Assessment day for the new starters",
      "Analysis of my squat please",
      "Bass fishing trip, who is in",
      "Therapist recommended the sauna",
      "Grapes and rice after training",
      "Spice rack protein balls",
      "Among us, who is doing the 10k",
      "Pakistan trip photos",
      "Raccoon in the car park again",
      "Thorny hedge by the gate has been cut",
      "Pedometer says 12,000 steps",
      "Jack offered to spot me",
      "Kill your selfish reps and help rack the weights",
      // Places with the "Scunthorpe problem".
      "Scunthorpe open this weekend",
      "Essex half marathon results",
      "Sussex 10k anyone",
      "Middlesex league fixtures",
      "Penistone hill sprints",
      "Cockermouth fell run",
      "Clitheroe sportive on Sunday",
      "Lightwater parkrun",
      "Arsenal fans in tonight?",
    ];
    expect(clean.filter((text) => hasBadWords(text))).toEqual([]);
  });

  it("holds no exercise the app itself names", () => {
    expect(CATALOG_58.length).toBeGreaterThan(50);
    const names = CATALOG_58.map((exercise) => exercise.slug.replaceAll("_", " "));
    expect(names.filter((name) => hasBadWords(`Did 3 sets of ${name} today`))).toEqual([]);
  });

  it("names the words it found for staff, each once and no more than five", () => {
    expect(badWordsIn("what a tosser, a real TOSSER")).toEqual(["tosser"]);
    expect(badWordsIn("Great class tonight")).toEqual([]);
    const many = badWordsIn("tosser paki wetback raghead poof coon spic");
    expect(many).toHaveLength(BAD_WORDS_SHOWN);
    expect(many.slice(0, 2)).toEqual(["tosser", "paki"]);
  });
});
