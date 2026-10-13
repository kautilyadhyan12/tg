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
    expect(phoneAppExtraSchema.parse({ apiUrl: "http://localhost:3000" })).toEqual({
      apiUrl: "http://localhost:3000",
    });
    expect(
      phoneAppExtraSchema.parse({ copyName: "Feature 1", apiUrl: "http://localhost:3000" }).copyName,
    ).toBe("Feature 1");
    for (const other of [undefined, {}, { apiUrl: "localhost" }, { apiUrl: "http://x", copyName: "" }]) {
      expect(phoneAppExtraSchema.safeParse(other).success).toBe(false);
    }
  });
});
