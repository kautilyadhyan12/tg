import { runInNewContext } from "node:vm";
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

  it("the policy lets no other script or address in, and frames only https pages: Square's and the bank's check", () => {
    const parts: Record<string, string[]> = Object.fromEntries(CARD_PAGE_POLICY.split("; ").map((d): [string, string[]] => [d.split(" ")[0] ?? "", d.split(" ").slice(1)]));
    expect(parts["default-src"]).toEqual(["'none'"]);
    expect(parts["script-src"]).toEqual([PAGE_SCRIPT_HASH, "https://web.squarecdn.com", "https://sandbox.web.squarecdn.com"]);
    // Square's script frames the card's bank's own check on the page and posts its form there, at any bank's address.
    expect(parts["frame-src"]).toEqual(["https:"]);
    expect(parts["form-action"]).toEqual(["https:"]);
    expect(parts["object-src"]).toEqual(["'none'"]);
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
    ["the bank's check Square's script frames on the page", "https://acs.examplebank.com/3ds", false, "load"],
    ["a frame that is not https", "http://evil.example/frame", false, "refuse"],
    ["a file", "file:///sdcard/x", false, "refuse"],
  ])("%s", (_name, url, top, where) => {
    expect(cardWhereTo(url, top, PAGE)).toBe(where);
  });
});

/** A part of the page as the page's script measures it: its box, and how it is drawn. */
interface Part {
  tagName: string;
  rect: { width: number; height: number };
  style: { display: string; visibility: string };
}
const part = (tagName: string, width: number, height: number, style: Partial<Part["style"]> = {}): Part => ({
  tagName,
  rect: { width, height },
  style: { display: "block", visibility: "visible", ...style },
});

/** The page's own script, run with these parts on the page; its watchers are run by hand. */
function pageWith(parts: Part[]) {
  const html = cardPage(form());
  if (html === null) throw new Error("no page");
  const script = runningScripts(html)[0] ?? "";
  const box = part("DIV", 366, 139);
  const said: { kind: string; on?: boolean }[] = [];
  let changed: () => void = () => undefined;
  const sizes: { run: () => void; watched: unknown[] }[] = [];
  const heard: { name: string; run: () => void }[] = [];
  const all = [box, part("SCRIPT", 0, 0, { display: "none" }), ...parts];
  const shown = all.map((p) => ({ ...p, getBoundingClientRect: () => p.rect }));
  const document = {
    body: { children: shown },
    head: { appendChild: () => undefined },
    addEventListener: (name: string, run: () => void) => heard.push({ name, run }),
    createElement: () => ({}),
    getElementById: (id: string) => (id === "form" ? { textContent: JSON.stringify(dataOf(html)) } : shown[0]),
  };
  const window = {
    ReactNativeWebView: { postMessage: (m: string) => said.push(JSON.parse(m) as { kind: string; on?: boolean }) },
    getComputedStyle: (p: Part) => p.style,
    ResizeObserver: class {
      watched: unknown[] = [];
      constructor(run: () => void) { sizes.push({ run, watched: this.watched }); }
      observe(el: unknown) { this.watched.push(el); }
    },
  };
  class MutationObserver {
    constructor(run: () => void) { changed = run; }
    observe() { return undefined; }
  }
  runInNewContext(script, { window, document, MutationObserver, ResizeObserver: window.ResizeObserver });
  return {
    /** What the page asked about room. */
    asked: () => said.filter((m) => m.kind === "tall"),
    /** Parts were added to the page. */
    added: () => { changed(); },
    /** A part's fade or animation ends with it drawn this way, with nothing added or changed on the page. */
    faded: (p: Part, style: Partial<Part["style"]>, name = "transitionend") => {
      Object.assign(p.style, style);
      for (const h of heard) if (h.name === name) h.run();
    },
    /** A part takes a new size with nothing added or changed on the page: its style arrived, or the page laid out again. */
    grew: (p: Part, height: number) => {
      p.rect.height = height;
      const el = shown[all.indexOf(p)];
      for (const s of sizes) if (s.watched.includes(el)) s.run();
    },
  };
}

/** What the page asks about room once these parts are added. */
function roomAsked(parts: Part[]): { kind: string; on?: boolean }[] {
  const page = pageWith(parts);
  page.added();
  return page.asked();
}

