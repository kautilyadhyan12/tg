import { describe, expect, it } from "vitest";

// The real sender of Body's waiting entries (ROADMAP Stage 5 35c-ii, round one): what each answer of
// the server becomes. A refusal that is sent again forever blocks every entry behind it; a removal
// sent again forever never ends.
import { bodySender, BODY_REFUSED_WORDS } from "../src/screens/progress/bodyQueue";
type Session = Parameters<typeof bodySender>[0];

const ENTRY = { id: "11111111-1111-4111-8111-111111111111", measuredAt: "2026-11-04T08:00:00.000Z", weightKg: 70, metrics: {}, tried: true };
const refused = (status: number, error = "x") => ({ kind: "refused" as const, status, error, message: "No.", retryAfterSeconds: null, robotCheckKey: null, body: null });

function sessionAnswering(answer: unknown): { session: Session; asked: unknown[] } {
  const asked: unknown[] = [];
  const session = {
    signedIn: (request: unknown) => {
      asked.push(request);
      return Promise.resolve(answer);
    },
  };
  // Only `signedIn` is used by the sender.
  return { session: session as unknown as Session, asked };
}

describe("what each answer of the server becomes", () => {
  it.each([
    ["a save kept", { kind: "ok", data: { measurement: { ...ENTRY, source: "manual", createdAt: ENTRY.measuredAt } } }, "done"],
    ["no answer", { kind: "no_answer" }, "later"],
    ["a sign-in being renewed", refused(401), "later"],
    ["too many at once", refused(429), "later"],
    ["a fault of the server's", refused(503), "later"],
    ["removed before this late save, or not theirs", refused(404, "not_found"), "done"],
    ["a shape it will never take", refused(400, "validation_error"), "refused"],
  ] as const)("a save answered %s is %s", async (_name, answer, kind) => {
    const { session, asked } = sessionAnswering(answer);
    const result = await bodySender(session).save(ENTRY);
    expect(result.kind).toBe(kind);
    if (result.kind === "refused") expect(result.message).toBe(BODY_REFUSED_WORDS);
    expect(asked).toEqual([{ method: "POST", path: "/v1/nutrition/body-measurements", body: { id: ENTRY.id, measuredAt: ENTRY.measuredAt, weightKg: 70, metrics: {} } }]);
  });

  it.each([
    ["removed", { kind: "ok", data: null }, "done"],
    ["already gone", refused(404, "not_found"), "done"],
    ["no answer", { kind: "no_answer" }, "later"],
    ["a fault of the server's", refused(500), "later"],
  ] as const)("a removal answered %s is %s", async (_name, answer, kind) => {
    const { session, asked } = sessionAnswering(answer);
    expect((await bodySender(session).remove(ENTRY.id)).kind).toBe(kind);
    expect(asked).toEqual([{ method: "DELETE", path: `/v1/nutrition/body-measurements/${ENTRY.id}` }]);
  });
});
