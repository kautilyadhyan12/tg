// The request the app's own Square adapter builds to delete a customer (ROADMAP 18d-iii-b-ii-b-ii-b-ii), read off a recording
// `fetch`: every route test runs against the fake, so a wrong method, a lost version or a path built from a bad id would stay
// green there. The shape is what Square's test area took on 2026-10-28 (`.cost/18d-iii-b-ii-b-ii-b-ii/probe-delete.mts`): DELETE
// on the customer's own path with `?version=` and no body; 200 and `{}` when it is done, 409 CONFLICT for a version that is not the
// current one, 404 NOT_FOUND for one already gone.
import { describe, expect, it } from "vitest";
import { createSquareApi, SQUARE_VERSION } from "../src/modules/orgs/payments/square.js";

const recorded: { url: string; init: RequestInit }[] = [];
const answer = (status: number, json: unknown) => {
  const fetchImpl: typeof fetch = (input, init) => {
    recorded.push({ url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url, init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } }));
  };
  return createSquareApi({ applicationId: "sandbox-sq0idb-APPID0000000", applicationSecret: "sandbox-sq0csb-SECRET00000000", environment: "sandbox", fetchImpl }); // dummy, gitleaks:allow
};
const last = () => recorded[recorded.length - 1];
const TOKEN = "EAAAtest-access-0123456789"; // dummy, gitleaks:allow
const error = (code: string) => ({ errors: [{ category: "INVALID_REQUEST_ERROR", code, detail: "x" }] });

describe("deleteCustomer", () => {
  it("DELETEs the customer's own path with the version read, no body, and the token", async () => {
    const result = await answer(200, {}).deleteCustomer(TOKEN, "CUST1", 3);
    expect(result).toEqual({ kind: "ok", value: null });
    expect(last()?.url).toBe("https://connect.squareupsandbox.com/v2/customers/CUST1?version=3");
    expect(last()?.init.method).toBe("DELETE");
    expect(last()?.init.body, "nothing in the body").toBeUndefined();
    const headers = new Headers(last()?.init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headers.get("square-version")).toBe(SQUARE_VERSION);
  });

  it("sends version 0 (a customer never changed), and none when none is known", async () => {
    await answer(200, {}).deleteCustomer(TOKEN, "CUST1", 0);
    expect(last()?.url).toBe("https://connect.squareupsandbox.com/v2/customers/CUST1?version=0");
    await answer(200, {}).deleteCustomer(TOKEN, "CUST1", null);
    expect(last()?.url).toBe("https://connect.squareupsandbox.com/v2/customers/CUST1");
  });

  it("answers Square's no as the status and code, and a lost answer as none", async () => {
    expect(await answer(409, error("CONFLICT")).deleteCustomer(TOKEN, "CUST1", 0)).toEqual({ kind: "refused", status: 409, code: "CONFLICT" });
    expect(await answer(404, error("NOT_FOUND")).deleteCustomer(TOKEN, "CUST1", 0)).toEqual({ kind: "refused", status: 404, code: "NOT_FOUND" });
    expect(await answer(401, error("UNAUTHORIZED")).deleteCustomer(TOKEN, "CUST1", 0)).toMatchObject({ kind: "refused", status: 401 });
    expect(await answer(429, {}).deleteCustomer(TOKEN, "CUST1", 0)).toEqual({ kind: "unavailable", status: 429 });
    expect(await answer(503, {}).deleteCustomer(TOKEN, "CUST1", 0)).toEqual({ kind: "unavailable", status: 503 });
  });

  it("never builds a path from an id that is not Square's", async () => {
    const api = answer(200, {});
    const before = recorded.length;
    for (const id of ["", "../v2/payments", "CUST1/cards", "CUST1?x=1", "a b", "x".repeat(65)]) {
      await expect(api.deleteCustomer(TOKEN, id, 0)).rejects.toThrow("not a Square customer id");
    }
    expect(recorded.length, "nothing was sent").toBe(before);
  });
});
