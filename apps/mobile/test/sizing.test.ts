import { describe, expect, it } from "vitest";
import { pictureTopHeight, modalHeight, wholePictureHeight, WHOLE_PICTURE_LEAST, workoutPictureHeight } from "../src/look/sizing";

// Screen shapes in the phone's own points (dp), width by height: shapes, not any one model's measured size.
describe("a page over the app", () => {
  it.each([
    ["only the bars left out, older Android", 1000, 920, 80, 1000],
    ["nothing left out", 1000, 1000, 80, 1000],
    ["split screen, the top half", 1000, 500, 80, 500],
    ["split screen, a gap just over the bars", 1000, 919, 80, 919],
  ])("%s", (_, screen, window, bars, tall) => {
    expect(modalHeight(screen, window, bars)).toBe(tall);
  });
});

describe("a page's own picture on phones of every size", () => {
  it.each([
    ["a phone like Kd's", 412, 915, 412],
    ["a small phone", 360, 760, 360],
    ["a mid-size phone", 393, 852, 393],
    ["a tall narrow phone", 384, 832, 384],
  ])("%s: the picture's own shape, never cut", (_name, width, height, drawn) => {
    expect(pictureTopHeight(width, height, 1)).toBe(drawn);
  });

  it.each([
    ["a folding phone opened, nearly square", 673, 841, 463],
    ["a folding phone opened, wider still", 700, 760, 418],
    ["a phone on its side", 915, 412, 227],
    ["a tablet", 800, 1280, 704],
  ])("%s: at most 55 % of the screen's height", (_name, width, height, drawn) => {
    expect(pictureTopHeight(width, height, 1)).toBe(drawn);
  });
});

describe("an exercise's own picture, whole, under the page's top buttons (62a)", () => {
  const tall = { width: 720, height: 1280 };
  const wide = { width: 1280, height: 720 };
  // 92 points above it: the phone's clock and the row of the close button.
  it.each([
    ["a tall picture, a phone like Kd's", 412, 915, tall, 411],
    ["a tall picture, a small phone", 360, 760, tall, 326],
    ["a wide picture, a phone like Kd's: its own shape", 412, 915, wide, 232],
    ["a wide picture, a small phone: its own shape", 360, 760, wide, 203],
    ["a tall picture, a folding phone opened", 690, 830, tall, 365],
    ["a wide picture, a folding phone opened", 690, 830, wide, 365],
    ["a tall picture, a tablet", 800, 1280, tall, 612],
  ])("%s: never more than 55 % of the screen with the space above it", (_name, width, height, picture, drawn) => {
    expect(wholePictureHeight(width, height, picture, 92)).toBe(drawn);
  });

  it("a phone on its side still shows the person: never under the least", () => {
    expect(wholePictureHeight(915, 412, tall, 92)).toBe(WHOLE_PICTURE_LEAST);
  });
});

// An exercise's own picture or clip at the top of a workout (62b): Kd's phone, a small phone, an opened fold, a phone on
// its side; a tall clip (720 × 1280) and a wide one (1280 × 720).
describe("an exercise's clip at the top of a workout", () => {
  const tall = { width: 720, height: 1280 };
  const wide = { width: 1280, height: 720 };
  it.each([
    ["Kd's phone, a tall clip: its share of the screen", 432, 960, tall, 278],
    ["Kd's phone, a wide clip: its own shape, the whole width", 432, 960, wide, 243],
    ["a small phone, a tall clip", 360, 760, tall, 220],
    ["a small phone, a wide clip: its own shape", 360, 760, wide, 203],
    ["an opened fold, a tall clip", 691, 830, tall, 241],
    ["an opened fold, a wide clip: its share, fitted whole", 691, 830, wide, 241],
    ["a phone on its side, a tall clip: never under the least", 915, 412, tall, 160],
    ["a phone on its side, a wide clip: never under the least", 915, 412, wide, 160],
  ])("%s", (_, width, height, picture, drawn) => {
    expect(workoutPictureHeight(width, height, picture)).toBe(drawn);
  });

  it("a picture whose own shape is shorter than the least keeps its own shape", () => {
    expect(workoutPictureHeight(360, 760, { width: 1280, height: 400 })).toBe(113);
  });
});
