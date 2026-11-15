import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pub = fileURLToPath(new URL("../public", import.meta.url));

// Width and height from a PNG's header.
function size(file) {
  const b = readFileSync(join(pub, file));
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe("the KWAZO wizard in the browser", () => {
  it("the tab icon and the save-to-home-screen icon are at the sizes browsers ask for", () => {
    expect(size("favicon-48.png")).toEqual({ width: 48, height: 48 });
    expect(size("apple-touch-icon.png")).toEqual({ width: 180, height: 180 });
  });

  it("the vector tab icon carries the wizard as a 96-pixel picture, written once", () => {
    const svg = readFileSync(join(pub, "favicon.svg"), "utf8");
    expect(svg).not.toContain("#FF8A1F");
    const found = [...svg.matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)];
    expect(found).toHaveLength(1);
    const png = Buffer.from(found[0][1], "base64");
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({ width: 96, height: 96 });
  });
});
