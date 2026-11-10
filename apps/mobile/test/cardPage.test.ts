import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2";
import { utf8ToBytes } from "@noble/hashes/utils";
import type { CardForm } from "@app/shared";
import { CARD_PAGE_POLICY, PAGE_SCRIPT_HASH, SAVE_SCRIPT, cardPage, cardWhereTo } from "../src/screens/gym/cardPage";

// Add card's page (20d): Square's boxes in a page the app writes. It runs its own script and Square's alone, frames
// Square alone, and nothing a person typed into their name can end its data block and run.

const form = (over: Partial<CardForm> = {}): CardForm => ({
  environment: "sandbox",
  applicationId: "sandbox-sq0idb-AbCdEfGhIjKlMnOp",
  locationId: "LOCATIONIRON01",
  contact: { givenName: "Tara", familyName: "Shah", email: "tara@gmail.com", countryCode: "US" },
  ...over,
});

const PAGE = "http://localhost:3000/";

/** The words between each `<script>` that runs and its end. */
function runningScripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
}

/** The page's data block, as the page's own script reads it. */
function dataOf(html: string): unknown {
  const m = /<script type="application\/json" id="form">([\s\S]*?)<\/script>/.exec(html);
  if (m === null) throw new Error("no data block");
  return JSON.parse(m[1] ?? "");
}

describe("the page runs only its own script and Square's", () => {
  it("its one running script is the one the policy names by fingerprint", () => {
    const html = cardPage(form());
    if (html === null) throw new Error("no page");
    const scripts = runningScripts(html);
    expect(scripts).toHaveLength(1);
    const hash = Buffer.from(sha256(utf8ToBytes(scripts[0] ?? ""))).toString("base64");
    expect(PAGE_SCRIPT_HASH).toBe(`'sha256-${hash}'`);
    expect(html).toContain(`content="${CARD_PAGE_POLICY}"`);
  });

  it("the policy lets no other script, frame or address in", () => {
    const parts: Record<string, string[]> = Object.fromEntries(CARD_PAGE_POLICY.split("; ").map((d): [string, string[]] => [d.split(" ")[0] ?? "", d.split(" ").slice(1)]));
    expect(parts["default-src"]).toEqual(["'none'"]);
    expect(parts["script-src"]).toEqual([PAGE_SCRIPT_HASH, "https://web.squarecdn.com", "https://sandbox.web.squarecdn.com"]);
    expect(parts["frame-src"]).toEqual(["https://web.squarecdn.com", "https://sandbox.web.squarecdn.com"]);
    expect(parts["connect-src"]?.every((a) => a.startsWith("https://") && /square|sentry/.test(a))).toBe(true);
    expect(CARD_PAGE_POLICY).not.toContain("unsafe-eval");
    expect(parts["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("Square's test script for a test account, its live one for a live account", () => {
    expect(dataOf(cardPage(form()) ?? "")).toMatchObject({ script: "https://sandbox.web.squarecdn.com/v1/square.js" });
    expect(dataOf(cardPage(form({ environment: "production", applicationId: "sq0idp-AbCdEfGhIjKlMnOp" })) ?? "")).toMatchObject({
      script: "https://web.squarecdn.com/v1/square.js",
      applicationId: "sq0idp-AbCdEfGhIjKlMnOp",
    });
  });

  it("the gym's own Square location and the person go to Square as the server sent them", () => {
    expect(dataOf(cardPage(form()) ?? "")).toMatchObject({
      applicationId: "sandbox-sq0idb-AbCdEfGhIjKlMnOp",
      locationId: "LOCATIONIRON01",
      contact: { givenName: "Tara", familyName: "Shah", email: "tara@gmail.com", countryCode: "US" },
    });
    // Empty parts are left out, as the desk's form leaves them.
    expect(dataOf(cardPage(form({ contact: { givenName: "Tara", familyName: "", email: null, countryCode: "GB" } })) ?? "")).toMatchObject({
      contact: { givenName: "Tara", countryCode: "GB" },
    });
  });

  it("a name that tries to end the data block stays words", () => {
    const sly = `</script><script>alert(1)</script> x`;
    const html = cardPage(form({ contact: { givenName: sly, familyName: "Shah", email: null, countryCode: "US" } })) ?? "";
    expect(runningScripts(html)).toHaveLength(1);
    expect(html).not.toContain("alert(1)</script>");
    expect(dataOf(html)).toMatchObject({ contact: { givenName: sly } });
  });

  it("no page for a form the server would never send", () => {
    expect(cardPage(form({ applicationId: "evil" }))).toBeNull();
    expect(cardPage(form({ locationId: "a b" }))).toBeNull();
    expect(cardPage({ ...form(), environment: "other" } as unknown as CardForm)).toBeNull();
  });

  it("Save card asks the page for Square's token, and nothing else", () => {
    expect(SAVE_SCRIPT).toBe("window.kwazoSave&&window.kwazoSave();true;");
  });
});

describe("the page never moves off itself", () => {
  it.each([
    ["the page itself", PAGE, true, "load"],
    ["a blank frame", "about:blank", false, "load"],
    ["another page in its place", "https://evil.example/card", true, "outside"],
    ["a page that is not https", "http://evil.example/", true, "refuse"],
    ["a script address in its place", "javascript:alert(1)", true, "refuse"],
    ["an app's own address", "intent://pay", true, "refuse"],
    ["Square's frame", "https://sandbox.web.squarecdn.com/v1/card", false, "load"],
    ["the bank's check inside Square's frame", "https://acs.examplebank.com/3ds", false, "load"],
    ["a frame that is not https", "http://evil.example/frame", false, "refuse"],
    ["a file", "file:///sdcard/x", false, "refuse"],
  ])("%s", (_name, url, top, where) => {
    expect(cardWhereTo(url, top, PAGE)).toBe(where);
  });
});
