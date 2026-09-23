// What comes back, the pure parts (ROADMAP 3b-i-b; Part 3 §9.12): the Svix signature,
// what each Resend report means, when Resend's record confirms it, when a gym stops,
// when it waits, the reader of Resend's record and the operator's note. No database.
//
// The signature's first case and the webhook body are not written from this code: the
// vector is Svix's own ("Verifying payloads manually", docs.svix.com, read 2026-09-23)
// and the body is Resend's own example of `email.bounced` (resend.com/docs, read the
// same day), word for word.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resendWebhookBodySchema } from "@app/shared";
import { createResendEmailReader } from "../src/email/resend.js";
import { operatorNote } from "../src/modules/orgs/invites/operatorNote.js";
import {
  confirm,
  effectOf,
  judgeGym,
  mayGymSend,
  replacesResult,
  type GateFacts,
  type GymCounts,
} from "../src/modules/orgs/invites/standing.js";
import type { StoredResendEvent } from "../src/modules/webhooks/repo.js";
import { svixKey, verifySvix } from "../src/modules/webhooks/svix.js";

// =========================================================================
// THE SIGNATURE
// =========================================================================

describe("verifySvix", () => {
  // Svix's published test vector.
  const vector = {
    secret: "whsec_plJ3nmyCDGBKInavdOK15jsl", // Svix's public documentation example, gitleaks:allow
    id: "msg_loFOjxBNrRLzqYUf",
    timestamp: "1731705121",
    body: '{"event_type":"ping","data":{"success":true}}',
    signature: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
  };
  const key = svixKey(vector.secret);
  if (key === null) throw new Error("Svix's own example secret did not read");
  const at = Number(vector.timestamp);
  const signed = (over: Partial<{ id: string; timestamp: string; signature: string; body: string }> = {}) => ({
    id: over.id ?? vector.id,
    timestamp: over.timestamp ?? vector.timestamp,
    signature: over.signature ?? vector.signature,
    body: Buffer.from(over.body ?? vector.body, "utf8"),
  });

  const cases: [string, ReturnType<typeof signed>, number, boolean][] = [
    ["Svix's own example", signed(), at, true],
    ["the example among other signatures", signed({ signature: `v1,AAAA v2,${vector.signature.slice(3)} ${vector.signature}` }), at, true],
    ["one byte of the body changed", signed({ body: vector.body.replace("true", "tru3") }), at, false],
    ["a space added to the body", signed({ body: vector.body + " " }), at, false],
    ["another message id", signed({ id: "msg_loFOjxBNrRLzqYUg" }), at, false],
    ["another timestamp", signed({ timestamp: String(at + 1) }), at + 1, false],
    ["the right signature under v2", signed({ signature: `v2,${vector.signature.slice(3)}` }), at, false],
    ["no version", signed({ signature: vector.signature.slice(3) }), at, false],
    ["an empty header", signed({ signature: "" }), at, false],
    ["garbage", signed({ signature: "v1,!!!not-base64!!!" }), at, false],
    ["the signature cut short", signed({ signature: vector.signature.slice(0, 20) }), at, false],
    ["five minutes late", signed(), at + 300, true],
    ["five minutes early", signed(), at - 300, true],
    ["a second past five minutes late", signed(), at + 301, false],
    ["a second past five minutes early", signed(), at - 301, false],
    ["a timestamp in milliseconds", signed({ timestamp: `${vector.timestamp}000` }), at, false],
    ["a timestamp that is not a number", signed({ timestamp: "1731705121.0" }), at, false],
  ];
  for (const [name, request, now, expected] of cases) {
    it(name, () => {
      expect(verifySvix(key, request, now)).toBe(expected);
    });
  }

  it("a different secret never verifies Svix's example", () => {
    const other = svixKey("whsec_" + Buffer.from("another-secret-entirely").toString("base64"));
    if (other === null) throw new Error("the other secret did not read");
    expect(verifySvix(other, signed(), at)).toBe(false);
  });

  it("reads only a whsec_ secret", () => {
    expect(svixKey("plJ3nmyCDGBKInavdOK15jsl")).toBeNull();
    expect(svixKey("whsec_")).toBeNull();
    expect(svixKey("whsec_not base64!")).toBeNull();
    expect(svixKey(vector.secret)?.equals(Buffer.from("plJ3nmyCDGBKInavdOK15jsl", "base64"))).toBe(true);
  });

  it("signs the raw bytes, so a body that is not UTF-8 still verifies as sent", () => {
    const body = Buffer.from([0x7b, 0xff, 0xfe, 0x7d]);
    const mac = createHmac("sha256", key).update(`${vector.id}.${vector.timestamp}.`).update(body).digest("base64");
    expect(verifySvix(key, { id: vector.id, timestamp: vector.timestamp, signature: `v1,${mac}`, body }, at)).toBe(true);
  });
});

