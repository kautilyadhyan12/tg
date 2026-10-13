import { describe, expect, it } from "vitest";
import { phoneAppExtraSchema, serverHealthSchema } from "../src/phoneApp.js";

describe("the phone app's first reads", () => {
  it("the api's health reply is ok and nothing else", () => {
    expect(serverHealthSchema.safeParse({ status: "ok" }).success).toBe(true);
    for (const other of [{ status: "down" }, { ok: true }, {}, null, "ok"]) {
      expect(serverHealthSchema.safeParse(other).success).toBe(false);
    }
  });

  it("a build's settings need the api's address; the copy's name is a laptop copy's alone", () => {
    expect(phoneAppExtraSchema.parse({ apiUrl: "https://api.example.com" })).toEqual({
      apiUrl: "https://api.example.com",
    });
    expect(
      phoneAppExtraSchema.parse({ copyName: "Feature 1", apiUrl: "http://localhost:3000" }).copyName,
    ).toBe("Feature 1");
    for (const other of [undefined, {}, { apiUrl: "localhost" }, { apiUrl: "http://x", copyName: "" }]) {
      expect(phoneAppExtraSchema.safeParse(other).success).toBe(false);
    }
  });

  it("the store's app, which has no copy name, reaches its server over https only", () => {
    // A laptop's copy goes down the USB cable; the store's app sends a person's sign-in over the internet.
    expect(phoneAppExtraSchema.safeParse({ apiUrl: "https://api.example.com" }).success).toBe(true);
    for (const plain of ["http://api.example.com", "http://localhost:3000", "ws://api.example.com"]) {
      expect([plain, phoneAppExtraSchema.safeParse({ apiUrl: plain }).success]).toEqual([plain, false]);
    }
    expect(phoneAppExtraSchema.safeParse({ copyName: "Feature 1", apiUrl: "http://localhost:3000" }).success).toBe(true);
  });
});
