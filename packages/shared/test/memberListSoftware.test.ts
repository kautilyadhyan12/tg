import { describe, expect, it } from "vitest";
import { MEMBER_LIST_SOFTWARE } from "../src/memberListSoftware.js";

describe("Which software is your list in? (§11.7)", () => {
  it("lists each product once, by name", () => {
    const ids = MEMBER_LIST_SOFTWARE.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = MEMBER_LIST_SOFTWARE.map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));
  });

  // Each product's own domain, written here and not read from the data, so a rival's page
  // about the product (glofox-alternatives.rival.com) cannot pass for the product's own.
  const OWN_DOMAIN: Readonly<Record<string, string>> = {
    glofox: "glofox.com",
    "gym-insight": "gyminsight.com",
    gymdesk: "gymdesk.com",
    gymmaster: "gymmaster.com",
    mindbody: "mindbodyonline.com",
    teamup: "goteamup.com",
    wellnessliving: "wellnessliving.com",
    wodify: "wodify.com",
  };
  const onOwnSite = (url: string, domain: string): boolean => {
    const host = new URL(url).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  };

  it("the own-site check refuses a rival's page that only names the product", () => {
    expect(onOwnSite("https://support.glofox.com/hc/x", "glofox.com")).toBe(true);
    expect(onOwnSite("https://glofox-alternatives.rival-gym-software.com/x", "glofox.com")).toBe(false);
    expect(onOwnSite("https://notglofox.com/x", "glofox.com")).toBe(false);
  });

  it("every product has steps and cites its own help page, on the product's own site", () => {
    expect(Object.keys(OWN_DOMAIN).sort()).toEqual(MEMBER_LIST_SOFTWARE.map((s) => s.id).sort());
    for (const s of MEMBER_LIST_SOFTWARE) {
      expect(s.steps.length, s.name).toBeGreaterThan(0);
      expect(s.sources.length, s.name).toBeGreaterThan(0);
      const domain = OWN_DOMAIN[s.id] ?? "";
      for (const source of s.sources) {
        expect(new URL(source.url).protocol, s.name).toBe("https:");
        expect(onOwnSite(source.url, domain), `${s.name} ${source.url}`).toBe(true);
        expect(source.read, s.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(source.title.trim(), s.name).not.toBe("");
      }
    }
  });

  // Import reads every file as the whole list (review of 5c, High 2): no step may ask for
  // only some of the people.
  it("no step asks for only some of the people", () => {
    for (const s of MEMBER_LIST_SOFTWARE) {
      for (const step of [...s.steps, s.tip ?? ""]) {
        expect(step, s.name).not.toMatch(/you want\b|who to include|narrow/i);
      }
    }
  });
});
