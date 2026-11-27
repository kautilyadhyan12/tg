// The server's front door answering for the api (37o; 37m's L5): Caddy's 502, 503 or 504 in words not the api's is
// told apart from no reply, so a run the api broke on is not taken for no signal. Every other reply stays as it was.
import { describe, expect, it } from "vitest";
import { call, type Ask, type Shape } from "../src/session/calls";

const any: Shape<unknown> = { safeParse: (raw) => ({ success: true, data: raw }) };

function server(status: number, body: () => Promise<unknown>): Ask {
  return () => Promise.resolve({ ok: status >= 200 && status < 300, status, json: body });
}
const html = () => Promise.reject(new SyntaxError("Unexpected token <"));
const ask = (a: Ask) => call({ apiUrl: "http://api", ask: a }, { method: "POST", path: "/v1/geo/runs", body: {} }, any);

describe("a reply that is not the api's", () => {
  it.each([
    ["the front door's 502 with an empty page", 502, html, { kind: "no_answer", gateway: true }],
    ["the front door's 503 in its own words", 503, () => Promise.resolve({ detail: "upstream down" }), { kind: "no_answer", gateway: true }],
    ["the front door's 504", 504, html, { kind: "no_answer", gateway: true }],
    ["a café's sign-in page as 200", 200, html, { kind: "no_answer" }],
    ["a page with 401 on it", 401, html, { kind: "no_answer" }],
    ["a 500 in words not the api's", 500, html, { kind: "no_answer" }],
    ["a 404 page", 404, html, { kind: "no_answer" }],
  ] as const)("%s", async (_name, status, body, expected) => {
    expect(await ask(server(status, body))).toEqual(expected);
  });

  it("the api's own 503 is its refusal, as before", async () => {
    const answer = await ask(server(503, () => Promise.resolve({ error: "unavailable", message: "Try again later." })));
    expect(answer).toMatchObject({ kind: "refused", status: 503, error: "unavailable" });
  });

  it("no reply at all is no answer, with no front door", async () => {
    expect(await ask(() => Promise.reject(new Error("no signal")))).toEqual({ kind: "no_answer" });
  });
});