describe("the bank's check gets room on the page", () => {
  // What Square adds, measured in a real browser at the phone's own size: the card's boxes sit 142 points tall, and the
  // bank's check is a layer over the whole page, so it is exactly as tall as the page.
  it("Square's check layer over the whole page asks for room, however small the page is", () => {
    expect(roomAsked([part("DIV", 366, 142)])).toEqual([{ kind: "tall", on: true }]);
    expect(roomAsked([part("DIV", 366, 860)])).toEqual([{ kind: "tall", on: true }]);
  });

  it("Square's hidden helper frame and the check's empty form ask for nothing", () => {
    expect(roomAsked([part("IFRAME", 0, 0, { visibility: "hidden" }), part("FORM", 366, 0)])).toEqual([]);
    expect(roomAsked([part("DIV", 366, 142, { display: "none" })])).toEqual([]);
  });

  it("Square's layer added before its style has loaded asks for room once it takes its size", () => {
    // On the phone Square adds the layer with no size yet; it grows when Square's style arrives, which adds nothing to the page.
    const layer = part("DIV", 366, 0);
    const page = pageWith([layer]);
    page.added();
    expect(page.asked()).toEqual([]);
    page.grew(layer, 142);
    expect(page.asked()).toEqual([{ kind: "tall", on: true }]);
    page.grew(layer, 0);
    expect(page.asked()).toEqual([{ kind: "tall", on: true }, { kind: "tall", on: false }]);
  });

  it("Square's layer that fades in asks for room when the fade ends", () => {
    // Measured on the phone: the layer is added full size but hidden, and stays so while it fades in; the fade's end
    // changes nothing on the page.
    const layer = part("DIV", 366, 142, { visibility: "hidden" });
    const page = pageWith([layer]);
    page.added();
    expect(page.asked()).toEqual([]);
    page.faded(layer, { visibility: "visible" });
    expect(page.asked()).toEqual([{ kind: "tall", on: true }]);
    page.faded(layer, { visibility: "hidden" }, "animationend");
    expect(page.asked()).toEqual([{ kind: "tall", on: true }, { kind: "tall", on: false }]);
  });
});

/** The page with a check (20i-ii), run with a stand-in for Square: what it asks Square, and what it says back. */
function checkPageWith(answer: () => Promise<{ status: string; token?: string }>) {
  const html = cardPage(form(), { cardId: "ccof:CA4SEtara", amount: "49.99", currencyCode: "USD" });
  if (html === null) throw new Error("no page");
  const script = runningScripts(html)[0] ?? "";
  const said: { kind: string; token?: string }[] = [];
  const asked: unknown[][] = [];
  let attached = 0;
  const loaded: { onload?: () => void } = {};
  const card = {
    attach: () => {
      attached += 1;
      return Promise.resolve();
    },
    tokenize: (...args: unknown[]) => {
      asked.push(args);
      return answer();
    },
  };
  const document = {
    body: { children: [] },
    head: { appendChild: () => undefined },
    addEventListener: () => undefined,
    createElement: () => loaded,
    getElementById: (id: string) => (id === "form" ? { textContent: JSON.stringify(dataOf(html)) } : { getBoundingClientRect: () => ({ width: 0, height: 0 }) }),
  };
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (m: string) => said.push(JSON.parse(m) as { kind: string }) },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  };
  class MutationObserver {
    observe() { return undefined; }
  }
  runInNewContext(script, { window, document, MutationObserver });
  const settle = () => new Promise((done) => setTimeout(done, 0));
  return {
    said,
    asked,
    attached: () => attached,
    /** Square's script loads. */
    load: async () => {
      window["Square"] = { payments: () => ({ card: () => Promise.resolve(card) }) };
      loaded.onload?.();
      await settle();
    },
    /** The app runs CHECK_SCRIPT. */
    check: async () => {
      (window["kwazoCheck"] as () => void)();
      await settle();
    },
  };
}

describe("the bank's check before Pay asks Square about the saved card, for Pay's amount (20i-ii; round one, T1)", () => {
  it("draws no boxes, and asks Square to check that card for that amount, as a member's own charge, with the person named", async () => {
    const page = checkPageWith(() => Promise.resolve({ status: "OK", token: "ccof:CA4SEtara#verf:CA4SEyes" }));
    await page.load();
    expect(page.said).toEqual([{ kind: "ready" }]);
    expect(page.attached()).toBe(0);
    await page.check();
    expect(page.asked).toEqual([
      [
        {
          amount: "49.99",
          currencyCode: "USD",
          intent: "CHARGE",
          customerInitiated: true,
          sellerKeyedIn: false,
          billingContact: { givenName: "Tara", familyName: "Shah", email: "tara@gmail.com", countryCode: "US" },
        },
        "ccof:CA4SEtara",
      ],
    ]);
    expect(page.said.at(-1)).toEqual({ kind: "pass", token: "ccof:CA4SEtara#verf:CA4SEyes" });
  });

  it("Square's own words decide the ending: the bank's check refused or cancelled, or a card Square can't use", async () => {
    // Square's errors as its test area threw them on 2026-11-14.
    for (const [answer, kind] of [
      [() => Promise.reject(new Error("Tokenization has failed\n  An error occurred while verifying the buyer")), "bank_no"],
      [() => Promise.reject(new Error("An unexpected error occurred while using Card.")), "not_taken"],
      [() => Promise.resolve({ status: "Invalid" }), "not_taken"],
      [() => Promise.resolve({ status: "Cancel" }), "not_taken"],
    ] as const) {
      const page = checkPageWith(answer);
      await page.load();
      await page.check();
      expect(page.said.at(-1)).toEqual({ kind });
    }
  });

  it("asks once a press: before Square is ready nothing, and a second press while it works asks nothing more", async () => {
    let done: (v: { status: string; token?: string }) => void = () => undefined;
    const page = checkPageWith(() => new Promise((r) => (done = r)));
    await page.check();
    expect(page.asked).toEqual([]);
    await page.load();
    await page.check();
    await page.check();
    expect(page.asked).toHaveLength(1);
    done({ status: "OK", token: "ccof:CA4SEtara#verf:CA4SEyes" });
    await new Promise((r) => setTimeout(r, 0));
    expect(page.said.filter((m) => m.kind === "pass")).toHaveLength(1);
  });
});
