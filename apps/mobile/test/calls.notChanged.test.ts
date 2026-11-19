// "Not changed" (304) in the app's one request (63a): read as null only for a request that sent the copy it holds
// (`etag`, as If-None-Match); to any other request a 304 is no answer, never a reply to read.
import { describe, expect, it } from "vitest";
import { call, type Ask, type AskInit, type Shape } from "../src/session/calls";

const nullable: Shape<unknown> = { safeParse: (raw) => ({ success: true, data: raw }) };

function server(status: number, body: unknown = null): { ask: Ask; sent: AskInit[] } {
  const sent: AskInit[] = [];
  const ask: Ask = (_url, init) => {
    sent.push(init);
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => (status === 304 ? Promise.reject(new Error("a 304 has no body")) : Promise.resolve(body)) });
  };
  return { ask, sent };
}

describe("a 304", () => {
  it("to a request that sent its copy's tag is read as null, and the tag went as If-None-Match", async () => {
    const s = server(304);
    expect(await call({ apiUrl: "http://api", ask: s.ask }, { method: "GET", path: "/v1/library", etag: '"abc"' }, nullable)).toEqual({ kind: "ok", data: null });
    expect(s.sent[0]?.headers).toEqual({ "if-none-match": '"abc"' });
  });

  it("to a request that sent no tag is no answer, never read as a reply", async () => {
    const s = server(304);
    expect(await call({ apiUrl: "http://api", ask: s.ask }, { method: "GET", path: "/v1/library" }, nullable)).toEqual({ kind: "no_answer" });
    expect(s.sent[0]?.headers).toEqual({});
  });

  it("a 200 to a request with a tag is read as its body", async () => {
    const s = server(200, { fingerprint: "f" });
    expect(await call({ apiUrl: "http://api", ask: s.ask }, { method: "GET", path: "/v1/library", etag: '"abc"' }, nullable)).toEqual({ kind: "ok", data: { fingerprint: "f" } });
  });
});
