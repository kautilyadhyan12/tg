// What Paddle, Razorpay, Square and Resend send, in their documented shapes with the extra fields
// they add (fixtures/providerReplies.ts), is read by our checks. The route tests' fakes hand back
// objects already read, so only this file proves a real renewal, invoice or webhook still reads
// after a change to zod (ROADMAP 21a-iii-b, round one).
import { describe, expect, it } from "vitest";
import * as shared from "../src/index.js";
import { PROVIDER_REPLIES } from "./fixtures/providerReplies.js";

type Reader = { safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: unknown[] } } };
const reader = (name: string): Reader => {
  const s: unknown = (shared as Record<string, unknown>)[name];
  if (typeof s !== "object" || s === null || !("safeParse" in s)) throw new Error(`${name} is not a check in @app/shared`);
  return s as Reader;
};

describe("a provider's documented reply is read", () => {
  const cases = Object.entries(PROVIDER_REPLIES).flatMap(([name, replies]) => replies.map((reply, i) => [`${name} #${String(i + 1)}`, name, reply] as const));

  it.each(cases)("%s", (_label, name, reply) => {
    const read = reader(name).safeParse(reply);
    expect(read.error?.issues ?? []).toEqual([]);
    expect(read.success).toBe(true);
  });
});

describe("what a renewal decides from", () => {
  it("Paddle's subscription keeps its customer, status and next bill", () => {
    const read = shared.paddleSubscriptionSchema.parse(PROVIDER_REPLIES.paddleSubscriptionSchema[0]);
    expect(read.status).toBe("active");
    expect(read.customer_id).toBe("ctm_01hv6y1jedq4p1n0yqn5ba3ky4");
    expect(read.next_billed_at).toBe("2024-05-12T10:18:47.635628Z");
  });

  it("Razorpay's paid invoice keeps its amount in paise", () => {
    const read = shared.razorpayInvoiceSchema.parse(PROVIDER_REPLIES.razorpayInvoiceSchema[0]);
    expect(read.status).toBe("paid");
    expect(read.amount_paid).toBe(129900);
  });
});
