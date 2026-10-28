import { describe, expect, it } from "vitest";
import { pictureTopHeight } from "../src/look/sizing";

// Screen shapes in the phone's own points (dp), width by height: shapes, not any one model's measured size.
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
