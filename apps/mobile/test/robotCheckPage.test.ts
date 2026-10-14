import { describe, expect, it } from "vitest";
import { robotCheckMessageSchema } from "@app/shared";
import { pageAddress, robotCheckPage, whereTo } from "../src/screens/robotCheckPage";

const PAGE = "https://api.aihomegym.app/";

describe("the page's address is the api's own", () => {
  it.each([
    ["http://localhost:3000", "http://localhost:3000/"],
    ["https://api.aihomegym.app", "https://api.aihomegym.app/"],
    ["https://api.aihomegym.app/v1/", "https://api.aihomegym.app/"],
    ["https://api.aihomegym.app?x=1", "https://api.aihomegym.app/"],
    ["ftp://api.aihomegym.app", null],
    ["https://", null],
    ["not an address", null],
  ])("%s → %s", (apiUrl, page) => {
    expect(pageAddress(apiUrl)).toBe(page);
  });
});

describe("the page is drawn only for a key Cloudflare would issue", () => {
  it.each([
    ["Cloudflare's test key", "1x00000000000000000000AA", true],
    ["a real key's shape", "0x4AAAAAAAB_c-dEfGh", true],
    ["a script in the key", '</script><script>alert(1)</script>', false],
    ["a quote in the key", 'x",action:"enquiry', false],
    ["an empty key", "", false],
    ["a key of 101 letters", "a".repeat(101), false],
  ])("%s", (_name, key, drawn) => {
    const page = robotCheckPage(key);
    expect(page !== null).toBe(drawn);
    if (page !== null) {
      expect(page).toContain(`sitekey:${JSON.stringify(key)}`);
      expect(page).toContain('action:"sign_in"');
    }
  });

  it("loads Cloudflare's script and no other", () => {
    const page = robotCheckPage("1x00000000000000000000AA") ?? "";
    const sources = [...page.matchAll(/src="([^"]+)"/g)].map((found) => found[1]);
    expect(sources).toEqual(["https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=drawBox"]);
    // Two scripts in all: the page's own few lines, and Cloudflare's.
    expect(page.match(/<script/g)).toHaveLength(2);
    expect(page).not.toMatch(/createElement|import\(|fetch\(|XMLHttpRequest/);
    // A page with no icon of its own asks the api for /favicon.ico (seen on the phone).
    expect([...page.matchAll(/href="([^"]*)"/g)].map((found) => found[1])).toEqual(["data:,"]);
  });

  // Every message the page can send must be one the app reads; the page and the shape are one list.
  it("each thing the page says is a message the app reads", () => {
    const page = robotCheckPage("1x00000000000000000000AA") ?? "";
    const kinds = [...page.matchAll(/kind:["']([a-z]+)["']/g)].map((found) => found[1]);
    expect(new Set(kinds)).toEqual(new Set(["token", "expired", "failed", "blocked"]));
    for (const kind of kinds) {
      const message = kind === "token" ? { kind, token: "t" } : { kind };
      expect(robotCheckMessageSchema.safeParse(message).success).toBe(true);
    }
  });
});

describe("where a link in the box goes", () => {
  it.each<[string, string, boolean, "load" | "outside" | "refuse"]>([
    ["the page itself", PAGE, true, "load"],
    ["an empty page", "about:blank", true, "load"],
    ["Cloudflare's frame", "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/x", false, "load"],
    ["Cloudflare's Privacy page", "https://www.cloudflare.com/privacypolicy/", true, "outside"],
    ["another site in the box", "https://example.com/", true, "outside"],
    ["the api's other pages in the box", "https://api.aihomegym.app/v1/me", true, "outside"],
    ["another site's frame", "https://example.com/frame", false, "refuse"],
    ["a plain http page", "http://example.com/", true, "refuse"],
    ["a script address", "javascript:alert(1)", true, "refuse"],
    ["a file on the phone", "file:///data/data/x", true, "refuse"],
    ["another app's link", "intent://scan#Intent;end", true, "refuse"],
  ])("%s → %s", (_name, url, topFrame, where) => {
    expect(whereTo(url, topFrame, PAGE)).toBe(where);
  });
});
