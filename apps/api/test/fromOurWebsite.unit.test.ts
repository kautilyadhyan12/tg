// Which requests the api takes a change from (ROADMAP Stage 4 item 17): every class of
// caller, by the headers it really sends. The browsers' come from the Fetch standard's
// Sec-Fetch-Site values (same-origin, same-site, cross-site, none) and from what a browser
// without them sends; the rest from what Paddle, Razorpay, Square, Resend, a mail
// program's one-click unsubscribe and the phone app send: no Origin and no Sec-Fetch-Site.
import { describe, expect, it } from "vitest";
import { fromOurWebsite, type FromOurWebsite } from "../src/modules/auth/fromOurWebsite.js";

const WEB = "https://app.kwazo.com";
const API_HOST = "api.kwazo.com";

type Case = [name: string, method: string, headers: Record<string, string>, want: FromOurWebsite];

const cases: Case[] = [
  // The console's own saves: our website, a different site from the api.
  ["the console's save", "POST", { origin: WEB, "sec-fetch-site": "cross-site", host: API_HOST }, "pass"],
  ["the console's PATCH", "PATCH", { origin: WEB, "sec-fetch-site": "cross-site", host: API_HOST }, "pass"],
  ["the console's DELETE", "DELETE", { origin: WEB, "sec-fetch-site": "cross-site", host: API_HOST }, "pass"],
  ["the console, from a browser without Sec-Fetch-Site", "PUT", { origin: WEB, host: API_HOST }, "pass"],
  // Another website, in every way a browser can say it.
  ["another website's form", "POST", { origin: "https://evil.example", "sec-fetch-site": "cross-site", host: API_HOST }, "refuse"],
  ["another website's fetch", "DELETE", { origin: "https://evil.example", "sec-fetch-site": "cross-site", host: API_HOST }, "refuse"],
  ["another page on our own domain", "POST", { origin: "https://blog.kwazo.com", "sec-fetch-site": "same-site", host: API_HOST }, "refuse"],
  ["our address over plain http", "POST", { origin: "http://app.kwazo.com", "sec-fetch-site": "cross-site", host: API_HOST }, "refuse"],
  ["our address with a slash after it", "POST", { origin: `${WEB}/`, "sec-fetch-site": "cross-site", host: API_HOST }, "refuse"],
  ["a sandboxed frame or a file opened from disk", "POST", { origin: "null", "sec-fetch-site": "cross-site", host: API_HOST }, "refuse"],
  ["a cross-site request with its Origin left off", "POST", { "sec-fetch-site": "cross-site", host: API_HOST }, "refuse"],
  ["another website, from a browser without Sec-Fetch-Site", "POST", { origin: "https://evil.example", host: API_HOST }, "refuse"],
  ["\"null\", from a browser without Sec-Fetch-Site", "POST", { origin: "null", host: API_HOST }, "refuse"],
  ["not a web address, from a browser without Sec-Fetch-Site", "POST", { origin: "chrome-extension://abc", host: API_HOST }, "refuse"],
  ["a look-alike host with our api's name in it", "POST", { origin: "https://api.kwazo.com.evil.example", host: API_HOST }, "refuse"],
  ["our api's host on another port", "POST", { origin: "https://api.kwazo.com:8443", host: API_HOST }, "refuse"],
  ["a Sec-Fetch-Site value no standard has", "POST", { origin: "https://evil.example", "sec-fetch-site": "same-origin-ish", host: API_HOST }, "refuse"],
  // The api's own unsubscribe page posting to itself.
  ["the unsubscribe page's button", "POST", { origin: `https://${API_HOST}`, "sec-fetch-site": "same-origin", host: API_HOST }, "pass"],
  ["the unsubscribe page, from a browser without Sec-Fetch-Site", "POST", { origin: `https://${API_HOST}`, host: API_HOST }, "pass"],
  ["a request the person typed", "POST", { "sec-fetch-site": "none", host: API_HOST }, "pass"],
  // Not a browser.
  ["a payment company's message", "POST", { host: API_HOST, "content-type": "application/json" }, "pass"],
  ["a mail program's one-click unsubscribe", "POST", { host: API_HOST, "content-type": "application/x-www-form-urlencoded" }, "pass"],
  ["the phone app", "PATCH", { host: API_HOST, authorization: "Bearer x" }, "pass"],
  // Asking changes nothing, from anywhere.
  ["another website's GET", "GET", { origin: "https://evil.example", "sec-fetch-site": "cross-site", host: API_HOST }, "pass"],
  ["another website's HEAD", "HEAD", { origin: "https://evil.example", "sec-fetch-site": "cross-site", host: API_HOST }, "pass"],
  ["a browser's pre-check", "OPTIONS", { origin: "https://evil.example", "sec-fetch-site": "cross-site", host: API_HOST }, "pass"],
  ["a method in lower case is still a change", "post", { origin: "https://evil.example", "sec-fetch-site": "cross-site", host: API_HOST }, "refuse"],
];

describe("fromOurWebsite", () => {
  it.each(cases)("%s", (_name, method, headers, want) => {
    expect(fromOurWebsite(method, headers, WEB)).toBe(want);
  });

  it("every method that changes something is checked, not only POST", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "PROPFIND", "SEARCH"]) {
      expect(fromOurWebsite(method, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }, WEB)).toBe("refuse");
    }
  });
});
