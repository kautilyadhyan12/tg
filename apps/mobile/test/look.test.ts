import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configFor, copyFor } from "../app.config";
import { colours, sizes } from "../src/look/colours";

const here = join(__dirname, "..");
const design = join(here, "..", "..", "docs", "design", "phone", "shared");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const files = sources(join(here, "src"));
const read = (path: string) => readFileSync(path, "utf8");
const short = (path: string) => path.slice(here.length + 1).replaceAll("\\", "/");

describe("a chip grows with its words", () => {
  it("is drawn at least 40 tall and never to a fixed height", () => {
    const chip = read(join(here, "src", "look", "Chip.tsx"));
    expect(chip).toMatch(/minHeight: 40/);
    expect(chip).not.toMatch(/[^A-Za-z]height: \d/);
  });
});

describe("the look is drawn once", () => {
  it("no screen writes a colour of its own", () => {
    const written = files
      .filter((path) => short(path) !== "src/look/colours.ts")
      .flatMap((path) =>
        // A hex, rgb or hsl colour anywhere, or a colour's name ("white") given to a colour style.
        [
          ...read(path).matchAll(
            /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\w*[cC]olor\w*\s*[:=]\s*["'`](?!transparent["'`])[a-zA-Z]+["'`]/g,
          ),
        ].map((hit) => `${short(path)}: ${hit[0]}`),
      );
    expect(written).toEqual([]);
  });

  it("the colours are the member web's", () => {
    expect(colours).toMatchObject({
      page: "#0A0908",
      box: "#121110",
      raised: "#1A1815",
      orange: "#FF8A1F",
      orangeLight: "#FFB347",
      good: "#22c55e",
      bad: "#ef4444",
      gold: "#FFD66B",
    });
  });

  it("no size written in the look is under 11, and its two press sizes are 48 and 44", () => {
    // What is DRAWN is measured in test/screens/app.test.tsx; this reads the sizes as written.
    const fontSizes = files.flatMap((path) =>
      [...read(path).matchAll(/fontSize: (\d+)/g)].map((hit) => Number(hit[1])),
    );
    expect(fontSizes.length).toBeGreaterThan(5);
    expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(11);
    expect(sizes.button).toBe(48);
    expect(sizes.press).toBe(44);
  });

  it("the app is dark only, on the look's own page colour", () => {
    const config = configFor(copyFor("feature1"));
    expect(config.userInterfaceStyle).toBe("dark");
    expect(config.backgroundColor).toBe(colours.page);
  });
});

describe("the icons and the pictures are the design's", () => {
  it("the icons are the drawn ones", () => {
    expect(JSON.parse(read(join(here, "src", "look", "icons.json")))).toEqual(
      JSON.parse(read(join(design, "icons.json"))),
    );
  });

  it("every drawn picture is in the app by its name, small", () => {
    // The sign-in and setup pictures are the browser's own pages', cut for a phone, and the two goals pictures are
    // Kd's own drawing (31b), as are the clock's and the Dashboard top's; none is on the design canvas.
    const drawn = [...Object.keys(JSON.parse(read(join(design, "images.json"))) as Record<string, string>), "cave", "getstarted", "goals", "goalsbox", "motivation", "setup"].sort();
    const folder = join(here, "assets", "pictures");
    const shipped = readdirSync(folder).sort();
    expect(shipped).toEqual(drawn.map((name) => `${name}.webp`));
    const named = [...read(join(here, "src", "look", "pictures.ts")).matchAll(/^ {2}(\w+),$/gm)].map((hit) => hit[1]);
    expect(named).toEqual(drawn);
    // The web ships these 31 at 47,597 KB; a full-size file here would be megabytes.
    const biggest = Math.max(...shipped.map((name) => statSync(join(folder, name)).size));
    expect(biggest).toBeLessThan(100 * 1024);
  });
});