// =========================================================================
// RESEND'S BODY
// =========================================================================

describe("Resend's own example body", () => {
  // resend.com/docs "email.bounced", as published.
  const example = {
    type: "email.bounced",
    created_at: "2026-11-22T23:41:12.126Z",
    data: {
      broadcast_id: "8b146471-e88e-4322-86af-016cd36fd216",
      created_at: "2026-11-22T23:41:11.894Z",
      email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
      message_id: "<111-222-333@email.example.com>",
      from: "Acme <onboarding@resend.dev>",
      to: ["delivered@resend.dev"],
      subject: "Sending this example",
      template_id: "43f68331-0622-4e15-8202-246a0388854b",
      bounce: {
        message: "The recipient's email address is on the suppression list because it has a recent history of producing hard bounces.",
        subType: "Suppressed",
        type: "Permanent",
      },
      tags: { category: "confirm_email" },
    },
  };

  it("reads as Resend refusing that email", () => {
    const body = resendWebhookBodySchema.parse(example);
    expect(body.type).toBe("email.bounced");
    expect(body.data?.email_id).toBe("56761188-7520-42d8-8898-ff6fc54ce618");
    // Resend's example is a bounce of sub-type Suppressed: its own list, which a complaint
    // about another gym's email can put an address on. Refused, never a bounce against
    // this gym.
    const event = {
      type: "email.bounced" as const,
      emailId: "x",
      sendId: null,
      bounceType: body.data?.bounce?.type ?? null,
      bounceSubType: body.data?.bounce?.subType ?? null,
    };
    expect(effectOf(event)).toEqual({ result: "refused", suppress: "refused" });
  });
});

// =========================================================================
// WHAT A REPORT MEANS, AND WHEN RESEND'S RECORD CONFIRMS IT
// =========================================================================

const ev = (type: StoredResendEvent["type"], bounceType: string | null = null, bounceSubType: string | null = null): StoredResendEvent => ({
  type,
  emailId: "e",
  sendId: null,
  bounceType,
  bounceSubType,
});

describe("effectOf — every report", () => {
  const cases: [string, StoredResendEvent, ReturnType<typeof effectOf>][] = [
    ["delivered", ev("email.delivered"), { result: "delivered", suppress: null }],
    ["a Permanent bounce", ev("email.bounced", "Permanent", "General"), { result: "bounced", suppress: "bounced" }],
    ["a permanent bounce, any case", ev("email.bounced", "PERMANENT"), { result: "bounced", suppress: "bounced" }],
    ["a bounce with no type (Resend calls every bounce permanent)", ev("email.bounced"), { result: "bounced", suppress: "bounced" }],
    ["a Transient bounce", ev("email.bounced", "Transient"), { result: "failed", suppress: null }],
    ["an Undetermined bounce", ev("email.bounced", "Undetermined"), { result: "failed", suppress: null }],
    ["a bounce typed with a word nobody uses", ev("email.bounced", "Soft"), { result: "failed", suppress: null }],
    // Resend's own example body: its list, which another gym's complaint can put an address on.
    ["a Permanent bounce of sub-type Suppressed", ev("email.bounced", "Permanent", "Suppressed"), { result: "refused", suppress: "refused" }],
    ["sub-type Suppressed, any case", ev("email.bounced", "Permanent", "suppressed"), { result: "refused", suppress: "refused" }],
    ["a Permanent bounce of sub-type MessageRejected", ev("email.bounced", "Permanent", "MessageRejected"), { result: "bounced", suppress: "bounced" }],
    ["suppressed by Resend", ev("email.suppressed"), { result: "refused", suppress: "refused" }],
    ["a complaint", ev("email.complained"), { result: "complained", suppress: "complained" }],
    ["failed to send", ev("email.failed"), { result: "failed", suppress: null }],
  ];
  for (const [name, event, expected] of cases) {
    it(name, () => {
      expect(effectOf(event)).toEqual(expected);
    });
  }
});

