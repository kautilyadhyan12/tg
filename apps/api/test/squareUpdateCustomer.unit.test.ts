// The request the app's own Square adapter builds to change a customer (ROADMAP 18d-iii-b-ii-b-ii-b-i), read off a
// recording `fetch`: every route test runs against the fake, so a wrong method, a lost version, `undefined` where
// Square wants `null`, or a dropped header would stay green there. The shape is what Square's test area took on
// 2026-10-28 (`.cost/18d-iii-b-ii-b-ii-b-i/probe-update.mts`).
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
const lastBody = () => {
  const body = last()?.init.body;
  return JSON.parse(typeof body === "string" ? body : "null") as Record<string, unknown>;
};
const lastHeaders = () => new Headers(last()?.init.headers);
const customer = { customer: { id: "CUST1", given_name: "Amy", family_name: "Lee", email_address: "amy@gmail.com", phone_number: "+13125550143", version: 1 } };
const TOKEN = "EAAAtest-access-0123456789"; // dummy, gitleaks:allow

describe("updateCustomer", () => {
  it("PUTs the customer's own path with the version read and only the parts given", async () => {
    const result = await answer(200, customer).updateCustomer(TOKEN, "CUST1", { version: 0, phone: "+13125550143" });
    expect(result).toMatchObject({ kind: "ok", value: { id: "CUST1", version: 1, phone_number: "+13125550143" } });
    expect(last()?.url).toBe("https://connect.squareupsandbox.com/v2/customers/CUST1");
    expect(last()?.init.method).toBe("PUT");
    expect(lastBody()).toEqual({ version: 0, phone_number: "+13125550143" });
    expect(lastHeaders().get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(lastHeaders().get("square-version")).toBe(SQUARE_VERSION);
    expect(lastHeaders().get("x-clear-null"), "no part is cleared, so no header").toBeNull();
  });

  it("clears a part with null, and says so in the header Square names", async () => {
    await answer(200, customer).updateCustomer(TOKEN, "CUST1", { version: 3, email: null, phone: null });
    expect(lastBody()).toEqual({ version: 3, email_address: null, phone_number: null });
    expect(lastHeaders().get("x-clear-null")).toBe("true");
  });

  it("sends a name as its two parts, leaves a part out that is undefined, and leaves the version out when none is known", async () => {
    await answer(200, customer).updateCustomer(TOKEN, "CUST1", { version: null, givenName: "Amy", familyName: "Lee-Chen" });
    expect(lastBody()).toEqual({ given_name: "Amy", family_name: "Lee-Chen" });
    expect("version" in lastBody()).toBe(false);
  });

  it("answers Square's no as the status and code, and a lost answer as none", async () => {
    expect(await answer(409, { errors: [{ category: "INVALID_REQUEST_ERROR", code: "CONFLICT", detail: "Version is not up to date." }] }).updateCustomer(TOKEN, "CUST1", { version: 0, phone: "+13125550143" })).toEqual({
      kind: "refused",
      status: 409,
      code: "CONFLICT",
    });
    expect(await answer(400, { errors: [{ category: "INVALID_REQUEST_ERROR", code: "INVALID_PHONE_NUMBER" }] }).updateCustomer(TOKEN, "CUST1", { version: 0, phone: "+15555550100" })).toEqual({
      kind: "refused",
      status: 400,
      code: "INVALID_PHONE_NUMBER",
    });
    expect(await answer(503, {}).updateCustomer(TOKEN, "CUST1", { version: 0, phone: "+13125550143" })).toEqual({ kind: "unavailable", status: 503 });
    // A 2xx the app cannot read is no answer, never a success.
    expect(await answer(200, { customer: { given_name: "Amy" } }).updateCustomer(TOKEN, "CUST1", { version: 0, phone: "+13125550143" })).toMatchObject({ kind: "unavailable" });
  });

  it("never builds a path from an id that is not Square's", async () => {
    const api = answer(200, customer);
    const before = recorded.length;
    for (const id of ["", "../v2/payments", "CUST1/cards", "a b", "x".repeat(65)]) {
      await expect(api.updateCustomer(TOKEN, id, { version: 0, phone: "+13125550143" })).rejects.toThrow("not a Square customer id");
    }
    expect(recorded.length, "nothing was sent").toBe(before);
  });
});
