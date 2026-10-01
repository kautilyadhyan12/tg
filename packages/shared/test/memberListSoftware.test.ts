import { describe, expect, it } from "vitest";
import { MEMBER_LIST_SOFTWARE } from "../src/memberListSoftware.js";

describe("Which software is your list in? (§11.7)", () => {
  it("lists each product once, by name", () => {
    const ids = MEMBER_LIST_SOFTWARE.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = MEMBER_LIST_SOFTWARE.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  });

  it("every product has steps and cites its own help page, on the product's own site", () => {
    for (const s of MEMBER_LIST_SOFTWARE) {
      expect(s.steps.length, s.name).toBeGreaterThan(0);
      expect(s.sources.length, s.name).toBeGreaterThan(0);
      const site = s.name.toLowerCase().replace(/\s+/g, "");
      for (const source of s.sources) {
        const url = new URL(source.url);
        expect(url.protocol, s.name).toBe("https:");
        // A competitor's page about the product does not count (RULINGS 2026-10-01).
        expect(url.hostname.replace(/[^a-z]/g, ""), s.name).toContain(site === "teamup" ? "goteamup" : site === "mindbody" ? "mindbodyonline" : site);
        expect(source.read, s.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(source.title.trim(), s.name).not.toBe("");
      }
    }
  });
});
