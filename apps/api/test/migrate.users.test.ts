// P2.7b — pure transform tests for the users stage (no DB/Mongo).
import { describe, expect, it } from "vitest";
import { transformUser } from "../tools/migrate-mongo/collections/users.js";
import { weightToKg, KG_PER_LB } from "../tools/migrate-mongo/weight.js";
import { uuidv5 } from "../tools/migrate-mongo/uuid5.js";

const base = { _id: "69f31cbbf93bc0c7a04016f1", email: "alice@example.com", fullName: "Alice Roy" };

describe("weightToKg", () => {
  it("converts lbs and passes kg through; rounds to 2dp", () => {
    expect(weightToKg({ value: 154, unit: "lb" })).toBe(Math.round(154 * KG_PER_LB * 100) / 100);
    expect(weightToKg({ value: 70, unit: "kg" })).toBe(70);
    expect(weightToKg({ value: 70 })).toBe(70); // unit defaults to kg
  });
  it("returns null for missing/invalid — never fabricates 70", () => {
    expect(weightToKg(undefined)).toBeNull();
    expect(weightToKg(null)).toBeNull();
    expect(weightToKg({ value: 0, unit: "kg" })).toBeNull();
    expect(weightToKg({ value: -5, unit: "kg" })).toBeNull();
    expect(weightToKg({ unit: "kg" })).toBeNull();
  });
  it("clamps out-of-range weights to null (numeric(5,2) overflow — T3 finding 6)", () => {
    expect(weightToKg({ value: 1500, unit: "kg" })).toBeNull();
    expect(weightToKg({ value: 3000, unit: "lb" })).toBeNull(); // 1360.78 kg > 999.99
  });
});

describe("transformUser", () => {
  it("maps credentials + profile; hash_algo='bcrypt'; id is deterministic UUIDv5", () => {
    const row = transformUser({ ...base, password: "$2b$10$abcdefghijklmnopqrstuv", weight: { value: 60, unit: "kg" } });
    expect(row).not.toBeNull();
    expect(row?.id).toBe(uuidv5(base._id));
    expect(row?.legacyMongoId).toBe(base._id);
    expect(row?.email).toBe("alice@example.com");
    expect(row?.passwordHash).toBe("$2b$10$abcdefghijklmnopqrstuv");
    expect(row?.hashAlgo).toBe("bcrypt");
    expect(row?.displayName).toBe("Alice Roy");
    expect(row?.weightKg).toBe(60);
  });

  it("OAuth-only user (no password) → null hash + null hash_algo", () => {
    const row = transformUser({ _id: "aa11bb22cc33dd44ee55ff66", email: "g@example.com", googleId: "x" });
    expect(row?.passwordHash).toBeNull();
    expect(row?.hashAlgo).toBeNull();
  });

  it("display_name falls back to email local-part, then 'Member'", () => {
    expect(transformUser({ _id: "1a", email: "bob@example.com", fullName: "  " })?.displayName).toBe("bob");
    expect(transformUser({ _id: "1b" })?.displayName).toBe("Member");
  });

  it("drops onboarding fields (no target columns) and returns null for a doc with no _id", () => {
    const row = transformUser({ ...base, age: 30, fitnessLevel: "advanced", availableEquipment: ["dumbbells"] });
    expect(row).not.toBeNull();
    expect(Object.keys(row ?? {})).not.toContain("age");
    expect(transformUser({ email: "x@example.com" })).toBeNull(); // no _id
  });

  it("a malformed email does NOT discard the user or its bcrypt hash (T3 finding 4)", () => {
    const row = transformUser({ _id: "cc11", email: "not-an-email", password: "$2b$10$xxxxxxxxxxxxxxxxxxxxxx" });
    expect(row).not.toBeNull();
    expect(row?.passwordHash).toBe("$2b$10$xxxxxxxxxxxxxxxxxxxxxx");
    expect(row?.hashAlgo).toBe("bcrypt");
  });

  it("an unparseable lastLogin → null lastActiveAt, never an Invalid Date (T3 finding 3)", () => {
    expect(transformUser({ ...base, lastLogin: "not-a-date" })?.lastActiveAt).toBeNull();
    expect(transformUser({ ...base, lastLogin: "2025-03-01T00:00:00Z" })?.lastActiveAt).toBeInstanceOf(Date);
  });
});
