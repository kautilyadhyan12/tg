// THE BAD-WORDS CHECK: the word check against cases from outside the code (ROADMAP
// 19b-ii-b; spec Part 3 §15.3). `fixtures/bad-words/README.md` says where the outside list
// comes from; the rows marked "the review" were written by round one's reviewer, who had
// not read the list.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOG_58 } from "@app/shared";
import { BAD_WORDS_SHOWN, badWordsIn, hasBadWords } from "../src/modules/orgs/posts/badWords.js";

const lines = (name: string): string[] =>
  readFileSync(new URL(`./fixtures/bad-words/${name}`, import.meta.url), "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");

/** How a word is really written in a post: alone, in a sentence, shouted, in brackets. */
const WRITTEN: ((word: string) => string)[] = [
  (word) => word,
  (word) => `he is a ${word} honestly`,
  (word) => `${word}!`,
  (word) => `${word}!!!`,
  (word) => `what a ${word}.`,
  (word) => `(${word})`,
  (word) => `"${word}"`,
  (word) => `${word}?`,
  (word) => word.toUpperCase(),
  (word) => `line one\n${word}\nline three`,
];

describe("the bad-words check", () => {
  const outside = lines("ldnoobw-en.txt");
  const letThrough = new Set(lines("let-through.txt"));

  it("every entry of the outside list is refused however it is written, or is let through on purpose", () => {
    expect(outside.length).toBeGreaterThan(400);
    const refused = outside.filter((word) => !letThrough.has(word));
    expect(refused.length).toBeGreaterThan(200);
    const missed = refused.flatMap((word) => WRITTEN.map((write) => write(word)).filter((text) => !hasBadWords(text)));
    expect(missed).toEqual([]);
    // The let-through list holds nothing the check now catches, and nothing the outside list lacks.
    expect([...letThrough].filter((word) => hasBadWords(`he is a ${word} honestly`))).toEqual([]);
    expect([...letThrough].filter((word) => !outside.includes(word))).toEqual([]);
  });

  it("refuses slurs, sexual words and telling somebody to hurt themselves, however they are dressed up", () => {
    const refused = [
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
      "bullshit",
      "bullshitting",
      "dickhead",
      "motherfucker",
      "dumbass",
      "clusterfuck",
      "t0sser",
      "p4ki",
      // Kd's click-through, 2026-10-05.
      "gooning all night",
      "creampie",
      "creampied her",
      "cum inside me",
      "send nudes",
      "deepthroating",
      "FAPPING",
      // The review: a mark, a bracket or a digit after the word.
      "what a tosser!",
      "go kill yourself!",
      "kys!",
      "wetback!",
      "send nudes!",
      "(tosser)",
      "raghead!!",
      "kill yourself!!!",
      "tosser1",
      "coon!",
      "spic!",
      "pedo!",
      "horny!",
      "creampie!",
      "jerk off!",
      // The review: characters nobody sees, and a phrase split another way.
      "to​sser",
      "fu­ck",
      "tos⁠ser",
      "﻿tosser",
      "f̶u̶c̶k̶",
      "kill\nyourself",
      "kill yourself",
      "kill-yourself",
      "jack-off",
      "blow-job",
      "hand-job",
      "towel head",
      "rag head",
      "f u c k",
      "f.u.c.k",
    ];
    expect(refused.filter((text) => !hasBadWords(text))).toEqual([]);
  });

  it("does not refuse what a gym says every day", () => {
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
      "The coach will push you hard",
      "Go hard or go home",
      "Gooners in tonight",
      "Strap on your belt for deadlifts",
      "Cream pie for dessert, back on it Monday",
      "Spread your legs wider in the sumo squat",
      "Nipple chafing on the long run",
      "Sextet of kettlebells arrived",
      "3 sets: A, B, C. Go!",
      "1! 2! 3! Go!",
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
      // The review: an ordinary word that has a listed word inside it.
      "Cucumber and cumin salad after training",
      "Cummings took the 5k",
      "Cummins engine row",
      "Rapeseed oil in the shakes",
      "Mishit the wall ball",
      "Anusara yoga at 7",
      "Fire retardant mats only",
      "Dickies shorts for sale",
      "Dickleburgh fun run",
      "Don't pussyfoot around the warm-up",
      "Wankdorf stadium trip",
      // The review: ordinary phrases and gym words.
      "What a cock-up with the bookings",
      "Kick-ass session",
      "Ass to grass squats",
      "Mixed-sex sauna from Monday",
      "Single sex classes on Tuesdays",
      "Pissed off with my deadlift",
      "Pin prick blood test at the desk",
      "Blue tit nesting by the door",
      "Maine Coon cat found in the car park",
      "Graduated magna cum laude, back training now",
      "Erection of the new rig starts Friday",
      "Pegging the rower at 1:45",
      "Fingering the hold on the climbing wall",
      "Hooker needed for the rugby sevens",
    ];
    expect(clean.filter((text) => hasBadWords(text)).map((text) => `${text} -> ${badWordsIn(text).join(", ")}`)).toEqual([]);
  });

  it("refuses no exercise the app itself names", () => {
    expect(CATALOG_58.length).toBeGreaterThan(50);
    const names = CATALOG_58.map((exercise) => exercise.slug.replaceAll("_", " "));
    expect(names.filter((name) => hasBadWords(`Did 3 sets of ${name} today`))).toEqual([]);
  });

  it("names the word as its writer typed it, whole, each once and no more than five", () => {
    expect(badWordsIn("what a tosser, a real TOSSER")).toEqual(["tosser"]);
    expect(badWordsIn("Great class tonight")).toEqual([]);
    // A word inside a longer listed word is said once; marks around a word are not part of it.
    expect(badWordsIn("FAPPING and cumming")).toEqual(["fapping", "cumming"]);
    expect(badWordsIn("sh1t post")).toEqual(["sh1t"]);
    expect(badWordsIn("what a tosser!")).toEqual(["tosser"]);
    expect(badWordsIn("(tosser)")).toEqual(["tosser"]);
    expect(badWordsIn("kill\nyourself")).toEqual(["kill yourself"]);
    expect(badWordsIn("f u c k you")).toEqual(["fuck"]);
    // The whole typed word, never a piece of it.
    expect(badWordsIn("stop bullshitting")).toEqual(["bullshitting"]);
    expect(badWordsIn("you dickheads")).toEqual(["dickheads"]);
    expect(badWordsIn("Cucumber, cumin and a shitty attitude")).toEqual(["shitty"]);
    const many = badWordsIn("tosser paki wetback raghead poofter coon spic");
    expect(many).toHaveLength(BAD_WORDS_SHOWN);
    expect(many.slice(0, 2)).toEqual(["tosser", "paki"]);
  });
});