describe("confirm — Resend's last event against each report, from the orders Resend's events come in", () => {
  // The event orders Resend's "Event Types" page describes (read 2026-09-23): an email is
  // sent, may be delayed, then delivered or bounced; once delivered it may be opened,
  // clicked and complained about in any order; or Resend suppresses it, or it fails.
  // Written from those words, not from the code's own list.
  // Any email may be scheduled, queued, sent and delayed before its outcome.
  const start = ["scheduled", "queued", "sent", "delivery_delayed"];
  const orders: string[][] = [
    [...start, "delivered"],
    [...start, "delivered", "opened", "clicked", "complained"],
    [...start, "delivered", "complained", "opened", "clicked"],
    [...start, "delivered", "clicked", "complained", "opened"],
    [...start, "bounced"],
    // A bounce can come back after the receiving server first accepted the email.
    [...start, "delivered", "bounced"],
    [...start, "suppressed"],
    [...start, "failed"],
  ];
  const eventOf: Record<StoredResendEvent["type"], string> = {
    "email.delivered": "delivered",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.failed": "failed",
    "email.suppressed": "suppressed",
  };
  // Resend reports a suppression as either event, and may record it as either.
  const same = (a: string, b: string) => a === b || (["bounced", "suppressed"].includes(a) && ["bounced", "suppressed"].includes(b));
  /** What the orders say: the record reads the report's event or one after it → agrees;
   *  only ever an event before it → not yet; an event no order puts with it → disagrees. */
  const expected = (report: string, last: string): string => {
    if (same(last, report)) return "agrees";
    let before = false;
    for (const order of orders) {
      const at = order.indexOf(report);
      const lastAt = order.indexOf(last);
      if (at < 0 || lastAt < 0) continue;
      if (lastAt > at) return "agrees";
      before = true;
    }
    return before ? "not_yet" : "disagrees";
  };  const lastEvents = [...new Set([...orders.flat(), "canceled", "something_new", ""])];
  for (const type of Object.keys(eventOf) as StoredResendEvent["type"][]) {
    for (const last of lastEvents) {
      const want = expected(eventOf[type], last);
      it(`${type} with last event "${last}" → ${want}`, () => {
        expect(confirm(type, last)).toBe(want);
      });
    }
  }
});
describe("replacesResult — an email keeps its most serious result", () => {
  const order = ["delivered", "failed", "refused", "bounced", "complained"] as const;
  it("nothing yet: anything is written", () => {
    for (const next of order) expect(replacesResult(next, null)).toBe(true);
  });
  for (const [i, current] of order.entries()) {
    for (const [j, next] of order.entries()) {
      it(`${current} then ${next}: ${j > i ? "replaced" : "kept"}`, () => {
        expect(replacesResult(next, current)).toBe(j > i);
      });
    }
  }
});

// =========================================================================
// WHEN A GYM STOPS
// =========================================================================

