// A CHANGE IS TAKEN FROM A BROWSER ONLY WHEN OUR OWN WEBSITE SENT IT (ROADMAP Stage 4
// item 17, Kd 2026-10-21).
//
// In production the console and the api are two sites, so the session cookies are
// SameSite=None (`tokens.ts`): a browser sends them with a request ANY page asks for. A
// page on another website could post a form to a signed-in owner's api and remove a
// booking in their name, and a body-less route needs no JSON to be reached. CORS does not
// stop that: it only hides the answer from the other page, after the change is made.
//
// The design is Go's `http.CrossOriginProtection` (Go 1.25), the standard one:
//   · GET, HEAD and OPTIONS change nothing and pass.
//   · `Origin` exactly our website's: passes. This is every save the console makes.
//   · `Sec-Fetch-Site` (every browser since 2023) is the browser's own word: same-origin
//     (the unsubscribe page the api serves, posting to itself) or none (typed by the
//     person) passes; same-site and cross-site are refused.
//   · Neither header: not a browser. Paddle, Razorpay, Square and Resend, a mail
//     program's one-click unsubscribe and the phone app send neither, and hold no
//     browser's cookie, so they pass.
//   · An older browser sends `Origin` without `Sec-Fetch-Site`: it passes only when the
//     page is on the api's own host.
// Run before anything else counts or reads the request, so a refused request spends
// none of the signed-in person's allowance.
import type { IncomingHttpHeaders } from "node:http";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type FromOurWebsite = "pass" | "refuse";

export function fromOurWebsite(method: string, headers: IncomingHttpHeaders, webOrigin: string): FromOurWebsite {
  if (SAFE_METHODS.has(method.toUpperCase())) return "pass";
  const origin = headers.origin;
  if (origin === webOrigin) return "pass";
  const site = headers["sec-fetch-site"];
  if (site !== undefined) return site === "same-origin" || site === "none" ? "pass" : "refuse";
  if (origin === undefined) return "pass";
  return hostOf(origin) !== null && hostOf(origin) === headers.host ? "pass" : "refuse";
}

/** The `host:port` an Origin names, as a Host header writes it; null for "null" and
 *  anything else that is not a web address. */
function hostOf(origin: string): string | null {
  if (!URL.canParse(origin)) return null;
  const url = new URL(origin);
  return url.protocol === "http:" || url.protocol === "https:" ? url.host : null;
}
