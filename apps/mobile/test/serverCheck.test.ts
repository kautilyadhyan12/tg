import { describe, expect, it } from "vitest";
import { checkServer } from "../src/serverCheck";

const reply = (ok: boolean, body: unknown) => () =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) });

describe("is this copy's server there", () => {
  it("asks the copy's own api for /health", async () => {
    const asked: string[] = [];
    const state = await checkServer("http://localhost:3000", (url) => {
      asked.push(url);
      return reply(true, { status: "ok" })();
    });
    expect(state).toBe("connected");
    expect(asked).toEqual(["http://localhost:3000/health"]);
  });

  it.each([
    ["a refusal", reply(false, { status: "ok" })],
    ["another server's reply", reply(true, { ok: true })],
    ["a page that is not the api", reply(true, "<html>")],
    ["an empty reply", reply(true, null)],
    ["no connection", () => Promise.reject(new TypeError("Network request failed"))],
    [
      "a reply that is not JSON",
      () => Promise.resolve({ ok: true, json: () => Promise.reject(new SyntaxError("bad")) }),
    ],
  ])("%s reads as unreachable", async (_name, ask) => {
    expect(await checkServer("http://localhost:3000", ask)).toBe("unreachable");
  });

  it("a server that never answers is given up on", async () => {
    const never = (_url: string, init: { signal: AbortSignal }) =>
      new Promise<never>((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      });
    expect(await checkServer("http://localhost:3000", never, 20)).toBe("unreachable");
  });
});