describe("judgeGym — every class of case", () => {
  const cases: [string, GymCounts, ReturnType<typeof judgeGym>][] = [
    ["nothing sent", { sent: 0, bounced: 0, complainedEarly: false }, null],
    ["one bounce in the first email", { sent: 1, bounced: 1, complainedEarly: false }, null],
    ["one bounce in 50", { sent: 50, bounced: 1, complainedEarly: false }, null],
    ["two bounces in 10 (counted as if 50 had gone)", { sent: 10, bounced: 2, complainedEarly: false }, "bounces"],
    ["two bounces in 50", { sent: 50, bounced: 2, complainedEarly: false }, "bounces"],
    ["two bounces in 100 (exactly 2 %)", { sent: 100, bounced: 2, complainedEarly: false }, null],
    ["three bounces in 100", { sent: 100, bounced: 3, complainedEarly: false }, "bounces"],
    ["four in 200 (exactly 2 %)", { sent: 200, bounced: 4, complainedEarly: false }, null],
    ["five in 200", { sent: 200, bounced: 5, complainedEarly: false }, "bounces"],
    ["twenty in 1,000 (exactly 2 %)", { sent: 1000, bounced: 20, complainedEarly: false }, null],
    ["twenty-one in 1,000", { sent: 1000, bounced: 21, complainedEarly: false }, "bounces"],
    ["a complaint in the first 100, nothing else", { sent: 100, bounced: 0, complainedEarly: true }, "complaint"],
    ["a complaint and too many bounces: the complaint is named", { sent: 50, bounced: 5, complainedEarly: true }, "complaint"],
  ];
  for (const [name, counts, expected] of cases) {
    it(name, () => {
      expect(judgeGym(counts)).toBe(expected);
    });
  }
});

// =========================================================================
// WHEN A GYM WAITS: THE FIRST 50
// =========================================================================

describe("mayGymSend — every class of case", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const HOUR = 60 * 60 * 1000;
  const facts = (over: Partial<GateFacts> & { batch?: Partial<GateFacts["firstBatch"]> } = {}): GateFacts => ({
    stopped: over.stopped ?? false,
    sentOrSending: over.sentOrSending ?? 50,
    firstBatch: { sent: 50, withResult: 0, lastSentAt: ago(10 * 60_000), ...over.batch },
  });
  const cases: [string, GateFacts, boolean][] = [
    ["a new gym", facts({ sentOrSending: 0, batch: { sent: 0, lastSentAt: null } }), true],
    ["49 gone", facts({ sentOrSending: 49, batch: { sent: 49 } }), true],
    ["45 gone and 4 going", facts({ sentOrSending: 49, batch: { sent: 45 } }), true],
    ["45 gone and 5 going: the 50th is out", facts({ sentOrSending: 50, batch: { sent: 45 } }), false],
    ["50 gone, none back, ten minutes ago", facts(), false],
    ["50 gone, 49 back", facts({ batch: { withResult: 49 } }), false],
    ["50 gone, all 50 back", facts({ batch: { withResult: 50 } }), true],
    ["50 gone, none back, 59 minutes ago", facts({ batch: { lastSentAt: ago(59 * 60_000) } }), false],
    ["50 gone, none back, an hour ago", facts({ batch: { lastSentAt: ago(HOUR) } }), true],
    ["50 gone, none back, a day ago", facts({ batch: { lastSentAt: ago(24 * HOUR) } }), true],
    ["stopped, with everything back", facts({ stopped: true, batch: { withResult: 50 } }), false],
    ["stopped, and new", facts({ stopped: true, sentOrSending: 0, batch: { sent: 0, lastSentAt: null } }), false],
  ];
  for (const [name, gate, expected] of cases) {
    it(name, () => {
      expect(mayGymSend(gate, now)).toBe(expected);
    });
  }
});

// =========================================================================
// RESEND'S RECORD, READ BACK
// =========================================================================

describe("createResendEmailReader", () => {
  const id = "56761188-7520-42d8-8898-ff6fc54ce618";
  const answering = (status: number, body: unknown) => {
    const asked: string[] = [];
    const fetchImpl = ((input: string | URL) => {
      asked.push(input.toString());
      return Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));
    }) as typeof fetch;
    return { reader: createResendEmailReader({ apiKey: "re_test_not_a_key", fetchImpl }), asked };
  };

  it("reads the last event of the email asked about", async () => {
    const { reader, asked } = answering(200, {
      object: "email",
      id,
      to: ["x@example.com"],
      last_event: "bounced",
      tags: [{ name: "invite_send", value: "9b2f7c1e-0000-4000-8000-000000000001" }],
    });
    expect(await reader.read(id)).toEqual({
      kind: "found",
      lastEvent: "bounced",
      tags: [{ name: "invite_send", value: "9b2f7c1e-0000-4000-8000-000000000001" }],
    });
    expect(asked).toEqual([`https://api.resend.com/emails/${id}`]);
  });
  it("a record with no tags, or tags that do not read, still reads", async () => {
    expect(await answering(200, { id, last_event: "delivered", tags: null }).reader.read(id)).toEqual({ kind: "found", lastEvent: "delivered", tags: [] });
    expect(await answering(200, { id, last_event: "delivered", tags: "x" }).reader.read(id)).toEqual({ kind: "found", lastEvent: "delivered", tags: [] });
  });
  it("another email's record is no answer", async () => {
    const { reader } = answering(200, { id: "another", last_event: "bounced" });
    expect(await reader.read(id)).toEqual({ kind: "unavailable", status: 200 });
  });
  it("a body that does not parse is no answer", async () => {
    const { reader } = answering(200, { id });
    expect(await reader.read(id)).toEqual({ kind: "unavailable", status: 200 });
  });
  it("404 is an email Resend does not have", async () => {
    expect(await answering(404, { name: "not_found" }).reader.read(id)).toEqual({ kind: "missing" });
  });
  it("401 and 403 are a key that may not read", async () => {
    expect(await answering(401, {}).reader.read(id)).toEqual({ kind: "denied", status: 401 });
    expect(await answering(403, { name: "restricted_api_key" }).reader.read(id)).toEqual({ kind: "denied", status: 403 });
  });
  it("429 and 500 are asked again later", async () => {
    expect(await answering(429, {}).reader.read(id)).toEqual({ kind: "unavailable", status: 429 });
    expect(await answering(500, {}).reader.read(id)).toEqual({ kind: "unavailable", status: 500 });
  });
  it("a network failure is asked again later", async () => {
    const reader = createResendEmailReader({ apiKey: "k", fetchImpl: () => Promise.reject(new TypeError("fetch failed")) });
    expect(await reader.read(id)).toEqual({ kind: "unavailable", status: null });
  });
  it("an id not in Resend's shape never reaches the address", async () => {
    const { reader, asked } = answering(200, {});
    for (const bad of ["../api-keys", "a/b", "a?b", "", "x".repeat(101)]) expect(await reader.read(bad)).toEqual({ kind: "missing" });
    expect(asked).toEqual([]);
  });
});

// =========================================================================
// THE OPERATOR'S NOTE
// =========================================================================

describe("operatorNote", () => {
  it("names the gym on one line, why it stopped, and how to start it again", () => {
    const note = operatorNote({
      gymId: "7d0c5f0e-1111-4222-8333-944455556666",
      gymName: "Iron\r\nBcc: someone@example.com <b>House</b>",
      reason: "bounces",
      sent: 50,
      bounced: 2,
    });
    expect(note.subject).toBe("Invitations stopped: Iron Bcc: someone@example.com <b>House</b>");
    expect(note.subject).not.toMatch(/[\r\n]/);
    expect(note.text).toContain("2 of its 50 invitations bounced");
    expect(note.text).toContain("tools/invites-stopped.ts resume 7d0c5f0e-1111-4222-8333-944455556666");
    expect(note.html).toContain("&lt;b&gt;House&lt;/b&gt;");
    expect(note.html).not.toContain("<b>");
  });
  it("says so for a complaint", () => {
    const note = operatorNote({ gymId: "g", gymName: "", reason: "complaint", sent: 12, bounced: 0 });
    expect(note.subject).toBe("Invitations stopped: A gym");
    expect(note.text).toContain("marked one of its first 100 invitations as spam");
  });
});
